/**
 * Intersection Observer Hook — Lazy Card Rendering
 * Only renders cards visible in viewport + 1 screen buffer
 */

import { useRef, useState, useEffect, useCallback } from 'react';

interface UseIntersectionOptions {
  rootMargin?: string;
  threshold?: number;
}

export function useIntersectionObserver(options: UseIntersectionOptions = {}) {
  const { rootMargin = '100% 0px', threshold = 0 } = options;
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const hasBeenVisible = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          hasBeenVisible.current = true;
        } else if (hasBeenVisible.current) {
          // Keep rendered once visible (prevents re-mount thrashing)
          // Only hide if far out of viewport
          setIsVisible(false);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return { ref, isVisible: isVisible || hasBeenVisible.current };
}

/**
 * Virtualized list helper — returns which indices should render
 */
export function useVirtualizedList(totalItems: number, itemHeight: number = 80) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.min(20, totalItems) });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewportHeight = el.clientHeight;
    const buffer = viewportHeight; // 1 screen buffer

    const start = Math.max(0, Math.floor((scrollTop - buffer) / itemHeight));
    const end = Math.min(totalItems, Math.ceil((scrollTop + viewportHeight + buffer) / itemHeight));

    setVisibleRange(prev => {
      if (prev.start === start && prev.end === end) return prev;
      return { start, end };
    });
  }, [totalItems, itemHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return { containerRef, visibleRange };
}
