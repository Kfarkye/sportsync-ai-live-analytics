
import React, { FC } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';

/**
 * Root Application Component
 * 
 * Architecture:
 * 1. Data Layer (QueryClient)
 * 2. Identity Layer (AuthProvider)
 * 3. State Layer (BettingProvider)
 * 4. UI Shell (AppShell)
 */
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';

import { configService } from './services/configService';
import { bindIOSVisualViewport } from './hooks/useIOSVisualViewport';

const App: FC = () => {
  React.useEffect(() => {
    // 1. Initialize Remote Config (Hot-swapping physics gates)
    configService.init();
    configService.subscribe();

    // 2. Bind iOS Visual Viewport (Fixes keyboard layout jumps)
    return bindIOSVisualViewport();
  }, []);

  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
