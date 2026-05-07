import { Outlet } from 'react-router-dom';
import HomepageNav from '../components/HomepageNav/HomepageNav';

export default function HomeLayout() {
	return (
		<div className="app">
			<HomepageNav />
			<main className="app-main">
				<Outlet />
			</main>
		</div>
	);
}
