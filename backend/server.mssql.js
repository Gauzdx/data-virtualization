import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sql from 'mssql';

const app = express();
app.use(cors());
app.use(express.json());

// ─── Connection pool ──────────────────────────────────────────────────────────
const dbConfig = {
  server:   process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME     || 'TTM_DEV',
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    // Set DB_ENCRYPT=true when connecting to Azure SQL or over TLS
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    // Set DB_TRUST_CERT=false in production when a valid CA-signed cert is used
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// Lazily initialised singleton pool — reconnects automatically on first error
let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig).catch((err) => {
      poolPromise = null; // allow retry on next request
      throw err;
    });
  }
  return poolPromise;
}

// ─── Column cache ─────────────────────────────────────────────────────────────
let columnCache = null;

async function getColumns() {
  if (columnCache) return columnCache;
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT column_name
    FROM   information_schema.columns
    WHERE  table_schema = 'dbo'
      AND  table_name   = 'ttm_random_data'
    ORDER  BY ordinal_position
  `);
  columnCache = result.recordset.map((r) => r.column_name);
  return columnCache;
}

// ─── GET /api/metadata  →  { columns: string[], rowCount: number } ───────────
app.get('/api/metadata', async (_req, res) => {
  try {
    const pool = await getPool();
    const [columns, countResult] = await Promise.all([
      getColumns(),
      pool.request().query('SELECT COUNT(*) AS cnt FROM ttm_random_data'),
    ]);
    res.json({ columns, rowCount: countResult.recordset[0].cnt });
  } catch (err) {
    console.error('[metadata]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/data?rowStart&rowEnd&colStart&colEnd ────────────────────────────
//     →  { rows: object[], columns: string[] }
app.get('/api/data', async (req, res) => {
  try {
    const rowStart = Math.max(0, parseInt(req.query.rowStart ?? 0,  10));
    const rowEnd   =             parseInt(req.query.rowEnd   ?? 99,  10);
    const colStart = Math.max(0, parseInt(req.query.colStart ?? 0,  10));
    const colEnd   =             parseInt(req.query.colEnd   ?? 29,  10);

    const allColumns      = await getColumns();
    const selectedColumns = allColumns.slice(colStart, colEnd + 1);
    if (selectedColumns.length === 0) return res.json({ rows: [], columns: [] });

    // Bracket-quote identifiers for MSSQL
    const colList  = selectedColumns.map((c) => `[${c}]`).join(', ');
    const rowLimit = rowEnd - rowStart + 1;

    const pool   = await getPool();
    const result = await pool.request()
      .input('offset', sql.Int, rowStart)
      .input('limit',  sql.Int, rowLimit)
      .query(`
        SELECT ${colList}
        FROM   ttm_random_data
        ORDER  BY [ID]
        OFFSET @offset ROWS
        FETCH  NEXT @limit ROWS ONLY
      `);

    res.json({ rows: result.recordset, columns: selectedColumns });
  } catch (err) {
    console.error('[data]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/cell  →  update a single cell value ────────────────────────────
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

    const pool = await getPool();

    // Look up the ID at the given display position (ORDER BY [ID] matches the
    // fetch query), then update directly by PK — no ROW_NUMBER() needed.
    // We send value as NVARCHAR(MAX) and let MSSQL implicitly cast to the
    // target column type (e.g. '42' → INT, null → NULL).
    await pool.request()
      .input('value',    sql.NVarChar(sql.MAX), value)
      .input('offset',   sql.Int,               rowIndex)
      .query(`
        UPDATE ttm_random_data
        SET    [${column}] = @value
        WHERE  [ID] = (
          SELECT [ID] FROM ttm_random_data
          ORDER  BY [ID]
          OFFSET @offset ROWS FETCH NEXT 1 ROWS ONLY
        )
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('[cell update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend (MSSQL) listening on http://localhost:${PORT}`));
