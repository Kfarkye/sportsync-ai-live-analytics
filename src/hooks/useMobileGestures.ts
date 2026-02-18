/**
 * Mobile Gesture Hooks — Pull-to-Refresh, Swipe Navigation, Long Press
 * Physics: Native-feeling spring with damped overshoot
 */

import { useCallback, useRef, useState, useEffect } from 'react';

// ============================================================================
// PULL-TO-REFRESH
// ============================================================================
interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

interface PullToRefreshState {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80, maxPull = 140 }: PullToRefreshOptions) {
  const [state, setState] = useState<PullToRefreshState>({ pulling: false, refreshing: false, pullDistance: 0 });
  const startY = useRef(0);
  const scrollRef = useRef<HTMLElement | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (el && el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    setState(s => ({ ...s, pulling: true }));
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!state.pulling || state.refreshing) return;
    const delta = Math.max(0, e.touches[0].clientY - startY.current);
    // Spring-damped pull (resistance increases with distance)
    const damped = Math.min(maxPull, delta * (1 - delta / (maxPull * 3)));
    setState(s => ({ ...s, pullDistance: damped }));
  }, [state.pulling, state.refreshing, maxPull]);

  const onTouchEnd = useCallback(async () => {
    if (!state.pulling) return;
    if (state.pullDistance >= threshold) {
      setState(s => ({ ...s, refreshing: true, pullDistance: threshold * 0.6 }));
      try { await onRefresh(); } catch { /* swallow */ }
      setState({ pulling: false, refreshing: false, pullDistance: 0 });
    } else {
      setState({ pulling: false, refreshing: false, pullDistance: 0 });
    }
  }, [state.pulling, state.pullDistance, threshold, onRefresh]);

  return {
    ...state,
    scrollRef,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}

// ============================================================================
// SWIPE NAVIGATION (horizontal league switching)
// ============================================================================
interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
}

export function useSwipeNavigation({ onSwipeLeft, onSwipeRight, threshold = 60 }: SwipeOptions) {
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = true;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    swiping.current = false;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - startX.current;
    const dy = endY - startY.current;
    // Only trigger if horizontal motion > vertical (not a scroll)
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    }
  }, [onSwipeLeft, onSwipeRight, threshold]);

  return { onTouchStart, onTouchEnd };
}

// ============================================================================
// LONG PRESS
// ============================================================================
interface LongPressOptions {
  onLongPress: () => void;
  delay?: number;
}

export function useLongPress({ onLongPress, delay = 500 }: LongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedRef = useRef(false);

  const start = useCallback(() => {
    pressedRef.current = true;
    timerRef.current = setTimeout(() => {
      if (pressedRef.current) {
        // Haptic feedback
        if ('vibrate' in navigator) navigator.vibrate(10);
        onLongPress();
      }
    }, delay);
  }, [onLongPress, delay]);

  const clear = useCallback(() => {
    pressedRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
  };
}

// ============================================================================
// HAPTIC FEEDBACK
// ============================================================================
export function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (!('vibrate' in navigator)) return;
  const patterns = { light: 10, medium: 20, heavy: 40 };
  navigator.vibrate(patterns[style]);
}
