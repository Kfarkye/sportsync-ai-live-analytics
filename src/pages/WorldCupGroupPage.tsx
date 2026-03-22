import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEOHead from '@/components/seo/SEOHead';
import {
  type WorldCupGroupSummary,
  type WorldCupQualificationOdds,
  fetchWorldCupGroupSummary,
} from '@/services/worldCupLedgerService';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: WorldCupGroupSummary };

const STATE_TONE: Record<string, string> = {
  open: 'text-amber-300 border-amber-400/35 bg-amber-400/10',
  tight: 'text-sky-300 border-sky-400/35 bg-sky-400/10',
  locked: 'text-emerald-300 border-emerald-400/35 bg-emerald-400/10',
};

const cardShell = 'rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm';

const formatPercent = (value: number | null): string => {
  if (value == null) return '--';
  return `${Math.round(value)}%`;
};

const formatPriceCents = (value: number | null): string => {
  if (value == null) return '--';
  return `${Math.round(value)}c`;
};

const formatDateTime = (value: string): string => {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
};

const formatEventType = (value: string): string => {
  if (!value) return 'Event';
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

const renderOddsValue = (value: unknown): string => {
  if (typeof value === 'number') return `${value}`;
  if (typeof value === 'string' && value.trim()) return value;
  return '--';
};

const renderMoneyline = (odds: WorldCupGroupSummary['matchAnchor']['moneyline']): string => {
  const home = renderOddsValue(odds.home);
  const away = renderOddsValue(odds.away);
  const draw = renderOddsValue(odds.draw);
  return `H ${home}  A ${away}  D ${draw}`;
};

const renderTotal = (total: WorldCupGroupSummary['matchAnchor']['total']): string => {
  const line = renderOddsValue(total.line);
  const over = renderOddsValue(total.over);
  const under = renderOddsValue(total.under);
  return `Line ${line}  O ${over}  U ${under}`;
};

const formatOddsTelemetrySource = (source: WorldCupGroupSummary['oddsTelemetry']['source']): string => {
  if (source === 'kalshi_snapshot_overlay') return 'Kalshi Snapshot Overlay';
  return 'Ledger Seed Fallback';
};

const GroupStatePill: React.FC<{ state: string }> = ({ state }) => {
  const key = state.toLowerCase();
  const tone = STATE_TONE[key] || 'text-slate-200 border-white/20 bg-white/10';
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${tone}`}>
      {state || 'Open'}
    </span>
  );
};

const OddsTable: React.FC<{ rows: WorldCupQualificationOdds[]; fallbackLastUpdated: string }> = ({ rows, fallbackLastUpdated }) => {
  if (!rows.length) {
    return <p className="text-sm text-white/60">Qualification markets have not been published yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left">
        <thead className="bg-white/5 text-[11px] uppercase tracking-[0.12em] text-white/65">
          <tr>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">To Qualify</th>
            <th className="px-3 py-2">To Win Group</th>
            <th className="px-3 py-2">Implied Probability</th>
            <th className="px-3 py-2">Last Updated</th>
          </tr>
        </thead>
        <tbody className="text-sm text-white/90">
          {rows.map((row) => (
            <tr key={row.team} className="border-t border-white/10">
              <td className="px-3 py-2 font-medium">{row.team}</td>
              <td className="px-3 py-2 font-mono text-[13px]">{formatPriceCents(row.toQualifyPriceCents)}</td>
              <td className="px-3 py-2 font-mono text-[13px]">{formatPriceCents(row.toWinGroupPriceCents)}</td>
              <td className="px-3 py-2 font-mono text-[12px]">
                Q {formatPercent(row.toQualifyPct)} / W {formatPercent(row.toWinGroupPct)}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-white/70">
                {formatDateTime(row.lastUpdatedAt || fallbackLastUpdated)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const WorldCupGroupPage: React.FC = () => {
  const { groupSlug = '' } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetchWorldCupGroupSummary(groupSlug)
      .then((summary) => {
        if (!cancelled) {
          setState({ status: 'ready', summary });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load World Cup group page.';
        if (!cancelled) {
          setState({ status: 'error', message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupSlug]);

  const seo = useMemo(() => {
    if (state.status !== 'ready') {
      return {
        title: 'World Cup 2026 Group | The Drip',
        description: 'World Cup group intelligence powered by object-ledger state and event history.',
        canonicalPath: `/world-cup-2026/groups/${groupSlug || 'group-b'}`,
      };
    }

    return {
      title: state.summary.seoSummary.title || `${state.summary.groupTitle} | The Drip`,
      description:
        state.summary.seoSummary.description ||
        `${state.summary.groupTitle} group state, odds movement, and match anchor.`,
      canonicalPath: state.summary.publicPath,
    };
  }, [groupSlug, state]);

  const jsonLd = useMemo(() => {
    if (state.status !== 'ready') return undefined;
    const summary = state.summary;

    return [
      {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        name: `${summary.groupTitle} - ${summary.matchAnchor.homeTeam} vs ${summary.matchAnchor.awayTeam}`,
        eventStatus: 'https://schema.org/EventScheduled',
        startDate: summary.matchAnchor.scheduledAt,
        location: {
          '@type': 'Place',
          name: summary.hostCity || 'Host city pending',
        },
        url: `https://thedrip.to${summary.publicPath}`,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SportsOrganization',
        name: 'The Drip',
        url: 'https://www.thedrip.to/',
      },
    ];
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-[100dvh] bg-[#07090d] px-5 py-16 text-white">
        <SEOHead title={seo.title} description={seo.description} canonicalPath={seo.canonicalPath} />
        <div className="mx-auto max-w-5xl animate-pulse space-y-4">
          <div className="h-9 w-56 rounded-lg bg-white/10" />
          <div className="h-64 rounded-2xl bg-white/10" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-44 rounded-2xl bg-white/10" />
            <div className="h-44 rounded-2xl bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-[100dvh] bg-[#07090d] px-5 py-16 text-white">
        <SEOHead title={seo.title} description={seo.description} canonicalPath={seo.canonicalPath} />
        <main className="mx-auto max-w-2xl rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-rose-200/90">World Cup Object Ledger</p>
          <h1 className="mt-2 text-2xl font-semibold">Unable to load group state</h1>
          <p className="mt-2 text-sm text-rose-50/85">{state.message}</p>
          <Link
            to="/"
            className="mt-5 inline-flex rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            Back to Home
          </Link>
        </main>
      </div>
    );
  }

  const summary = state.summary;

  return (
    <div className="min-h-[100dvh] bg-[#07090d] text-white">
      <SEOHead
        title={seo.title}
        description={seo.description}
        canonicalPath={seo.canonicalPath}
        ogImage={summary.hostCityImageUrl || '/icons/icon-512.png'}
        jsonLd={jsonLd}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 hover:text-white">
            The Drip
          </Link>
          <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-white/65">
            Object Ledger Surface
          </span>
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <article className={`${cardShell} overflow-hidden`}>
            {summary.hostCityImageUrl ? (
              <img
                src={summary.hostCityImageUrl}
                alt={`${summary.hostCity || 'Host city'} skyline`}
                className="h-56 w-full object-cover sm:h-72"
                loading="lazy"
              />
            ) : null}
            <div className="space-y-3 p-5 sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/65">
                World Cup 2026 / Group Intelligence
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.2rem]">{summary.atAGlance.groupName}</h1>
              <p className="text-sm text-white/75">
                {summary.hostCity || 'Host city pending'} host node. Market state is{' '}
                <span className="font-semibold text-white">{summary.atAGlance.groupState}</span> with{' '}
                <span className="font-semibold text-white">{summary.atAGlance.nextDecisiveMatch || 'next match TBD'}</span>{' '}
                as the current anchor.
              </p>
              <div className="flex flex-wrap gap-2">
                {summary.standings.map((row) => (
                  <span
                    key={row.team}
                    className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80"
                  >
                    {row.team}
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article className={`${cardShell} p-5 sm:p-6`}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">At A Glance</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Current Leader</p>
                <p className="mt-1 text-base font-medium">{summary.atAGlance.currentLeader || 'TBD'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Group State</p>
                <div className="mt-1">
                  <GroupStatePill state={summary.atAGlance.groupState} />
                </div>
              </div>
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Next Decisive Match</p>
                <p className="mt-1 text-base font-medium">{summary.atAGlance.nextDecisiveMatch || 'TBD'}</p>
              </div>
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Last Update</p>
                <p className="mt-1 font-mono text-[13px] text-white/85">{formatDateTime(summary.lastUpdatedAt)}</p>
              </div>
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <article className={`${cardShell} p-5 sm:p-6`}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">Group Prediction Market Odds</h2>
            <p className="mt-2 text-sm text-white/70">
              Kalshi-style group markets: to qualify and to win group. Tournament outrights are intentionally excluded from this surface.
            </p>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Odds Source Telemetry</p>
              <p className="mt-1 text-sm font-medium text-white">{formatOddsTelemetrySource(summary.oddsTelemetry.source)}</p>
              <p className="mt-1 font-mono text-[11px] text-white/70">
                scanned {summary.oddsTelemetry.snapshotRowsScanned} • matched {summary.oddsTelemetry.matchedCandidates} • teams updated{' '}
                {summary.oddsTelemetry.overriddenTeams}
              </p>
              <p className="mt-1 font-mono text-[11px] text-white/55">
                generated {formatDateTime(summary.oddsTelemetry.generatedAt)}
              </p>
            </div>
            <div className="mt-4">
              <OddsTable rows={summary.atAGlance.qualificationOdds} fallbackLastUpdated={summary.lastUpdatedAt} />
            </div>
          </article>

          <article className={`${cardShell} p-5 sm:p-6`}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">Match Schedule</h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-white/5 text-[11px] uppercase tracking-[0.12em] text-white/65">
                  <tr>
                    <th className="px-2 py-2">Team</th>
                    <th className="px-2 py-2">P</th>
                    <th className="px-2 py-2">Pts</th>
                    <th className="px-2 py-2">GD</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.standings.map((row) => (
                    <tr key={row.team} className="border-t border-white/10">
                      <td className="px-2 py-2">{row.team}</td>
                      <td className="px-2 py-2 font-mono">{row.played ?? '--'}</td>
                      <td className="px-2 py-2 font-mono">{row.points ?? '--'}</td>
                      <td className="px-2 py-2 font-mono">{row.goalDiff ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-2">
              {summary.fixtures.map((fixture) => (
                <div key={fixture.matchId} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-sm font-medium">{fixture.label}</p>
                  <p className="mt-1 text-[12px] text-white/65">
                    {fixture.round || 'Round pending'} • {formatDateTime(fixture.scheduledAt)}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.25fr]">
          <article className={`${cardShell} p-5 sm:p-6`}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">Match Anchor</h2>
            <p className="mt-2 text-lg font-medium tracking-tight">
              {summary.matchAnchor.homeTeam || '--'} vs {summary.matchAnchor.awayTeam || '--'}
            </p>
            <p className="mt-1 text-sm text-white/70">
              {summary.matchAnchor.round || 'Round pending'} • {formatDateTime(summary.matchAnchor.scheduledAt)}
            </p>

            <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-[13px] text-white/90">
              <p>{renderMoneyline(summary.matchAnchor.moneyline)}</p>
              <p>{renderTotal(summary.matchAnchor.total)}</p>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {Object.entries(summary.matchAnchor.teamNeeds).length ? (
                Object.entries(summary.matchAnchor.teamNeeds).map(([side, note]) => (
                  <div key={side} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{side}</p>
                    <p className="mt-1 text-white/85">{note}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/60">Team-needs context is not available yet.</p>
              )}
            </div>
          </article>

          <article className={`${cardShell} p-5 sm:p-6`}>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">History / Round Context</h2>
            <p className="mt-2 text-sm text-white/75">{summary.history.summary}</p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Odds Updated</p>
                <p className="mt-1 font-mono text-[15px]">{summary.history.eventCounts.oddsUpdated}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Qual State</p>
                <p className="mt-1 font-mono text-[15px]">{summary.history.eventCounts.qualificationStateChanged}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Matches Done</p>
                <p className="mt-1 font-mono text-[15px]">{summary.history.eventCounts.matchCompleted}</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {summary.history.recentEvents.map((entry) => (
                <li key={`${entry.eventType}:${entry.eventTs}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">
                      {formatEventType(entry.eventType)}
                    </span>
                    <span className="font-mono text-[11px] text-white/60">{formatDateTime(entry.eventTs)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-white/60">Related Links</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.relatedLinks.map((link) => (
              <Link
                key={`${link.label}:${link.path}`}
                to={link.path}
                className="rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-medium text-white/85 hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default WorldCupGroupPage;
