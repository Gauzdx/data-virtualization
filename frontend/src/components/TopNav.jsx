import './TopNav.css';

export default function TopNav({ currentTtm, onHome, onAddTask, onAddResource, onReorder }) {
  const viewing = currentTtm !== null;

  return (
    <nav className="topnav">
      <button className="topnav-logo" onClick={onHome} title="Go to home">
        <span className="topnav-logo-t">T</span>
        <span className="topnav-logo-rest">TM</span>
      </button>

      {viewing && (
        <span className="topnav-ttm-name">{currentTtm.ttm_name}</span>
      )}

      <div className="topnav-spacer" />

      {viewing && (
        <div className="topnav-actions">
          <button className="topnav-btn topnav-btn-ghost" onClick={() => onReorder('tasks')}
            title="Reorder tasks">
            ⇅ Tasks
          </button>
          <button className="topnav-btn topnav-btn-ghost" onClick={() => onReorder('resources')}
            title="Reorder resources">
            ⇄ Resources
          </button>
          <button className="topnav-btn topnav-btn-outline" onClick={onAddTask}>
            + Task
          </button>
          <button className="topnav-btn topnav-btn-red" onClick={onAddResource}>
            + Resource
          </button>
        </div>
      )}

      {!viewing && (
        <span className="topnav-tagline">Task Time Management</span>
      )}
    </nav>
  );
}
