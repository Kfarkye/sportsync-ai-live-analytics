import type { AISignals, Match } from '@/types';

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

type SportFamily = 'basketball' | 'hockey' | 'soccer' | 'baseball' | 'football' | 'generic';
type DeterministicRegime = NonNullable<AISignals['deterministic_regime']>;

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

const inferSportFamily = (sport: string, leagueId: string): SportFamily => {
  const raw = `${sport} ${leagueId}`.toLowerCase();
  if (raw.includes('hockey') || raw.includes('nhl') || raw.includes('icehockey')) return 'hockey';
  if (
    raw.includes('basketball') ||
    raw.includes('nba') ||
    raw.includes('wnba') ||
    raw.includes('college_basketball') ||
    raw.includes('mens-college-basketball')
  ) return 'basketball';
  if (raw.includes('soccer') || raw.includes('fifa') || raw.includes('football/soccer')) return 'soccer';
  if (raw.includes('baseball') || raw.includes('mlb')) return 'baseball';
  if (raw.includes('football') || raw.includes('nfl')) return 'football';
  return 'generic';
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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

  const sportFamily = inferSportFamily(sport, leagueId);
  const gameTotalMins =
    sportFamily === 'basketball' ? (leagueId.includes('mens-college-basketball') || leagueId.includes('college_basketball') ? 40 : 48) :
      sportFamily === 'hockey' ? 60 :
        sportFamily === 'soccer' ? 90 :
          sportFamily === 'baseball' ? 54 :
            sportFamily === 'football' ? 60 :
              48;

  const period = Number(match.period ?? 0);
  const clockSecs = parseClockSeconds(match.displayClock ?? (match as unknown as Record<string, unknown>).clock);
  const elapsedSecs = (() => {
    if (sportFamily === 'basketball') {
      const periodMins = leagueId === 'mens-college-basketball' ? 20 : 12;
      const completedPeriods = Math.max(0, period - 1);
      return completedPeriods * periodMins * 60 + Math.max(0, periodMins * 60 - clockSecs);
    }
    if (sportFamily === 'hockey') {
      const periodMins = 20;
      const completedPeriods = Math.max(0, period - 1);
      return completedPeriods * periodMins * 60 + Math.max(0, periodMins * 60 - clockSecs);
    }
    if (sportFamily === 'football') {
      const periodMins = 15;
      const completedPeriods = Math.max(0, period - 1);
      return completedPeriods * periodMins * 60 + Math.max(0, periodMins * 60 - clockSecs);
    }
    if (sportFamily === 'soccer') return clockSecs;
    return 0;
  })();

  const elapsedMins = Math.max(1, elapsedSecs / 60);
  const remainingMins = Math.max(0, gameTotalMins - elapsedMins);
  const observedPPM = currentTotal / elapsedMins;
  const projectedPPM = marketTotal ? marketTotal / gameTotalMins : 0;
  const ppmDelta = observedPPM - projectedPPM;

  const statusUpper = status.toUpperCase();
  const isLive =
    statusUpper === 'STATUS_IN_PROGRESS' ||
    statusUpper === 'IN_PROGRESS' ||
    statusUpper === 'LIVE' ||
    statusUpper === 'STATUS_HALFTIME' ||
    statusUpper === 'HALFTIME';

  const scoreDiff = Math.abs(homeScore - awayScore);
  const varianceFlags: NonNullable<AISignals['variance_flags']> = {
    blowout: false,
    foul_trouble: false,
    endgame: remainingMins <= 2,
  };

  let regime: DeterministicRegime = 'NORMAL';
  let fairTotal = marketTotal ?? currentTotal;
  let regimeMultiplier = 1;
  const notesLower = String((match as any).notes ?? '').toLowerCase();
  const traceDump: Record<string, unknown> = {
    sportFamily,
    elapsedMins: Number(elapsedMins.toFixed(2)),
    remainingMins: Number(remainingMins.toFixed(2)),
    scoreDiff,
  };

  if (sportFamily === 'hockey') {
    const isLateThird = period >= 3;
    const isBackToBack = /back[-\s]?to[-\s]?back|b2b/.test(notesLower);
    const possessionText = String((match as any).situation?.possessionText ?? '').toLowerCase();
    const isPowerPlay = Boolean((match as any).situation?.isPowerPlay) || possessionText.includes('power play');
    const isBlowout = isLateThird && scoreDiff >= 3 && remainingMins <= 10;
    const isEnRisk = isLateThird && scoreDiff === 1 && remainingMins <= 3;

    if (isEnRisk) {
      regime = 'CHAOS';
      const enInjection = 0.85;
      const timeDecayTail = projectedPPM * remainingMins * 0.25;
      fairTotal = currentTotal + enInjection + timeDecayTail;
      regimeMultiplier = 1.2;
      traceDump.enInjection = enInjection;
      traceDump.is_en_risk = true;
    } else if (isBlowout) {
      regime = 'BLOWOUT';
      varianceFlags.blowout = true;
      let surrenderScalar = isBackToBack ? 0.65 : 0.8;
      if (isPowerPlay) {
        surrenderScalar += 0.25;
        varianceFlags.power_play_decay = true;
      }
      surrenderScalar = clamp(surrenderScalar, 0.4, 1.25);
      fairTotal = currentTotal + (projectedPPM * remainingMins * surrenderScalar);
      regimeMultiplier = 0.92;
      traceDump.surrenderScalar = Number(surrenderScalar.toFixed(2));
      traceDump.isBackToBack = isBackToBack;
      traceDump.isPowerPlay = isPowerPlay;
      traceDump.is_en_risk = false;
    } else {
      fairTotal = currentTotal + (projectedPPM * remainingMins);
    }
  } else if (sportFamily === 'basketball') {
    const elapsedPct = elapsedMins / gameTotalMins;
    const isBlowout = scoreDiff >= 22 && elapsedPct >= 0.6;
    if (isBlowout) {
      regime = 'BLOWOUT';
      varianceFlags.blowout = true;
      regimeMultiplier = 0.9;
    } else if (remainingMins <= 3 && scoreDiff <= 6) {
      regime = 'CHAOS';
      regimeMultiplier = 1.1;
    }
    fairTotal = currentTotal + (projectedPPM * remainingMins * regimeMultiplier);
    traceDump.elapsedPct = Number(elapsedPct.toFixed(3));
    traceDump.match_phase_multiplier = regimeMultiplier;
  } else {
    const isBlowout = scoreDiff > (sportFamily === 'soccer' ? 3 : 4);
    if (isBlowout) {
      regime = 'BLOWOUT';
      varianceFlags.blowout = true;
      regimeMultiplier = 0.92;
    }
    fairTotal = currentTotal + (projectedPPM * remainingMins * regimeMultiplier);
  }

  fairTotal = Number(fairTotal.toFixed(2));
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
    deterministic_fair_total: fairTotal,
    deterministic_regime: regime,
    variance_flags: {
      ...(existing.variance_flags || {}),
      ...varianceFlags,
    },
    edge_state: edgeState,
    edge_points: existing.edge_points ?? 0,
    game_progress: Math.min(1, elapsedSecs / (gameTotalMins * 60)),
    regime_multiplier: regimeMultiplier,
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
    trace_id: `${match.id || 'match'}:${Date.now().toString(36)}`,
    trace_dump: {
      ...traceDump,
      marketTotal,
      projectedPPM: Number(projectedPPM.toFixed(4)),
      observedPPM: Number(observedPPM.toFixed(4)),
      regime,
      fairTotal,
    },
  };

  return { ...existing, ...base } as AISignals;
}
