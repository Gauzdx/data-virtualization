import { useState, useRef, useCallback } from 'react';
import TopNav    from './components/TopNav';
import HomePage  from './components/HomePage';
import TTMGrid   from './components/TTMGrid';
import './App.css';

export default function App() {
  const [currentTtm, setCurrentTtm] = useState(null); // null = home, object = { ttm_id, ttm_name }
  const ttmGridRef = useRef(null);

  const handleHome = useCallback(() => setCurrentTtm(null), []);

  const handleAddTask = useCallback(() => {
    ttmGridRef.current?.addTask();
  }, []);

  const handleAddResource = useCallback(() => {
    ttmGridRef.current?.openResourcePicker();
  }, []);

  const handleReorder = useCallback((type) => {
    ttmGridRef.current?.openReorder(type);
  }, []);

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
        {currentTtm === null ? (
          <HomePage onSelectTtm={setCurrentTtm} />
        ) : (
          <TTMGrid
            ref={ttmGridRef}
            ttm_id={currentTtm.ttm_id}
            ttm_name={currentTtm.ttm_name}
          />
        )}
      </main>
    </div>
  );
}
