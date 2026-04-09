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
const COLUMN_WIDTH = 150;   // px per column
const ROW_HEIGHT   = 36;    // px per data row
const HEADER_HEIGHT = 42;   // px for the sticky header strip

// Data is fetched in chunks so we batch many cells into one network request.
// Adjust these to tune the trade-off between network calls and over-fetching.
const CHUNK_ROWS = 100;
const CHUNK_COLS = 30;

// ─── Cell (defined outside VirtualGrid so react-window never recreates it) ───
/**
 * itemData shape: { cacheRef, loadingChunksRef, version }
 *
 * `version` is incremented every time cacheRef is updated, which causes
 * React.memo to let the cell re-render and pick up new values.
 */
const Cell = memo(({ columnIndex, rowIndex, style, data }) => {
  const { cacheRef, loadingChunksRef } = data;

  const chunkKey = `${Math.floor(rowIndex / CHUNK_ROWS)}_${Math.floor(columnIndex / CHUNK_COLS)}`;
  const cellKey  = `${rowIndex}_${columnIndex}`;

  const value     = cacheRef.current.get(cellKey);
  const isLoading = loadingChunksRef.current.has(chunkKey);
  const isEven    = rowIndex % 2 === 0;

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 10,
        paddingRight: 10,
        borderRight: '1px solid #e2e8f0',
        borderBottom: '1px solid #e2e8f0',
        backgroundColor: isEven ? '#ffffff' : '#f8fafc',
        fontSize: 13,
        fontFamily: "'Menlo', 'Consolas', monospace",
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        boxSizing: 'border-box',
        color: '#374151',
        userSelect: 'text',
      }}
      title={value !== undefined ? String(value) : undefined}
    >
      {isLoading && value === undefined ? (
        <span style={{ color: '#94a3b8', fontSize: 11 }}>loading…</span>
      ) : value !== undefined ? (
        String(value)
      ) : (
        <span style={{ color: '#cbd5e1' }}>—</span>
      )}
    </div>
  );
});

Cell.displayName = 'Cell';

// ─── VirtualGrid ─────────────────────────────────────────────────────────────
export default function VirtualGrid({ columns, rowCount }) {
  // Mutable cache — storing here avoids triggering React re-renders on every
  // cell write. We bump `version` only after a whole chunk lands, causing a
  // single re-render that refreshes all visible cells.
  const cacheRef         = useRef(new Map()); // `${row}_${col}` → string value
  const loadedChunksRef  = useRef(new Set()); // chunk keys already fetched
  const loadingChunksRef = useRef(new Set()); // chunk keys currently in-flight
  const [version, bump]  = useReducer((v) => v + 1, 0);

  // Ref used to sync header scroll with grid scroll
  const headerRef = useRef(null);

  // Measure the wrapper element so react-window gets real pixel dimensions
  const wrapperRef                        = useRef(null);
  const [wrapperSize, setWrapperSize]     = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapperRef.current) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setWrapperSize({ width, height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchChunk = useCallback(
    async (chunkRowIdx, chunkColIdx) => {
      const key = `${chunkRowIdx}_${chunkColIdx}`;
      if (loadedChunksRef.current.has(key) || loadingChunksRef.current.has(key)) return;

      loadingChunksRef.current.add(key);
      bump(); // show "loading…" placeholders immediately

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
          // Object.values preserves the order returned by the server, which
          // matches the column slice we requested.
          Object.values(row).forEach((value, colOffset) => {
            cacheRef.current.set(
              `${rowStart + rowOffset}_${colStart + colOffset}`,
              value !== null && value !== undefined ? String(value) : ''
            );
          });
        });

        loadedChunksRef.current.add(key);
      } catch (err) {
        console.error('[VirtualGrid] chunk fetch failed:', err.message);
        // Remove from loading so it can be retried on next scroll
      } finally {
        loadingChunksRef.current.delete(key);
        bump(); // re-render visible cells with fresh data
      }
    },
    [columns.length, rowCount]
  );

  // ── react-window callbacks ─────────────────────────────────────────────────
  const handleItemsRendered = useCallback(
    ({
      visibleRowStartIndex,
      visibleRowStopIndex,
      visibleColumnStartIndex,
      visibleColumnStopIndex,
    }) => {
      const crStart = Math.floor(visibleRowStartIndex  / CHUNK_ROWS);
      const crEnd   = Math.floor(visibleRowStopIndex   / CHUNK_ROWS);
      const ccStart = Math.floor(visibleColumnStartIndex / CHUNK_COLS);
      const ccEnd   = Math.floor(visibleColumnStopIndex  / CHUNK_COLS);

      for (let cr = crStart; cr <= crEnd; cr++) {
        for (let cc = ccStart; cc <= ccEnd; cc++) {
          fetchChunk(cr, cc);
        }
      }
    },
    [fetchChunk]
  );

  const handleScroll = useCallback(({ scrollLeft }) => {
    if (headerRef.current) headerRef.current.scrollLeft = scrollLeft;
  }, []);

  // ── itemData ───────────────────────────────────────────────────────────────
  // `version` changes → new object → React.memo on Cell sees changed prop →
  // visible cells re-render and read fresh values from cacheRef.
  const itemData = useMemo(
    () => ({ cacheRef, loadingChunksRef, version }),
    [version]
  );

  // ── Dimensions ─────────────────────────────────────────────────────────────
  // Height available to the grid itself = wrapper height minus the header strip.
  // Clamp to a minimum so it's usable while the ResizeObserver hasn't fired yet.
  const gridWidth  = wrapperSize.width  || 800;
  const gridHeight = (wrapperSize.height || 600) - HEADER_HEIGHT;

  return (
    <div className="vg-outer">
      {/* Row/column count badge */}
      <div className="vg-badge">
        Showing {rowCount.toLocaleString()} rows × {columns.length} columns
        &nbsp;—&nbsp;scroll to explore
      </div>

      {/* Wrapper that fills available space; measured for react-window */}
      <div ref={wrapperRef} className="vg-wrapper">
        {/* ── Sticky header ── */}
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

        {/* ── Data grid ── */}
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
