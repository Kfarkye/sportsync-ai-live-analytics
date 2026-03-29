-- Index support for NBA player attachment backfill and alias-driven identity joins.
CREATE INDEX IF NOT EXISTS idx_player_prop_bets_nba_identity_lookup
  ON public.player_prop_bets (
    public.norm_name_key(player_name),
    public.norm_name_key(coalesce(team, ''))
  )
  WHERE lower(coalesce(league, '')) = 'nba';
