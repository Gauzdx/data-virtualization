import { useNavigate } from 'react-router-dom';
import './HomePage.css';

const APPS = [
	{
		id: 'ttm',
		name: 'TTM',
		fullName: 'Time Task Matrix',
		description: 'Plan and track time across tasks and resources.',
		path: '/ttm'
	},
	{
		id: 'someapp',
		name: 'Some App',
		fullName: 'Some App',
		description: 'Some App Description.',
		path: '/someapp'
	}
];

export default function HomePage() {
	const navigate = useNavigate();

	return (
		<div className="ah-shell">
			<div className="ah-hero">
				<div className="ah-hero-content">
					<h1 className="ah-hero-title">Apps</h1>
					<p className="ah-hero-sub">Pick an application to launch</p>
				</div>
				<div className="ah-hero-bar" />
			</div>

			<div className="ah-content">
				<div className="ah-grid">
					{APPS.map((app) => (
						<button key={app.id} className="ah-card" onClick={() => navigate(app.path)}>
							<div className="ah-card-accent" />
							<div className="ah-card-body">
								<span className="ah-card-short">{app.name}</span>
								<h3 className="ah-card-name">{app.fullName}</h3>
								<p className="ah-card-desc">{app.description}</p>
							</div>
							<div className="ah-card-arrow">→</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
