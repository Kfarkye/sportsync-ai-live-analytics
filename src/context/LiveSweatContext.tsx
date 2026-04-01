/**
 * LiveSweatContext.tsx
 * "Live Sweat" — Real-time bridge between AI Watch Triggers and UI animations.
 *
 * Architecture:
 * ├─ AI outputs structured `WatchTriggers` (entity + keywords)
 * ├─ LiveSweatProvider listens to play-by-play text feed
 * ├─ When PBP text matches trigger keywords → activePulses fires
 * └─ Consuming components animate (pulse, glow, haptics) based on activePulses
 *
 * CRITICAL FIXES:
 * ├─ useRef timeout registry: prevents overlapping rapid-fire events from
 * │  causing UI flicker or memory leaks
 * ├─ Word boundary regex: prevents partial matches ("Z" triggering on "Zebra")
 * └─ Safe haptics: navigator.vibrate unsupported on iOS Safari
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// §1  TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AIWatchTrigger {
    /** Unique entity identifier, e.g., "zion_williamson" or "pelicans_ml" */
    entityId: string;
    /** Keywords to match in play-by-play text */
    keywords: string[];
    /** Optional: metric being tracked (for UI labeling) */
    metric?: string;
    /** Optional: UI action hint */
    uiAction?: 'pulse_card' | 'glow_border' | 'shake' | 'highlight_zone';
}

interface LiveSweatState {
    /** Array of entityIds currently in their animation window */
    activePulses: string[];
    /** Whether any trigger is currently active */
    hasActiveTriggers: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// §2  CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

const defaultState: LiveSweatState = {
    activePulses: [],
    hasActiveTriggers: false,
};

const LiveSweatContext = createContext<LiveSweatState>(defaultState);

/** Duration in ms that a pulse stays active after triggering */
const PULSE_DURATION_MS = 3000;

/** Minimum interval between consecutive pulses for the same entity */
const DEBOUNCE_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════
// §3  REGEX CACHE (prevents recompilation on every PBP update)
// ═══════════════════════════════════════════════════════════════════════════

const regexCache = new Map<string, RegExp>();

function getWordBoundaryRegex(keyword: string): RegExp {
    const cached = regexCache.get(keyword);
    if (cached) return cached;
    // Escape special regex characters in the keyword
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    regexCache.set(keyword, regex);
    return regex;
}

// ═══════════════════════════════════════════════════════════════════════════
// §4  PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

export const LiveSweatProvider: React.FC<{
    children: React.ReactNode;
    /** Latest play-by-play text from the live game feed */
    latestPlayByPlayText: string;
    /** AI-generated watch triggers for the current game context */
    aiTriggers: AIWatchTrigger[];
}> = ({ children, latestPlayByPlayText, aiTriggers }) => {
    const [activePulses, setActivePulses] = useState<string[]>([]);

    // 🛡️ Per-entity timeout registry — prevents overlapping rapid events
    // from causing UI flicker or orphaned timeouts
    const timeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

    // 🛡️ Per-entity last-trigger timestamp — prevents debounce violations
    const lastTriggerRef = useRef<Record<string, number>>({});

    const triggerPulse = useCallback((entityId: string) => {
        const now = Date.now();
        const lastTrigger = lastTriggerRef.current[entityId] || 0;

        // Debounce: skip if same entity triggered too recently
        if (now - lastTrigger < DEBOUNCE_MS) return;
        lastTriggerRef.current[entityId] = now;

        // Activate the pulse
        setActivePulses(prev => {
            if (prev.includes(entityId)) return prev; // Already active
            return [...prev, entityId];
        });

        // Safe haptics (unsupported on iOS Safari, works on Android Chrome)
        try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(100);
            }
        } catch { /* Ignore haptic errors */ }

        // Clear any existing timeout for this entity
        if (timeoutsRef.current[entityId]) {
            clearTimeout(timeoutsRef.current[entityId]);
        }

        // Schedule pulse removal
        timeoutsRef.current[entityId] = setTimeout(() => {
            setActivePulses(prev => prev.filter(id => id !== entityId));
            delete timeoutsRef.current[entityId];
        }, PULSE_DURATION_MS);
    }, []);

    // ─── Match PBP text against AI triggers ───
    useEffect(() => {
        if (!latestPlayByPlayText || !aiTriggers || aiTriggers.length === 0) return;

        for (const trigger of aiTriggers) {
            const isMatch = trigger.keywords.some(keyword =>
                getWordBoundaryRegex(keyword).test(latestPlayByPlayText)
            );

            if (isMatch) {
                triggerPulse(trigger.entityId);
            }
        }
    }, [latestPlayByPlayText, aiTriggers, triggerPulse]);

    // ─── Cleanup ALL active timers on unmount ───
    useEffect(() => {
        const timers = timeoutsRef.current;
        return () => {
            Object.values(timers).forEach(clearTimeout);
        };
    }, []);

    const state: LiveSweatState = {
        activePulses,
        hasActiveTriggers: activePulses.length > 0,
    };

    return (
        <LiveSweatContext.Provider value={state}>
            {children}
        </LiveSweatContext.Provider>
    );
};

LiveSweatProvider.displayName = 'LiveSweatProvider';

// ═══════════════════════════════════════════════════════════════════════════
// §5  CONSUMER HOOK
// ═══════════════════════════════════════════════════════════════════════════

export function useLiveSweat() {
    return useContext(LiveSweatContext);
}

/**
 * Check if a specific entity is currently pulsing.
 * Convenience hook for individual card/prop animations.
 */
export function useIsEntityPulsing(entityId: string): boolean {
    const { activePulses } = useContext(LiveSweatContext);
    return activePulses.includes(entityId);
}
