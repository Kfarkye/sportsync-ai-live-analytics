import React, { FC } from 'react';
import { Link } from 'react-router-dom';

interface Surface {
  label: string;
  title: string;
  description: string;
  href: string;
  external?: boolean;
}

const SURFACES: Surface[] = [
  {
    label: 'NBA',
    title: 'NBA Props',
    description: 'Live evidence pack profiles with baseline + context splits.',
    href: '/props',
  },
  {
    label: 'Trends',
    title: 'ATS & O/U Trends',
    description: 'ATS records and totals trends.',
    href: '/trends',
  },
  {
    label: 'Pregame',
    title: 'Game Matchups',
    description: 'Odds, matchups, and trends.',
    href: '/edge',
  },
  {
    label: 'MLB',
    title: 'Bullpens',
    description: 'Bullpen risk with weather and late-inning stress.',
    href: '/edge',
  },
  {
    label: 'Officials',
    title: 'NBA Referees',
    description: 'Ref betting stats and totals trends.',
    href: 'https://ref-tendencies.web.app/',
    external: true,
  },
  {
    label: 'Live Board',
    title: 'THEDRIP.BET',
    description: 'Live slate board with in-game state and market context.',
    href: '/live',
  },
  {
    label: 'World Cup',
    title: 'THEDRIP.TO',
    description: 'Live World Cup board with match state and market context.',
    href: '/world-cup-2026',
  },
];

const HubPage: FC = () => (
  <div style={styles.wrapper}>
    <main style={styles.hub}>
      <div style={styles.kicker}>SportsSync</div>

      <section style={styles.grid} aria-label="Evidence Surfaces">
        {SURFACES.map((s) => {
          const inner = (
            <>
              <div style={styles.tileLabel}>{s.label}</div>
              <div style={styles.tileTitle}>{s.title}</div>
              <p style={styles.tileCopy}>{s.description}</p>
              <span style={styles.arrow}>→</span>
            </>
          );

          return s.external ? (
            <a
              key={s.title}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.tile}
              className="hub-tile"
            >
              {inner}
            </a>
          ) : (
            <Link
              key={s.title}
              to={s.href}
              style={styles.tile}
              className="hub-tile"
            >
              {inner}
            </Link>
          );
        })}
      </section>

      <footer style={styles.footer}>
        Quantitative decision-support for entertainment only. Not financial advice.
        <br />
        <span style={styles.footerLegal}>21+ &nbsp;&nbsp; 1-800-GAMBLER</span>
      </footer>
    </main>

    <style>{`
      .hub-tile {
        text-decoration: none;
        color: inherit;
        position: relative;
        transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      }
      .hub-tile:hover {
        transform: translateY(-2px);
        border-color: rgba(184,92,56,0.5);
        box-shadow: 0 10px 24px rgba(0,0,0,0.07);
      }
    `}</style>
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#1d1b18',
    background: `
      radial-gradient(900px 360px at 0% 0%, rgba(184,92,56,0.06), transparent 55%),
      radial-gradient(900px 360px at 100% 0%, rgba(87,132,170,0.06), transparent 55%),
      #f8f7f3
    `,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '28px 16px',
  },
  hub: {
    width: '100%',
    maxWidth: '720px',
  },
  kicker: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1d1b18',
    marginBottom: '24px',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    background: '#e8e3d8',
    borderTop: '1px solid #e8e3d8',
    borderBottom: '1px solid #e8e3d8',
  },
  tile: {
    display: 'block',
    background: '#ffffff',
    padding: '20px 20px 20px 20px',
    position: 'relative',
  },
  tileLabel: {
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    fontWeight: 700,
    color: '#9f9a90',
    marginBottom: '6px',
  },
  tileTitle: {
    fontSize: '18px',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    marginBottom: '6px',
  },
  tileCopy: {
    fontSize: '14px',
    lineHeight: '1.45',
    color: '#5f5a51',
    margin: 0,
    paddingRight: '32px',
  },
  arrow: {
    position: 'absolute' as const,
    top: '20px',
    right: '20px',
    fontSize: '16px',
    color: '#b85c38',
  },
  footer: {
    marginTop: '40px',
    textAlign: 'center' as const,
    fontSize: '12px',
    color: '#9f9a90',
    lineHeight: 1.6,
  },
  footerLegal: {
    fontSize: '11px',
    letterSpacing: '0.05em',
  },
};

export default HubPage;
