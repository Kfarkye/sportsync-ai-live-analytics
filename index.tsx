
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import SoccerLeagueStructuralStatsPage, { getSoccerLeagueByPathname } from './src/pages/SoccerLeagueStructuralStatsPage';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const leaguePage = getSoccerLeagueByPathname(window.location.pathname);

if (leaguePage) {
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
