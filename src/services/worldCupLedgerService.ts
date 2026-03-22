import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface WorldCupQualificationOdds {
  team: string;
  toQualifyPct: number | null;
  toWinGroupPct: number | null;
  toQualifyPriceCents: number | null;
  toWinGroupPriceCents: number | null;
  provider: string;
  lastUpdatedAt: string;
}

export interface WorldCupStanding {
  team: string;
  played: number | null;
  points: number | null;
  goalDiff: number | null;
}

export interface WorldCupFixture {
  matchId: string;
  label: string;
  round: string;
  scheduledAt: string;
}

export interface WorldCupMatchAnchor {
  matchId: string;
  matchPath: string;
  round: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  scheduledAt: string;
  moneyline: Record<string, unknown>;
  total: Record<string, unknown>;
  teamNeeds: Record<string, string>;
}

export interface WorldCupHistoryEvent {
  eventType: string;
  eventTs: string;
  payload: Record<string, unknown>;
}

export interface WorldCupGroupSummary {
  objectId: string;
  slug: string;
  groupTitle: string;
  publicPath: string;
  hostCity: string;
  hostCityImageUrl: string;
  atAGlance: {
    groupName: string;
    currentLeader: string;
    qualificationOdds: WorldCupQualificationOdds[];
    groupState: string;
    nextDecisiveMatchId: string;
    nextDecisiveMatch: string;
  };
  matchAnchor: WorldCupMatchAnchor;
  history: {
    summary: string;
    eventCounts: {
      oddsUpdated: number;
      qualificationStateChanged: number;
      matchCompleted: number;
    };
    recentEvents: WorldCupHistoryEvent[];
  };
  shareSnapshot: {
    title: string;
    state: string;
    leader: string;
    nextMatchId: string;
    hostCity: string;
  };
  seoSummary: {
    title: string;
    description: string;
  };
  standings: WorldCupStanding[];
  fixtures: WorldCupFixture[];
  relatedLinks: Array<{ label: string; path: string }>;
  oddsTelemetry: WorldCupOddsTelemetry;
  lastUpdatedAt: string;
}

type GroupMarketType = 'to_qualify' | 'to_win_group';

export interface WorldCupOddsTelemetry {
  source: 'ledger_seed' | 'kalshi_snapshot_overlay';
  snapshotRowsScanned: number;
  matchedCandidates: number;
  matchedTeams: number;
  overriddenTeams: number;
  generatedAt: string;
}

interface KalshiSnapshotMarketRow {
  market_ticker: string | null;
  event_ticker: string | null;
  market_label: string | null;
  yes_price: number | string | null;
  captured_at: string | null;
  sport: string | null;
  league: string | null;
  market_type: string | null;
}

interface GroupMarketCandidate {
  team: string;
  marketType: GroupMarketType;
  priceCents: number;
  probabilityPct: number;
  lastUpdatedAt: string;
  score: number;
  capturedAtMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const asString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const normalizeText = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
};

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
};

const asPctFromPrice = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null || parsed < 0) return null;
  if (parsed <= 1) return Math.round(parsed * 100);
  if (parsed <= 100) return Math.round(parsed);
  return null;
};

const asCentsFromPrice = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null || parsed < 0) return null;
  if (parsed <= 1) return Math.round(parsed * 100);
  if (parsed <= 100) return Math.round(parsed);
  return null;
};

const buildGroupTokens = (groupSlug: string): string[] => {
  const slug = normalizeText(groupSlug);
  const values: string[] = [slug];
  const groupMatch = groupSlug.trim().toLowerCase().match(/^group-([a-z0-9]+)$/);
  if (groupMatch?.[1]) {
    const groupKey = groupMatch[1];
    values.push(`group ${groupKey}`);
    values.push(`group${groupKey}`);
    values.push(`grp ${groupKey}`);
    values.push(`grp${groupKey}`);
  }
  return uniqueStrings(values.map(normalizeText).filter(Boolean));
};

const classifyGroupMarketType = (text: string): GroupMarketType | null => {
  const normalized = normalizeText(text);
  const winGroupSignals = [
    'to win group',
    'wins group',
    'win group',
    'group winner',
    'finish first in group',
    'place first in group',
  ];
  if (winGroupSignals.some((signal) => normalized.includes(signal))) {
    return 'to_win_group';
  }

  const qualifySignals = [
    'to qualify',
    'qualify from group',
    'qualification',
    'to advance',
    'advance from group',
    'group advancement',
    'reach knockout',
    'top 2',
    'top two',
  ];
  if (qualifySignals.some((signal) => normalized.includes(signal))) {
    return 'to_qualify';
  }

  return null;
};

const scoreTeamMatch = (normalizedText: string, team: string): number => {
  const teamText = normalizeText(team);
  if (!teamText) return 0;
  if (normalizedText.includes(teamText)) {
    return 100 + teamText.length;
  }

  const parts = teamText.split(' ').filter((part) => part.length >= 3);
  if (!parts.length) return 0;
  const matchedParts = parts.filter((part) => normalizedText.includes(part));
  if (!matchedParts.length) return 0;

  return matchedParts.length * 10;
};

const pickTeamFromText = (normalizedText: string, teams: string[]): { team: string; score: number } | null => {
  let best: { team: string; score: number } | null = null;
  teams.forEach((team) => {
    const score = scoreTeamMatch(normalizedText, team);
    if (!best || score > best.score) {
      best = { team, score };
    }
  });

  if (!best || best.score <= 0) return null;
  return best;
};

const candidateOutranks = (incoming: GroupMarketCandidate, current: GroupMarketCandidate): boolean => {
  if (incoming.score !== current.score) return incoming.score > current.score;
  return incoming.capturedAtMs > current.capturedAtMs;
};

const buildGroupMarketCandidates = (
  rows: KalshiSnapshotMarketRow[],
  groupSlug: string,
  teams: string[],
): GroupMarketCandidate[] => {
  if (!rows.length || !teams.length) return [];

  const groupTokens = buildGroupTokens(groupSlug);

  return rows
    .map((row) => {
      const text = normalizeText(
        [
          asString(row.market_label),
          asString(row.market_ticker),
          asString(row.event_ticker),
          asString(row.market_type),
          asString(row.sport),
          asString(row.league),
        ].join(' '),
      );
      if (!text) return null;

      const marketType = classifyGroupMarketType(text);
      if (!marketType) return null;

      const teamMatch = pickTeamFromText(text, teams);
      if (!teamMatch) return null;

      const hasGroupSignal =
        groupTokens.some((token) => token.length > 0 && text.includes(token)) ||
        text.includes('from group') ||
        text.includes('in group');
      if (!hasGroupSignal) return null;

      const priceCents = asCentsFromPrice(row.yes_price);
      const probabilityPct = asPctFromPrice(row.yes_price);
      if (priceCents == null || probabilityPct == null) return null;

      const capturedAt = asString(row.captured_at);
      const capturedAtMs = Date.parse(capturedAt);
      const timestamp = Number.isFinite(capturedAtMs) ? capturedAtMs : 0;

      return {
        team: teamMatch.team,
        marketType,
        priceCents,
        probabilityPct,
        lastUpdatedAt: capturedAt,
        score: teamMatch.score + (hasGroupSignal ? 50 : 0),
        capturedAtMs: timestamp,
      };
    })
    .filter((entry): entry is GroupMarketCandidate => entry !== null);
};

const pickBestGroupMarketCandidates = (candidates: GroupMarketCandidate[]): Map<string, Record<GroupMarketType, GroupMarketCandidate | undefined>> => {
  const selected = new Map<string, Record<GroupMarketType, GroupMarketCandidate | undefined>>();

  candidates.forEach((candidate) => {
    const existing = selected.get(candidate.team) ?? { to_qualify: undefined, to_win_group: undefined };
    const current = existing[candidate.marketType];
    if (!current || candidateOutranks(candidate, current)) {
      existing[candidate.marketType] = candidate;
      selected.set(candidate.team, existing);
    }
  });

  return selected;
};

const buildBaseTelemetry = (generatedAt: string, snapshotRowsScanned: number): WorldCupOddsTelemetry => ({
  source: 'ledger_seed',
  snapshotRowsScanned,
  matchedCandidates: 0,
  matchedTeams: 0,
  overriddenTeams: 0,
  generatedAt,
});

export function buildSnapshotOddsOverlay(
  baseOdds: WorldCupQualificationOdds[],
  snapshotRows: KalshiSnapshotMarketRow[],
  options: {
    groupSlug: string;
    teamOrder: string[];
    fallbackLastUpdated: string;
    generatedAt?: string;
  },
): { odds: WorldCupQualificationOdds[]; telemetry: WorldCupOddsTelemetry } {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const teamOrder = uniqueStrings(
    [
      ...options.teamOrder.map((team) => team.trim()).filter(Boolean),
      ...baseOdds.map((row) => row.team.trim()).filter(Boolean),
    ],
  );
  if (!teamOrder.length) {
    return {
      odds: baseOdds,
      telemetry: buildBaseTelemetry(generatedAt, snapshotRows.length),
    };
  }

  const candidates = buildGroupMarketCandidates(snapshotRows, options.groupSlug, teamOrder);
  if (!candidates.length) {
    return {
      odds: baseOdds,
      telemetry: buildBaseTelemetry(generatedAt, snapshotRows.length),
    };
  }

  const chosen = pickBestGroupMarketCandidates(candidates);
  const byTeam = new Map(baseOdds.map((row) => [row.team, row]));
  const matchedTeams = chosen.size;
  let overriddenTeams = 0;

  const mergedOdds = teamOrder.map((team) => {
    const base = byTeam.get(team) ?? {
      team,
      toQualifyPct: null,
      toWinGroupPct: null,
      toQualifyPriceCents: null,
      toWinGroupPriceCents: null,
      provider: 'Kalshi',
      lastUpdatedAt: options.fallbackLastUpdated,
    };
    const selected = chosen.get(team);
    const qualify = selected?.to_qualify;
    const winGroup = selected?.to_win_group;
    const lastUpdatedAt =
      qualify?.lastUpdatedAt ||
      winGroup?.lastUpdatedAt ||
      base.lastUpdatedAt ||
      options.fallbackLastUpdated;

    if (!qualify && !winGroup) {
      return {
        ...base,
        lastUpdatedAt,
      };
    }

    overriddenTeams += 1;

    return {
      team,
      toQualifyPct: qualify?.probabilityPct ?? base.toQualifyPct,
      toWinGroupPct: winGroup?.probabilityPct ?? base.toWinGroupPct,
      toQualifyPriceCents: qualify?.priceCents ?? base.toQualifyPriceCents,
      toWinGroupPriceCents: winGroup?.priceCents ?? base.toWinGroupPriceCents,
      provider: 'Kalshi snapshot',
      lastUpdatedAt,
    };
  });

  return {
    odds: mergedOdds,
    telemetry: {
      source: overriddenTeams > 0 ? 'kalshi_snapshot_overlay' : 'ledger_seed',
      snapshotRowsScanned: snapshotRows.length,
      matchedCandidates: candidates.length,
      matchedTeams,
      overriddenTeams,
      generatedAt,
    },
  };
}

export function mergeSnapshotGroupOdds(
  baseOdds: WorldCupQualificationOdds[],
  snapshotRows: KalshiSnapshotMarketRow[],
  options: {
    groupSlug: string;
    teamOrder: string[];
    fallbackLastUpdated: string;
  },
): WorldCupQualificationOdds[] {
  return buildSnapshotOddsOverlay(baseOdds, snapshotRows, options).odds;
}

const normalizeQualificationOdds = (value: unknown): WorldCupQualificationOdds[] => {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      team: asString(entry.team, 'Unknown team'),
      toQualifyPct: asNumber(entry.to_qualify_pct),
      toWinGroupPct: asNumber(entry.to_win_group_pct),
      toQualifyPriceCents: asNumber(entry.to_qualify_price_cents),
      toWinGroupPriceCents: asNumber(entry.to_win_group_price_cents),
      provider: asString(entry.provider),
      lastUpdatedAt: asString(entry.last_updated_at),
    }));
};

const normalizeStandings = (value: unknown): WorldCupStanding[] => {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      team: asString(entry.team, 'Unknown team'),
      played: asNumber(entry.played),
      points: asNumber(entry.points),
      goalDiff: asNumber(entry.goal_diff),
    }));
};

const normalizeFixtures = (value: unknown): WorldCupFixture[] => {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      matchId: asString(entry.match_id),
      label: asString(entry.label),
      round: asString(entry.round),
      scheduledAt: asString(entry.scheduled_at),
    }));
};

const normalizeRelatedLinks = (value: unknown): Array<{ label: string; path: string }> => {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      label: asString(entry.label),
      path: asString(entry.path),
    }))
    .filter((entry) => entry.label.length > 0 && entry.path.length > 0);
};

const normalizeHistoryEvents = (value: unknown): WorldCupHistoryEvent[] => {
  return asArray(value)
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      eventType: asString(entry.event_type),
      eventTs: asString(entry.event_ts),
      payload: asRecord(entry.payload),
    }))
    .filter((entry) => entry.eventType.length > 0);
};

const normalizeOddsTelemetry = (value: unknown, fallbackGeneratedAt: string): WorldCupOddsTelemetry => {
  const record = asRecord(value);
  const sourceRaw = asString(record.source);
  const source = sourceRaw === 'kalshi_snapshot_overlay' ? 'kalshi_snapshot_overlay' : 'ledger_seed';

  return {
    source,
    snapshotRowsScanned: asNumber(record.snapshot_rows_scanned) ?? 0,
    matchedCandidates: asNumber(record.matched_candidates) ?? 0,
    matchedTeams: asNumber(record.matched_teams) ?? 0,
    overriddenTeams: asNumber(record.overridden_teams) ?? 0,
    generatedAt: asString(record.generated_at, fallbackGeneratedAt),
  };
};

export function normalizeWorldCupGroupRow(raw: Record<string, unknown>): WorldCupGroupSummary {
  const atAGlance = asRecord(raw.at_a_glance);
  const matchAnchor = asRecord(raw.match_anchor);
  const history = asRecord(raw.history);
  const historyEventCounts = asRecord(history.event_counts);
  const shareSnapshot = asRecord(raw.share_snapshot);
  const seoSummary = asRecord(raw.seo_summary);
  const fallbackGeneratedAt = asString(raw.last_updated_at, new Date().toISOString());

  const teamNeedsRaw = asRecord(matchAnchor.team_needs);
  const teamNeeds: Record<string, string> = {};
  Object.entries(teamNeedsRaw).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      teamNeeds[key] = value;
    }
  });

  return {
    objectId: asString(raw.object_id),
    slug: asString(raw.slug),
    groupTitle: asString(raw.group_title),
    publicPath: asString(raw.public_path),
    hostCity: asString(raw.host_city),
    hostCityImageUrl: asString(raw.host_city_image_url),
    atAGlance: {
      groupName: asString(atAGlance.group_name),
      currentLeader: asString(atAGlance.current_leader),
      qualificationOdds: normalizeQualificationOdds(atAGlance.qualification_odds),
      groupState: asString(atAGlance.group_state, 'open'),
      nextDecisiveMatchId: asString(atAGlance.next_decisive_match_id),
      nextDecisiveMatch: asString(atAGlance.next_decisive_match),
    },
    matchAnchor: {
      matchId: asString(matchAnchor.match_id),
      matchPath: asString(matchAnchor.match_path),
      round: asString(matchAnchor.round),
      homeTeam: asString(matchAnchor.home_team),
      awayTeam: asString(matchAnchor.away_team),
      status: asString(matchAnchor.status),
      scheduledAt: asString(matchAnchor.scheduled_at),
      moneyline: asRecord(matchAnchor.moneyline),
      total: asRecord(matchAnchor.total),
      teamNeeds,
    },
    history: {
      summary: asString(history.summary),
      eventCounts: {
        oddsUpdated: asNumber(historyEventCounts.odds_updated) ?? 0,
        qualificationStateChanged: asNumber(historyEventCounts.qualification_state_changed) ?? 0,
        matchCompleted: asNumber(historyEventCounts.match_completed) ?? 0,
      },
      recentEvents: normalizeHistoryEvents(history.recent_events),
    },
    shareSnapshot: {
      title: asString(shareSnapshot.title),
      state: asString(shareSnapshot.state),
      leader: asString(shareSnapshot.leader),
      nextMatchId: asString(shareSnapshot.next_match_id),
      hostCity: asString(shareSnapshot.host_city),
    },
    seoSummary: {
      title: asString(seoSummary.title),
      description: asString(seoSummary.description),
    },
    standings: normalizeStandings(raw.standings),
    fixtures: normalizeFixtures(raw.fixtures),
    relatedLinks: normalizeRelatedLinks(raw.related_links),
    oddsTelemetry: normalizeOddsTelemetry(raw.odds_telemetry, fallbackGeneratedAt),
    lastUpdatedAt: asString(raw.last_updated_at),
  };
}

const kalshiSnapshotSelect =
  'market_ticker,event_ticker,market_label,yes_price,captured_at,sport,league,market_type';

async function fetchRecentSoccerKalshiSnapshots(): Promise<KalshiSnapshotMarketRow[]> {
  const sixtyDaysAgoIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('kalshi_orderbook_snapshots')
    .select(kalshiSnapshotSelect)
    .gte('captured_at', sixtyDaysAgoIso)
    .or('sport.eq.soccer,league.eq.soccer')
    .order('captured_at', { ascending: false })
    .limit(3000);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => asRecord(row))
    .map((row) => ({
      market_ticker: asString(row.market_ticker) || null,
      event_ticker: asString(row.event_ticker) || null,
      market_label: asString(row.market_label) || null,
      yes_price: asNumber(row.yes_price),
      captured_at: asString(row.captured_at) || null,
      sport: asString(row.sport) || null,
      league: asString(row.league) || null,
      market_type: asString(row.market_type) || null,
    }));
}

export async function fetchWorldCupGroupSummary(groupSlug: string): Promise<WorldCupGroupSummary> {
  const slug = groupSlug.trim().toLowerCase();
  if (!slug) {
    throw new Error('Group slug is required.');
  }

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const publicPath = `/world-cup-2026/groups/${slug}`;
  const { data, error } = await supabase
    .from('v_wc_group_summaries')
    .select('*')
    .eq('public_path', publicPath)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load world cup group summary: ${error.message}`);
  }

  if (!data || !isRecord(data)) {
    throw new Error(`No world cup group summary found for ${publicPath}.`);
  }

  const summary = normalizeWorldCupGroupRow(data);
  const teamOrder = uniqueStrings([
    ...summary.standings.map((standing) => standing.team.trim()).filter(Boolean),
    ...summary.atAGlance.qualificationOdds.map((row) => row.team.trim()).filter(Boolean),
  ]);

  const generatedAt = new Date().toISOString();
  if (!teamOrder.length) {
    return {
      ...summary,
      oddsTelemetry: {
        source: 'ledger_seed',
        snapshotRowsScanned: 0,
        matchedCandidates: 0,
        matchedTeams: 0,
        overriddenTeams: 0,
        generatedAt,
      },
    };
  }

  const snapshotRows = await fetchRecentSoccerKalshiSnapshots();
  const overlay = buildSnapshotOddsOverlay(summary.atAGlance.qualificationOdds, snapshotRows, {
    groupSlug: slug,
    teamOrder,
    fallbackLastUpdated: summary.lastUpdatedAt,
    generatedAt,
  });

  return {
    ...summary,
    atAGlance: {
      ...summary.atAGlance,
      qualificationOdds: overlay.odds,
    },
    oddsTelemetry: overlay.telemetry,
  };
}
