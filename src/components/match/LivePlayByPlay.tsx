/**
 * LivePlayByPlay — Unified PBP Component
 * 
 * Renders the play-by-play feed using data from useLiveGameIntel.
 * The SAME data that Gemini reads via urlContext.
 * 
 * Features:
 * - Full PBP timeline with team logos, clocks, and scoring plays
 * - Player box score per team with headshots
 * - Advanced metrics panel (pace, efficiency, AST/TO ratio)
 * - Auto-scrolls to latest play on updates
 * 
 * UI: Obsidian Weissach v7 — dark ground, monospace accents, minimal chrome.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { useLiveGameIntel, type GameIntel, type PlayEvent, type PlayerStat } from '@/hooks/useLiveGameIntel';

interface LivePlayByPlayProps {
  gameId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeLogo?: string;
  awayLogo?: string;
  homeColor?: string;
  awayColor?: string;
}

// ── Play type → icon mapping ────────────────────────────────────────────
const playTypeIcon = (type: string | undefined): string => {
  if (!type) return '⏱';
  const t = type.toLowerCase();
  if (t.includes('three') || t.includes('3pt')) return '🏀';
  if (t.includes('dunk') || t.includes('slam')) return '💥';
  if (t.includes('block')) return '🛡️';
  if (t.includes('steal')) return '🔥';
  if (t.includes('turnover')) return '❌';
  if (t.includes('foul')) return '⚠️';
  if (t.includes('rebound')) return '📋';
  if (t.includes('free throw') || t.includes('ft')) return '🎯';
  if (t.includes('timeout')) return '⏸';
  if (t.includes('made') || t.includes('goal') || t.includes('score')) return '✅';
  if (t.includes('miss')) return '⭕';
  return '▸';
};

// ── Play scoring detection ──────────────────────────────────────────────
const isScoringPlay = (play: PlayEvent): boolean => {
  if (!play.type) return false;
  const t = play.type.toLowerCase();
  return t.includes('made') || t.includes('goal') || t.includes('touchdown') || t.includes('three') || t.includes('dunk');
};

const LivePlayByPlay: React.FC<LivePlayByPlayProps> = ({
  gameId,
  homeTeamName,
  awayTeamName,
  homeLogo,
  awayLogo,
  homeColor = '#006BB6',
  awayColor = '#CE1141',
}) => {
  const { data: intel, isLoading, error } = useLiveGameIntel(gameId);
  const latestPlayRef = useRef<HTMLDivElement>(null);
  const prevPlayCountRef = useRef(0);

  // Auto-scroll to latest play when new ones arrive
  useEffect(() => {
    const count = intel?.recent_plays?.length ?? 0;
    if (count > prevPlayCountRef.current && latestPlayRef.current) {
      latestPlayRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    prevPlayCountRef.current = count;
  }, [intel?.recent_plays?.length]);

  const plays = useMemo(() => {
    if (!intel?.recent_plays) return [];
    return [...intel.recent_plays].reverse(); // Most recent first
  }, [intel?.recent_plays]);

  const advancedMetrics = useMemo(() => {
    const m = intel?.advanced_metrics;
    if (!m || typeof m !== 'object') return null;
    const entries: Array<{ label: string; value: string }> = [];
    
    const pairs: Array<[string, string]> = [
      ['pace', 'PACE'],
      ['pointsPerPoss', 'PPeP'],
      ['offensiveReboundPct', 'OREB%'],
      ['assistToTurnoverRatio', 'AST/TO'],
      ['shootingEfficiency', 'eFG%'],
      ['turnoversPerPoss', 'TOPG'],
    ];
    
    for (const [key, label] of pairs) {
      const val = (m as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) {
        entries.push({ label, value: typeof val === 'number' ? val.toFixed(2) : String(val) });
      }
    }
    return entries.length > 0 ? entries : null;
  }, [intel?.advanced_metrics]);

  const isLive = intel?.status === 'STATUS_IN_PROGRESS' || intel?.status === 'STATUS_HALFTIME';

  if (isLoading) {
    return (
      <div className="pbp-container pbp-loading">
        <style>{componentStyles}</style>
        <div className="pbp-skeleton-pulse" />
        <div className="pbp-skeleton-pulse short" />
        <div className="pbp-skeleton-pulse" />
      </div>
    );
  }

  if (error || !intel) {
    return (
      <div className="pbp-container pbp-empty">
        <style>{componentStyles}</style>
        <div className="pbp-empty-label">Play-by-play data unavailable</div>
      </div>
    );
  }

  return (
    <div className="pbp-container">
      <style>{componentStyles}</style>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="pbp-header">
        <div className="pbp-header-left">
          <span className="pbp-header-title">Play-by-Play</span>
          {isLive && <span className="pbp-live-dot" />}
        </div>
        <div className="pbp-header-right">
          <span className="pbp-period-label">
            {intel.clock && `${intel.clock} · `}
            {intel.period ? `Q${intel.period}` : intel.status}
          </span>
        </div>
      </div>

      {/* ── Last Play Highlight ───────────────────────────── */}
      {intel.last_play && (
        <div className="pbp-last-play">
          <span className="pbp-last-play-badge">LATEST</span>
          <span className="pbp-last-play-text">{intel.last_play.text}</span>
          <span className="pbp-last-play-clock">{intel.last_play.clock}</span>
        </div>
      )}

      {/* ── Advanced Metrics Strip ────────────────────────── */}
      {advancedMetrics && (
        <div className="pbp-metrics-strip">
          {advancedMetrics.map(m => (
            <div key={m.label} className="pbp-metric-item">
              <span className="pbp-metric-label">{m.label}</span>
              <span className="pbp-metric-value">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Play Timeline ─────────────────────────────────── */}
      <div className="pbp-timeline">
        {plays.length === 0 ? (
          <div className="pbp-empty-state">
            <div className="pbp-empty-icon">⏱</div>
            <div className="pbp-empty-label">Timeline appears after tip-off</div>
          </div>
        ) : (
          plays.map((play, idx) => {
            const isHome = play.teamId && homeTeamName;
            const logo = play.teamId ? (play.teamId === intel.score.home.team ? homeLogo : awayLogo) : undefined;
            const scoring = isScoringPlay(play);

            return (
              <div
                key={play.id || idx}
                ref={idx === 0 ? latestPlayRef : undefined}
                className={`pbp-play-row ${scoring ? 'pbp-scoring' : ''} ${idx === 0 ? 'pbp-latest' : ''}`}
              >
                <div className="pbp-play-indicator">
                  {logo ? (
                    <img src={logo} alt="" className="pbp-play-team-logo" />
                  ) : (
                    <span className="pbp-play-icon">{playTypeIcon(play.type)}</span>
                  )}
                  {idx < plays.length - 1 && <div className="pbp-play-line" />}
                </div>
                <div className="pbp-play-content">
                  <div className="pbp-play-text">{play.text}</div>
                  <div className="pbp-play-meta">
                    <span className="pbp-play-clock">{play.clock || '—'}</span>
                    {play.period && <span className="pbp-play-period">Q{play.period}</span>}
                    {play.type && <span className="pbp-play-type">{play.type.replace(/_/g, ' ')}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Box Score Preview ─────────────────────────────── */}
      {intel.player_stats && (
        <div className="pbp-boxscore">
          <div className="pbp-boxscore-header">Box Score</div>
          {(['home', 'away'] as const).map(side => {
            const players = intel.player_stats?.[side];
            if (!players || players.length === 0) return null;
            const teamName = side === 'home' ? (homeTeamName || intel.score.home.team) : (awayTeamName || intel.score.away.team);
            const logo = side === 'home' ? homeLogo : awayLogo;

            return (
              <div key={side} className="pbp-team-stats">
                <div className="pbp-team-stats-header">
                  {logo && <img src={logo} alt="" className="pbp-team-logo-sm" />}
                  <span className="pbp-team-name">{teamName}</span>
                </div>
                <div className="pbp-stats-table-wrap">
                  <table className="pbp-stats-table">
                    <thead>
                      <tr>
                        <th className="pbp-th-player">Player</th>
                        <th>MIN</th>
                        <th>PTS</th>
                        <th>REB</th>
                        <th>AST</th>
                        <th>FG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.slice(0, 8).map((p, pIdx) => (
                        <tr key={p.id || pIdx}>
                          <td className="pbp-td-player">
                            {p.headshot && <img src={p.headshot} alt="" className="pbp-player-headshot" />}
                            <span className="pbp-player-name">{p.short_name || p.name}</span>
                            {p.position && <span className="pbp-player-pos">{p.position}</span>}
                          </td>
                          <td>{p.stats?.MIN ?? '—'}</td>
                          <td className="pbp-stat-pts">{p.stats?.PTS ?? '—'}</td>
                          <td>{p.stats?.REB ?? '—'}</td>
                          <td>{p.stats?.AST ?? '—'}</td>
                          <td>{p.stats?.FG ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Machine Contract Footer ───────────────────────── */}
      <div className="pbp-machine-tag">
        <span>Same data &rarr; AI &amp; UI</span>
        <span className="pbp-endpoint-tag">/api/live/game/{gameId}</span>
      </div>
    </div>
  );
};

// ── Component Styles (Obsidian Weissach v7) ──────────────────────────────────
const componentStyles = `
  .pbp-container {
    font-family: 'DM Sans', -apple-system, system-ui, sans-serif;
    color: #1A1A18;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Header ────────── */
  .pbp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid #E8E7E3;
  }
  .pbp-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pbp-header-title {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 18px;
    font-weight: 600;
    color: #1A1A18;
  }
  .pbp-live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #C85A3A;
    animation: pbp-pulse 2s ease-in-out infinite;
  }
  @keyframes pbp-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }
  .pbp-period-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9B9B91;
    padding: 4px 10px;
    background: #F5F4F0;
    border-radius: 6px;
    border: 1px solid #E8E7E3;
  }

  /* ── Last Play Highlight ── */
  .pbp-last-play {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    margin: 12px 0;
    background: linear-gradient(135deg, rgba(200, 90, 58, 0.06) 0%, rgba(200, 90, 58, 0.02) 100%);
    border: 1px solid rgba(200, 90, 58, 0.15);
    border-radius: 10px;
  }
  .pbp-last-play-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #C85A3A;
    background: rgba(200, 90, 58, 0.12);
    padding: 3px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .pbp-last-play-text {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: #1A1A18;
    line-height: 1.4;
  }
  .pbp-last-play-clock {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    color: #9B9B91;
    flex-shrink: 0;
  }

  /* ── Metrics Strip ── */
  .pbp-metrics-strip {
    display: flex;
    gap: 1px;
    background: #E8E7E3;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .pbp-metric-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 6px;
    background: #FFFFFF;
  }
  .pbp-metric-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9B9B91;
  }
  .pbp-metric-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 700;
    color: #1A1A18;
  }

  /* ── Timeline ── */
  .pbp-timeline {
    padding: 8px 0;
  }
  .pbp-play-row {
    display: flex;
    gap: 14px;
    padding: 0;
    position: relative;
    transition: background 0.15s ease;
  }
  .pbp-play-row:hover {
    background: rgba(245, 244, 240, 0.5);
    border-radius: 8px;
  }
  .pbp-scoring {
    background: rgba(45, 143, 92, 0.04);
    border-radius: 8px;
  }
  .pbp-latest {
    border-left: 3px solid #C85A3A;
    padding-left: 4px;
    border-radius: 0 8px 8px 0;
  }

  .pbp-play-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 28px;
    flex-shrink: 0;
    padding-top: 12px;
  }
  .pbp-play-team-logo {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: contain;
  }
  .pbp-play-icon {
    font-size: 14px;
    line-height: 20px;
  }
  .pbp-play-line {
    width: 1px;
    flex: 1;
    min-height: 12px;
    background: #E8E7E3;
    margin-top: 4px;
  }

  .pbp-play-content {
    flex: 1;
    padding: 10px 0;
    border-bottom: 1px solid rgba(232, 231, 227, 0.4);
    min-width: 0;
  }
  .pbp-play-row:last-child .pbp-play-content {
    border-bottom: none;
  }
  .pbp-play-text {
    font-size: 14px;
    font-weight: 500;
    color: #1A1A18;
    line-height: 1.4;
    margin-bottom: 4px;
  }
  .pbp-play-meta {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .pbp-play-clock {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    color: #9B9B91;
  }
  .pbp-play-period {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #9B9B91;
  }
  .pbp-play-type {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    color: #B5B5AA;
    text-transform: capitalize;
  }

  /* ── Empty State ── */
  .pbp-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 20px;
  }
  .pbp-empty-icon {
    font-size: 28px;
    opacity: 0.4;
  }
  .pbp-empty-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    color: #9B9B91;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pbp-loading {
    padding: 20px 0;
  }
  .pbp-skeleton-pulse {
    height: 14px;
    background: linear-gradient(90deg, #F5F4F0 25%, #E8E7E3 50%, #F5F4F0 75%);
    background-size: 200% 100%;
    animation: pbp-shimmer 1.5s ease infinite;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .pbp-skeleton-pulse.short {
    width: 60%;
  }
  @keyframes pbp-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Box Score ── */
  .pbp-boxscore {
    margin-top: 20px;
    border-top: 1px solid #E8E7E3;
    padding-top: 16px;
  }
  .pbp-boxscore-header {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 17px;
    font-weight: 600;
    color: #1A1A18;
    margin-bottom: 16px;
  }
  .pbp-team-stats {
    margin-bottom: 16px;
  }
  .pbp-team-stats-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid #E8E7E3;
    margin-bottom: 0;
  }
  .pbp-team-logo-sm {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .pbp-team-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6B6B63;
  }
  .pbp-stats-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .pbp-stats-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .pbp-stats-table th {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9B9B91;
    padding: 8px 8px;
    text-align: center;
    border-bottom: 1px solid #E8E7E3;
    background: #FAFAF8;
    white-space: nowrap;
  }
  .pbp-th-player {
    text-align: left !important;
    min-width: 120px;
  }
  .pbp-stats-table td {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    color: #6B6B63;
    padding: 8px 8px;
    text-align: center;
    border-bottom: 1px solid rgba(232, 231, 227, 0.4);
    white-space: nowrap;
  }
  .pbp-stats-table tr:last-child td {
    border-bottom: none;
  }
  .pbp-td-player {
    text-align: left !important;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pbp-player-headshot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    background: #F5F4F0;
    flex-shrink: 0;
  }
  .pbp-player-name {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #1A1A18;
  }
  .pbp-player-pos {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    color: #B5B5AA;
    text-transform: uppercase;
  }
  .pbp-stat-pts {
    font-weight: 700 !important;
    color: #1A1A18 !important;
  }

  /* ── Machine Tag ── */
  .pbp-machine-tag {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    margin-top: 16px;
    border-top: 1px solid #E8E7E3;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    color: #B5B5AA;
    letter-spacing: 0.04em;
  }
  .pbp-endpoint-tag {
    padding: 2px 8px;
    background: #F5F4F0;
    border: 1px solid #E8E7E3;
    border-radius: 4px;
    font-size: 9px;
    letter-spacing: 0.02em;
  }

  @media (max-width: 640px) {
    .pbp-metrics-strip {
      flex-wrap: wrap;
    }
    .pbp-metric-item {
      min-width: calc(33% - 1px);
    }
    .pbp-stats-table th,
    .pbp-stats-table td {
      padding: 6px 4px;
      font-size: 10px;
    }
    .pbp-player-headshot {
      width: 20px;
      height: 20px;
    }
    .pbp-td-player {
      gap: 4px;
    }
    .pbp-player-name {
      font-size: 11px;
    }
  }
`;

export default LivePlayByPlay;
