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
	password: process.env.DB_PASSWORD || ''
});

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

	// table_name is a WHERE value here, so $1 parameterization is safe
	const result = await pool.query(
		`SELECT column_name
     FROM   information_schema.columns
     WHERE  table_schema = 'public'
       AND  table_name   = $1
     ORDER  BY ordinal_position`,
		[tableName]
	);
	const columns = result.rows.map((r) => r.column_name);
	columnCacheMap.set(tableName, columns);
	return columns;
}

// ─── GET /api/metadata?table=<name>  →  { columns: string[], rowCount: number }
app.get('/api/metadata', async (req, res) => {
	try {
		const table = validateTable(req.query.table);

		const [columns, countResult] = await Promise.all([getColumns(table), pool.query(`SELECT COUNT(*) FROM "${table}"`)]);

		res.json({ columns, rowCount: parseInt(countResult.rows[0].count, 10) });
	} catch (err) {
		console.error('[metadata]', err.message);
		res.status(err.status ?? 500).json({ error: err.message });
	}
});

// ─── GET /api/data?table=<name>&rowStart=0&rowEnd=99&colStart=0&colEnd=29 ─────
//     →  { rows: object[], columns: string[] }
app.get('/api/data', async (req, res) => {
	try {
		const table = validateTable(req.query.table);
		const rowStart = Math.max(0, parseInt(req.query.rowStart ?? 0, 10));
		const rowEnd = parseInt(req.query.rowEnd ?? 99, 10);
		const colStart = Math.max(0, parseInt(req.query.colStart ?? 0, 10));
		const colEnd = parseInt(req.query.colEnd ?? 29, 10);

		const allColumns = await getColumns(table);
		const selectedColumns = allColumns.slice(colStart, colEnd + 1);
		if (selectedColumns.length === 0) return res.json({ rows: [], columns: [] });

		const colList = selectedColumns.map((c) => `"${c}"`).join(', ');
		const rowLimit = rowEnd - rowStart + 1;

		const result = await pool.query(`SELECT ${colList} FROM "${table}" ORDER BY "id" LIMIT $1 OFFSET $2`, [rowLimit, rowStart]);

		res.json({ rows: result.rows, columns: selectedColumns });
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

		await pool.query(
			`UPDATE "${table}"
       SET    "${column}" = $1
       WHERE  "id" = (
         SELECT "id" FROM "${table}" ORDER BY "id" LIMIT 1 OFFSET $2
       )`,
			[value, rowIndex]
		);

		res.json({ ok: true });
	} catch (err) {
		console.error('[cell update]', err.message);
		res.status(err.status ?? 500).json({ error: err.message });
	}
});

// ─── GET /api/ttm  →  list all TTMs ──────────────────────────────────────────
app.get('/api/ttm', async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM ttm ORDER BY ttm_id DESC');
		res.json(result.rows);
	} catch (err) {
		console.error('[ttm list]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── POST /api/ttm  →  create a new TTM ──────────────────────────────────────
app.post('/api/ttm', async (req, res) => {
	const { ttm_name, ttm_creator_email, ttm_delegation } = req.body;
	if (!ttm_name) return res.status(400).json({ error: 'ttm_name required' });
	try {
		const result = await pool.query('INSERT INTO ttm (ttm_name, ttm_creator_email, ttm_delegation) VALUES ($1,$2,$3) RETURNING *', [
			ttm_name,
			ttm_creator_email ?? null,
			ttm_delegation ?? null
		]);
		res.json(result.rows[0]);
	} catch (err) {
		console.error('[ttm create]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── GET /api/ttm/:ttm_id ─────────────────────────────────────────────────────
// Returns tasks (with nested subtasks) and resources — no entries.
// Entries are fetched on demand via /api/ttm/:ttm_id/entries.
app.get('/api/ttm/:ttm_id', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	if (isNaN(ttm_id)) return res.status(400).json({ error: 'Invalid ttm_id' });
	try {
		const [tasksRes, subsRes, resourcesRes] = await Promise.all([
			pool.query('SELECT * FROM tasks WHERE ttm_id = $1 ORDER BY task_order', [ttm_id]),
			pool.query(
				`SELECT s.* FROM subtasks s
         JOIN tasks t ON t.task_id = s.task_id
         WHERE t.ttm_id = $1
         ORDER BY t.task_order, s.subtask_order`,
				[ttm_id]
			),
			pool.query(
				`SELECT r.*, tr.resource_order
         FROM ttm_resources tr
         JOIN resources r ON r.resource_id = tr.resource_id
         WHERE tr.ttm_id = $1
         ORDER BY tr.resource_order`,
				[ttm_id]
			)
		]);
		const subsByTask = {};
		subsRes.rows.forEach((s) => {
			(subsByTask[s.task_id] = subsByTask[s.task_id] || []).push(s);
		});
		const tasks = tasksRes.rows.map((t) => ({ ...t, subtasks: subsByTask[t.task_id] || [] }));
		res.json({ tasks, resources: resourcesRes.rows });
	} catch (err) {
		console.error('[ttm get]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── GET /api/ttm/:ttm_id/entries ─────────────────────────────────────────────
// Returns a chunk of ttm_entries for the visible viewport.
// Query params:
//   subFrom, subTo   — 0-based position range into the ordered subtask list
//   resFrom, resTo   — 0-based position range into the ordered resource list
app.get('/api/ttm/:ttm_id/entries', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const subFrom = Math.max(0, parseInt(req.query.subFrom ?? 0, 10));
	const subTo = parseInt(req.query.subTo ?? 49, 10);
	const resFrom = Math.max(0, parseInt(req.query.resFrom ?? 0, 10));
	const resTo = parseInt(req.query.resTo ?? 19, 10);
	if (isNaN(ttm_id)) return res.status(400).json({ error: 'Invalid ttm_id' });

	try {
		// Resolve positional ranges to actual IDs using the same sort orders
		const [subsRes, resRes] = await Promise.all([
			pool.query(
				`SELECT s.subtask_id
         FROM subtasks s
         JOIN tasks t ON t.task_id = s.task_id
         WHERE t.ttm_id = $1
         ORDER BY t.task_order, s.subtask_order
         LIMIT $2 OFFSET $3`,
				[ttm_id, subTo - subFrom + 1, subFrom]
			),
			pool.query(
				`SELECT resource_id
         FROM ttm_resources
         WHERE ttm_id = $1
         ORDER BY resource_order
         LIMIT $2 OFFSET $3`,
				[ttm_id, resTo - resFrom + 1, resFrom]
			)
		]);

		const subtaskIds = subsRes.rows.map((r) => r.subtask_id);
		const resourceIds = resRes.rows.map((r) => r.resource_id);

		if (subtaskIds.length === 0 || resourceIds.length === 0) {
			return res.json({ entries: [] });
		}

		const entriesRes = await pool.query(
			`SELECT subtask_id, resource_id, ttm_entry_hours
       FROM ttm_entries
       WHERE ttm_id = $1
         AND subtask_id  = ANY($2::int[])
         AND resource_id = ANY($3::int[])`,
			[ttm_id, subtaskIds, resourceIds]
		);

		res.json({ entries: entriesRes.rows });
	} catch (err) {
		console.error('[entries chunk]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── GET /api/resources ───────────────────────────────────────────────────────
// Returns all resources for use in the add-resource picker.
app.get('/api/resources', async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM resources ORDER BY resource_name');
		res.json(result.rows);
	} catch (err) {
		console.error('[resources]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
// Creates a new task + 5 empty subtasks for a TTM.
// Body: { ttm_id }
app.post('/api/tasks', async (req, res) => {
	const { ttm_id } = req.body;
	if (!ttm_id) return res.status(400).json({ error: 'ttm_id required' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const orderRes = await client.query('SELECT COALESCE(MAX(task_order), 0) + 1 AS n FROM tasks WHERE ttm_id = $1', [ttm_id]);
		const countRes = await client.query('SELECT COUNT(*) AS c FROM tasks WHERE ttm_id = $1', [ttm_id]);
		const taskOrder = orderRes.rows[0].n;
		const taskNum = parseInt(countRes.rows[0].c, 10) + 1;
		const taskRes = await client.query('INSERT INTO tasks (ttm_id, task_number, task_name, task_order) VALUES ($1,$2,$3,$4) RETURNING *', [
			ttm_id,
			String(taskNum),
			'',
			taskOrder
		]);
		const task = taskRes.rows[0];
		const subtasks = [];
		for (let i = 1; i <= 5; i++) {
			const subRes = await client.query(
				'INSERT INTO subtasks (ttm_id, task_id, subtask_number, subtask_name, subtask_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
				[ttm_id, task.task_id, `${taskNum}.${i}`, '', i]
			);
			subtasks.push(subRes.rows[0]);
		}
		await client.query('COMMIT');
		res.json({ ...task, subtasks });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[tasks post]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

// ─── POST /api/ttm-resources ──────────────────────────────────────────────────
// Links a resource to a TTM.
// Body: { ttm_id, resource_id }
app.post('/api/ttm-resources', async (req, res) => {
	const { ttm_id, resource_id } = req.body;
	if (!ttm_id || !resource_id) return res.status(400).json({ error: 'ttm_id and resource_id required' });
	try {
		const existRes = await pool.query('SELECT 1 FROM ttm_resources WHERE ttm_id = $1 AND resource_id = $2', [ttm_id, resource_id]);
		if (existRes.rows.length > 0) return res.status(409).json({ error: 'Resource already added to this TTM' });
		const orderRes = await pool.query('SELECT COALESCE(MAX(resource_order), 0) + 1 AS n FROM ttm_resources WHERE ttm_id = $1', [ttm_id]);
		await pool.query('INSERT INTO ttm_resources (ttm_id, resource_id, resource_order) VALUES ($1,$2,$3)', [ttm_id, resource_id, orderRes.rows[0].n]);
		const rRes = await pool.query('SELECT * FROM resources WHERE resource_id = $1', [resource_id]);
		res.json({ ...rRes.rows[0], resource_order: orderRes.rows[0].n });
	} catch (err) {
		console.error('[ttm-resources post]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── PUT /api/ttm  →  universal cell update ───────────────────────────────────
// Handles all editable cells in one endpoint.
//
// Shapes:
//   task    → { type:'task',    task_id,    field:'task_number'|'task_name',       value }
//   subtask → { type:'subtask', subtask_id, field:'subtask_number'|'subtask_name', value }
//   hours   → { type:'hours',   ttm_id, task_id, subtask_id, resource_id,          value }
app.put('/api/ttm', async (req, res) => {
	const { type } = req.body;
	try {
		if (type === 'task') {
			const { task_id, field, value } = req.body;
			if (!task_id || !['task_number', 'task_name'].includes(field)) return res.status(400).json({ error: 'Invalid task update payload' });
			await pool.query(`UPDATE tasks SET "${field}" = $1 WHERE task_id = $2`, [value ?? null, task_id]);
		} else if (type === 'subtask') {
			const { subtask_id, field, value } = req.body;
			if (!subtask_id || !['subtask_number', 'subtask_name'].includes(field)) return res.status(400).json({ error: 'Invalid subtask update payload' });
			await pool.query(`UPDATE subtasks SET "${field}" = $1 WHERE subtask_id = $2`, [value ?? null, subtask_id]);
		} else if (type === 'hours') {
			const { ttm_id, task_id, subtask_id, resource_id, value } = req.body;
			if (!ttm_id || !task_id || !subtask_id || !resource_id) return res.status(400).json({ error: 'Missing required fields for hours update' });
			const hours = value === '' || value === null || value === undefined ? null : parseFloat(value);
			const existing = await pool.query('SELECT ttm_entry_id FROM ttm_entries WHERE ttm_id=$1 AND task_id=$2 AND subtask_id=$3 AND resource_id=$4', [
				ttm_id,
				task_id,
				subtask_id,
				resource_id
			]);
			if (existing.rows.length > 0) {
				await pool.query('UPDATE ttm_entries SET ttm_entry_hours = $1 WHERE ttm_entry_id = $2', [hours, existing.rows[0].ttm_entry_id]);
			} else {
				await pool.query('INSERT INTO ttm_entries (ttm_id, task_id, subtask_id, resource_id, ttm_entry_hours) VALUES ($1,$2,$3,$4,$5)', [
					ttm_id,
					task_id,
					subtask_id,
					resource_id,
					hours
				]);
			}
		} else {
			return res.status(400).json({ error: `Unknown update type: "${type}"` });
		}
		res.json({ ok: true });
	} catch (err) {
		console.error('[ttm put]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── DELETE /api/tasks/:task_id ───────────────────────────────────────────────
// Deletes task + all its subtasks + all related ttm_entries.
app.delete('/api/tasks/:task_id', async (req, res) => {
	const task_id = parseInt(req.params.task_id, 10);
	if (isNaN(task_id)) return res.status(400).json({ error: 'Invalid task_id' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DELETE FROM ttm_entries WHERE subtask_id IN (SELECT subtask_id FROM subtasks WHERE task_id = $1)', [task_id]);
		await client.query('DELETE FROM subtasks WHERE task_id = $1', [task_id]);
		await client.query('DELETE FROM tasks WHERE task_id = $1', [task_id]);
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[task delete]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

// ─── DELETE /api/subtasks/:subtask_id ─────────────────────────────────────────
app.delete('/api/subtasks/:subtask_id', async (req, res) => {
	const subtask_id = parseInt(req.params.subtask_id, 10);
	if (isNaN(subtask_id)) return res.status(400).json({ error: 'Invalid subtask_id' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DELETE FROM ttm_entries WHERE subtask_id = $1', [subtask_id]);
		await client.query('DELETE FROM subtasks WHERE subtask_id = $1', [subtask_id]);
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[subtask delete]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

// ─── DELETE /api/ttm-resources/:ttm_id/:resource_id ──────────────────────────
// Removes resource column from TTM + deletes all its hours entries.
app.delete('/api/ttm-resources/:ttm_id/:resource_id', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const resource_id = parseInt(req.params.resource_id, 10);
	if (isNaN(ttm_id) || isNaN(resource_id)) return res.status(400).json({ error: 'Invalid ids' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('DELETE FROM ttm_entries WHERE ttm_id = $1 AND resource_id = $2', [ttm_id, resource_id]);
		await client.query('DELETE FROM ttm_resources WHERE ttm_id = $1 AND resource_id = $2', [ttm_id, resource_id]);
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[ttm-resource delete]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

// ─── PUT /api/ttm/:ttm_id/task-order ─────────────────────────────────────────
// Body: { taskIds: number[] }  — ordered array of task_ids
app.put('/api/ttm/:ttm_id/task-order', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const { taskIds } = req.body;
	if (isNaN(ttm_id) || !Array.isArray(taskIds)) return res.status(400).json({ error: 'Invalid payload' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		for (let i = 0; i < taskIds.length; i++) {
			await client.query('UPDATE tasks SET task_order = $1 WHERE task_id = $2 AND ttm_id = $3', [i + 1, taskIds[i], ttm_id]);
		}
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[task-order]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

// ─── PUT /api/ttm/:ttm_id/resource-order ─────────────────────────────────────
// Body: { resourceIds: number[] }  — ordered array of resource_ids
app.put('/api/ttm/:ttm_id/resource-order', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const { resourceIds } = req.body;
	if (isNaN(ttm_id) || !Array.isArray(resourceIds)) return res.status(400).json({ error: 'Invalid payload' });
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		for (let i = 0; i < resourceIds.length; i++) {
			await client.query('UPDATE ttm_resources SET resource_order = $1 WHERE resource_id = $2 AND ttm_id = $3', [i + 1, resourceIds[i], ttm_id]);
		}
		await client.query('COMMIT');
		res.json({ ok: true });
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('[resource-order]', err.message);
		res.status(500).json({ error: err.message });
	} finally {
		client.release();
	}
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
