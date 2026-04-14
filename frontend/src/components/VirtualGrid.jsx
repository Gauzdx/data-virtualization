import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Grid } from 'react-window';
import './VirtualGrid.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const COLUMN_WIDTH  = 150;
const ROW_HEIGHT    = 36;
const HEADER_HEIGHT = 42;
const CHUNK_ROWS    = 100;
const CHUNK_COLS    = 30;

// ─── Cell ─────────────────────────────────────────────────────────────────────
// Defined outside VirtualGrid so Grid always receives the same component
// reference and never forcibly unmounts/remounts every visible cell.
//
// react-window v2 spreads `cellProps` directly into cell component props
// (no `data` wrapper). Grid also injects `ariaAttributes` automatically.
//
// cellProps shape:
//   { cacheRef, loadingChunksRef, version,
//     editingCell: {rowIndex,colIndex}|null,
//     onStartEdit: (rowIndex, colIndex) => void,
//     onCommit:    (rowIndex, colIndex, value: string) => void,
//     onCancel:    () => void }
const Cell = memo(({
  columnIndex,
  rowIndex,
  style,
  ariaAttributes,
  cacheRef,
  loadingChunksRef,
  editingCell,
  onStartEdit,
  onCommit,
  onCancel,
}) => {
  const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === columnIndex;
  const chunkKey  = `${Math.floor(rowIndex / CHUNK_ROWS)}_${Math.floor(columnIndex / CHUNK_COLS)}`;
  const cellKey   = `${rowIndex}_${columnIndex}`;
  const value     = cacheRef.current.get(cellKey);
  const isLoading = loadingChunksRef.current.has(chunkKey);
  const isEven    = rowIndex % 2 === 0;

  // ── Editing mode ────────────────────────────────────────────────────────────
  if (isEditing) {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); onCommit(rowIndex, columnIndex, e.target.value); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    return (
      <div style={{ ...style, padding: 0, boxSizing: 'border-box' }}>
        <input
          className="vg-cell-input"
          autoFocus
          defaultValue={value ?? ''}
          onKeyDown={handleKeyDown}
          onBlur={(e) => onCommit(rowIndex, columnIndex, e.target.value)}
        />
      </div>
    );
  }

  // ── Display mode ─────────────────────────────────────────────────────────
  return (
    <div
      {...ariaAttributes}
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

  // ── Header scroll sync ────────────────────────────────────────────────────
  // The header is a separate overflow:hidden div above the Grid.
  // We sync its scrollLeft with the Grid's scroll via the onScroll DOM event.
  const headerRef = useRef(null);

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

  // ── Grid callbacks ────────────────────────────────────────────────────────
  // v2: onCellsRendered(visibleCells, allCells)
  //   visibleCells: { rowStartIndex, rowStopIndex, columnStartIndex, columnStopIndex }
  //   (v1 used visibleRowStartIndex / visibleColumnStartIndex — names changed in v2)
  const handleCellsRendered = useCallback(
    (visibleCells) => {
      const { rowStartIndex, rowStopIndex, columnStartIndex, columnStopIndex } = visibleCells;

      const crStart = Math.floor(rowStartIndex    / CHUNK_ROWS);
      const crEnd   = Math.floor(rowStopIndex     / CHUNK_ROWS);
      const ccStart = Math.floor(columnStartIndex / CHUNK_COLS);
      const ccEnd   = Math.floor(columnStopIndex  / CHUNK_COLS);

      for (let cr = crStart; cr <= crEnd; cr++)
        for (let cc = ccStart; cc <= ccEnd; cc++)
          fetchChunk(cr, cc);
    },
    [fetchChunk]
  );

  // v2: onScroll is a standard DOM UIEvent (not a custom callback like v1).
  //   Read scrollLeft from e.currentTarget instead of the destructured arg.
  const handleScroll = useCallback((e) => {
    if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  // ── cellProps ─────────────────────────────────────────────────────────────
  // v2 replaces v1's `itemData` with `cellProps`.
  // Grid spreads this object directly into every cell component's props.
  // Re-created when version OR editingCell changes so Cell.memo invalidates
  // and visible cells re-render with fresh cache / edit state.
  const cellProps = useMemo(
    () => ({
      cacheRef,
      loadingChunksRef,
      version,
      editingCell,
      onStartEdit: startEdit,
      onCommit:    commitEdit,
      onCancel:    cancelEdit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, editingCell]
  );

  // ── Editing callbacks ─────────────────────────────────────────────────────
  function startEdit(rowIndex, colIndex) {
    commitLockRef.current = false;
    setSaveError(null);
    setEditingCell({ rowIndex, colIndex });
  }

  function cancelEdit() {
    commitLockRef.current = false;
    setEditingCell(null);
  }

  async function commitEdit(rowIndex, colIndex, rawValue) {
    if (commitLockRef.current) return;
    commitLockRef.current = true;

    setEditingCell(null);

    const column    = columns[colIndex];
    const trimmed   = rawValue.trim();
    const sendValue = trimmed === '' ? null : trimmed;

    const prevValue = cacheRef.current.get(`${rowIndex}_${colIndex}`);
    cacheRef.current.set(`${rowIndex}_${colIndex}`, sendValue ?? '');
    bump();

    try {
      const res = await fetch('/api/cell', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rowIndex, column, value: sendValue }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || `HTTP ${res.status}`);
      }
    } catch (err) {
      cacheRef.current.set(`${rowIndex}_${colIndex}`, prevValue ?? '');
      setSaveError(err.message);
      bump();
    } finally {
      commitLockRef.current = false;
    }
  }

  // cellProps references startEdit/commitEdit/cancelEdit which are plain
  // functions redefined each render — stable enough since cellProps is
  // re-created on version/editingCell change anyway.

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

      {/* vg-wrapper is flex-column; header takes fixed height, Grid fills the rest */}
      <div className="vg-wrapper">
        {/* Sticky column-header strip — overflow:hidden hides its own scrollbar */}
        <div ref={headerRef} className="vg-header" style={{ height: HEADER_HEIGHT }}>
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

        {/* Data grid — v2 Grid auto-sizes via its internal ResizeObserver.
            style={{ flex: 1 }} fills the remaining height after the header. */}
        <Grid
          className="vg-grid"
          style={{ flex: 1 }}
          columnCount={columns.length}
          columnWidth={COLUMN_WIDTH}
          rowCount={rowCount}
          rowHeight={ROW_HEIGHT}
          cellComponent={Cell}
          cellProps={cellProps}
          onCellsRendered={handleCellsRendered}
          onScroll={handleScroll}
          overscanCount={5}
        />
      </div>
    </div>
  );
}
