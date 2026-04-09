import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { FixedSizeGrid } from 'react-window';
import './VirtualGrid.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const COLUMN_WIDTH  = 150;
const ROW_HEIGHT    = 36;
const HEADER_HEIGHT = 42;
const CHUNK_ROWS    = 100;
const CHUNK_COLS    = 30;

// ─── Cell ─────────────────────────────────────────────────────────────────────
// Defined outside VirtualGrid so react-window always gets the same component
// reference and never forcibly unmounts/remounts every visible cell.
//
// itemData shape:
//   { cacheRef, loadingChunksRef, version,
//     editingCell: {rowIndex,colIndex}|null,
//     onStartEdit: (rowIndex, colIndex) => void,
//     onCommit:    (rowIndex, colIndex, value: string) => void,
//     onCancel:    () => void }
const Cell = memo(({ columnIndex, rowIndex, style, data }) => {
  const { cacheRef, loadingChunksRef, editingCell, onStartEdit, onCommit, onCancel } = data;

  const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === columnIndex;
  const chunkKey  = `${Math.floor(rowIndex / CHUNK_ROWS)}_${Math.floor(columnIndex / CHUNK_COLS)}`;
  const cellKey   = `${rowIndex}_${columnIndex}`;
  const value     = cacheRef.current.get(cellKey);
  const isLoading = loadingChunksRef.current.has(chunkKey);
  const isEven    = rowIndex % 2 === 0;

  // ── Editing mode ────────────────────────────────────────────────────────────
  if (isEditing) {
    // Uncontrolled input — we read its value from the DOM on commit/cancel.
    // This avoids re-rendering the entire grid on every keystroke.
    const handleKeyDown = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); onCommit(rowIndex, columnIndex, e.target.value); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    const handleBlur = (e) => onCommit(rowIndex, columnIndex, e.target.value);

    return (
      <div style={{ ...style, padding: 0, boxSizing: 'border-box' }}>
        <input
          className="vg-cell-input"
          // autoFocus causes the input to grab focus as soon as it mounts
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          defaultValue={value ?? ''}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
    );
  }

  // ── Display mode ─────────────────────────────────────────────────────────
  return (
    <div
      className={`vg-data-cell${isEven ? '' : ' vg-data-cell--odd'}`}
      style={style}
      title={value !== undefined ? String(value) : undefined}
      onDoubleClick={() => onStartEdit(rowIndex, columnIndex)}
    >
      {isLoading && value === undefined ? (
        <span className="vg-cell-loading">loading…</span>
      ) : value !== undefined && value !== '' ? (
        String(value)
      ) : value === '' ? (
        <span className="vg-cell-empty">empty</span>
      ) : (
        <span className="vg-cell-placeholder">—</span>
      )}
    </div>
  );
});

Cell.displayName = 'Cell';

// ─── VirtualGrid ─────────────────────────────────────────────────────────────
export default function VirtualGrid({ columns, rowCount }) {
  // ── Data cache (mutable, no re-render on write) ───────────────────────────
  const cacheRef         = useRef(new Map()); // `${row}_${col}` → string
  const loadedChunksRef  = useRef(new Set());
  const loadingChunksRef = useRef(new Set());
  const [version, bump]  = useReducer((v) => v + 1, 0);

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState(null); // { rowIndex, colIndex }
  const [saveError,   setSaveError]   = useState(null);
  // Guard against double-commit when both Enter (keydown) and blur fire
  const commitLockRef = useRef(false);

  // ── Layout ────────────────────────────────────────────────────────────────
  const headerRef                      = useRef(null);
  const wrapperRef                     = useRef(null);
  const [wrapperSize, setWrapperSize]  = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setWrapperSize({ width, height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchChunk = useCallback(
    async (chunkRowIdx, chunkColIdx) => {
      const key = `${chunkRowIdx}_${chunkColIdx}`;
      if (loadedChunksRef.current.has(key) || loadingChunksRef.current.has(key)) return;

      loadingChunksRef.current.add(key);
      bump();

      const rowStart = chunkRowIdx * CHUNK_ROWS;
      const rowEnd   = Math.min(rowStart + CHUNK_ROWS - 1, rowCount - 1);
      const colStart = chunkColIdx * CHUNK_COLS;
      const colEnd   = Math.min(colStart + CHUNK_COLS - 1, columns.length - 1);

      try {
        const res = await fetch(
          `/api/data?rowStart=${rowStart}&rowEnd=${rowEnd}&colStart=${colStart}&colEnd=${colEnd}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { rows } = await res.json();

        rows.forEach((row, rowOffset) => {
          Object.values(row).forEach((val, colOffset) => {
            cacheRef.current.set(
              `${rowStart + rowOffset}_${colStart + colOffset}`,
              val !== null && val !== undefined ? String(val) : ''
            );
          });
        });
        loadedChunksRef.current.add(key);
      } catch (err) {
        console.error('[VirtualGrid] chunk fetch failed:', err.message);
      } finally {
        loadingChunksRef.current.delete(key);
        bump();
      }
    },
    [columns.length, rowCount]
  );

  // ── Editing callbacks ─────────────────────────────────────────────────────
  const startEdit = useCallback((rowIndex, colIndex) => {
    commitLockRef.current = false;
    setSaveError(null);
    setEditingCell({ rowIndex, colIndex });
  }, []);

  const cancelEdit = useCallback(() => {
    commitLockRef.current = false;
    setEditingCell(null);
  }, []);

  const commitEdit = useCallback(
    async (rowIndex, colIndex, rawValue) => {
      if (commitLockRef.current) return;
      commitLockRef.current = true;

      // Close the editor immediately for snappy UX
      setEditingCell(null);

      const column    = columns[colIndex];
      const trimmed   = rawValue.trim();
      const sendValue = trimmed === '' ? null : trimmed;

      // Optimistically update the local cache so the cell reflects the new
      // value without waiting for the network round-trip.
      const prevValue = cacheRef.current.get(`${rowIndex}_${colIndex}`);
      cacheRef.current.set(`${rowIndex}_${colIndex}`, sendValue ?? '');
      bump();

      try {
        const res = await fetch('/api/cell', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowIndex, column, value: sendValue }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          throw new Error(error || `HTTP ${res.status}`);
        }
      } catch (err) {
        // Roll back optimistic update on failure
        cacheRef.current.set(`${rowIndex}_${colIndex}`, prevValue ?? '');
        setSaveError(err.message);
        bump();
      } finally {
        commitLockRef.current = false;
      }
    },
    [columns, bump]
  );

  // ── react-window callbacks ────────────────────────────────────────────────
  const handleItemsRendered = useCallback(
    ({ visibleRowStartIndex, visibleRowStopIndex, visibleColumnStartIndex, visibleColumnStopIndex }) => {
      const crStart = Math.floor(visibleRowStartIndex    / CHUNK_ROWS);
      const crEnd   = Math.floor(visibleRowStopIndex     / CHUNK_ROWS);
      const ccStart = Math.floor(visibleColumnStartIndex / CHUNK_COLS);
      const ccEnd   = Math.floor(visibleColumnStopIndex  / CHUNK_COLS);
      for (let cr = crStart; cr <= crEnd; cr++)
        for (let cc = ccStart; cc <= ccEnd; cc++)
          fetchChunk(cr, cc);
    },
    [fetchChunk]
  );

  const handleScroll = useCallback(({ scrollLeft }) => {
    if (headerRef.current) headerRef.current.scrollLeft = scrollLeft;
  }, []);

  // ── itemData ──────────────────────────────────────────────────────────────
  // Re-created when version OR editingCell changes so Cell.memo invalidates.
  const itemData = useMemo(
    () => ({ cacheRef, loadingChunksRef, version, editingCell, onStartEdit: startEdit, onCommit: commitEdit, onCancel: cancelEdit }),
    [version, editingCell, startEdit, commitEdit, cancelEdit]
  );

  // ── Dimensions ────────────────────────────────────────────────────────────
  const gridWidth  = wrapperSize.width  || 800;
  const gridHeight = (wrapperSize.height || 600) - HEADER_HEIGHT;

  return (
    <div className="vg-outer">
      <div className="vg-toolbar">
        <span className="vg-badge">
          {rowCount.toLocaleString()} rows &times; {columns.length} columns
          &nbsp;&mdash;&nbsp;double-click any cell to edit
        </span>
        {saveError && (
          <span className="vg-save-error" role="alert">
            Save failed: {saveError}
            <button className="vg-save-error-close" onClick={() => setSaveError(null)}>✕</button>
          </span>
        )}
      </div>

      <div ref={wrapperRef} className="vg-wrapper">
        {/* Sticky column-header strip */}
        <div
          ref={headerRef}
          className="vg-header"
          style={{ width: gridWidth, height: HEADER_HEIGHT }}
        >
          {columns.map((col, i) => (
            <div
              key={i}
              className="vg-header-cell"
              style={{ minWidth: COLUMN_WIDTH, width: COLUMN_WIDTH }}
              title={col}
            >
              {col}
            </div>
          ))}
        </div>

        {/* Data grid */}
        {gridWidth > 0 && (
          <FixedSizeGrid
            columnCount={columns.length}
            columnWidth={COLUMN_WIDTH}
            rowCount={rowCount}
            rowHeight={ROW_HEIGHT}
            width={gridWidth}
            height={gridHeight}
            itemData={itemData}
            onScroll={handleScroll}
            onItemsRendered={handleItemsRendered}
            className="vg-grid"
          >
            {Cell}
          </FixedSizeGrid>
        )}
      </div>
    </div>
  );
}
