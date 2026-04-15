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
    encrypt:                process.env.DB_ENCRYPT    === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// ─── Table name validation ────────────────────────────────────────────────────
// Table names cannot be parameterized in SQL, so we validate strictly before
// interpolating. Only alphanumeric characters and underscores are allowed —
// this blocks every SQL injection vector while covering all real table names.
function validateTable(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
    const err = new Error(`Invalid or missing table name: "${name}"`);
    err.status = 400;
    throw err;
  }
  return name;
}

// ─── Per-table column cache ───────────────────────────────────────────────────
// Keyed by table name so any number of tables can be served without re-querying
// information_schema on every request.
const columnCacheMap = new Map(); // tableName → string[]

async function getColumns(tableName) {
  if (columnCacheMap.has(tableName)) return columnCacheMap.get(tableName);

  const pool   = await getPool();
  // table_name is a WHERE value so @tableName parameterization is safe
  const result = await pool.request()
    .input('tableName', sql.NVarChar(128), tableName)
    .query(`
      SELECT column_name
      FROM   information_schema.columns
      WHERE  table_schema = 'dbo'
        AND  table_name   = @tableName
      ORDER  BY ordinal_position
    `);

  const columns = result.recordset.map((r) => r.column_name);
  columnCacheMap.set(tableName, columns);
  return columns;
}

// ─── GET /api/metadata?table=<name>  →  { columns: string[], rowCount: number }
app.get('/api/metadata', async (req, res) => {
  try {
    const table = validateTable(req.query.table);
    const pool  = await getPool();

    const [columns, countResult] = await Promise.all([
      getColumns(table),
      pool.request().query(`SELECT COUNT(*) AS cnt FROM [${table}]`),
    ]);

    res.json({ columns, rowCount: countResult.recordset[0].cnt });
  } catch (err) {
    console.error('[metadata]', err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ─── GET /api/data?table=<name>&rowStart&rowEnd&colStart&colEnd ───────────────
//     →  { rows: object[], columns: string[] }
app.get('/api/data', async (req, res) => {
  try {
    const table    = validateTable(req.query.table);
    const rowStart = Math.max(0, parseInt(req.query.rowStart ?? 0,  10));
    const rowEnd   =             parseInt(req.query.rowEnd   ?? 99,  10);
    const colStart = Math.max(0, parseInt(req.query.colStart ?? 0,  10));
    const colEnd   =             parseInt(req.query.colEnd   ?? 29,  10);

    const allColumns      = await getColumns(table);
    const selectedColumns = allColumns.slice(colStart, colEnd + 1);
    if (selectedColumns.length === 0) return res.json({ rows: [], columns: [] });

    const colList  = selectedColumns.map((c) => `[${c}]`).join(', ');
    const rowLimit = rowEnd - rowStart + 1;

    const pool   = await getPool();
    const result = await pool.request()
      .input('offset', sql.Int, rowStart)
      .input('limit',  sql.Int, rowLimit)
      .query(`
        SELECT ${colList}
        FROM   [${table}]
        ORDER  BY [ID]
        OFFSET @offset ROWS
        FETCH  NEXT @limit ROWS ONLY
      `);

    res.json({ rows: result.recordset, columns: selectedColumns });
  } catch (err) {
    console.error('[data]', err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ─── PUT /api/cell  →  update a single cell value ────────────────────────────
// Body: { table: string, rowIndex: number, column: string, value: string | null }
app.put('/api/cell', async (req, res) => {
  try {
    const { rowIndex, column, value } = req.body;
    const table = validateTable(req.body.table);

    if (typeof rowIndex !== 'number' || !column) {
      return res.status(400).json({ error: 'rowIndex (number) and column (string) are required' });
    }

    const allColumns = await getColumns(table);
    if (!allColumns.includes(column)) {
      return res.status(400).json({ error: `Unknown column: ${column}` });
    }

    const pool = await getPool();
    await pool.request()
      .input('value',  sql.NVarChar(sql.MAX), value)
      .input('offset', sql.Int,               rowIndex)
      .query(`
        UPDATE [${table}]
        SET    [${column}] = @value
        WHERE  [ID] = (
          SELECT [ID] FROM [${table}]
          ORDER  BY [ID]
          OFFSET @offset ROWS FETCH NEXT 1 ROWS ONLY
        )
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('[cell update]', err.message);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend (MSSQL) listening on http://localhost:${PORT}`));
