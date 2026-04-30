import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useRef, useMemo, memo, useReducer } from 'react';
import { Grid } from 'react-window';
import LeftPanel from '../Tasks/Tasks';
import './TTMGrid.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const ROW_HEIGHT = 36;
const RESOURCE_WIDTH = 120;
const OVERSCAN_COLS = 2;
const CHUNK_SUBTASKS = 50; // subtask rows per chunk
const CHUNK_RESOURCES = 20; // resource columns per chunk

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRows(tasks) {
    const rows = [];
    tasks.forEach((task) => {
        rows.push({ type: 'task', task });
        task.subtasks.forEach((sub) => rows.push({ type: 'subtask', task, subtask: sub }));
    });
    return rows;
}

// ─── Inline dialogs ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
    return (
        <div className="ttm-overlay" onClick={onCancel}>
            <div className="ttm-dialog" onClick={(e) => e.stopPropagation()}>
                <p className="ttm-dialog-msg">{message}</p>
                <div className="ttm-dialog-actions">
                    <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="ttm-dlg-btn ttm-dlg-danger" onClick={onConfirm}>
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

function ReorderDialog({ title, items, onSave, onClose }) {
    const [list, setList] = useState(items);

    // Move item from `fromIdx` to `toIdx` (both 0-based). Clamps out-of-range values.
    const moveTo = (fromIdx, toIdx) => {
        const max = list.length - 1;
        const target = Math.max(0, Math.min(max, toIdx));
        if (target === fromIdx) return;
        setList((prev) => {
            const next = [...prev];
            const [item] = next.splice(fromIdx, 1);
            next.splice(target, 0, item);
            return next;
        });
    };

    return (
        <div className="ttm-overlay" onClick={onClose}>
            <div className="ttm-dialog ttm-dialog-reorder" onClick={(e) => e.stopPropagation()}>
                <h3 className="ttm-dialog-title">{title}</h3>
                <p className="ttm-reorder-hint">Type a position and press Enter to move an item.</p>
                <ul className="ttm-reorder-list">
                    {list.map((item, idx) => (
                        <PositionRow key={item.id} idx={idx} total={list.length} label={item.label} onCommit={(newIdx) => moveTo(idx, newIdx)} />
                    ))}
                </ul>
                <div className="ttm-dialog-actions">
                    <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="ttm-dlg-btn ttm-dlg-primary"
                        onClick={() => {
                            onSave(list.map((i) => i.id));
                            onClose();
                        }}
                    >
                        Save Order
                    </button>
                </div>
            </div>
        </div>
    );
}

function PositionRow({ idx, total, label, onCommit }) {
    const [draft, setDraft] = useState(String(idx + 1));

    // Reset draft whenever this row's index changes (after a reorder)
    useEffect(() => {
        setDraft(String(idx + 1));
    }, [idx]);

    const commit = () => {
        const n = parseInt(draft, 10);
        if (Number.isNaN(n)) {
            setDraft(String(idx + 1));
            return;
        }
        onCommit(n - 1);
    };

    return (
        <li className="ttm-reorder-item">
            <input
                className="ttm-reorder-pos"
                type="number"
                min="1"
                max={total}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.target.blur();
                    }
                    if (e.key === 'Escape') {
                        setDraft(String(idx + 1));
                        e.target.blur();
                    }
                }}
            />
            <span className="ttm-reorder-label">{label}</span>
        </li>
    );
}

function ResourcePicker({ allResources, addedIds, onSelect, onClose }) {
    const [search, setSearch] = useState('');
    const available = allResources.filter((r) => {
        if (addedIds.includes(r.resource_id)) return false;
        const q = search.toLowerCase();
        return !q || r.resource_name?.toLowerCase().includes(q) || r.resource_email?.toLowerCase().includes(q) || r.resource_jobcode?.toLowerCase().includes(q);
    });
    return (
        <div className="ttm-overlay" onClick={onClose}>
            <div className="ttm-dialog ttm-dialog-picker" onClick={(e) => e.stopPropagation()}>
                <h3 className="ttm-dialog-title">Add Resource</h3>
                <input
                    className="ttm-picker-search"
                    placeholder="Search name, email, job code…"
                    value={search}
                    autoFocus
                    onChange={(e) => setSearch(e.target.value)}
                />
                <div className="ttm-picker-list">
                    {available.length === 0 ? (
                        <p className="ttm-picker-empty">{allResources.length === 0 ? 'No resources found.' : 'All resources already added.'}</p>
                    ) : (
                        available.map((r) => (
                            <button
                                key={r.resource_id}
                                className="ttm-picker-item"
                                onClick={() => {
                                    onSelect(r.resource_id);
                                    onClose();
                                }}
                            >
                                <span className="ttm-picker-name">{r.resource_name}</span>
                                <span className="ttm-picker-sub">
                                    {r.resource_email} · {r.resource_jobcode}
                                    {r.resource_billing_rate != null ? ` · $${r.resource_billing_rate}/hr` : ''}
                                </span>
                            </button>
                        ))
                    )}
                </div>
                <div className="ttm-dialog-actions">
                    <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

function AddSubtasksDialog({ tasks, onSave, onClose }) {
    const [taskId, setTaskId] = useState(tasks[0]?.task_id ?? '');
    const [count, setCount] = useState(5);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        const id = parseInt(taskId, 10);
        const n = parseInt(count, 10);
        if (isNaN(id)) {
            setError('Please select a task.');
            return;
        }
        if (isNaN(n) || n < 1) {
            setError('Count must be at least 1.');
            return;
        }
        setSaving(true);
        try {
            await onSave(id, n);
            onClose();
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    if (tasks.length === 0) {
        return (
            <div className="ttm-overlay" onClick={onClose}>
                <div className="ttm-dialog" onClick={(e) => e.stopPropagation()}>
                    <h3 className="ttm-dialog-title">Add Subtask Row(s)</h3>
                    <p className="ttm-dialog-msg">No tasks exist yet. Add a task first.</p>
                    <div className="ttm-dialog-actions">
                        <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="ttm-overlay" onClick={onClose}>
            <div className="ttm-dialog" onClick={(e) => e.stopPropagation()}>
                <h3 className="ttm-dialog-title">Add Subtask Row(s)</h3>
                <form className="ttm-form" onSubmit={submit}>
                    <label className="ttm-form-label">
                        Task
                        <select
                            className="ttm-form-input"
                            value={taskId}
                            onChange={(e) => setTaskId(e.target.value)}
                            autoFocus
                        >
                            {tasks.map((t) => (
                                <option key={t.task_id} value={t.task_id}>
                                    {t.task_number ? `${t.task_number} — ` : ''}{t.task_name || `Task ${t.task_id}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="ttm-form-label">
                        Number of Subtasks
                        <input
                            className="ttm-form-input"
                            type="number"
                            min="1"
                            max="500"
                            value={count}
                            onChange={(e) => setCount(e.target.value)}
                        />
                    </label>
                    {error && <p className="ttm-form-error">{error}</p>}
                    <div className="ttm-dialog-actions">
                        <button type="button" className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="ttm-dlg-btn ttm-dlg-danger" disabled={saving}>
                            {saving ? 'Adding…' : 'Add Subtasks'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── DataCell — rendered by react-window Grid ─────────────────────────────────
// Reads hours from entriesRef (a Map) directly; version in cellProps triggers re-renders.
const DataCell = memo(({ rowIndex, columnIndex, style, rows, resources, entriesRef, editingCell, commitLockRef, onStartEdit, onCommit, onCancel }) => {
    const row = rows[rowIndex];
    const resource = resources[columnIndex];
    if (!row || !resource) return <div style={style} />;

    const isEditing = editingCell?.ri === rowIndex && editingCell?.ci === columnIndex;

    if (row.type === 'task') {
        const sum = row.task.subtasks.reduce((acc, sub) => {
            const h = entriesRef.current.get(`${sub.subtask_id}_${resource.resource_id}`);
            return acc + (h != null ? Number(h) : 0);
        }, 0);
        return (
            <div style={style} className="dc dc-task">
                {sum > 0 ? sum.toFixed(2) : ''}
            </div>
        );
    }

    const sub = row.subtask;
    const value = entriesRef.current.get(`${sub.subtask_id}_${resource.resource_id}`);

    if (isEditing) {
        const handleCommit = (e) => {
            if (commitLockRef.current) return;
            commitLockRef.current = true;
            onCommit(rowIndex, columnIndex, e.target.value);
        };
        return (
            <div style={{ ...style, padding: 0 }}>
                <input
                    className="dc-input"
                    type="number"
                    min="0"
                    step="0.5"
                    autoFocus
                    defaultValue={value != null ? String(value) : ''}
                    onBlur={handleCommit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCommit(e);
                        }
                        if (e.key === 'Escape') {
                            onCancel();
                        }
                    }}
                />
            </div>
        );
    }

    return (
        <div
            style={style}
            className="dc dc-hours"
            tabIndex={0}
            onMouseDown={(e) => e.currentTarget.focus()}
            onDoubleClick={() => onStartEdit(rowIndex, columnIndex)}
        >
            {value != null && value !== '' ? value : ''}
        </div>
    );
});

DataCell.displayName = 'DataCell';

// ─── TTMGrid ──────────────────────────────────────────────────────────────────
const TTMGrid = forwardRef(function TTMGrid({ ttm_id }, ref) {
    const [tasks, setTasks] = useState([]);
    const [resources, setResources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingCell, setEditing] = useState(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [showPicker, setShowPicker] = useState(false);
    const [allResources, setAllRes] = useState([]);
    const [pickerLoading, setPickLoad] = useState(false);
    const [reorderTarget, setReorder] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [showAddSubtasks, setShowAddSubtasks] = useState(false);
    const [gridKey, setGridKey] = useState(0); // increment to remount Grid on structural changes

    // Chunk-based entry cache (no React state — avoids full re-renders on every keystroke)
    const entriesRef = useRef(new Map()); // `${subtask_id}_${resource_id}` → number|null
    const loadedChunksRef = useRef(new Set());
    const loadingChunksRef = useRef(new Set());
    const [version, bump] = useReducer((v) => v + 1, 0); // triggers re-render after chunk loads
    const visibleRangeRef = useRef(null);

    const headerRef = useRef(null);
    const footerRef = useRef(null);
    const mainOuterEl = useRef(null);
    const rafRef = useRef(null);
    const commitLockRef = useRef(false);

    // ── Load metadata (tasks + resources only — no entries) ───────────────────────
    useEffect(() => {
        setLoading(true);
        entriesRef.current.clear();
        loadedChunksRef.current.clear();
        loadingChunksRef.current.clear();
        fetch(`/api/ttm/${ttm_id}`)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(({ tasks: t, resources: r }) => {
                setTasks(t);
                setResources(r);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, [ttm_id]);

    // ── Derived data ──────────────────────────────────────────────────────────────
    const rows = useMemo(() => buildRows(tasks), [tasks]);

    // Flat ordered subtask list (parallel to the subtask dimension of the grid)
    const subtaskList = useMemo(() => {
        const list = [];
        tasks.forEach((task) => task.subtasks.forEach((sub) => list.push(sub)));
        return list;
    }, [tasks]);

    // Map: row index → subtask index in subtaskList (-1 for task header rows)
    const rowToSubtaskIdx = useMemo(() => {
        const map = [];
        let si = 0;
        rows.forEach((row, ri) => {
            map[ri] = row.type === 'subtask' ? si++ : -1;
        });
        return map;
    }, [rows]);

    // ── Chunk fetching ────────────────────────────────────────────────────────────
    const fetchChunk = useCallback(
        async (chunkRow, chunkCol) => {
            const key = `${chunkRow}_${chunkCol}`;
            if (loadedChunksRef.current.has(key) || loadingChunksRef.current.has(key)) return;
            loadingChunksRef.current.add(key);

            const subFrom = chunkRow * CHUNK_SUBTASKS;
            const subTo = Math.min(subFrom + CHUNK_SUBTASKS - 1, subtaskList.length - 1);
            const resFrom = chunkCol * CHUNK_RESOURCES;
            const resTo = Math.min(resFrom + CHUNK_RESOURCES - 1, resources.length - 1);

            if (subFrom > subTo || resFrom > resTo) {
                loadingChunksRef.current.delete(key);
                return;
            }

            try {
                const res = await fetch(`/api/ttm/${ttm_id}/entries?subFrom=${subFrom}&subTo=${subTo}&resFrom=${resFrom}&resTo=${resTo}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const { entries } = await res.json();
                entries.forEach((e) => {
                    entriesRef.current.set(`${e.subtask_id}_${e.resource_id}`, e.ttm_entry_hours);
                });
                loadedChunksRef.current.add(key);
            } catch (err) {
                console.error('[entries chunk]', err.message);
            } finally {
                loadingChunksRef.current.delete(key);
                bump();
            }
        },
        [ttm_id, subtaskList.length, resources.length]
    );

    // ── onCellsRendered — trigger chunk fetches for visible viewport ───────────────
    const handleCellsRendered = useCallback(
        (visibleCells) => {
            const { rowStartIndex, rowStopIndex, columnStartIndex, columnStopIndex } = visibleCells;
            visibleRangeRef.current = { rowStartIndex, rowStopIndex, columnStartIndex, columnStopIndex };

            // Find subtask index range for the visible rows
            let minSi = Infinity,
                maxSi = -Infinity;
            for (let ri = rowStartIndex; ri <= rowStopIndex; ri++) {
                const si = rowToSubtaskIdx[ri];
                if (si >= 0) {
                    minSi = Math.min(minSi, si);
                    maxSi = Math.max(maxSi, si);
                }
            }
            if (minSi > maxSi) return; // only task header rows visible

            const crStart = Math.floor(minSi / CHUNK_SUBTASKS);
            const crEnd = Math.floor(maxSi / CHUNK_SUBTASKS);
            const ccStart = Math.floor(columnStartIndex / CHUNK_RESOURCES);
            const ccEnd = Math.floor(columnStopIndex / CHUNK_RESOURCES);

            for (let cr = crStart; cr <= crEnd; cr++) for (let cc = ccStart; cc <= ccEnd; cc++) fetchChunk(cr, cc);
        },
        [rowToSubtaskIdx, fetchChunk]
    );

    // ── Imperative API for TopNav ─────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
        addTask: handleAddTask,
        openAddSubtasks: () => setShowAddSubtasks(true),
        openResourcePicker: handleOpenPicker,
        openReorder: (type) => setReorder(type)
    }));

    // ── Scroll sync ───────────────────────────────────────────────────────────────
    const handleGridScroll = useCallback((e) => {
        mainOuterEl.current = e.currentTarget;
        const { scrollTop: top, scrollLeft: left } = e.currentTarget;
        if (headerRef.current) headerRef.current.style.transform = `translateX(-${left}px)`;
        if (footerRef.current) footerRef.current.style.transform = `translateX(-${left}px)`;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setScrollTop(top));
    }, []);

    const handleLeftWheel = useCallback((e) => {
        if (!mainOuterEl.current) return;
        e.preventDefault();
        mainOuterEl.current.scrollTop += e.deltaY;
    }, []);

    // ── cellProps — version included so DataCell re-renders when chunks arrive ─────
    const cellProps = useMemo(
        () => ({
            rows,
            resources,
            entriesRef,
            editingCell,
            commitLockRef,
            onStartEdit: (ri, ci) => {
                commitLockRef.current = false;
                setEditing({ ri, ci });
            },
            onCommit: (ri, ci, val) => {
                setEditing(null);
                commitLockRef.current = false;
                const row = rows[ri];
                const resource = resources[ci];
                if (!row || row.type !== 'subtask' || !resource) return;
                const sub = row.subtask;
                const hours = val === '' || val == null ? null : parseFloat(val);
                entriesRef.current.set(`${sub.subtask_id}_${resource.resource_id}`, hours);
                bump();
                fetch('/api/ttm', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'hours',
                        ttm_id,
                        task_id: row.task.task_id,
                        subtask_id: sub.subtask_id,
                        resource_id: resource.resource_id,
                        value: val
                    })
                }).catch(console.error);
            },
            onCancel: () => {
                setEditing(null);
                commitLockRef.current = false;
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }),
        [rows, resources, editingCell, version, ttm_id]
    );

    // ── Cache invalidation — clears all loaded entry chunks + remounts Grid ────────
    const invalidateCache = useCallback(() => {
        entriesRef.current.clear();
        loadedChunksRef.current.clear();
        loadingChunksRef.current.clear();
        setGridKey((k) => k + 1);
    }, []);

    // ── Add task ──────────────────────────────────────────────────────────────────
    const handleAddTask = useCallback(async () => {
        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttm_id })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const newTask = await res.json();
            setTasks((prev) => [...prev, newTask]);
        } catch (err) {
            console.error('Add task failed:', err.message);
        }
    }, [ttm_id]);

    // ── Add N subtasks to a task ──────────────────────────────────────────────────
    // Throws on failure so the dialog can surface the error to the user.
    const handleAddSubtasks = useCallback(
        async (task_id, count) => {
            const res = await fetch('/api/subtasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id, count })
            });
            if (!res.ok) {
                const msg = await res.json().catch(() => ({}));
                throw new Error(msg.error || `HTTP ${res.status}`);
            }
            const { subtasks: newSubs } = await res.json();
            // Row indices shift — chunk cache must be invalidated
            invalidateCache();
            setTasks((prev) =>
                prev.map((t) => (t.task_id === task_id ? { ...t, subtasks: [...t.subtasks, ...newSubs] } : t))
            );
        },
        [invalidateCache]
    );

    // ── Add resource ──────────────────────────────────────────────────────────────
    const handleOpenPicker = useCallback(async () => {
        if (allResources.length === 0 && !pickerLoading) {
            setPickLoad(true);
            try {
                const r = await fetch('/api/resources');
                if (r.ok) setAllRes(await r.json());
            } finally {
                setPickLoad(false);
            }
        }
        setShowPicker(true);
    }, [allResources.length, pickerLoading]);

    const handleAddResource = useCallback(
        async (resource_id) => {
            try {
                const res = await fetch('/api/ttm-resources', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ttm_id, resource_id })
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const newRes = await res.json();
                setResources((prev) => [...prev, newRes]);
            } catch (err) {
                console.error('Add resource failed:', err.message);
            }
        },
        [ttm_id]
    );

    // ── Edit task/subtask fields ──────────────────────────────────────────────────
    const handleEditTaskField = useCallback((task_id, field, value) => {
        setTasks((prev) => prev.map((t) => (t.task_id === task_id ? { ...t, [field]: value } : t)));
        fetch('/api/ttm', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'task', task_id, field, value })
        }).catch(console.error);
    }, []);

    const handleEditSubtaskField = useCallback((task_id, subtask_id, field, value) => {
        setTasks((prev) =>
            prev.map((t) =>
                t.task_id === task_id ? { ...t, subtasks: t.subtasks.map((s) => (s.subtask_id === subtask_id ? { ...s, [field]: value } : s)) } : t
            )
        );
        fetch('/api/ttm', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'subtask', subtask_id, field, value })
        }).catch(console.error);
    }, []);

    // ── Delete task ───────────────────────────────────────────────────────────────
    const handleDeleteTask = useCallback(
        (task_id, task_name) => {
            setConfirm({
                message: `Delete task "${task_name || task_id}" and all its subtasks?`,
                onConfirm: async () => {
                    setConfirm(null);
                    await fetch(`/api/tasks/${task_id}`, { method: 'DELETE' });
                    invalidateCache();
                    setTasks((prev) => prev.filter((t) => t.task_id !== task_id));
                }
            });
        },
        [invalidateCache]
    );

    // ── Delete subtask ────────────────────────────────────────────────────────────
    const handleDeleteSubtask = useCallback(
        (task_id, subtask_id, subtask_name) => {
            setConfirm({
                message: `Delete subtask "${subtask_name || subtask_id}"?`,
                onConfirm: async () => {
                    setConfirm(null);
                    await fetch(`/api/subtasks/${subtask_id}`, { method: 'DELETE' });
                    invalidateCache();
                    setTasks((prev) =>
                        prev.map((t) => (t.task_id === task_id ? { ...t, subtasks: t.subtasks.filter((s) => s.subtask_id !== subtask_id) } : t))
                    );
                }
            });
        },
        [invalidateCache]
    );

    // ── Delete resource ───────────────────────────────────────────────────────────
    const handleDeleteResource = useCallback(
        (resource_id, resource_name) => {
            setConfirm({
                message: `Remove "${resource_name}" and all its hours data from this TTM?`,
                onConfirm: async () => {
                    setConfirm(null);
                    await fetch(`/api/ttm-resources/${ttm_id}/${resource_id}`, { method: 'DELETE' });
                    invalidateCache();
                    setResources((prev) => prev.filter((r) => r.resource_id !== resource_id));
                }
            });
        },
        [ttm_id, invalidateCache]
    );

    // ── Reorder tasks ─────────────────────────────────────────────────────────────
    const handleSaveTaskOrder = useCallback(
        async (taskIds) => {
            await fetch(`/api/ttm/${ttm_id}/task-order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskIds })
            });
            invalidateCache();
            setTasks((prev) => {
                const map = Object.fromEntries(prev.map((t) => [t.task_id, t]));
                return taskIds.map((id) => map[id]);
            });
        },
        [ttm_id, invalidateCache]
    );

    // ── Reorder resources ─────────────────────────────────────────────────────────
    const handleSaveResourceOrder = useCallback(
        async (resourceIds) => {
            await fetch(`/api/ttm/${ttm_id}/resource-order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resourceIds })
            });
            invalidateCache();
            setResources((prev) => {
                const map = Object.fromEntries(prev.map((r) => [r.resource_id, r]));
                return resourceIds.map((id) => map[id]);
            });
        },
        [ttm_id, invalidateCache]
    );

    // ── Footer totals (read from entriesRef at render time, refreshed by version) ──
    const getTotalHours = (resource_id) =>
        tasks.reduce(
            (acc, task) =>
                acc +
                task.subtasks.reduce((a, sub) => {
                    const h = entriesRef.current.get(`${sub.subtask_id}_${resource_id}`);
                    return a + (h != null ? Number(h) : 0);
                }, 0),
            0
        );

    const getTotalFees = (resource) => getTotalHours(resource.resource_id) * (resource.resource_billing_rate ?? 0);

    // ── Render ────────────────────────────────────────────────────────────────────
    if (loading)
        return (
            <div className="ttm-status">
                <span className="ttm-spinner" /> Loading…
            </div>
        );
    if (error) return <div className="ttm-status ttm-status-err">Error: {error}</div>;

    const totalResourceWidth = resources.length * RESOURCE_WIDTH;

    return (
        <div className="ttm-shell">
            {/* ── Sticky header (resource info rows) ───────────────────────────── */}
            <div className="ttm-head">
                <div className="ttm-corner">
                    {['Name', 'Email', 'Job Code', 'Rate'].map((label) => (
                        <div key={label} className="ttm-corner-cell">
                            {label}
                        </div>
                    ))}
                </div>
                <div className="ttm-head-clip">
                    <div ref={headerRef} className="ttm-head-inner" style={{ width: totalResourceWidth }}>
                        {resources.map((r) => (
                            <div key={r.resource_id} className="ttm-res-head-col" style={{ width: RESOURCE_WIDTH }}>
                                <div className="ttm-hcell ttm-hcell-name">
                                    {r.resource_name}
                                    <button
                                        className="ttm-del-res"
                                        title="Remove resource"
                                        onClick={() => handleDeleteResource(r.resource_id, r.resource_name)}
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="ttm-hcell ttm-hcell-info">{r.resource_email}</div>
                                <div className="ttm-hcell ttm-hcell-info">{r.resource_jobcode}</div>
                                <div className="ttm-hcell ttm-hcell-info">{r.resource_billing_rate != null ? `$${r.resource_billing_rate}` : '—'}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Body: left panel + main virtual grid ─────────────────────────── */}
            <div className="ttm-body">
                {/* Left panel: custom virtual list */}
                <div className="ttm-left" onWheel={handleLeftWheel}>
                    <LeftPanel
                        rows={rows}
                        scrollTop={scrollTop}
                        onEditTaskField={handleEditTaskField}
                        onEditSubtaskField={handleEditSubtaskField}
                        onDeleteTask={handleDeleteTask}
                        onDeleteSubtask={handleDeleteSubtask}
                    />
                </div>

                {/* Main data grid: react-window with chunk-based entry fetching */}
                <Grid
                    key={gridKey}
                    style={{ flex: 1 }}
                    rowCount={rows.length}
                    columnCount={resources.length}
                    rowHeight={ROW_HEIGHT}
                    columnWidth={RESOURCE_WIDTH}
                    cellComponent={DataCell}
                    cellProps={cellProps}
                    onCellsRendered={handleCellsRendered}
                    onScroll={handleGridScroll}
                    overscanCount={OVERSCAN_COLS}
                />
            </div>

            {/* ── Sticky footer (Total Hours + Total Fees) ──────────────────────── */}
            <div className="ttm-foot">
                <div className="ttm-foot-corner">
                    <div className="ttm-fcell">Total Hours</div>
                    <div className="ttm-fcell">Total Fees</div>
                </div>
                <div className="ttm-foot-clip">
                    <div ref={footerRef} className="ttm-foot-inner" style={{ width: totalResourceWidth }}>
                        {resources.map((r) => {
                            const hrs = getTotalHours(r.resource_id);
                            const fees = getTotalFees(r);
                            return (
                                <div key={r.resource_id} className="ttm-res-foot-col" style={{ width: RESOURCE_WIDTH }}>
                                    <div className="ttm-fcell">{hrs.toFixed(2) || ''}</div>
                                    <div className="ttm-fcell">{fees.toFixed(2) || ''}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Dialogs ───────────────────────────────────────────────────────── */}
            {showPicker && (
                <ResourcePicker
                    allResources={allResources}
                    addedIds={resources.map((r) => r.resource_id)}
                    onSelect={handleAddResource}
                    onClose={() => setShowPicker(false)}
                />
            )}

            {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

            {showAddSubtasks && (
                <AddSubtasksDialog
                    tasks={tasks}
                    onSave={handleAddSubtasks}
                    onClose={() => setShowAddSubtasks(false)}
                />
            )}

            {reorderTarget === 'tasks' && (
                <ReorderDialog
                    title="Reorder Tasks"
                    items={tasks.map((t) => ({ id: t.task_id, label: t.task_name || t.task_number || `Task ${t.task_id}` }))}
                    onSave={handleSaveTaskOrder}
                    onClose={() => setReorder(null)}
                />
            )}

            {reorderTarget === 'resources' && (
                <ReorderDialog
                    title="Reorder Resources"
                    items={resources.map((r) => ({ id: r.resource_id, label: r.resource_name || `Resource ${r.resource_id}` }))}
                    onSave={handleSaveResourceOrder}
                    onClose={() => setReorder(null)}
                />
            )}
        </div>
    );
});

export default TTMGrid;
