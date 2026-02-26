
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
    const unbindViewport = bindIOSVisualViewport();

    // 3. Craftsmanship mark (Inspect Element test)
    console.log(
      "%c\u2588\u2588\u2588 SPORTSYNC AI \u2588\u2588\u2588\n%cCrafted by humans who watch the games.\nEngine: Gemini 3 Flash \u00b7 Protocol: Obsidian Weissach v29.1\n\nCome build with us \u2192 github.com/Kfarkye",
      "font-weight:900;font-size:16px;color:#0F172A;",
      "font-size:11px;color:#64748B;line-height:1.6;"
    );

    // 4. Apply grain texture to root for microscopic matte finish
    document.getElementById("root")?.classList.add("grain-overlay");

    return unbindViewport;
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
