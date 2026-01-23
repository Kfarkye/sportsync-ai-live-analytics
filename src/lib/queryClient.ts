import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // Data fresh for 5 mins (Google quality baseline)
      gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24h
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// Configure Persistence (Critical for iOS reliability)
if (typeof window !== 'undefined') {
  const localStoragePersister = createSyncStoragePersister({
    storage: window.localStorage,
    key: 'SHARPEDGE_QUERY_CACHE',
  });

  persistQueryClient({
    queryClient,
    persister: localStoragePersister,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
  });
}