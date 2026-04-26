import { useState, useCallback } from 'react';
import { Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import TopNav from './components/TopNav/TopNav';
import HomePage from './pages/HomePage/HomePage';
import TTMPage from './pages/TTMPage/TTMPage';
import './App.css';

function AppLayout() {
	const navigate = useNavigate();
	const [currentTtm, setCurrentTtm] = useState(null);
	const [ttmActions, setTtmActions] = useState(null);

	const handleHome = useCallback(() => navigate('/'), [navigate]);
	const handleAddTask = useCallback(() => ttmActions?.addTask(), [ttmActions]);
	const handleAddResource = useCallback(() => ttmActions?.openResourcePicker(), [ttmActions]);
	const handleReorder = useCallback((type) => ttmActions?.openReorder(type), [ttmActions]);

	return (
		<div className="app">
			<TopNav currentTtm={currentTtm} onHome={handleHome} onAddTask={handleAddTask} onAddResource={handleAddResource} onReorder={handleReorder} />
			<main className="app-main">
				<Outlet context={{ setCurrentTtm, setTtmActions }} />
			</main>
		</div>
	);
}

export default function App() {
	return (
		<Routes>
			<Route element={<AppLayout />}>
				<Route path="/" element={<HomePage />} />
				<Route path="/ttm/:ttm_id" element={<TTMPage />} />
			</Route>
		</Routes>
	);
}
