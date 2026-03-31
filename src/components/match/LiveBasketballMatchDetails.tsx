import React, { FC, useMemo, useState } from 'react';
import type { Match, MatchEvent, MatchOdds, PlayerPropBet, MatchLeader } from '@/types';
import { getPeriodDisplay, isGameFinished } from '@/utils/matchUtils';

interface LiveBasketballMatchDetailsProps {
  match: Match;
  liveState?: {
    home_score?: number;
    away_score?: number;
    clock?: string;
    period?: number | string;
  } | null;
  onBack: () => void;
}

const clampNumber = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const normalizeColor = (value: string | undefined | null, fallback: string) => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('#')) return trimmed;
  if (/^[0-9a-fA-F]{3,6}$/.test(trimmed)) return `#${trimmed}`;
  return fallback;
};

const toNumber = (value: string | number | undefined | null) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatSigned = (value: number | null) => {
  if (value === null) return '—';
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${value}`;
};

const formatMoneyline = (value: number | null) => {
  if (value === null) return '—';
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
};

const getSpreadValue = (odds?: MatchOdds) =>
  toNumber(odds?.homeSpread ?? odds?.spread ?? odds?.home_spread ?? odds?.spread_home ?? odds?.spread_home_value ?? odds?.spread_best);

const getTotalValue = (odds?: MatchOdds) =>
  toNumber(odds?.total ?? odds?.overUnder ?? odds?.total_line ?? odds?.total_value ?? odds?.total_best);

const getHomeMoneyline = (odds?: MatchOdds) =>
  toNumber(odds?.moneylineHome ?? odds?.home_ml ?? odds?.homeML ?? odds?.homeMoneyline);

const getAwayMoneyline = (odds?: MatchOdds) =>
  toNumber(odds?.moneylineAway ?? odds?.away_ml ?? odds?.awayML ?? odds?.awayMoneyline);

const marketLabel = (odds?: MatchOdds, homeShort?: string, awayShort?: string) => {
  const spread = getSpreadValue(odds);
  if (spread === null) return '—';
  const team = spread <= 0 ? homeShort : awayShort;
  return `${team ?? 'Line'} ${formatSigned(spread)}`;
};

const leaderRowsForTeam = (leaders: MatchLeader[] | undefined, teamId?: string) => {
  if (!leaders || leaders.length === 0 || !teamId) return [] as Array<{ name: string; detail: string; value: string }>;

  const rows: Array<{ name: string; detail: string; value: string }> = [];
  leaders.forEach((group) => {
    const leader = group.leaders?.find((entry) => entry.team?.id === teamId) ?? group.leaders?.[0];
    if (!leader?.athlete?.displayName) return;
    const detail = leader.displayValue || leader.athlete.position?.abbreviation || '';
    rows.push({
      name: leader.athlete.displayName,
      detail: detail ? `${detail}` : '',
      value: String(leader.value ?? leader.displayValue ?? ''),
    });
  });
  return rows.slice(0, 3);
};

const labelForBetType = (value: string) => {
  const key = value.toLowerCase();
  if (key.includes('points') || key === 'points') return 'Pts';
  if (key.includes('reb')) return 'Reb';
  if (key.includes('ast')) return 'Ast';
  if (key.includes('pra')) return 'PRA';
  if (key.includes('threes')) return '3PT';
  return key.slice(0, 3).toUpperCase();
};

const pickTeamProps = (props: PlayerPropBet[] | undefined, teamName?: string) => {
  if (!props || props.length === 0 || !teamName) return [] as PlayerPropBet[];
  return props
    .filter((row) => String(row.team || '').toLowerCase() === teamName.toLowerCase())
    .sort((a, b) => (b.impliedProbPct ?? 0) - (a.impliedProbPct ?? 0))
    .slice(0, 3);
};

const pickPlays = (events: MatchEvent[] | undefined) => {
  if (!events || events.length === 0) return [] as MatchEvent[];
  return events.slice(-12).reverse();
};

const computeLineMove = (openValue: number | null, currentValue: number | null) => {
  if (openValue === null || currentValue === null) return '—';
  const delta = currentValue - openValue;
  if (delta === 0) return '→';
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(delta).toFixed(1)} pts`;
};

const LiveBasketballMatchDetails: FC<LiveBasketballMatchDetailsProps> = ({ match, liveState, onBack }) => {
  const [activeTab, setActiveTab] = useState<'game' | 'props' | 'plays' | 'odds'>('game');

  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;
  const homeRecord = match.homeTeam.record || '—';
  const awayRecord = match.awayTeam.record || '—';
  const homeLogo = match.homeTeam.logo;
  const awayLogo = match.awayTeam.logo;

  const homeScore = liveState?.home_score ?? match.homeScore ?? match.homeTeam.score ?? 0;
  const awayScore = liveState?.away_score ?? match.awayScore ?? match.awayTeam.score ?? 0;

  const periodDisplay = getPeriodDisplay(match);
  const clock = liveState?.clock ?? match.displayClock ?? '';
  const periodLabel = [clock, periodDisplay].filter(Boolean).join(' • ') || (isGameFinished(match.status) ? 'Final' : match.status);

  const currentOdds = match.current_odds || match.odds;
  const openingOdds = match.opening_odds;

  const spreadLabel = marketLabel(currentOdds, match.homeTeam.abbreviation, match.awayTeam.abbreviation);
  const totalLabel = getTotalValue(currentOdds);
  const mlAway = getAwayMoneyline(currentOdds);

  const homeProb = toNumber(match.win_probability?.home ?? (currentOdds?.winProbability as number | undefined)) ?? 50;
  const awayProb = toNumber(match.win_probability?.away) ?? 100 - homeProb;
  const homeProbPct = clampNumber(homeProb);
  const awayProbPct = clampNumber(awayProb);

  const homeColor = normalizeColor(match.homeTeam.color, '#006BB6');
  const awayColor = normalizeColor(match.awayTeam.color, '#98002E');

  const quarterScores = useMemo(() => {
    const homeLines = match.homeTeam.linescores ?? [];
    const awayLines = match.awayTeam.linescores ?? [];
    return Array.from({ length: 4 }).map((_, idx) => ({
      home: homeLines[idx]?.value ?? '–',
      away: awayLines[idx]?.value ?? '–',
    }));
  }, [match.homeTeam.linescores, match.awayTeam.linescores]);

  const homeLeaders = leaderRowsForTeam(match.leaders, match.homeTeam.id);
  const awayLeaders = leaderRowsForTeam(match.leaders, match.awayTeam.id);

  const homeProps = pickTeamProps(match.dbProps, match.homeTeam.name);
  const awayProps = pickTeamProps(match.dbProps, match.awayTeam.name);

  const plays = pickPlays(match.events);

  const lineMovement = useMemo(() => {
    const openSpread = getSpreadValue(openingOdds);
    const curSpread = getSpreadValue(currentOdds);
    const openTotal = getTotalValue(openingOdds);
    const curTotal = getTotalValue(currentOdds);
    const openHomeMl = getHomeMoneyline(openingOdds);
    const curHomeMl = getHomeMoneyline(currentOdds);
    const openAwayMl = getAwayMoneyline(openingOdds);
    const curAwayMl = getAwayMoneyline(currentOdds);

    return {
      spread: { open: openSpread, current: curSpread, move: computeLineMove(openSpread, curSpread) },
      total: { open: openTotal, current: curTotal, move: computeLineMove(openTotal, curTotal) },
      homeMl: { open: openHomeMl, current: curHomeMl, move: computeLineMove(openHomeMl, curHomeMl) },
      awayMl: { open: openAwayMl, current: curAwayMl, move: computeLineMove(openAwayMl, curAwayMl) },
    };
  }, [openingOdds, currentOdds]);

  const styles = `
  .drip-live, .drip-live * { margin: 0; padding: 0; box-sizing: border-box; }
  .drip-live { font-family: var(--sans); background: var(--bg); color: var(--text-primary); -webkit-font-smoothing: antialiased; line-height: 1.6; height: 100dvh; max-height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .drip-live .top-bar { max-width: 900px; margin: 0 auto; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 30; background: var(--bg); border-bottom: 1px solid var(--border); }
  .drip-live .body-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .drip-live .layout-stamp { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
  .drip-live .back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--text-secondary); text-decoration: none; }
  .drip-live .back-link:hover { color: var(--text-primary); }
  .drip-live .scoreboard { max-width: 900px; margin: 0 auto; padding: 0 20px; }
  .drip-live .scoreboard-card { background: var(--scoreboard-bg); border-radius: 12px 12px 0 0; overflow: hidden; }
  .drip-live .scoreboard-main { padding: 28px 32px 16px; display: flex; align-items: center; justify-content: center; gap: 40px; }
  .drip-live .sb-team { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 120px; }
  .drip-live .sb-logo { width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; font-family: var(--mono); font-size: 14px; font-weight: 700; color: var(--scoreboard-text); overflow: hidden; }
  .drip-live .sb-name { font-size: 14px; font-weight: 600; color: var(--scoreboard-text); text-align: center; }
  .drip-live .sb-record { font-family: var(--mono); font-size: 11px; color: var(--scoreboard-dim); }
  .drip-live .sb-center { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .drip-live .sb-score { font-family: var(--mono); font-size: 44px; font-weight: 700; color: var(--scoreboard-text); letter-spacing: -0.02em; display: flex; align-items: baseline; gap: 12px; }
  .drip-live .sb-dash { font-size: 28px; color: var(--scoreboard-dim); font-weight: 400; }
  .drip-live .sb-period { font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--scoreboard-dim); letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 10px; background: rgba(255,255,255,0.06); border-radius: 4px; }
  .drip-live .line-strip { padding: 0 32px 12px; display: flex; justify-content: center; gap: 24px; }
  .drip-live .line-item { font-family: var(--mono); font-size: 12px; color: var(--scoreboard-dim); display: flex; align-items: center; gap: 6px; }
  .drip-live .line-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.3); }
  .drip-live .line-value { font-weight: 600; color: var(--scoreboard-text); }
  .drip-live .prob-strip { padding: 0 32px 20px; display: flex; align-items: center; gap: 12px; }
  .drip-live .prob-label { font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--scoreboard-dim); white-space: nowrap; min-width: 60px; }
  .drip-live .prob-label.right { text-align: right; }
  .drip-live .prob-track { flex: 1; height: 4px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; display: flex; }
  .drip-live .prob-fill-home { height: 100%; background: var(--home-color); border-radius: 3px 0 0 3px; }
  .drip-live .prob-fill-away { height: 100%; background: var(--away-color); border-radius: 0 3px 3px 0; }
  .drip-live .court-section { max-width: 900px; margin: 0 auto; padding: 0 20px; }
  .drip-live .court-wrap { background: #2A2926; border-radius: 0 0 12px 12px; position: relative; overflow: hidden; }
  .drip-live .court-svg { width: 100%; height: auto; display: block; }
  .drip-live .last-play { display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: rgba(0,0,0,0.3); }
  .drip-live .last-play-icon { width: 20px; height: 20px; border-radius: 50%; object-fit: contain; flex-shrink: 0; }
  .drip-live .last-play-text { display: flex; flex-direction: column; gap: 1px; }
  .drip-live .last-play-action { font-size: 13px; font-weight: 500; color: var(--scoreboard-text); }
  .drip-live .last-play-meta { font-family: var(--mono); font-size: 11px; color: var(--scoreboard-dim); }
  .drip-live .tabs { max-width: 900px; margin: 0 auto; padding: 16px 20px 0; }
  .drip-live .tab-row { display: flex; border-bottom: 1px solid var(--border); }
  .drip-live .tab-btn { font-family: var(--mono); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 12px 24px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s; }
  .drip-live .tab-btn.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
  .drip-live .tab-btn:hover:not(.active) { color: var(--text-secondary); }
  .drip-live .content { max-width: 900px; margin: 0 auto; padding: 20px 20px 80px; }
  .drip-live .quarter-table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
  .drip-live .quarter-table { width: 100%; border-collapse: collapse; }
  .drip-live .quarter-table th { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--border); background: var(--bg); }
  .drip-live .quarter-table th:first-child { text-align: left; }
  .drip-live .quarter-table td { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--text-secondary); padding: 10px 14px; text-align: center; border-bottom: 1px solid rgba(232,231,227,0.4); }
  .drip-live .quarter-table td:first-child { text-align: left; font-family: var(--sans); font-weight: 600; color: var(--text-primary); }
  .drip-live .quarter-table td:last-child { font-weight: 700; color: var(--text-primary); }
  .drip-live .quarter-table tr:last-child td { border-bottom: none; }
  .drip-live .leaders-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
  .drip-live .leader-card { background: var(--surface); padding: 16px 18px; }
  .drip-live .leader-team { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 12px; }
  .drip-live .leader-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
  .drip-live .leader-row + .leader-row { border-top: 1px solid rgba(232,231,227,0.4); }
  .drip-live .leader-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .drip-live .leader-stat { font-family: var(--mono); font-size: 14px; font-weight: 700; color: var(--text-primary); }
  .drip-live .leader-detail { font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); }
  .drip-live .plays-section { margin-top: 4px; }
  .drip-live .plays-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 12px; border-bottom: 1px solid var(--border); }
  .drip-live .plays-title { font-family: var(--serif); font-size: 17px; font-weight: 600; }
  .drip-live .plays-period { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
  .drip-live .period-break { background: var(--surface-warm); border: 1px solid var(--border); border-radius: 8px; padding: 12px 20px; text-align: center; margin: 16px 0; }
  .drip-live .period-break-text { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.04em; text-transform: uppercase; }
  .drip-live .play-row { display: flex; align-items: flex-start; gap: 12px; padding: 11px 0; border-bottom: 1px solid rgba(232,231,227,0.35); }
  .drip-live .play-row:last-child { border-bottom: none; }
  .drip-live .play-icon { width: 18px; height: 18px; border-radius: 50%; margin-top: 2px; flex-shrink: 0; object-fit: contain; }
  .drip-live .play-clock { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--text-tertiary); min-width: 38px; margin-top: 1px; }
  .drip-live .play-text { flex: 1; font-size: 14px; color: var(--text-secondary); line-height: 1.4; }
  .drip-live .play-text strong { color: var(--text-primary); font-weight: 600; }
  .drip-live .play-score { font-family: var(--mono); font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap; margin-top: 1px; }
  .drip-live .props-pane { display: none; }
  .drip-live .props-pane.active { display: block; }
  .drip-live .game-pane { display: block; }
  .drip-live .game-pane.hidden { display: none; }
  .drip-live .plays-pane { display: none; }
  .drip-live .plays-pane.active { display: block; }
  .drip-live .odds-pane { display: none; }
  .drip-live .odds-pane.active { display: block; }
  .drip-live .props-team-header { display: flex; align-items: center; gap: 10px; padding: 16px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 0; }
  .drip-live .props-team-header img { width: 24px; height: 24px; object-fit: contain; }
  .drip-live .props-team-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .drip-live .prop-card { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid rgba(232,231,227,0.35); }
  .drip-live .prop-card:last-child { border-bottom: none; }
  .drip-live .prop-headshot { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: var(--surface-warm); flex-shrink: 0; }
  .drip-live .prop-info { flex: 1; min-width: 0; }
  .drip-live .prop-name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
  .drip-live .prop-markets { display: flex; gap: 6px; flex-wrap: wrap; }
  .drip-live .prop-chip { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; background: var(--surface-warm); border: 1px solid var(--border); }
  .drip-live .prop-market-name { font-family: var(--mono); font-size: 9px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
  .drip-live .prop-line { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .drip-live .prop-live-stats { display: flex; gap: 10px; flex-shrink: 0; }
  .drip-live .prop-live-stat { display: flex; flex-direction: column; align-items: center; min-width: 40px; }
  .drip-live .prop-stat-label { font-family: var(--mono); font-size: 8px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 2px; }
  .drip-live .prop-stat-value { font-family: var(--mono); font-size: 16px; font-weight: 700; color: var(--text-primary); }
  .drip-live .prop-stat-value.over-line { color: var(--text-primary); font-weight: 700; }
  .drip-live .prop-stat-value.under-line { color: var(--text-tertiary); font-weight: 500; }
  .drip-live .odds-section-title { font-family: var(--serif); font-size: 17px; font-weight: 600; padding: 16px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 0; }
  .drip-live .odds-table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
  .drip-live .odds-table { width: 100%; border-collapse: collapse; }
  .drip-live .odds-table th { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); padding: 11px 14px; text-align: center; border-bottom: 1px solid var(--border); background: var(--bg); }
  .drip-live .odds-table th:first-child { text-align: left; }
  .drip-live .odds-table td { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--text-secondary); padding: 11px 14px; text-align: center; border-bottom: 1px solid rgba(232,231,227,0.35); }
  .drip-live .odds-table td:first-child { font-family: var(--sans); font-weight: 600; color: var(--text-primary); text-align: left; font-size: 13px; }
  .drip-live .odds-table tr:last-child td { border-bottom: none; }
  .drip-live .odds-table tr:hover { background: #FDFCFA; }
  .drip-live .odds-best { font-weight: 700; color: var(--text-primary); }
  .drip-live .odds-book-logo { font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--text-tertiary); letter-spacing: 0.02em; }
  .drip-live .quarter-header { background: var(--surface-warm); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; margin: 16px 0 8px; display: flex; justify-content: space-between; align-items: center; }
  .drip-live .quarter-header-label { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.04em; text-transform: uppercase; }
  .drip-live .quarter-header-score { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
  .drip-live footer { max-width: 900px; margin: 0 auto; padding: 24px 20px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .drip-live footer span { font-size: 13px; color: var(--text-tertiary); }
  .drip-live footer a { font-size: 13px; color: var(--text-secondary); text-decoration: none; }
  @media (max-width: 640px) {
    .drip-live .scoreboard-main { gap: 20px; padding: 20px 16px 14px; }
    .drip-live .sb-logo { width: 44px; height: 44px; font-size: 12px; }
    .drip-live .sb-score { font-size: 32px; }
    .drip-live .sb-name { font-size: 12px; }
    .drip-live .line-strip { gap: 12px; padding: 0 16px 10px; flex-wrap: wrap; justify-content: center; }
    .drip-live .prob-strip { padding: 0 16px 16px; }
    .drip-live .content { padding: 16px 16px 48px; }
    .drip-live .leaders-grid { grid-template-columns: 1fr; }
    .drip-live .tab-btn { padding: 10px 16px; font-size: 11px; }
  }
  `;

  return (
    <div
      className="drip-live"
      style={{
        ['--bg' as string]: '#FAFAF8',
        ['--surface' as string]: '#FFFFFF',
        ['--surface-warm' as string]: '#F5F4F0',
        ['--text-primary' as string]: '#1A1A18',
        ['--text-secondary' as string]: '#6B6B63',
        ['--text-tertiary' as string]: '#9B9B91',
        ['--accent' as string]: '#C85A3A',
        ['--border' as string]: '#E8E7E3',
        ['--green' as string]: '#2D8F5C',
        ['--scoreboard-bg' as string]: '#1A1A18',
        ['--scoreboard-text' as string]: '#F5F4F0',
        ['--scoreboard-dim' as string]: '#9B9B91',
        ['--live-pulse' as string]: '#C85A3A',
        ['--home-color' as string]: homeColor,
        ['--away-color' as string]: awayColor,
        ['--mono' as string]: "'JetBrains Mono', monospace",
        ['--serif' as string]: "'Source Serif 4', serif",
        ['--sans' as string]: "'DM Sans', sans-serif",
      } as React.CSSProperties}
    >
      <style>{styles}</style>

      <div className="top-bar">
        <button className="back-link" type="button" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4l-6 6 6 6" />
          </svg>
          Scores
        </button>
        <span className="layout-stamp">Layout_V2</span>
      </div>

      <div className="body-scroll">
      <div className="scoreboard">
        <div className="scoreboard-card">
          <div className="scoreboard-main">
            <div className="sb-team">
              <div className="sb-logo">
                {homeLogo ? <img src={homeLogo} alt={homeName} style={{ width: 40, height: 40, objectFit: 'contain' }} /> : homeName.slice(0, 3)}
              </div>
              <div className="sb-name">{homeName}</div>
              <div className="sb-record">{homeRecord}</div>
            </div>
            <div className="sb-center">
              <div className="sb-score">
                <span>{homeScore}</span>
                <span className="sb-dash">–</span>
                <span>{awayScore}</span>
              </div>
              <div className="sb-period">{periodLabel}</div>
            </div>
            <div className="sb-team">
              <div className="sb-logo">
                {awayLogo ? <img src={awayLogo} alt={awayName} style={{ width: 40, height: 40, objectFit: 'contain' }} /> : awayName.slice(0, 3)}
              </div>
              <div className="sb-name">{awayName}</div>
              <div className="sb-record">{awayRecord}</div>
            </div>
          </div>

          <div className="line-strip">
            <div className="line-item">
              <span className="line-label">Spread</span>
              <span className="line-value">{spreadLabel}</span>
            </div>
            <div className="line-item">
              <span className="line-label">O/U</span>
              <span className="line-value">{totalLabel ?? '—'}</span>
            </div>
            <div className="line-item">
              <span className="line-label">ML</span>
              <span className="line-value">{match.awayTeam.abbreviation ?? awayName} {formatMoneyline(mlAway)}</span>
            </div>
          </div>

          <div className="prob-strip">
            <span className="prob-label">{match.homeTeam.abbreviation ?? homeName} {homeProbPct}%</span>
            <div className="prob-track">
              <div className="prob-fill-home" style={{ width: `${homeProbPct}%` }} />
              <div className="prob-fill-away" style={{ width: `${awayProbPct}%` }} />
            </div>
            <span className="prob-label right">{awayProbPct}% {match.awayTeam.abbreviation ?? awayName}</span>
          </div>
        </div>
      </div>

      <div className="court-section">
        <div className="court-wrap">
          <svg className="court-svg" viewBox="0 0 470 280" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="470" height="280" rx="4" fill="#2A2926" />
            <rect x="15" y="15" width="440" height="250" rx="2" stroke="#4A4840" strokeWidth="1" fill="none" />
            <line x1="235" y1="15" x2="235" y2="265" stroke="#4A4840" strokeWidth="1" />
            <circle cx="235" cy="140" r="36" stroke="#4A4840" strokeWidth="1" fill="none" />
            <circle cx="235" cy="140" r="4" fill="#4A4840" />
            <path d="M 15 60 L 65 60 Q 155 60 155 140 Q 155 220 65 220 L 15 220" stroke="#4A4840" strokeWidth="1" fill="none" />
            <path d="M 455 60 L 405 60 Q 315 60 315 140 Q 315 220 405 220 L 455 220" stroke="#4A4840" strokeWidth="1" fill="none" />
            <rect x="15" y="81" width="75" height="118" stroke="#4A4840" strokeWidth="1" fill="none" />
            <rect x="380" y="81" width="75" height="118" stroke="#4A4840" strokeWidth="1" fill="none" />
            <circle cx="90" cy="140" r="36" stroke="#4A4840" strokeWidth="1" fill="none" strokeDasharray="4 4" />
            <circle cx="380" cy="140" r="36" stroke="#4A4840" strokeWidth="1" fill="none" strokeDasharray="4 4" />
            <circle cx="28" cy="140" r="6" stroke="#4A4840" strokeWidth="1" fill="none" />
            <rect x="15" y="128" width="8" height="24" stroke="#4A4840" strokeWidth="1" fill="none" />
            <circle cx="442" cy="140" r="6" stroke="#4A4840" strokeWidth="1" fill="none" />
            <rect x="447" y="128" width="8" height="24" stroke="#4A4840" strokeWidth="1" fill="none" />
            <circle cx="370" cy="150" r="8" fill="#C85A3A" opacity="0.9" />
            <circle cx="370" cy="150" r="14" fill="#C85A3A" opacity="0.15" />
          </svg>

          <div className="last-play">
            <img className="last-play-icon" src={awayLogo || homeLogo} alt="last" />
            <div className="last-play-text">
              <span className="last-play-action">{match.lastPlay?.text || 'Live play-by-play updating'}</span>
              <span className="last-play-meta">{periodLabel} · {homeScore} – {awayScore}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tabs">
        <div className="tab-row">
          {(['game', 'props', 'plays', 'odds'] as const).map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === 'game' ? 'Game' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="content">
        <div className={`game-pane ${activeTab !== 'game' ? 'hidden' : ''}`}>
          <div className="quarter-table-wrap">
            <table className="quarter-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Q1</th>
                  <th>Q2</th>
                  <th>Q3</th>
                  <th>Q4</th>
                  <th>T</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{homeName}</td>
                  {quarterScores.map((q, idx) => (
                    <td key={`home-${idx}`}>{q.home}</td>
                  ))}
                  <td>{homeScore}</td>
                </tr>
                <tr>
                  <td>{awayName}</td>
                  {quarterScores.map((q, idx) => (
                    <td key={`away-${idx}`}>{q.away}</td>
                  ))}
                  <td>{awayScore}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="leaders-grid">
            <div className="leader-card">
              <div className="leader-team">{homeName}</div>
              {homeLeaders.length === 0 ? (
                <div className="leader-detail">Leader data pending.</div>
              ) : (
                homeLeaders.map((row) => (
                  <div key={row.name} className="leader-row">
                    <div>
                      <div className="leader-name">{row.name}</div>
                      <div className="leader-detail">{row.detail}</div>
                    </div>
                    <div className="leader-stat">{row.value}</div>
                  </div>
                ))
              )}
            </div>
            <div className="leader-card">
              <div className="leader-team">{awayName}</div>
              {awayLeaders.length === 0 ? (
                <div className="leader-detail">Leader data pending.</div>
              ) : (
                awayLeaders.map((row) => (
                  <div key={row.name} className="leader-row">
                    <div>
                      <div className="leader-name">{row.name}</div>
                      <div className="leader-detail">{row.detail}</div>
                    </div>
                    <div className="leader-stat">{row.value}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="plays-section">
            <div className="plays-header">
              <span className="plays-title">Plays</span>
              <span className="plays-period">{periodDisplay || 'Game'}</span>
            </div>

            {plays.length === 0 ? (
              <div className="period-break">
                <div className="period-break-text">Live timeline appears after tip</div>
              </div>
            ) : (
              plays.map((play) => {
                const teamLogo = play.teamId === match.homeTeam.id ? homeLogo : play.teamId === match.awayTeam.id ? awayLogo : awayLogo || homeLogo;
                return (
                  <div key={play.id} className="play-row">
                    <img className="play-icon" src={teamLogo} alt="" />
                    <div className="play-clock">{play.clock || play.time}</div>
                    <div className="play-text"><strong>{play.text || play.description || 'Play'}</strong></div>
                    <div className="play-score">{homeScore} – {awayScore}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={`props-pane ${activeTab === 'props' ? 'active' : ''}`}>
          <div className="props-team-header">
            <img src={homeLogo} alt={homeName} />
            <span className="props-team-name">{homeName}</span>
          </div>

          {homeProps.length === 0 ? (
            <div className="period-break">
              <div className="period-break-text">No props available yet</div>
            </div>
          ) : (
            homeProps.map((prop) => (
              <div key={prop.id} className="prop-card">
                <img className="prop-headshot" src={prop.headshotUrl || ''} alt={prop.playerName} />
                <div className="prop-info">
                  <div className="prop-name">{prop.playerName}</div>
                  <div className="prop-markets">
                    <div className="prop-chip">
                      <span className="prop-market-name">{labelForBetType(prop.betType)}</span>
                      <span className="prop-line">{prop.lineValue}</span>
                    </div>
                  </div>
                </div>
                <div className="prop-live-stats">
                  <div className="prop-live-stat">
                    <span className="prop-stat-label">Live</span>
                    <span className={`prop-stat-value ${prop.resultValue !== null && prop.resultValue !== undefined ? (prop.resultValue >= prop.lineValue ? 'over-line' : 'under-line') : 'under-line'}`}>
                      {prop.resultValue ?? '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}

          <div className="props-team-header" style={{ marginTop: 8 }}>
            <img src={awayLogo} alt={awayName} />
            <span className="props-team-name">{awayName}</span>
          </div>

          {awayProps.length === 0 ? (
            <div className="period-break">
              <div className="period-break-text">No props available yet</div>
            </div>
          ) : (
            awayProps.map((prop) => (
              <div key={prop.id} className="prop-card">
                <img className="prop-headshot" src={prop.headshotUrl || ''} alt={prop.playerName} />
                <div className="prop-info">
                  <div className="prop-name">{prop.playerName}</div>
                  <div className="prop-markets">
                    <div className="prop-chip">
                      <span className="prop-market-name">{labelForBetType(prop.betType)}</span>
                      <span className="prop-line">{prop.lineValue}</span>
                    </div>
                  </div>
                </div>
                <div className="prop-live-stats">
                  <div className="prop-live-stat">
                    <span className="prop-stat-label">Live</span>
                    <span className={`prop-stat-value ${prop.resultValue !== null && prop.resultValue !== undefined ? (prop.resultValue >= prop.lineValue ? 'over-line' : 'under-line') : 'under-line'}`}>
                      {prop.resultValue ?? '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={`plays-pane ${activeTab === 'plays' ? 'active' : ''}`}>
          {plays.length === 0 ? (
            <div className="period-break">
              <div className="period-break-text">Live timeline appears after tip</div>
            </div>
          ) : (
            plays.map((play) => {
              const teamLogo = play.teamId === match.homeTeam.id ? homeLogo : play.teamId === match.awayTeam.id ? awayLogo : awayLogo || homeLogo;
              return (
                <div key={play.id} className="play-row">
                  <img className="play-icon" src={teamLogo} alt="" />
                  <div className="play-clock">{play.clock || play.time}</div>
                  <div className="play-text"><strong>{play.text || play.description || 'Play'}</strong></div>
                  <div className="play-score">{homeScore} – {awayScore}</div>
                </div>
              );
            })
          )}
        </div>

        <div className={`odds-pane ${activeTab === 'odds' ? 'active' : ''}`}>
          <h3 className="odds-section-title">Game Lines</h3>
          <div className="odds-table-wrap">
            <table className="odds-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Spread</th>
                  <th>Total</th>
                  <th>{match.homeTeam.abbreviation ?? 'Home'} ML</th>
                  <th>{match.awayTeam.abbreviation ?? 'Away'} ML</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{currentOdds?.provider || 'Market'}</td>
                  <td>{spreadLabel}</td>
                  <td>{totalLabel ?? '—'}</td>
                  <td>{formatMoneyline(getHomeMoneyline(currentOdds))}</td>
                  <td>{formatMoneyline(mlAway)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="odds-section-title">Line Movement</h3>
          <div className="odds-table-wrap">
            <table className="odds-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Open</th>
                  <th>Current</th>
                  <th>Move</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Spread</td>
                  <td>{openingOdds ? marketLabel(openingOdds, match.homeTeam.abbreviation, match.awayTeam.abbreviation) : '—'}</td>
                  <td>{spreadLabel}</td>
                  <td>{lineMovement.spread.move}</td>
                </tr>
                <tr>
                  <td>Total</td>
                  <td>{openingOdds ? getTotalValue(openingOdds) ?? '—' : '—'}</td>
                  <td>{totalLabel ?? '—'}</td>
                  <td>{lineMovement.total.move}</td>
                </tr>
                <tr>
                  <td>{match.homeTeam.abbreviation ?? 'Home'} ML</td>
                  <td>{formatMoneyline(lineMovement.homeMl.open)}</td>
                  <td>{formatMoneyline(lineMovement.homeMl.current)}</td>
                  <td>{lineMovement.homeMl.move}</td>
                </tr>
                <tr>
                  <td>{match.awayTeam.abbreviation ?? 'Away'} ML</td>
                  <td>{formatMoneyline(lineMovement.awayMl.open)}</td>
                  <td>{formatMoneyline(lineMovement.awayMl.current)}</td>
                  <td>{lineMovement.awayMl.move}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <footer>
        <span>&copy; 2026 The Drip</span>
        <a href="https://thedrip.bet" rel="noreferrer">thedrip.bet</a>
      </footer>
      </div>
    </div>
  );
};

export default LiveBasketballMatchDetails;
