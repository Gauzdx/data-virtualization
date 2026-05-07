import { useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav/TopNav';

export default function TtmLayout() {
	const navigate = useNavigate();
	const [currentTtm, setCurrentTtm] = useState(null);
	const [ttmActions, setTtmActions] = useState(null);

	const handleHome = useCallback(() => navigate('/'), [navigate]);
	const handleAddTask = useCallback(() => ttmActions?.addTask(), [ttmActions]);
	const handleAddSubtasks = useCallback(() => ttmActions?.openAddSubtasks(), [ttmActions]);
	const handleAddResource = useCallback(() => ttmActions?.openResourcePicker(), [ttmActions]);
	const handleReorder = useCallback((type) => ttmActions?.openReorder(type), [ttmActions]);

	return (
		<div className="app">
			<TopNav
				currentTtm={currentTtm}
				onHome={handleHome}
				onAddTask={handleAddTask}
				onAddSubtasks={handleAddSubtasks}
				onAddResource={handleAddResource}
				onReorder={handleReorder}
			/>
			<main className="app-main">
				<Outlet context={{ setCurrentTtm, setTtmActions }} />
			</main>
		</div>
	);
}
