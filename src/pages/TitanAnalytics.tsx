import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabaseUrl, isSupabaseConfigured } from '@/lib/supabase';
import { cn, ESSENCE } from '@/lib/essence';
import { Page, Pill, TableRail } from '@/components/ui';

interface TitanSummary {
  total_picks: number | null;
  total_wins: number | null;
  total_losses: number | null;
  global_win_rate: number | null;
  best_category_win_rate: number | null;
  best_category: string | null;
}

interface TitanLeague {
  league_id: string;
  total_picks: number | null;
  wins: number | null;
  losses: number | null;
  pushes: number | null;
  win_rate: number | null;
}

interface TitanBucket {
  bucket_id: string;
  total_picks: number | null;
  wins: number | null;
  losses: number | null;
  win_rate: number | null;
}

interface TitanHeatmap {
  category: string;
  wins: number | null;
  losses: number | null;
  win_rate: number | null;
}

interface TitanTrend {
  game_date: string;
  daily_picks: number | null;
  daily_wins: number | null;
  daily_losses: number | null;
  daily_pushes: number | null;
}

interface TitanAnalyticsPayload {
  summary: TitanSummary | null;
  leagues: TitanLeague[];
  buckets: TitanBucket[];
  heatmap: TitanHeatmap[];
  trends: TitanTrend[];
  metadata?: { generated_at?: string; trend_days?: number };
}

const BASELINE = 50;

const CATEGORY_LABELS: Record<string, string> = {
  FAVORITE: 'Favorites',
  UNDERDOG: 'Underdogs',
  HOME_FAV: 'Home Spread (Fav)',
  HOME_DOG: 'Home Spread (Dog)',
  ROAD_FAV: 'Away Spread (Fav)',
  ROAD_DOG: 'Away Spread (Dog)',
  OVER: 'Total Over',
  UNDER: 'Total Under',
  INTEGRITY_ARTIFACT: 'Ingestion Artifact',
};

const BUCKET_LABELS: Record<string, string> = {
  '0_Total': 'Totals (O/U)',
  '1_Tight (0-3)': 'Tight (0-3)',
  '2_Key (3.5-7)': 'Key Number (3.5-7)',
  '3_Medium (7.5-10)': 'Medium (7.5-10)',
  '4_Blowout (10+)': 'Blowout (10+)',
  '5_NoSpread': 'No Spread Data',
};

const LEAGUE_LABELS: Record<string, string> = {
  nba: 'NBA',
  'mens-college-basketball': 'NCAAB',
  wnba: 'WNBA',
  'womens-college-basketball': 'NCAAW',
  nfl: 'NFL',
  'college-football': 'NCAAF',
  nhl: 'NHL',
  mlb: 'MLB',
  'eng.1': 'Premier League',
  'esp.1': 'La Liga',
  'ger.1': 'Bundesliga',
  'ita.1': 'Serie A',
  'fra.1': 'Ligue 1',
  'uefa.champions': 'Champions League',
  ufc: 'UFC',
};

const safe = (n: number | null | undefined): number =>
  n === null || n === undefined || Number.isNaN(n) ? 0 : n;

const normalizePct = (n: number | null | undefined): number => {
  const v = safe(n);
  if (v > 0 && v <= 1) return v * 100;
  return v;
};

const winRatePct = (w: number, l: number): number => {
  const denom = w + l;
  return denom > 0 ? (w / denom) * 100 : 0;
};

const formatPct = (n: number): string => `${n.toFixed(1)}%`;
const formatRecord = (w: number, l: number): string => `${w}-${l}`;

const outcomeTextStyle = (ratePct: number) => ({
  color: ratePct >= BASELINE ? ESSENCE.colors.accent.success : ESSENCE.colors.accent.danger,
});

const tertiaryTextStyle = { color: ESSENCE.colors.text.tertiary };
const secondaryTextStyle = { color: ESSENCE.colors.text.secondary };

const fetchTitanAnalytics = async (): Promise<TitanAnalyticsPayload> => {
  if (!isSupabaseConfigured()) {
    return { summary: null, leagues: [], buckets: [], heatmap: [], trends: [] };
  }

  const SUPABASE_URL = getSupabaseUrl();
  // @ts-ignore build-time env replacement
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/titan-analytics?trend_days=28`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`titan-analytics failed: ${res.status} ${err}`);
  }

  return await res.json();
};

export default function TitanAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['titan-analytics-v1'],
    queryFn: fetchTitanAnalytics,
    staleTime: 20_000,
    gcTime: 15 * 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const summary = data?.summary ?? null;
  const leagues = data?.leagues ?? [];
  const buckets = data?.buckets ?? [];
  const heatmap = data?.heatmap ?? [];
  const trends = data?.trends ?? [];

  const totalWins = safe(summary?.total_wins);
  const totalLosses = safe(summary?.total_losses);
  const totalPicks = safe(summary?.total_picks);
  const totalPushes = Math.max(0, totalPicks - (totalWins + totalLosses));

  const globalRatePct = normalizePct(summary?.global_win_rate);
  const bestCategoryRatePct = normalizePct(summary?.best_category_win_rate);
  const delta = globalRatePct - BASELINE;

  const categories = useMemo(() => {
    const hidden = new Set(['INTEGRITY_ARTIFACT', 'PICK_EM', 'MONEYLINE', 'UNCATEGORIZED']);
    const aggregate: Record<string, { wins: number; losses: number }> = {};

    for (const row of heatmap) {
      if (hidden.has(row.category)) continue;
      if (!aggregate[row.category]) aggregate[row.category] = { wins: 0, losses: 0 };
      aggregate[row.category].wins += safe(row.wins);
      aggregate[row.category].losses += safe(row.losses);
    }

    return Object.entries(aggregate)
      .map(([key, value]) => ({
        key,
        name: CATEGORY_LABELS[key] || key,
        wins: value.wins,
        losses: value.losses,
        rate: winRatePct(value.wins, value.losses),
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [heatmap]);

  const quickView = useMemo(() => {
    const today = trends[trends.length - 1];
    const yesterday = trends.length > 1 ? trends[trends.length - 2] : null;

    const recentWeek = trends.slice(-7);
    const weekWins = recentWeek.reduce((sum, row) => sum + safe(row.daily_wins), 0);
    const weekLosses = recentWeek.reduce((sum, row) => sum + safe(row.daily_losses), 0);

    return {
      todayRecord: today ? formatRecord(safe(today.daily_wins), safe(today.daily_losses)) : '—',
      yesterdayRecord: yesterday ? formatRecord(safe(yesterday.daily_wins), safe(yesterday.daily_losses)) : '—',
      weekRecord: recentWeek.length > 0 ? formatRecord(weekWins, weekLosses) : '—',
    };
  }, [trends]);

  const bestCategoryLabel = CATEGORY_LABELS[summary?.best_category || ''] || summary?.best_category || '—';
  const updatedAt = data?.metadata?.generated_at
    ? new Date(data.metadata.generated_at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

  if (isLoading) {
    return (
      <Page className="flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
          <span className={ESSENCE.tw.sectionLabel} style={secondaryTextStyle}>Loading TITAN analytics</span>
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page className="flex items-center justify-center px-4">
        <div className={cn(ESSENCE.card.base, 'w-full max-w-xl')}>
          <div className={ESSENCE.tw.cardHeaderLabel} style={outcomeTextStyle(0)}>Data Error</div>
          <p className="mt-3 text-sm" style={secondaryTextStyle}>{error instanceof Error ? error.message : 'Failed to load TITAN analytics.'}</p>
        </div>
      </Page>
    );
  }

  return (
    <Page className="pb-16" padded={false}>
      <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">
        <header className={cn(ESSENCE.card.base, 'flex items-center justify-between')}>
          <div>
            <div className={ESSENCE.tw.cardHeaderLabel}>TITAN</div>
            <h1 className="text-2xl font-semibold tracking-tight mt-2" style={{ color: ESSENCE.colors.text.primary }}>Analytics Performance</h1>
          </div>
          <div className="text-right">
            <div className={ESSENCE.tw.cardHeaderLabel}>Updated</div>
            <div className="mt-2 text-sm font-medium" style={secondaryTextStyle}>{updatedAt}</div>
          </div>
        </header>

        {totalPushes > 0 && (
          <div className={cn(ESSENCE.card.base, 'py-4')}>
            <div className={ESSENCE.tw.cardHeaderLabel}>Data Integrity</div>
            <p className="mt-2 text-sm" style={secondaryTextStyle}>
              Total picks includes pushes. W+L = {(totalWins + totalLosses).toLocaleString()}, pushes = {totalPushes.toLocaleString()}.
            </p>
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className={ESSENCE.card.base}>
            <div className={ESSENCE.tw.cardHeaderLabel}>Total Picks</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums" style={{ color: ESSENCE.colors.text.primary }}>{totalPicks.toLocaleString()}</div>
            <div className="mt-1 text-sm" style={secondaryTextStyle}>Graded picks (W/L/P)</div>
          </article>
          <article className={ESSENCE.card.base}>
            <div className={ESSENCE.tw.cardHeaderLabel}>Global Win Rate</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums" style={outcomeTextStyle(globalRatePct)}>{formatPct(globalRatePct)}</div>
            <div className="mt-1 text-sm" style={delta >= 0 ? { color: ESSENCE.colors.accent.success } : { color: ESSENCE.colors.accent.danger }}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs baseline
            </div>
          </article>
          <article className={ESSENCE.card.base}>
            <div className={ESSENCE.tw.cardHeaderLabel}>Record</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums" style={{ color: ESSENCE.colors.text.primary }}>{formatRecord(totalWins, totalLosses)}</div>
            <div className="mt-1 text-sm" style={secondaryTextStyle}>Win-loss (push excluded)</div>
          </article>
          <article className={ESSENCE.card.base}>
            <div className={ESSENCE.tw.cardHeaderLabel}>Best Category</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums" style={outcomeTextStyle(bestCategoryRatePct)}>{formatPct(bestCategoryRatePct)}</div>
            <div className="mt-1 text-sm" style={secondaryTextStyle}>{bestCategoryLabel}</div>
          </article>
        </section>

        <section className={cn(ESSENCE.card.base, 'space-y-4')}>
          <div className="flex items-center justify-between">
            <div className={ESSENCE.tw.cardHeaderLabel}>Quick View</div>
            <div className="text-xs" style={tertiaryTextStyle}>Today / Yesterday / Last 7 Days</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[['Today', quickView.todayRecord], ['Yesterday', quickView.yesterdayRecord], ['This Week', quickView.weekRecord]].map(([label, value]) => (
              <div key={label} className={cn(ESSENCE.tw.surface.subtle, ESSENCE.tw.border.default, 'rounded-xl px-4 py-4')}>
                <div className={ESSENCE.tw.cardHeaderLabel}>{label}</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: ESSENCE.colors.text.primary }}>{value}</div>
              </div>
            ))}
          </div>
        </section>

        <TableRail
          header={
            <div className="flex items-center justify-between">
              <div className={ESSENCE.tw.cardHeaderLabel}>Category Performance</div>
              <div className="text-xs" style={tertiaryTextStyle}>Win rate by pick type</div>
            </div>
          }
        >
          <div className="flex items-center justify-between pb-3">
            <div />
          </div>
          <div className="grid grid-cols-[1fr_180px_72px] md:grid-cols-[1fr_260px_92px] px-1 py-2 border-b border-slate-200/70">
            <span className={ESSENCE.tw.columnHeader}>Category</span>
            <span className={ESSENCE.tw.columnHeader}>Record</span>
            <span className={cn(ESSENCE.tw.columnHeader, 'text-right')}>Win Rate</span>
          </div>
          {categories.map((category) => (
            <div key={category.key} className="grid grid-cols-[1fr_180px_72px] md:grid-cols-[1fr_260px_92px] items-center py-3 border-b border-slate-100 last:border-b-0">
              <span className="text-sm font-medium" style={{ color: ESSENCE.colors.text.primary }}>{category.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium tabular-nums w-14" style={secondaryTextStyle}>{formatRecord(category.wins, category.losses)}</span>
                <div className="h-1.5 rounded-full overflow-hidden flex-1" style={{ background: ESSENCE.colors.overlay.subtle }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(0, Math.min(100, category.rate))}%`,
                      background: category.rate >= BASELINE ? ESSENCE.colors.accent.success : ESSENCE.colors.accent.danger,
                    }}
                  />
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums text-right" style={outcomeTextStyle(category.rate)}>{formatPct(category.rate)}</span>
            </div>
          ))}
        </TableRail>

        <section className="grid gap-3 xl:grid-cols-2">
          <article className={cn(ESSENCE.card.base, 'overflow-hidden')}>
            <div className="pb-3 border-b border-slate-200/70">
              <span className={ESSENCE.tw.cardHeaderLabel}>Spread Buckets</span>
            </div>
            <div className="space-y-0">
              {buckets
                .slice()
                .sort((a, b) => String(a.bucket_id).localeCompare(String(b.bucket_id)))
                .map((bucket) => {
                  const wins = safe(bucket.wins);
                  const losses = safe(bucket.losses);
                  const rate = winRatePct(wins, losses);
                  return (
                    <div key={bucket.bucket_id} className="grid grid-cols-[1fr_86px_70px] items-center py-3 border-b border-slate-100 last:border-b-0">
                      <span className="text-sm font-medium" style={{ color: ESSENCE.colors.text.primary }}>{BUCKET_LABELS[bucket.bucket_id] || bucket.bucket_id}</span>
                      <span className="text-xs font-medium tabular-nums" style={secondaryTextStyle}>{formatRecord(wins, losses)}</span>
                      <span className="text-xs font-semibold tabular-nums text-right" style={outcomeTextStyle(rate)}>{formatPct(rate)}</span>
                    </div>
                  );
                })}
            </div>
          </article>

          <article className={cn(ESSENCE.card.base, 'overflow-hidden')}>
            <div className="pb-3 border-b border-slate-200/70">
              <span className={ESSENCE.tw.cardHeaderLabel}>League Performance</span>
            </div>
            <div className="pt-4 flex flex-wrap gap-2">
              {leagues
                .slice()
                .sort((a, b) => safe(b.total_picks) - safe(a.total_picks))
                .map((league) => {
                  const wins = safe(league.wins);
                  const losses = safe(league.losses);
                  const rate = winRatePct(wins, losses);
                  const name = LEAGUE_LABELS[String(league.league_id || '').toLowerCase()] || String(league.league_id || 'UNKNOWN').toUpperCase();

                  return (
                    <div key={league.league_id} className={cn('rounded-lg px-3 py-2', ESSENCE.tw.surface.subtle, ESSENCE.tw.border.default)} title={`Picks: ${safe(league.total_picks)} | Pushes: ${safe(league.pushes)}`}>
                      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: ESSENCE.colors.text.primary }}>{name}</div>
                      <div className="mt-0.5 text-[11px] font-medium tabular-nums" style={secondaryTextStyle}>{formatRecord(wins, losses)}</div>
                      <div className="mt-1"><Pill tone={rate >= BASELINE ? 'success' : 'danger'}>{formatPct(rate)}</Pill></div>
                    </div>
                  );
                })}
            </div>
          </article>
        </section>
      </div>
    </Page>
  );
}
