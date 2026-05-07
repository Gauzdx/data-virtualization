import { Routes, Route } from 'react-router-dom';
import HomeLayout from './layouts/HomeLayout';
import TtmLayout from './layouts/TtmLayout';
import HomePage from './pages/HomePage/HomePage';
import TtmHomePage from './pages/TtmHomePage/TtmHomePage';
import TTMPage from './pages/TTMPage/TTMPage';
import './App.css';

export default function App() {
	return (
		<Routes>
			<Route element={<HomeLayout />}>
				<Route path="/" element={<HomePage />} />
			</Route>
			<Route element={<TtmLayout />}>
				<Route path="/ttm" element={<TtmHomePage />} />
				<Route path="/ttm/:ttm_id" element={<TTMPage />} />
			</Route>
		</Routes>
	);
}
