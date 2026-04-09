import { useEffect, useState } from 'react';
import VirtualGrid from './components/VirtualGrid';
import './App.css';

export default function App() {
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/metadata')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setMetadata)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">TTM Data Viewer</h1>
        {metadata && (
          <span className="app-meta">
            {metadata.rowCount.toLocaleString()} rows &times; {metadata.columns.length} columns
          </span>
        )}
      </header>

      <main className="app-main">
        {error && (
          <div className="status-box status-error">
            Failed to connect: {error}
          </div>
        )}
        {!error && !metadata && (
          <div className="status-box status-loading">
            <span className="spinner" /> Loading metadata&hellip;
          </div>
        )}
        {metadata && (
          <VirtualGrid columns={metadata.columns} rowCount={metadata.rowCount} />
        )}
      </main>
    </div>
  );
}
