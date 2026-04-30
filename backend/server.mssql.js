import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sql from 'mssql';

const app = express();
app.use(cors());
app.use(express.json());

// ─── Connection pool ──────────────────────────────────────────────────────────
const dbConfig = {
	server: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '1433', 10),
	database: process.env.DB_NAME || 'TTM_DEV',
	user: process.env.DB_USER || 'sa',
	password: process.env.DB_PASSWORD || '',
	options: {
		encrypt: process.env.DB_ENCRYPT === 'true',
		trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
	},
	pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
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
function validateTable(name) {
	if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
		const err = new Error(`Invalid or missing table name: "${name}"`);
		err.status = 400;
		throw err;
	}
	return name;
}

// ─── Per-table column cache ───────────────────────────────────────────────────
const columnCacheMap = new Map();

async function getColumns(tableName) {
	if (columnCacheMap.has(tableName)) return columnCacheMap.get(tableName);

	const pool = await getPool();
	const result = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
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

// ─── GET /api/metadata?table=<name> ──────────────────────────────────────────
app.get('/api/metadata', async (req, res) => {
	try {
		const table = validateTable(req.query.table);
		const pool = await getPool();

		const [columns, countResult] = await Promise.all([getColumns(table), pool.request().query(`SELECT COUNT(*) AS cnt FROM [${table}]`)]);

		res.json({ columns, rowCount: countResult.recordset[0].cnt });
	} catch (err) {
		console.error('[metadata]', err.message);
		res.status(err.status ?? 500).json({ error: err.message });
	}
});

// ─── GET /api/data?table=<name>&rowStart&rowEnd&colStart&colEnd ───────────────
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

		const colList = selectedColumns.map((c) => `[${c}]`).join(', ');
		const rowLimit = rowEnd - rowStart + 1;

		const pool = await getPool();
		const result = await pool.request().input('offset', sql.Int, rowStart).input('limit', sql.Int, rowLimit).query(`
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

// ─── PUT /api/cell ────────────────────────────────────────────────────────────
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
		await pool.request().input('value', sql.NVarChar(sql.MAX), value).input('offset', sql.Int, rowIndex).query(`
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

// ─── GET /api/ttm  →  list all TTMs ──────────────────────────────────────────
app.get('/api/ttm', async (req, res) => {
	try {
		const pool = await getPool();
		const result = await pool.request().query('SELECT * FROM ttm ORDER BY ttm_id DESC');
		res.json(result.recordset);
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
		const pool = await getPool();
		const result = await pool
			.request()
			.input('ttm_name', sql.NVarChar(255), ttm_name)
			.input('ttm_creator_email', sql.NVarChar(255), ttm_creator_email ?? null)
			.input('ttm_delegation', sql.NVarChar(sql.MAX), ttm_delegation ?? null).query(`
        INSERT INTO ttm (ttm_name, ttm_creator_email, ttm_delegation)
        OUTPUT INSERTED.*
        VALUES (@ttm_name, @ttm_creator_email, @ttm_delegation)
      `);
		res.json(result.recordset[0]);
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
		const pool = await getPool();
		const [tasksRes, subsRes, resourcesRes] = await Promise.all([
			pool.request().input('ttm_id', sql.Int, ttm_id).query('SELECT * FROM tasks WHERE ttm_id = @ttm_id ORDER BY task_order'),
			pool.request().input('ttm_id', sql.Int, ttm_id).query(`
          SELECT s.*
          FROM subtasks s
          JOIN tasks t ON t.task_id = s.task_id
          WHERE t.ttm_id = @ttm_id
          ORDER BY t.task_order, s.subtask_order
        `),
			pool.request().input('ttm_id', sql.Int, ttm_id).query(`
          SELECT r.*, tr.resource_order
          FROM ttm_resources tr
          JOIN resources r ON r.resource_id = tr.resource_id
          WHERE tr.ttm_id = @ttm_id
          ORDER BY tr.resource_order
        `)
		]);

		const subsByTask = {};
		subsRes.recordset.forEach((s) => {
			(subsByTask[s.task_id] = subsByTask[s.task_id] || []).push(s);
		});
		const tasks = tasksRes.recordset.map((t) => ({ ...t, subtasks: subsByTask[t.task_id] || [] }));
		res.json({ tasks, resources: resourcesRes.recordset });
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
		const pool = await getPool();

		// Resolve positional ranges to actual IDs using the same sort orders
		const [subsRes, resRes] = await Promise.all([
			pool
				.request()
				.input('ttm_id', sql.Int, ttm_id)
				.input('subOffset', sql.Int, subFrom)
				.input('subLimit', sql.Int, subTo - subFrom + 1).query(`
          SELECT s.subtask_id
          FROM subtasks s
          JOIN tasks t ON t.task_id = s.task_id
          WHERE t.ttm_id = @ttm_id
          ORDER BY t.task_order, s.subtask_order
          OFFSET @subOffset ROWS FETCH NEXT @subLimit ROWS ONLY
        `),
			pool
				.request()
				.input('ttm_id', sql.Int, ttm_id)
				.input('resOffset', sql.Int, resFrom)
				.input('resLimit', sql.Int, resTo - resFrom + 1).query(`
          SELECT resource_id
          FROM ttm_resources
          WHERE ttm_id = @ttm_id
          ORDER BY resource_order
          OFFSET @resOffset ROWS FETCH NEXT @resLimit ROWS ONLY
        `)
		]);

		const subtaskIds = subsRes.recordset.map((r) => r.subtask_id);
		const resourceIds = resRes.recordset.map((r) => r.resource_id);

		if (subtaskIds.length === 0 || resourceIds.length === 0) {
			return res.json({ entries: [] });
		}

		// IDs are integers from the database — safe to interpolate into IN clause
		const subIdList = subtaskIds.join(',');
		const resIdList = resourceIds.join(',');

		const entriesRes = await pool.request().input('ttm_id', sql.Int, ttm_id).query(`
        SELECT subtask_id, resource_id, ttm_entry_hours
        FROM ttm_entries
        WHERE ttm_id = @ttm_id
          AND subtask_id  IN (${subIdList})
          AND resource_id IN (${resIdList})
      `);

		res.json({ entries: entriesRes.recordset });
	} catch (err) {
		console.error('[entries chunk]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── GET /api/resources ───────────────────────────────────────────────────────
app.get('/api/resources', async (req, res) => {
	try {
		const pool = await getPool();
		const result = await pool.request().query('SELECT * FROM resources ORDER BY resource_name');
		res.json(result.recordset);
	} catch (err) {
		console.error('[resources]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
// Creates a new task + 5 empty subtasks for a TTM.
app.post('/api/tasks', async (req, res) => {
	const { ttm_id } = req.body;
	if (!ttm_id) return res.status(400).json({ error: 'ttm_id required' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();

		const orderRes = await new sql.Request(transaction)
			.input('ttm_id', sql.Int, ttm_id)
			.query('SELECT ISNULL(MAX(task_order), 0) + 1 AS n FROM tasks WHERE ttm_id = @ttm_id');

		const countRes = await new sql.Request(transaction).input('ttm_id', sql.Int, ttm_id).query('SELECT COUNT(*) AS c FROM tasks WHERE ttm_id = @ttm_id');

		const taskOrder = orderRes.recordset[0].n;
		const taskNum = countRes.recordset[0].c + 1;

		const taskRes = await new sql.Request(transaction)
			.input('ttm_id', sql.Int, ttm_id)
			.input('task_number', sql.NVarChar(50), String(taskNum))
			.input('task_name', sql.NVarChar(255), '')
			.input('task_order', sql.Int, taskOrder).query(`
        INSERT INTO tasks (ttm_id, task_number, task_name, task_order)
        OUTPUT INSERTED.*
        VALUES (@ttm_id, @task_number, @task_name, @task_order)
      `);

		const task = taskRes.recordset[0];
		const subtasks = [];

		for (let i = 1; i <= 5; i++) {
			const subRes = await new sql.Request(transaction)
				.input('ttm_id', sql.Int, ttm_id)
				.input('task_id', sql.Int, task.task_id)
				.input('subtask_number', sql.NVarChar(50), `${taskNum}.${i}`)
				.input('subtask_name', sql.NVarChar(255), '')
				.input('subtask_order', sql.Int, i).query(`
          INSERT INTO subtasks (ttm_id, task_id, subtask_number, subtask_name, subtask_order)
          OUTPUT INSERTED.*
          VALUES (@ttm_id, @task_id, @subtask_number, @subtask_name, @subtask_order)
        `);
			subtasks.push(subRes.recordset[0]);
		}

		await transaction.commit();
		res.json({ ...task, subtasks });
	} catch (err) {
		await transaction.rollback();
		console.error('[tasks post]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── POST /api/ttm-resources ──────────────────────────────────────────────────
app.post('/api/ttm-resources', async (req, res) => {
	const { ttm_id, resource_id } = req.body;
	if (!ttm_id || !resource_id) return res.status(400).json({ error: 'ttm_id and resource_id required' });
	try {
		const pool = await getPool();

		const existRes = await pool
			.request()
			.input('ttm_id', sql.Int, ttm_id)
			.input('resource_id', sql.Int, resource_id)
			.query('SELECT 1 AS found FROM ttm_resources WHERE ttm_id = @ttm_id AND resource_id = @resource_id');

		if (existRes.recordset.length > 0) {
			return res.status(409).json({ error: 'Resource already added to this TTM' });
		}

		const orderRes = await pool
			.request()
			.input('ttm_id', sql.Int, ttm_id)
			.query('SELECT ISNULL(MAX(resource_order), 0) + 1 AS n FROM ttm_resources WHERE ttm_id = @ttm_id');

		const resourceOrder = orderRes.recordset[0].n;

		await pool
			.request()
			.input('ttm_id', sql.Int, ttm_id)
			.input('resource_id', sql.Int, resource_id)
			.input('resource_order', sql.Int, resourceOrder)
			.query('INSERT INTO ttm_resources (ttm_id, resource_id, resource_order) VALUES (@ttm_id, @resource_id, @resource_order)');

		const rRes = await pool.request().input('resource_id', sql.Int, resource_id).query('SELECT * FROM resources WHERE resource_id = @resource_id');

		res.json({ ...rRes.recordset[0], resource_order: resourceOrder });
	} catch (err) {
		console.error('[ttm-resources post]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── PUT /api/ttm  →  universal cell update ───────────────────────────────────
// Shapes:
//   task    → { type:'task',    task_id,    field:'task_number'|'task_name',       value }
//   subtask → { type:'subtask', subtask_id, field:'subtask_number'|'subtask_name', value }
//   hours   → { type:'hours',   ttm_id, task_id, subtask_id, resource_id,          value }
app.put('/api/ttm', async (req, res) => {
	const { type } = req.body;
	try {
		const pool = await getPool();

		if (type === 'task') {
			const { task_id, field, value } = req.body;
			if (!task_id || !['task_number', 'task_name'].includes(field)) return res.status(400).json({ error: 'Invalid task update payload' });
			await pool
				.request()
				.input('value', sql.NVarChar(255), value ?? null)
				.input('task_id', sql.Int, task_id)
				.query(`UPDATE tasks SET [${field}] = @value WHERE task_id = @task_id`);
		} else if (type === 'subtask') {
			const { subtask_id, field, value } = req.body;
			if (!subtask_id || !['subtask_number', 'subtask_name'].includes(field)) return res.status(400).json({ error: 'Invalid subtask update payload' });
			await pool
				.request()
				.input('value', sql.NVarChar(255), value ?? null)
				.input('subtask_id', sql.Int, subtask_id)
				.query(`UPDATE subtasks SET [${field}] = @value WHERE subtask_id = @subtask_id`);
		} else if (type === 'hours') {
			const { ttm_id, task_id, subtask_id, resource_id, value } = req.body;
			if (!ttm_id || !task_id || !subtask_id || !resource_id) return res.status(400).json({ error: 'Missing required fields for hours update' });

			const hours = value === '' || value === null || value === undefined ? null : parseFloat(value);

			const existing = await pool
				.request()
				.input('ttm_id', sql.Int, ttm_id)
				.input('task_id', sql.Int, task_id)
				.input('subtask_id', sql.Int, subtask_id)
				.input('resource_id', sql.Int, resource_id).query(`
          SELECT ttm_entry_id FROM ttm_entries
          WHERE ttm_id = @ttm_id AND task_id = @task_id
            AND subtask_id = @subtask_id AND resource_id = @resource_id
        `);

			if (existing.recordset.length > 0) {
				await pool
					.request()
					.input('hours', sql.Float, hours)
					.input('ttm_entry_id', sql.Int, existing.recordset[0].ttm_entry_id)
					.query('UPDATE ttm_entries SET ttm_entry_hours = @hours WHERE ttm_entry_id = @ttm_entry_id');
			} else {
				await pool
					.request()
					.input('ttm_id', sql.Int, ttm_id)
					.input('task_id', sql.Int, task_id)
					.input('subtask_id', sql.Int, subtask_id)
					.input('resource_id', sql.Int, resource_id)
					.input('hours', sql.Float, hours).query(`
            INSERT INTO ttm_entries (ttm_id, task_id, subtask_id, resource_id, ttm_entry_hours)
            VALUES (@ttm_id, @task_id, @subtask_id, @resource_id, @hours)
          `);
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
app.delete('/api/tasks/:task_id', async (req, res) => {
	const task_id = parseInt(req.params.task_id, 10);
	if (isNaN(task_id)) return res.status(400).json({ error: 'Invalid task_id' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();
		await new sql.Request(transaction).input('task_id', sql.Int, task_id).query(`
        DELETE FROM ttm_entries
        WHERE subtask_id IN (SELECT subtask_id FROM subtasks WHERE task_id = @task_id)
      `);
		await new sql.Request(transaction).input('task_id', sql.Int, task_id).query('DELETE FROM subtasks WHERE task_id = @task_id');
		await new sql.Request(transaction).input('task_id', sql.Int, task_id).query('DELETE FROM tasks WHERE task_id = @task_id');
		await transaction.commit();
		res.json({ ok: true });
	} catch (err) {
		await transaction.rollback();
		console.error('[task delete]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── POST /api/subtasks ───────────────────────────────────────────────────────
// Adds N empty subtask rows to an existing task.
// Body: { task_id, count }
app.post('/api/subtasks', async (req, res) => {
	const task_id = parseInt(req.body.task_id, 10);
	const count = parseInt(req.body.count, 10);
	if (isNaN(task_id)) return res.status(400).json({ error: 'task_id required' });
	if (isNaN(count) || count < 1 || count > 500) return res.status(400).json({ error: 'count must be between 1 and 500' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();

		const taskRes = await new sql.Request(transaction)
			.input('task_id', sql.Int, task_id)
			.query('SELECT ttm_id, task_number FROM tasks WHERE task_id = @task_id');
		if (taskRes.recordset.length === 0) {
			await transaction.rollback();
			return res.status(404).json({ error: 'Task not found' });
		}
		const { ttm_id, task_number } = taskRes.recordset[0];

		const aggRes = await new sql.Request(transaction)
			.input('task_id', sql.Int, task_id)
			.query('SELECT ISNULL(MAX(subtask_order), 0) AS max_order, COUNT(*) AS cnt FROM subtasks WHERE task_id = @task_id');
		const startOrder = aggRes.recordset[0].max_order;
		const startSuffix = aggRes.recordset[0].cnt + 1;

		const subtasks = [];
		for (let i = 0; i < count; i++) {
			const order = startOrder + i + 1;
			const subNum = `${task_number}.${startSuffix + i}`;
			const subRes = await new sql.Request(transaction)
				.input('ttm_id', sql.Int, ttm_id)
				.input('task_id', sql.Int, task_id)
				.input('subtask_number', sql.NVarChar(50), subNum)
				.input('subtask_name', sql.NVarChar(255), '')
				.input('subtask_order', sql.Int, order).query(`
					INSERT INTO subtasks (ttm_id, task_id, subtask_number, subtask_name, subtask_order)
					OUTPUT INSERTED.*
					VALUES (@ttm_id, @task_id, @subtask_number, @subtask_name, @subtask_order)
				`);
			subtasks.push(subRes.recordset[0]);
		}

		await transaction.commit();
		res.json({ task_id, subtasks });
	} catch (err) {
		await transaction.rollback();
		console.error('[subtasks post]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── DELETE /api/subtasks/:subtask_id ─────────────────────────────────────────
app.delete('/api/subtasks/:subtask_id', async (req, res) => {
	const subtask_id = parseInt(req.params.subtask_id, 10);
	if (isNaN(subtask_id)) return res.status(400).json({ error: 'Invalid subtask_id' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();
		await new sql.Request(transaction).input('subtask_id', sql.Int, subtask_id).query('DELETE FROM ttm_entries WHERE subtask_id = @subtask_id');
		await new sql.Request(transaction).input('subtask_id', sql.Int, subtask_id).query('DELETE FROM subtasks WHERE subtask_id = @subtask_id');
		await transaction.commit();
		res.json({ ok: true });
	} catch (err) {
		await transaction.rollback();
		console.error('[subtask delete]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── DELETE /api/ttm-resources/:ttm_id/:resource_id ──────────────────────────
app.delete('/api/ttm-resources/:ttm_id/:resource_id', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const resource_id = parseInt(req.params.resource_id, 10);
	if (isNaN(ttm_id) || isNaN(resource_id)) return res.status(400).json({ error: 'Invalid ids' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();
		await new sql.Request(transaction)
			.input('ttm_id', sql.Int, ttm_id)
			.input('resource_id', sql.Int, resource_id)
			.query('DELETE FROM ttm_entries WHERE ttm_id = @ttm_id AND resource_id = @resource_id');
		await new sql.Request(transaction)
			.input('ttm_id', sql.Int, ttm_id)
			.input('resource_id', sql.Int, resource_id)
			.query('DELETE FROM ttm_resources WHERE ttm_id = @ttm_id AND resource_id = @resource_id');
		await transaction.commit();
		res.json({ ok: true });
	} catch (err) {
		await transaction.rollback();
		console.error('[ttm-resource delete]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── PUT /api/ttm/:ttm_id/task-order ─────────────────────────────────────────
app.put('/api/ttm/:ttm_id/task-order', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const { taskIds } = req.body;
	if (isNaN(ttm_id) || !Array.isArray(taskIds)) return res.status(400).json({ error: 'Invalid payload' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();
		for (let i = 0; i < taskIds.length; i++) {
			await new sql.Request(transaction)
				.input('order', sql.Int, i + 1)
				.input('task_id', sql.Int, taskIds[i])
				.input('ttm_id', sql.Int, ttm_id)
				.query('UPDATE tasks SET task_order = @order WHERE task_id = @task_id AND ttm_id = @ttm_id');
		}
		await transaction.commit();
		res.json({ ok: true });
	} catch (err) {
		await transaction.rollback();
		console.error('[task-order]', err.message);
		res.status(500).json({ error: err.message });
	}
});

// ─── PUT /api/ttm/:ttm_id/resource-order ─────────────────────────────────────
app.put('/api/ttm/:ttm_id/resource-order', async (req, res) => {
	const ttm_id = parseInt(req.params.ttm_id, 10);
	const { resourceIds } = req.body;
	if (isNaN(ttm_id) || !Array.isArray(resourceIds)) return res.status(400).json({ error: 'Invalid payload' });

	const pool = await getPool();
	const transaction = new sql.Transaction(pool);
	try {
		await transaction.begin();
		for (let i = 0; i < resourceIds.length; i++) {
			await new sql.Request(transaction)
				.input('order', sql.Int, i + 1)
				.input('resource_id', sql.Int, resourceIds[i])
				.input('ttm_id', sql.Int, ttm_id)
				.query('UPDATE ttm_resources SET resource_order = @order WHERE resource_id = @resource_id AND ttm_id = @ttm_id');
		}
		await transaction.commit();
		res.json({ ok: true });
	} catch (err) {
		await transaction.rollback();
		console.error('[resource-order]', err.message);
		res.status(500).json({ error: err.message });
	}
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend (MSSQL) listening on http://localhost:${PORT}`));
