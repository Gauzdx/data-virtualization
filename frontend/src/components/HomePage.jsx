import { useState, useEffect } from 'react';
import './HomePage.css';

function CreateTtmModal({ onClose, onCreate }) {
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [delegation, setDeleg]    = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/ttm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttm_name: name.trim(), ttm_creator_email: email, ttm_delegation: delegation }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ttm = await res.json();
      onCreate(ttm);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="hp-overlay" onClick={onClose}>
      <div className="hp-modal" onClick={e => e.stopPropagation()}>
        <h2 className="hp-modal-title">New TTM</h2>
        <form onSubmit={submit} className="hp-form">
          <label className="hp-label">
            TTM Name <span className="hp-required">*</span>
            <input
              className="hp-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Q2 2026 Planning"
              autoFocus
            />
          </label>
          <label className="hp-label">
            Creator Email
            <input
              className="hp-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label className="hp-label">
            Delegation
            <input
              className="hp-input"
              value={delegation}
              onChange={e => setDeleg(e.target.value)}
              placeholder="e.g. Engineering"
            />
          </label>
          {error && <p className="hp-form-error">{error}</p>}
          <div className="hp-form-actions">
            <button type="button" className="hp-btn hp-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="hp-btn hp-btn-red" disabled={saving}>
              {saving ? 'Creating…' : 'Create TTM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function HomePage({ onSelectTtm }) {
  const [ttms, setTtms]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch('/api/ttm')
      .then(r => r.json())
      .then(data => { setTtms(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleCreated = (ttm) => {
    setTtms(prev => [ttm, ...prev]);
    setShowCreate(false);
    onSelectTtm({ ttm_id: ttm.ttm_id, ttm_name: ttm.ttm_name });
  };

  return (
    <div className="hp-shell">
      <div className="hp-hero">
        <div className="hp-hero-content">
          <h1 className="hp-hero-title">
            <span className="hp-hero-t">T</span>TM
          </h1>
          <p className="hp-hero-sub">Task Time Management</p>
          <button className="hp-btn hp-btn-red hp-btn-lg" onClick={() => setShowCreate(true)}>
            + New TTM
          </button>
        </div>
        <div className="hp-hero-bar" />
      </div>

      <div className="hp-content">
        <div className="hp-section-header">
          <h2 className="hp-section-title">Recent TTMs</h2>
          <button className="hp-btn hp-btn-outline-dark" onClick={() => setShowCreate(true)}>
            + New TTM
          </button>
        </div>

        {loading && (
          <div className="hp-grid">
            {[1, 2, 3].map(i => <div key={i} className="hp-card hp-card-skeleton" />)}
          </div>
        )}

        {!loading && ttms.length === 0 && (
          <div className="hp-empty">
            <div className="hp-empty-icon">📋</div>
            <p className="hp-empty-text">No TTMs yet. Create your first one above.</p>
          </div>
        )}

        {!loading && ttms.length > 0 && (
          <div className="hp-grid">
            {ttms.map(ttm => (
              <button
                key={ttm.ttm_id}
                className="hp-card"
                onClick={() => onSelectTtm({ ttm_id: ttm.ttm_id, ttm_name: ttm.ttm_name })}
              >
                <div className="hp-card-accent" />
                <div className="hp-card-body">
                  <span className="hp-card-id">#{ttm.ttm_id}</span>
                  <h3 className="hp-card-name">{ttm.ttm_name}</h3>
                  {ttm.ttm_delegation && (
                    <span className="hp-card-tag">{ttm.ttm_delegation}</span>
                  )}
                  {ttm.ttm_creator_email && (
                    <p className="hp-card-email">{ttm.ttm_creator_email}</p>
                  )}
                </div>
                <div className="hp-card-arrow">→</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTtmModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}
    </div>
  );
}
