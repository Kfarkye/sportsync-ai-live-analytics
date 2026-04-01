import React, { type FC, useMemo } from 'react';
import { SOCCER_LEAGUES } from '@/lib/postgamePages';
import SoccerHubPage from './SoccerHubPage';
import LeaguePage from './LeaguePage';
import TeamPage from './TeamPage';
import MatchPage from './MatchPage';
import { EmptyBlock, PageShell, TopNav } from './PostgamePrimitives';
import SEOHead from '@/components/seo/SEOHead';

const toSafeSlug = (value: string): string => decodeURIComponent(value).trim().toLowerCase();
const titleCaseFromSlug = (value: string): string =>
  value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const LEAGUE_LABELS: Record<string, string> = {
  epl: 'Premier League',
  laliga: 'La Liga',
  seriea: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue1: 'Ligue 1',
  mls: 'MLS',
  ucl: 'Champions League',
  uel: 'Europa League',
};

export const PostgameRouter: FC = () => {
  const { pathname, query } = useMemo(() => {
    const url = new URL(window.location.href);
    return { pathname: url.pathname, query: url.searchParams };
  }, []);

  if (pathname === '/soccer') {
    return (
      <>
        <SEOHead
          title="Soccer Postgame Hub | The Drip"
          description="Postgame hub for soccer leagues with match archives, scorelines, and betting context."
          canonicalPath="/soccer"
        />
        <SoccerHubPage />
      </>
    );
  }

  if (pathname.startsWith('/league/')) {
    const leagueId = toSafeSlug(pathname.slice('/league/'.length));
    if (!SOCCER_LEAGUES.includes(leagueId as (typeof SOCCER_LEAGUES)[number])) {
      return (
        <PageShell>
          <TopNav />
          <EmptyBlock message={`Unknown league slug: ${leagueId}`} />
        </PageShell>
      );
    }
    const leagueName = LEAGUE_LABELS[leagueId] || titleCaseFromSlug(leagueId);
    return (
      <>
        <SEOHead
          title={`${leagueName} Results and Betting Splits | The Drip`}
          description={`${leagueName} postgame results, scoreline distributions, first-goal timing, and market context.`}
          canonicalPath={`/league/${leagueId}`}
        />
        <LeaguePage leagueId={leagueId} query={query} />
      </>
    );
  }

  if (pathname.startsWith('/team/')) {
    const teamSlug = toSafeSlug(pathname.slice('/team/'.length));
    const teamName = titleCaseFromSlug(teamSlug);
    return (
      <>
        <SEOHead
          title={`${teamName} Team Results and Betting Record | The Drip`}
          description={`${teamName} postgame results, form profile, and line history from completed matches.`}
          canonicalPath={`/team/${teamSlug}`}
        />
        <TeamPage teamSlug={teamSlug} query={query} />
      </>
    );
  }

  if (pathname.startsWith('/match/')) {
    const slug = decodeURIComponent(pathname.slice('/match/'.length));
    return (
      <>
        <SEOHead
          title="Match Breakdown and Betting Context | The Drip"
          description="Postgame match breakdown with scoreline context, timeline events, and market snapshots."
          canonicalPath={`/match/${slug}`}
        />
        <MatchPage slug={slug} />
      </>
    );
  }

  return (
    <PageShell>
      <TopNav />
      <EmptyBlock message="Unsupported postgame route." />
    </PageShell>
  );
};

export default PostgameRouter;
