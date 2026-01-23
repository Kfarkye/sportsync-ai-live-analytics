
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { UnifiedMarket } from '../types';

const extractMascot = (fullName: string): string => {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const lastTwo = parts.slice(-2).join(" ");
  const specialMascots = ["Trail Blazers", "Red Sox", "Blue Jays", "Maple Leafs", "White Sox"];
  if (specialMascots.includes(lastTwo)) return lastTwo;
  return parts[parts.length - 1];
};

export const useLiveMarket = (externalId: string, homeName?: string, awayName?: string) => {
  return useQuery({
    queryKey: ['market', externalId, homeName, awayName],
    queryFn: async (): Promise<UnifiedMarket | null> => {
      // 1. Primary Lookup: External ID (UUID)
      if (externalId) {
        const { data } = await supabase
          .from('market_feeds')
          .select('*')
          .eq('external_id', externalId)
          .maybeSingle();
        if (data) return data as UnifiedMarket;
      }

      // 2. Fallback Lookup: Mascot Matching
      if (homeName && awayName) {
        const homeMascot = extractMascot(homeName).toLowerCase();
        const awayMascot = extractMascot(awayName).toLowerCase();

        const { data: fallbackFeeds } = await supabase
          .from('market_feeds')
          .select('*')
          .ilike('home_team', `%${homeMascot}`)
          .ilike('away_team', `%${awayMascot}`)
          .order('last_updated', { ascending: false })
          .limit(1);

        if (fallbackFeeds?.[0]) return fallbackFeeds[0] as UnifiedMarket;
      }

      return null;
    },
    enabled: !!(externalId || (homeName && awayName)),
    refetchInterval: 15000,
  });
};
