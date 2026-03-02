import React, { type FC, useMemo } from 'react';
import { SOCCER_LEAGUES } from '@/lib/postgame';
import SoccerHubPage from './SoccerHubPage';
import LeaguePage from './LeaguePage';
import TeamPage from './TeamPage';
import MatchPage from './MatchPage';
import { EmptyBlock, PageShell, TopNav } from './PostgamePrimitives';

const toSafeSlug = (value: string): string => decodeURIComponent(value).trim().toLowerCase();

export const PostgameRouter: FC = () => {
  const { pathname, query } = useMemo(() => {
    const url = new URL(window.location.href);
    return { pathname: url.pathname, query: url.searchParams };
  }, []);

  if (pathname === '/soccer') {
    return <SoccerHubPage />;
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
    return <LeaguePage leagueId={leagueId} query={query} />;
  }

  if (pathname.startsWith('/team/')) {
    const teamSlug = toSafeSlug(pathname.slice('/team/'.length));
    return <TeamPage teamSlug={teamSlug} query={query} />;
  }

  if (pathname.startsWith('/match/')) {
    const slug = decodeURIComponent(pathname.slice('/match/'.length));
    return <MatchPage slug={slug} />;
  }

  return (
    <PageShell>
      <TopNav />
      <EmptyBlock message="Unsupported postgame route." />
    </PageShell>
  );
};

export default PostgameRouter;
