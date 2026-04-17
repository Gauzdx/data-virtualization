import {
  forwardRef, useImperativeHandle,
  useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect, memo,
} from 'react';
import { Grid } from 'react-window';
import LeftPanel from './Tasks';
import './TTMGrid.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const ROW_HEIGHT     = 36;
const RESOURCE_WIDTH = 120;
const LEFT_WIDTH     = 310; // 90 (task#) + 220 (task name)
const OVERSCAN_COLS  = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function buildRows(tasks) {
  const rows = [];
  tasks.forEach(task => {
    rows.push({ type: 'task', task });
    task.subtasks.forEach(sub => rows.push({ type: 'subtask', task, subtask: sub }));
  });
  return rows;
}

// ─── Inline dialogs ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="ttm-overlay" onClick={onCancel}>
      <div className="ttm-dialog" onClick={e => e.stopPropagation()}>
        <p className="ttm-dialog-msg">{message}</p>
        <div className="ttm-dialog-actions">
          <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onCancel}>Cancel</button>
          <button className="ttm-dlg-btn ttm-dlg-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function ReorderDialog({ title, items, onSave, onClose }) {
  const [list, setList] = useState(items);

  const move = (idx, dir) => {
    const next = [...list];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setList(next);
  };

  return (
    <div className="ttm-overlay" onClick={onClose}>
      <div className="ttm-dialog ttm-dialog-reorder" onClick={e => e.stopPropagation()}>
        <h3 className="ttm-dialog-title">{title}</h3>
        <ul className="ttm-reorder-list">
          {list.map((item, idx) => (
            <li key={item.id} className="ttm-reorder-item">
              <span className="ttm-reorder-num">{idx + 1}</span>
              <span className="ttm-reorder-label">{item.label}</span>
              <div className="ttm-reorder-btns">
                <button className="ttm-reorder-arrow" onClick={() => move(idx, -1)} disabled={idx === 0}>▲</button>
                <button className="ttm-reorder-arrow" onClick={() => move(idx, 1)}  disabled={idx === list.length - 1}>▼</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="ttm-dialog-actions">
          <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>Cancel</button>
          <button className="ttm-dlg-btn ttm-dlg-primary" onClick={() => { onSave(list.map(i => i.id)); onClose(); }}>
            Save Order
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourcePicker({ allResources, addedIds, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const available = allResources.filter(r => {
    if (addedIds.includes(r.resource_id)) return false;
    const q = search.toLowerCase();
    return !q || r.resource_name?.toLowerCase().includes(q) ||
      r.resource_email?.toLowerCase().includes(q) ||
      r.resource_jobcode?.toLowerCase().includes(q);
  });
  return (
    <div className="ttm-overlay" onClick={onClose}>
      <div className="ttm-dialog ttm-dialog-picker" onClick={e => e.stopPropagation()}>
        <h3 className="ttm-dialog-title">Add Resource</h3>
        <input className="ttm-picker-search" placeholder="Search name, email, job code…"
          value={search} autoFocus onChange={e => setSearch(e.target.value)} />
        <div className="ttm-picker-list">
          {available.length === 0
            ? <p className="ttm-picker-empty">{allResources.length === 0 ? 'No resources found.' : 'All resources already added.'}</p>
            : available.map(r => (
              <button key={r.resource_id} className="ttm-picker-item"
                onClick={() => { onSelect(r.resource_id); onClose(); }}>
                <span className="ttm-picker-name">{r.resource_name}</span>
                <span className="ttm-picker-sub">{r.resource_email} · {r.resource_jobcode}
                  {r.resource_billing_rate != null ? ` · $${r.resource_billing_rate}/hr` : ''}</span>
              </button>
            ))
          }
        </div>
        <div className="ttm-dialog-actions">
          <button className="ttm-dlg-btn ttm-dlg-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── DataCell — rendered by react-window Grid ─────────────────────────────────
const DataCell = memo(({
  rowIndex, columnIndex, style,
  rows, resources, entries,
  editingCell, commitLockRef,
  onStartEdit, onCommit, onCancel,
}) => {
  const row      = rows[rowIndex];
  const resource = resources[columnIndex];
  if (!row || !resource) return <div style={style} />;

  const isEditing = editingCell?.ri === rowIndex && editingCell?.ci === columnIndex;

  if (row.type === 'task') {
    const sum = row.task.subtasks.reduce((acc, sub) => {
      const h = entries[`${sub.subtask_id}_${resource.resource_id}`];
      return acc + (h != null ? Number(h) : 0);
    }, 0);
    return (
      <div style={style} className="dc dc-task">
        {sum > 0 ? sum : ''}
      </div>
    );
  }

  // Subtask row — editable hours
  const sub   = row.subtask;
  const value = entries[`${sub.subtask_id}_${resource.resource_id}`];

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
          type="number" min="0" step="0.5"
          autoFocus
          defaultValue={value != null ? String(value) : ''}
          onBlur={handleCommit}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); handleCommit(e); }
            if (e.key === 'Escape') { onCancel(); }
          }}
        />
      </div>
    );
  }

  return (
    <div style={style} className="dc dc-hours" onDoubleClick={() => onStartEdit(rowIndex, columnIndex)}>
      {value != null && value !== '' ? value : ''}
    </div>
  );
});

DataCell.displayName = 'DataCell';

// ─── TTMGrid ──────────────────────────────────────────────────────────────────
const TTMGrid = forwardRef(function TTMGrid({ ttm_id }, ref) {
  const [tasks, setTasks]         = useState([]);
  const [resources, setResources] = useState([]);
  const [entries, setEntries]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [editingCell, setEditing] = useState(null); // { ri, ci }
  const [scrollTop, setScrollTop] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(400);
  const [showPicker, setShowPicker]   = useState(false);
  const [allResources, setAllRes]     = useState([]);
  const [pickerLoading, setPickLoad]  = useState(false);
  const [reorderTarget, setReorder]   = useState(null); // 'tasks' | 'resources'
  const [confirm, setConfirm]         = useState(null);  // { message, onConfirm }

  const headerRef      = useRef(null);
  const footerRef      = useRef(null);
  const bodyRef        = useRef(null);
  const mainOuterEl    = useRef(null);
  const rafRef         = useRef(null);
  const commitLockRef  = useRef(false);

  // ── Load TTM data ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch(`/api/ttm/${ttm_id}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(({ tasks: t, resources: r, entries: e }) => {
        setTasks(t);
        setResources(r);
        const map = {};
        e.forEach(en => { map[`${en.subtask_id}_${en.resource_id}`] = en.ttm_entry_hours; });
        setEntries(map);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [ttm_id]);

  // ── Measure body height for left panel virtualization ────────────────────────
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const ro = new ResizeObserver(es => setBodyHeight(es[0].contentRect.height));
    ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Imperative API for TopNav buttons ────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    addTask: handleAddTask,
    openResourcePicker: handleOpenPicker,
    openReorder: (type) => setReorder(type),
  }));

  // ── Scroll sync ──────────────────────────────────────────────────────────────
  const handleGridScroll = useCallback((e) => {
    mainOuterEl.current = e.currentTarget;
    const { scrollTop: top, scrollLeft: left } = e.currentTarget;

    // Header and footer: use CSS transform to avoid overflow:hidden scrollLeft bug
    if (headerRef.current) headerRef.current.style.transform = `translateX(-${left}px)`;
    if (footerRef.current) footerRef.current.style.transform = `translateX(-${left}px)`;

    // Left panel: batch via rAF so React re-renders happen at 60fps
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollTop(top));
  }, []);

  // Forward wheel events from left panel area to the main grid
  const handleLeftWheel = useCallback((e) => {
    if (!mainOuterEl.current) return;
    e.preventDefault();
    mainOuterEl.current.scrollTop += e.deltaY;
  }, []);

  // ── Derived rows ─────────────────────────────────────────────────────────────
  const rows = useMemo(() => buildRows(tasks), [tasks]);

  // ── cellProps for react-window (recreated when editing/entries/rows change) ──
  const cellProps = useMemo(() => ({
    rows, resources, entries, editingCell, commitLockRef,
    onStartEdit: (ri, ci) => { commitLockRef.current = false; setEditing({ ri, ci }); },
    onCommit:    (ri, ci, val) => {
      setEditing(null);
      commitLockRef.current = false;
      const row      = rows[ri];
      const resource = resources[ci];
      if (!row || row.type !== 'subtask' || !resource) return;
      const sub   = row.subtask;
      const hours = val === '' || val == null ? null : parseFloat(val);
      setEntries(prev => ({ ...prev, [`${sub.subtask_id}_${resource.resource_id}`]: hours }));
      fetch('/api/ttm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'hours', ttm_id, task_id: row.task.task_id,
          subtask_id: sub.subtask_id, resource_id: resource.resource_id, value: val,
        }),
      }).catch(console.error);
    },
    onCancel: () => { setEditing(null); commitLockRef.current = false; },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, resources, entries, editingCell, ttm_id]);

  // ── Add task ─────────────────────────────────────────────────────────────────
  const handleAddTask = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttm_id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newTask = await res.json();
      setTasks(prev => [...prev, { ...newTask, _new: true }]);
    } catch (err) { console.error('Add task failed:', err.message); }
  }, [ttm_id]);

  // ── Add resource ─────────────────────────────────────────────────────────────
  const handleOpenPicker = useCallback(async () => {
    if (allResources.length === 0 && !pickerLoading) {
      setPickLoad(true);
      try {
        const r = await fetch('/api/resources');
        if (r.ok) setAllRes(await r.json());
      } finally { setPickLoad(false); }
    }
    setShowPicker(true);
  }, [allResources.length, pickerLoading]);

  const handleAddResource = useCallback(async (resource_id) => {
    try {
      const res = await fetch('/api/ttm-resources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttm_id, resource_id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newRes = await res.json();
      setResources(prev => [...prev, newRes]);
    } catch (err) { console.error('Add resource failed:', err.message); }
  }, [ttm_id]);

  // ── Edit task/subtask fields ──────────────────────────────────────────────────
  const handleEditTaskField = useCallback((task_id, field, value) => {
    setTasks(prev => prev.map(t => t.task_id === task_id ? { ...t, [field]: value } : t));
    fetch('/api/ttm', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'task', task_id, field, value }) }).catch(console.error);
  }, []);

  const handleEditSubtaskField = useCallback((task_id, subtask_id, field, value) => {
    setTasks(prev => prev.map(t =>
      t.task_id === task_id
        ? { ...t, subtasks: t.subtasks.map(s => s.subtask_id === subtask_id ? { ...s, [field]: value } : s) }
        : t
    ));
    fetch('/api/ttm', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'subtask', subtask_id, field, value }) }).catch(console.error);
  }, []);

  // ── Delete task ───────────────────────────────────────────────────────────────
  const handleDeleteTask = useCallback((task_id, task_name) => {
    setConfirm({
      message: `Delete task "${task_name || task_id}" and all its subtasks?`,
      onConfirm: async () => {
        setConfirm(null);
        await fetch(`/api/tasks/${task_id}`, { method: 'DELETE' });
        setTasks(prev => prev.filter(t => t.task_id !== task_id));
      },
    });
  }, []);

  // ── Delete subtask ────────────────────────────────────────────────────────────
  const handleDeleteSubtask = useCallback((task_id, subtask_id, subtask_name) => {
    setConfirm({
      message: `Delete subtask "${subtask_name || subtask_id}"?`,
      onConfirm: async () => {
        setConfirm(null);
        await fetch(`/api/subtasks/${subtask_id}`, { method: 'DELETE' });
        setTasks(prev => prev.map(t =>
          t.task_id === task_id
            ? { ...t, subtasks: t.subtasks.filter(s => s.subtask_id !== subtask_id) }
            : t
        ));
      },
    });
  }, []);

  // ── Delete resource ───────────────────────────────────────────────────────────
  const handleDeleteResource = useCallback((resource_id, resource_name) => {
    setConfirm({
      message: `Remove "${resource_name}" and all its hours data from this TTM?`,
      onConfirm: async () => {
        setConfirm(null);
        await fetch(`/api/ttm-resources/${ttm_id}/${resource_id}`, { method: 'DELETE' });
        setResources(prev => prev.filter(r => r.resource_id !== resource_id));
        setEntries(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => { if (k.endsWith(`_${resource_id}`)) delete next[k]; });
          return next;
        });
      },
    });
  }, [ttm_id]);

  // ── Reorder tasks ─────────────────────────────────────────────────────────────
  const handleSaveTaskOrder = useCallback(async (taskIds) => {
    await fetch(`/api/ttm/${ttm_id}/task-order`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds }),
    });
    setTasks(prev => {
      const map = Object.fromEntries(prev.map(t => [t.task_id, t]));
      return taskIds.map(id => map[id]);
    });
  }, [ttm_id]);

  // ── Reorder resources ─────────────────────────────────────────────────────────
  const handleSaveResourceOrder = useCallback(async (resourceIds) => {
    await fetch(`/api/ttm/${ttm_id}/resource-order`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceIds }),
    });
    setResources(prev => {
      const map = Object.fromEntries(prev.map(r => [r.resource_id, r]));
      return resourceIds.map(id => map[id]);
    });
  }, [ttm_id]);

  // ── Footer totals ─────────────────────────────────────────────────────────────
  const totalHours = useCallback((resource_id) =>
    tasks.reduce((acc, task) =>
      acc + task.subtasks.reduce((a, sub) => {
        const h = entries[`${sub.subtask_id}_${resource_id}`];
        return a + (h != null ? Number(h) : 0);
      }, 0), 0),
  [tasks, entries]);

  const totalFees = useCallback((resource) =>
    totalHours(resource.resource_id) * (resource.resource_billing_rate ?? 0),
  [totalHours]);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <div className="ttm-status"><span className="ttm-spinner" /> Loading…</div>;
  if (error)   return <div className="ttm-status ttm-status-err">Error: {error}</div>;

  const totalResourceWidth = resources.length * RESOURCE_WIDTH;

  return (
    <div className="ttm-shell">

      {/* ── Sticky header (4 info rows) ───────────────────────────────────── */}
      <div className="ttm-head">
        {/* Corner: header labels for the left columns */}
        <div className="ttm-corner">
          {['Name', 'Email', 'Job Code', 'Rate'].map(label => (
            <div key={label} className="ttm-corner-cell">{label}</div>
          ))}
        </div>
        {/* Resource info columns — shift via transform on scroll */}
        <div className="ttm-head-clip">
          <div ref={headerRef} className="ttm-head-inner" style={{ width: totalResourceWidth }}>
            {resources.map(r => (
              <div key={r.resource_id} className="ttm-res-head-col" style={{ width: RESOURCE_WIDTH }}>
                <div className="ttm-hcell ttm-hcell-name">
                  {r.resource_name}
                  <button className="ttm-del-res" title="Remove resource"
                    onClick={() => handleDeleteResource(r.resource_id, r.resource_name)}>×</button>
                </div>
                <div className="ttm-hcell ttm-hcell-info">{r.resource_email}</div>
                <div className="ttm-hcell ttm-hcell-info">{r.resource_jobcode}</div>
                <div className="ttm-hcell ttm-hcell-info">
                  {r.resource_billing_rate != null ? `$${r.resource_billing_rate}` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body: left panel + main virtual grid ─────────────────────────── */}
      <div ref={bodyRef} className="ttm-body">

        {/* Left panel: custom virtual (sticky left) */}
        <div className="ttm-left" onWheel={handleLeftWheel}>
          <LeftPanel
            rows={rows}
            scrollTop={scrollTop}
            containerHeight={bodyHeight}
            onEditTaskField={handleEditTaskField}
            onEditSubtaskField={handleEditSubtaskField}
            onDeleteTask={handleDeleteTask}
            onDeleteSubtask={handleDeleteSubtask}
          />
        </div>

        {/* Main data grid: react-window */}
        <Grid
          style={{ flex: 1 }}
          rowCount={rows.length}
          columnCount={resources.length}
          rowHeight={ROW_HEIGHT}
          columnWidth={RESOURCE_WIDTH}
          cellComponent={DataCell}
          cellProps={cellProps}
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
            {resources.map(r => {
              const hrs  = totalHours(r.resource_id);
              const fees = totalFees(r);
              return (
                <div key={r.resource_id} className="ttm-res-foot-col" style={{ width: RESOURCE_WIDTH }}>
                  <div className="ttm-fcell">{hrs || ''}</div>
                  <div className="ttm-fcell">{fees ? `$${fees.toLocaleString()}` : ''}</div>
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
          addedIds={resources.map(r => r.resource_id)}
          onSelect={handleAddResource}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {reorderTarget === 'tasks' && (
        <ReorderDialog
          title="Reorder Tasks"
          items={tasks.map(t => ({ id: t.task_id, label: t.task_name || t.task_number || `Task ${t.task_id}` }))}
          onSave={handleSaveTaskOrder}
          onClose={() => setReorder(null)}
        />
      )}

      {reorderTarget === 'resources' && (
        <ReorderDialog
          title="Reorder Resources"
          items={resources.map(r => ({ id: r.resource_id, label: r.resource_name || `Resource ${r.resource_id}` }))}
          onSave={handleSaveResourceOrder}
          onClose={() => setReorder(null)}
        />
      )}
    </div>
  );
});

export default TTMGrid;
