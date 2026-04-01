import type { AISignals, Match } from '@/types';

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseClockSeconds = (clock: unknown): number => {
  const raw = String(clock ?? '').trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/['"]/g, '');
  const mmss = cleaned.match(/^(\d{1,3}):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const mins = cleaned.match(/^(\d{1,3})(?:\+(\d{1,2}))?$/);
  if (mins) return Number(mins[1]) * 60 + Number(mins[2] ?? 0);
  return 0;
};

export function computeAISignals(match: Match): AISignals {
  const existing = (match.ai_signals || {}) as Record<string, any>;
  const sport = String(match.sport || '').toLowerCase();
  const leagueId = String(match.leagueId || '').toLowerCase();
  const status = String(match.status || '');

  const homeScore = Number(match.homeScore ?? 0);
  const awayScore = Number(match.awayScore ?? 0);
  const currentTotal = homeScore + awayScore;

  const odds = (match.current_odds || match.odds || {}) as Record<string, any>;
  const marketTotal = toNumber(odds.total ?? odds.overUnder ?? odds.main?.total?.line);
  const marketSpread = toNumber(odds.homeSpread ?? odds.spread ?? odds.main?.spread?.home?.point);
  const marketHomeMl = toNumber(odds.homeML ?? odds.moneylineHome ?? odds.homeWin ?? odds.home_ml ?? odds.main?.h2h?.home?.price);
  const marketAwayMl = toNumber(odds.awayML ?? odds.moneylineAway ?? odds.awayWin ?? odds.away_ml ?? odds.main?.h2h?.away?.price);

  const gameTotalMins =
    sport === 'basketball' ? (leagueId === 'mens-college-basketball' ? 40 : 48) :
      sport === 'icehockey' || sport === 'hockey' ? 60 :
        sport === 'soccer' ? 90 :
          sport === 'baseball' ? 54 :
            sport === 'americanfootball' || sport === 'football' ? 60 :
              48;

  const period = Number(match.period ?? 0);
  const clockSecs = parseClockSeconds(match.displayClock);
  const elapsedSecs = (() => {
    if (sport === 'basketball') {
      const periodMins = leagueId === 'mens-college-basketball' ? 20 : 12;
      const completedPeriods = Math.max(0, period - 1);
      return completedPeriods * periodMins * 60 + Math.max(0, periodMins * 60 - clockSecs);
    }
    if (sport === 'soccer') return clockSecs;
    return 0;
  })();

  const elapsedMins = Math.max(1, elapsedSecs / 60);
  const observedPPM = currentTotal / elapsedMins;
  const projectedPPM = marketTotal ? marketTotal / gameTotalMins : 0;
  const ppmDelta = observedPPM - projectedPPM;

  const isLive = status.toUpperCase() === 'STATUS_IN_PROGRESS';
  const isBlowout = Math.abs(homeScore - awayScore) > (sport === 'basketball' ? 20 : sport === 'soccer' ? 3 : 4);
  const regime = isBlowout ? 'BLOWOUT' : (elapsedSecs > gameTotalMins * 55 ? 'ENDGAME' : 'NORMAL');
  const edgeState = isLive && Math.abs(ppmDelta / (projectedPPM || 1)) > 0.12 ? 'LEAN' : 'NEUTRAL';
  const marketLean = ppmDelta > 0.05 ? 'OVER' : ppmDelta < -0.05 ? 'UNDER' : 'NEUTRAL';

  const base: Record<string, any> = {
    system_state: isLive ? 'ACTIVE' : 'SILENT',
    dislocation_side_pct: 0,
    dislocation_total_pct: 0,
    market_bias: 'NONE',
    market_efficiency: 'UNKNOWN',
    market_total: marketTotal,
    constraints: {
      correction_lag: false,
      market_shade: false,
      public_flow_bias: false,
      ...(existing.constraints || {}),
    },
    odds: existing.odds || {},
    regimes: existing.regimes || [],
    edge_cap: existing.edge_cap ?? 0.07,
    evidence_pack: existing.evidence_pack || [],
    risk_flags: existing.risk_flags || [],
    context_summary: existing.context_summary || 'Market passthrough reference',
    deterministic_fair_total: marketTotal,
    deterministic_regime: regime,
    edge_state: edgeState,
    edge_points: existing.edge_points ?? 0,
    game_progress: Math.min(1, elapsedSecs / (gameTotalMins * 60)),
    market_spread: marketSpread,
    market_home_ml: marketHomeMl,
    market_away_ml: marketAwayMl,
    ppm: {
      observed: Number(observedPPM.toFixed(4)),
      projected: Number(projectedPPM.toFixed(4)),
      delta: Number(ppmDelta.toFixed(4)),
    },
    narrative: {
      ...(existing.narrative || {}),
      market_lean: marketLean,
      signal_label: isLive ? 'LIVE READ' : 'PREGAME',
    },
    debug_trace: [
      'source:market_passthrough',
      `regime:${regime}`,
      `ppm_delta:${ppmDelta.toFixed(3)}`,
    ],
  };

  return { ...existing, ...base } as AISignals;
}
