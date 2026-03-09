
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import SoccerLeagueStructuralStatsPage, {
  getSoccerLeagueByPathname,
  isDeprecatedSoccerLeaguePathname,
} from './src/pages/SoccerLeagueStructuralStatsPage';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const pathname = window.location.pathname;
const leaguePage = getSoccerLeagueByPathname(pathname);
const isDeprecatedLeaguePath = isDeprecatedSoccerLeaguePathname(pathname);

const DeprecatedPathGone = () => (
  <main className="mx-auto min-h-screen max-w-3xl px-6 py-20 text-slate-900">
    <h1 className="text-3xl font-semibold tracking-tight">410 Gone</h1>
    <p className="mt-4 text-slate-600">
      This URL has been retired and is no longer served. Use the current structural stats paths under `/soccer/*-structural-stats`.
    </p>
    <a href="/" className="mt-6 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
      Back to live feed
    </a>
  </main>
);

if (isDeprecatedLeaguePath) {
  root.render(
    <React.StrictMode>
      <DeprecatedPathGone />
    </React.StrictMode>
  );
} else if (leaguePage) {
  root.render(
    <React.StrictMode>
      <SoccerLeagueStructuralStatsPage league={leaguePage} />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// PWA: Register service worker for installability + offline shell
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
