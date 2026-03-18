import React, { FC, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { configService } from './services/configService';
import { bindIOSVisualViewport } from './hooks/useIOSVisualViewport';

// SSOT: apply ESSENCE tokens globally once
import { applyEssenceToRoot } from './lib/applyEssenceToRoot';

// SSOT: tokenized fallback
import { AppLoadingScreen } from './components/system/AppLoadingScreen';

const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const TrendsPage = lazy(() => import('./pages/TrendsPage'));
const PostgameRouter = lazy(() => import('./pages/postgame/PostgameRouter'));

const App: FC = () => {
  const isSwDebugDisabled = typeof window !== 'undefined'
    ? (window as typeof window & { __sportsyncSwDebugDisabled?: boolean }).__sportsyncSwDebugDisabled === true
    : false;

  useEffect(() => {
    // 0) Apply ESSENCE -> CSS vars (SSOT)
    applyEssenceToRoot();

    // 1) Initialize Remote Config
    configService.init();
    configService.subscribe();

    // 2) Bind iOS Visual Viewport
    const unbindViewport = bindIOSVisualViewport();

    // 3) Craftsmanship mark
    console.log(
      "%c███ SPORTSYNC AI ███\n%cCrafted by humans who watch the games.\nEngine: Gemini 3 Flash · Protocol: Obsidian Weissach v29.1\n\nCome build with us → github.com/Kfarkye",
      'font-weight:900;font-size:16px;color:#0F172A;',
      'font-size:11px;color:#64748B;line-height:1.6;'
    );

    return unbindViewport;
  }, []);

  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            {isSwDebugDisabled ? (
              <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-100 border-b border-amber-300 px-3 py-2 text-center text-[11px] font-semibold text-amber-900">
                Service Worker disabled for debug: ?disable-sw=1 or ?disable-sw=true. Re-enable with ?disable-sw=0 or ?disable-sw=false.
              </div>
            ) : null}
            <Suspense fallback={<AppLoadingScreen />}>
              <Routes>
                <Route path="/soccer" element={<PostgameRouter />} />
                <Route path="/league/:slug" element={<PostgameRouter />} />
                <Route path="/team/:slug" element={<PostgameRouter />} />
                <Route path="/match/:slug" element={<PostgameRouter />} />
                <Route path="/edge" element={<ReportsPage />} />
                <Route path="/reports" element={<Navigate to="/edge" replace />} />
                <Route path="/trends" element={<TrendsPage />} />
                <Route path="*" element={<AppShell />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
