/**
 * useBetLink.ts
 * Production-grade deep linking hook for sportsbook intent routing.
 *
 * CRITICAL FIX:
 * Standard setTimeout fallbacks fail on modern iOS/Android because the browser
 * suspends JS execution when the native sportsbook app opens. The Page Visibility
 * API (document.hidden) check prevents the web fallback from opening unexpectedly
 * in the background when the native app DID successfully launch.
 *
 * Architecture:
 * 1. Attempt native app URI scheme (e.g., draftkings://sportsbook/search)
 * 2. Listen for Page Visibility change (OS backgrounded browser → app opened)
 * 3. If browser stays visible after 1500ms → app not installed → open web URL
 * 4. Cleanup on visibility change or component unmount
 */

import { useCallback, useRef, useEffect } from 'react';

export type SupportedBook = 'DraftKings' | 'FanDuel' | 'BetMGM' | 'Caesars';

interface BookConfig {
    appUri: (query: string) => string;
    webUrl: (query: string) => string;
}

const BOOK_CONFIGS: Record<SupportedBook, BookConfig> = {
    DraftKings: {
        appUri: (q) => `draftkings://sportsbook/search?q=${encodeURIComponent(q)}`,
        webUrl: (q) => `https://sportsbook.draftkings.com/search?q=${encodeURIComponent(q)}`,
    },
    FanDuel: {
        appUri: (q) => `fanduelbetting://search?q=${encodeURIComponent(q)}`,
        webUrl: (q) => `https://sportsbook.fanduel.com/search?q=${encodeURIComponent(q)}`,
    },
    BetMGM: {
        appUri: (q) => `betmgm://search?q=${encodeURIComponent(q)}`,
        webUrl: (q) => `https://sports.betmgm.com/en/sports?query=${encodeURIComponent(q)}`,
    },
    Caesars: {
        appUri: (q) => `caesars://sports/search?q=${encodeURIComponent(q)}`,
        webUrl: (q) => `https://www.caesars.com/sportsbook/search?q=${encodeURIComponent(q)}`,
    },
};

/**
 * Fallback delay in ms. Must be long enough for the OS app-switch animation
 * to trigger the visibilitychange event, but short enough that users don't
 * perceive the delay as broken.
 */
const FALLBACK_DELAY_MS = 1500;

export function useBetLink() {
    const cleanupRef = useRef<(() => void) | null>(null);

    // Cleanup on unmount to prevent orphaned event listeners
    useEffect(() => {
        return () => {
            cleanupRef.current?.();
        };
    }, []);

    const handleDeepLink = useCallback((book: SupportedBook, query: string) => {
        // SSR safety
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const config = BOOK_CONFIGS[book];
        if (!config) {
            console.warn(`[BetLink] Unsupported sportsbook: ${book}`);
            return;
        }

        // Cancel any previously pending deep link attempt
        cleanupRef.current?.();

        const appUri = config.appUri(query);
        const webUrl = config.webUrl(query);
        const start = Date.now();

        // 1. Attempt to open the native app
        window.location.assign(appUri);

        // 2. Set up fallback timer
        const fallbackTimer = setTimeout(() => {
            // 🛡️ If document.hidden is true, the OS successfully backgrounded
            // the browser to open the native app — do NOT open web fallback
            if (document.hidden) return;

            // Additional timing check: if more than 1s passed without
            // the browser being backgrounded, the app likely isn't installed
            if (Date.now() - start > 1000) {
                window.open(webUrl, '_blank', 'noopener,noreferrer');
            }
        }, FALLBACK_DELAY_MS);

        // 3. Listen for visibility change (app opened successfully)
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // App launched successfully — cancel web fallback
                clearTimeout(fallbackTimer);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange, { once: true });

        // 4. Store cleanup function
        cleanupRef.current = () => {
            clearTimeout(fallbackTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            cleanupRef.current = null;
        };
    }, []);

    /**
     * Generate a web-only link (no native app attempt).
     * Use for rendering <a> tags or explicit "Open in Browser" CTAs.
     */
    const getWebUrl = useCallback((book: SupportedBook, query: string): string | null => {
        const config = BOOK_CONFIGS[book];
        return config ? config.webUrl(query) : null;
    }, []);

    return { handleDeepLink, getWebUrl };
}
