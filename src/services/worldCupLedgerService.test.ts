import { describe, expect, it } from 'vitest';
import {
  buildSnapshotOddsOverlay,
  mergeSnapshotGroupOdds,
  normalizeWorldCupGroupRow,
} from './worldCupLedgerService';

describe('normalizeWorldCupGroupRow', () => {
  it('maps summary view payload into stable frontend shape', () => {
    const payload = normalizeWorldCupGroupRow({
      object_id: 'wc-2026-group-b',
      slug: 'group-b',
      group_title: 'Group B',
      public_path: '/world-cup-2026/groups/group-b',
      host_city: 'Los Angeles',
      host_city_image_url: '/world-cup/host-cities/los-angeles.svg',
      standings: [
        { team: 'Argentina', played: 1, points: 3, goal_diff: 2 },
      ],
      fixtures: [
        {
          match_id: 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
          label: 'Argentina vs Mexico',
          round: 'matchday_2',
          scheduled_at: '2026-06-18T20:00:00Z',
        },
      ],
      related_links: [
        { label: 'Argentina', path: '/world-cup-2026/teams/argentina' },
      ],
      at_a_glance: {
        group_name: 'Group B',
        current_leader: 'Argentina',
        group_state: 'open',
        next_decisive_match_id: 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
        next_decisive_match: 'Argentina vs Mexico',
        qualification_odds: [
          {
            team: 'Argentina',
            to_qualify_pct: 76,
            to_win_group_pct: 58,
            to_qualify_price_cents: 76,
            to_win_group_price_cents: 58,
            provider: 'Kalshi',
            last_updated_at: '2026-03-20T15:00:00Z',
          },
        ],
      },
      match_anchor: {
        match_id: 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
        match_path: '/world-cup-2026/groups/group-b/argentina-vs-mexico',
        round: 'matchday_2',
        home_team: 'Argentina',
        away_team: 'Mexico',
        status: 'pregame',
        scheduled_at: '2026-06-18T20:00:00Z',
        moneyline: { home: '-138', away: '+385', draw: '+255' },
        total: { line: 2.5, over: '-112', under: '-108' },
        team_needs: {
          home: 'Win to stay in direct control of the group.',
          away: 'Draw keeps qualification path above coin-flip.',
        },
      },
      history: {
        summary: 'Round-one prices widened early, then compressed into matchday-two anchor windows.',
        event_counts: {
          odds_updated: 3,
          qualification_state_changed: 1,
          match_completed: 0,
        },
        recent_events: [
          {
            event_type: 'odds_updated',
            event_ts: '2026-03-19T12:30:00Z',
            payload: { provider: 'DraftKings' },
          },
        ],
      },
      share_snapshot: {
        title: 'Group B',
        state: 'open',
        leader: 'Argentina',
        next_match_id: 'wc-2026-group-b-argentina-vs-mexico-2026-06-18',
        host_city: 'Los Angeles',
      },
      seo_summary: {
        title: 'Group B odds, fixtures, and qualification state | The Drip',
        description: 'Group B in Los Angeles.',
      },
      last_updated_at: '2026-03-20T15:00:00Z',
    });

    expect(payload.objectId).toBe('wc-2026-group-b');
    expect(payload.atAGlance.currentLeader).toBe('Argentina');
    expect(payload.atAGlance.qualificationOdds[0]?.toQualifyPct).toBe(76);
    expect(payload.atAGlance.qualificationOdds[0]?.toQualifyPriceCents).toBe(76);
    expect(payload.atAGlance.qualificationOdds[0]?.provider).toBe('Kalshi');
    expect(payload.matchAnchor.homeTeam).toBe('Argentina');
    expect(payload.history.eventCounts.oddsUpdated).toBe(3);
    expect(payload.history.recentEvents[0]?.eventType).toBe('odds_updated');
    expect(payload.relatedLinks[0]?.path).toBe('/world-cup-2026/teams/argentina');
    expect(payload.oddsTelemetry.source).toBe('ledger_seed');
  });

  it('falls back safely when optional JSON fields are missing', () => {
    const payload = normalizeWorldCupGroupRow({
      object_id: 'wc-2026-group-b',
      slug: 'group-b',
      group_title: 'Group B',
      public_path: '/world-cup-2026/groups/group-b',
      at_a_glance: {},
      match_anchor: {},
      history: { event_counts: {} },
      share_snapshot: {},
      seo_summary: {},
      standings: null,
      fixtures: null,
      related_links: null,
      last_updated_at: '',
    });

    expect(payload.atAGlance.groupState).toBe('open');
    expect(payload.standings).toEqual([]);
    expect(payload.fixtures).toEqual([]);
    expect(payload.relatedLinks).toEqual([]);
    expect(payload.history.eventCounts.matchCompleted).toBe(0);
    expect(payload.oddsTelemetry.snapshotRowsScanned).toBe(0);
  });
});

describe('buildSnapshotOddsOverlay', () => {
  it('returns snapshot overlay telemetry when candidates are applied', () => {
    const overlay = buildSnapshotOddsOverlay(
      [
        {
          team: 'Argentina',
          toQualifyPct: 76,
          toWinGroupPct: 58,
          toQualifyPriceCents: 76,
          toWinGroupPriceCents: 58,
          provider: 'Kalshi',
          lastUpdatedAt: '2026-03-20T15:00:00Z',
        },
      ],
      [
        {
          market_ticker: 'KXWCGRPB-ARG-TOQUALIFY',
          event_ticker: 'KXWCGROUPBQUALIFIERS',
          market_label: 'Argentina to Qualify from Group B',
          yes_price: 0.8,
          captured_at: '2026-03-21T10:00:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
      ],
      {
        groupSlug: 'group-b',
        teamOrder: ['Argentina'],
        fallbackLastUpdated: '2026-03-20T15:00:00Z',
        generatedAt: '2026-03-21T10:05:00Z',
      },
    );

    expect(overlay.telemetry.source).toBe('kalshi_snapshot_overlay');
    expect(overlay.telemetry.snapshotRowsScanned).toBe(1);
    expect(overlay.telemetry.matchedCandidates).toBe(1);
    expect(overlay.telemetry.matchedTeams).toBe(1);
    expect(overlay.telemetry.overriddenTeams).toBe(1);
    expect(overlay.telemetry.generatedAt).toBe('2026-03-21T10:05:00Z');
  });

  it('returns ledger telemetry when no candidates match', () => {
    const overlay = buildSnapshotOddsOverlay(
      [
        {
          team: 'Argentina',
          toQualifyPct: 76,
          toWinGroupPct: 58,
          toQualifyPriceCents: 76,
          toWinGroupPriceCents: 58,
          provider: 'Kalshi',
          lastUpdatedAt: '2026-03-20T15:00:00Z',
        },
      ],
      [
        {
          market_ticker: 'KXWCOUTRIGHT-ARG',
          event_ticker: 'KXWCTOURNAMENTWINNER',
          market_label: 'Argentina to win World Cup',
          yes_price: 0.1,
          captured_at: '2026-03-21T10:00:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
      ],
      {
        groupSlug: 'group-b',
        teamOrder: ['Argentina'],
        fallbackLastUpdated: '2026-03-20T15:00:00Z',
        generatedAt: '2026-03-21T10:05:00Z',
      },
    );

    expect(overlay.telemetry.source).toBe('ledger_seed');
    expect(overlay.telemetry.snapshotRowsScanned).toBe(1);
    expect(overlay.telemetry.matchedCandidates).toBe(0);
    expect(overlay.telemetry.overriddenTeams).toBe(0);
  });
});

describe('mergeSnapshotGroupOdds', () => {
  it('overlays to_qualify and to_win_group from group-scoped snapshot rows', () => {
    const merged = mergeSnapshotGroupOdds(
      [
        {
          team: 'Argentina',
          toQualifyPct: 76,
          toWinGroupPct: 58,
          toQualifyPriceCents: 76,
          toWinGroupPriceCents: 58,
          provider: 'Kalshi',
          lastUpdatedAt: '2026-03-20T15:00:00Z',
        },
        {
          team: 'Mexico',
          toQualifyPct: 49,
          toWinGroupPct: 20,
          toQualifyPriceCents: 49,
          toWinGroupPriceCents: 20,
          provider: 'Kalshi',
          lastUpdatedAt: '2026-03-20T15:00:00Z',
        },
      ],
      [
        {
          market_ticker: 'KXWCGRPB-ARG-TOQUALIFY',
          event_ticker: 'KXWCGROUPBQUALIFIERS',
          market_label: 'Argentina to Qualify from Group B',
          yes_price: 0.82,
          captured_at: '2026-03-21T10:01:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
        {
          market_ticker: 'KXWCGRPB-ARG-WINGROUP',
          event_ticker: 'KXWCGROUPBWINNER',
          market_label: 'Argentina to Win Group B',
          yes_price: 67,
          captured_at: '2026-03-21T10:02:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
        {
          market_ticker: 'KXWCGRPB-MEX-TOQUALIFY',
          event_ticker: 'KXWCGROUPBQUALIFIERS',
          market_label: 'Mexico to Qualify from Group B',
          yes_price: 0.53,
          captured_at: '2026-03-21T10:03:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
      ],
      {
        groupSlug: 'group-b',
        teamOrder: ['Argentina', 'Mexico'],
        fallbackLastUpdated: '2026-03-20T15:00:00Z',
      },
    );

    expect(merged[0]?.team).toBe('Argentina');
    expect(merged[0]?.toQualifyPct).toBe(82);
    expect(merged[0]?.toWinGroupPct).toBe(67);
    expect(merged[0]?.provider).toBe('Kalshi snapshot');
    expect(merged[1]?.team).toBe('Mexico');
    expect(merged[1]?.toQualifyPct).toBe(53);
    expect(merged[1]?.toWinGroupPct).toBe(20);
    expect(merged[1]?.provider).toBe('Kalshi snapshot');
  });

  it('ignores rows that are not group-scoped markets', () => {
    const base = [
      {
        team: 'Argentina',
        toQualifyPct: 76,
        toWinGroupPct: 58,
        toQualifyPriceCents: 76,
        toWinGroupPriceCents: 58,
        provider: 'Kalshi',
        lastUpdatedAt: '2026-03-20T15:00:00Z',
      },
    ];

    const merged = mergeSnapshotGroupOdds(
      base,
      [
        {
          market_ticker: 'KXWCOUTRIGHT-ARG',
          event_ticker: 'KXWCTOURNAMENTWINNER',
          market_label: 'Argentina to win World Cup',
          yes_price: 0.11,
          captured_at: '2026-03-21T10:00:00Z',
          sport: 'soccer',
          league: 'soccer',
          market_type: 'prop',
        },
      ],
      {
        groupSlug: 'group-b',
        teamOrder: ['Argentina'],
        fallbackLastUpdated: '2026-03-20T15:00:00Z',
      },
    );

    expect(merged).toEqual(base);
  });
});
