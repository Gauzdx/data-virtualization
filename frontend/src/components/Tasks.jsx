import { memo, useState, Fragment } from 'react';

const ROW_HEIGHT    = 36;
const TASK_NUM_W    = 90;
const TASK_NAME_W   = 220;
const OVERSCAN_ROWS = 4;

// ─── EditableCell ─────────────────────────────────────────────────────────────
function EditableCell({ value, onSave, className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  const start = () => { setDraft(value ?? ''); setEditing(true); };
  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? '')) onSave(draft);
  };

  if (editing) {
    return (
      <div className={`lp-cell ${className}`} style={{ padding: 0 }}>
        <input
          className="lp-input"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`lp-cell ${className}`} onDoubleClick={start} title={value ?? ''}>
      {value || ''}
    </div>
  );
}

// ─── TaskRow / SubtaskRow ─────────────────────────────────────────────────────
function TaskRow({ task, style, onEditTaskField, onDeleteTask }) {
  return (
    <div style={style} className="lp-row lp-row-task">
      <EditableCell
        value={task.task_number}
        className="lp-cell-num lp-cell-task"
        onSave={v => onEditTaskField(task.task_id, 'task_number', v)}
      />
      <div className="lp-cell-name-wrap">
        <EditableCell
          value={task.task_name}
          className="lp-cell-name lp-cell-task"
          onSave={v => onEditTaskField(task.task_id, 'task_name', v)}
        />
        <button
          className="lp-del-btn"
          title="Delete task"
          onClick={() => onDeleteTask(task.task_id, task.task_name)}
        >×</button>
      </div>
    </div>
  );
}

function SubtaskRow({ task, subtask, style, onEditSubtaskField, onDeleteSubtask }) {
  return (
    <div style={style} className="lp-row lp-row-subtask">
      <EditableCell
        value={subtask.subtask_number}
        className="lp-cell-num lp-cell-subtask"
        onSave={v => onEditSubtaskField(task.task_id, subtask.subtask_id, 'subtask_number', v)}
      />
      <div className="lp-cell-name-wrap">
        <EditableCell
          value={subtask.subtask_name}
          className="lp-cell-name lp-cell-subtask"
          onSave={v => onEditSubtaskField(task.task_id, subtask.subtask_id, 'subtask_name', v)}
        />
        <button
          className="lp-del-btn lp-del-sm"
          title="Delete subtask"
          onClick={() => onDeleteSubtask(task.task_id, subtask.subtask_id, subtask.subtask_name)}
        >×</button>
      </div>
    </div>
  );
}

// ─── LeftPanel — custom virtual list (no react-window needed; 2 columns only) ─
// Virtualization: calculates visible row window from scrollTop + containerHeight.
// Renders only those rows with absolute positioning inside a full-height spacer.
// The outer div is overflow:hidden; the parent forwards wheel events to main Grid.
const LeftPanel = memo(function LeftPanel({
  rows, scrollTop, containerHeight,
  onEditTaskField, onEditSubtaskField, onDeleteTask, onDeleteSubtask,
}) {
  const totalHeight = rows.length * ROW_HEIGHT;

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const endIdx   = Math.min(
    rows.length - 1,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
  );

  const visibleRows = rows.slice(startIdx, endIdx + 1);

  return (
    <div
      className="lp-outer"
      style={{ height: containerHeight, overflow: 'hidden', width: TASK_NUM_W + TASK_NAME_W }}
    >
      {/* Full-height spacer keeps the virtual content in correct position */}
      <div style={{ position: 'relative', height: totalHeight }}>
        {visibleRows.map((row, i) => {
          const absIdx = startIdx + i;
          const top    = absIdx * ROW_HEIGHT;
          const baseStyle = { position: 'absolute', top, height: ROW_HEIGHT, width: '100%', display: 'flex' };

          if (row.type === 'task') {
            return (
              <TaskRow
                key={`t-${row.task.task_id}`}
                task={row.task}
                style={baseStyle}
                onEditTaskField={onEditTaskField}
                onDeleteTask={onDeleteTask}
              />
            );
          }
          return (
            <SubtaskRow
              key={`s-${row.subtask.subtask_id}`}
              task={row.task}
              subtask={row.subtask}
              style={baseStyle}
              onEditSubtaskField={onEditSubtaskField}
              onDeleteSubtask={onDeleteSubtask}
            />
          );
        })}
      </div>
    </div>
  );
});

export default LeftPanel;
