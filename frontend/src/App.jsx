import { useState, useRef, useCallback, useEffect } from 'react';
import TopNav   from './components/TopNav';
import HomePage from './components/HomePage';
import TTMGrid  from './components/TTMGrid';
import './App.css';

// Parse window.location.pathname into a route descriptor
function parsePath(pathname) {
  const match = pathname.match(/^\/ttm\/(\d+)$/);
  if (match) return { view: 'ttm', ttm_id: parseInt(match[1], 10) };
  return { view: 'home' };
}

export default function App() {
  const [route, setRoute]       = useState(() => parsePath(window.location.pathname));
  const [ttmName, setTtmName]   = useState(null);
  const ttmGridRef              = useRef(null);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path, name = null) => {
    window.history.pushState({}, '', path);
    setRoute(parsePath(path));
    setTtmName(name);
  }, []);

  const handleSelectTtm = useCallback((ttm) => {
    navigate(`/ttm/${ttm.ttm_id}`, ttm.ttm_name);
  }, [navigate]);

  const handleHome        = useCallback(() => navigate('/'), [navigate]);
  const handleAddTask     = useCallback(() => ttmGridRef.current?.addTask(), []);
  const handleAddResource = useCallback(() => ttmGridRef.current?.openResourcePicker(), []);
  const handleReorder     = useCallback((type) => ttmGridRef.current?.openReorder(type), []);

  const isViewingTtm = route.view === 'ttm';

  // currentTtm shape used by TopNav to decide which action buttons to show
  const currentTtm = isViewingTtm
    ? { ttm_id: route.ttm_id, ttm_name: ttmName }
    : null;

  return (
    <div className="app">
      <TopNav
        currentTtm={currentTtm}
        onHome={handleHome}
        onAddTask={handleAddTask}
        onAddResource={handleAddResource}
        onReorder={handleReorder}
      />
      <main className="app-main">
        {isViewingTtm ? (
          <TTMGrid
            ref={ttmGridRef}
            key={route.ttm_id}
            ttm_id={route.ttm_id}
          />
        ) : (
          <HomePage onSelectTtm={handleSelectTtm} />
        )}
      </main>
    </div>
  );
}
