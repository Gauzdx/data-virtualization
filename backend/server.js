import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from 'pg';

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'TTM_DEV',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

// In-process column cache so schema isn't re-queried on every data fetch
let columnCache = null;

async function getColumns() {
  if (columnCache) return columnCache;
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ttm_random_data'
     ORDER BY ordinal_position`
  );
  columnCache = result.rows.map((r) => r.column_name);
  return columnCache;
}

// GET /api/metadata  →  { columns: string[], rowCount: number }
app.get('/api/metadata', async (_req, res) => {
  try {
    const [columns, countResult] = await Promise.all([
      getColumns(),
      pool.query('SELECT COUNT(*) FROM ttm_random_data'),
    ]);
    res.json({ columns, rowCount: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    console.error('[metadata]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data?rowStart=0&rowEnd=99&colStart=0&colEnd=29
//   →  { rows: object[], columns: string[] }
app.get('/api/data', async (req, res) => {
  try {
    const rowStart = Math.max(0, parseInt(req.query.rowStart ?? 0, 10));
    const rowEnd   = parseInt(req.query.rowEnd   ?? 99,  10);
    const colStart = Math.max(0, parseInt(req.query.colStart ?? 0,  10));
    const colEnd   = parseInt(req.query.colEnd   ?? 29,  10);

    const allColumns = await getColumns();

    const selectedColumns = allColumns.slice(colStart, colEnd + 1);
    if (selectedColumns.length === 0) return res.json({ rows: [], columns: [] });

    // Quote each identifier to handle mixed-case / reserved-word column names
    const colList   = selectedColumns.map((c) => `"${c}"`).join(', ');
    const rowLimit  = rowEnd - rowStart + 1;

    const result = await pool.query(
      `SELECT ${colList} FROM ttm_random_data ORDER BY "ID" LIMIT $1 OFFSET $2`,
      [rowLimit, rowStart]
    );

    res.json({ rows: result.rows, columns: selectedColumns });
  } catch (err) {
    console.error('[data]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cell  →  update a single cell value
// Body: { rowIndex: number, column: string, value: string | null }
app.put('/api/cell', async (req, res) => {
  try {
    const { rowIndex, column, value } = req.body;

    if (typeof rowIndex !== 'number' || !column) {
      return res.status(400).json({ error: 'rowIndex (number) and column (string) are required' });
    }

    const allColumns = await getColumns();
    if (!allColumns.includes(column)) {
      return res.status(400).json({ error: `Unknown column: ${column}` });
    }

    // Look up the ID at the given display position (ORDER BY "ID" matches the
    // fetch query), then update directly by PK.
    await pool.query(
      `UPDATE ttm_random_data
       SET    "${column}" = $1
       WHERE  "ID" = (
         SELECT "ID" FROM ttm_random_data ORDER BY "ID" LIMIT 1 OFFSET $2
       )`,
      [value, rowIndex]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[cell update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
