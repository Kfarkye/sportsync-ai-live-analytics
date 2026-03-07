// ============================================================================
// TOAST SYSTEM — Obsidian Weissach
// ============================================================================
// Local, zero-dependency feedback layer.
// Maintains the same API surface used across the app.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ToastVariant = 'info' | 'success' | 'error' | 'action';

interface ToastEventPayload {
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastEntry extends ToastEventPayload {
  id: number;
}

interface ToastOptions {
  duration?: number;
}

type ToastFn = ((message: string, options?: ToastOptions) => void) & {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
};

const TOAST_EVENT = 'obsidian-toast-event';

const emitToast = (payload: ToastEventPayload): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastEventPayload>(TOAST_EVENT, { detail: payload }));
};

const queueToast = (message: string, variant: ToastVariant, duration = 3000): void => {
  emitToast({ message, variant, duration });
};

const toast = ((message: string, options?: ToastOptions) => {
  queueToast(message, 'info', options?.duration ?? 3000);
}) as ToastFn;

toast.success = (message: string, options?: ToastOptions) => {
  queueToast(message, 'success', options?.duration ?? 3000);
};

toast.error = (message: string, options?: ToastOptions) => {
  queueToast(message, 'error', options?.duration ?? 3000);
};

const baseStyle: React.CSSProperties = {
  background: '#111113',
  border: '1px solid rgba(255,255,255,0.06)',
  color: '#FAFAFA',
  fontFamily: 'Geist, system-ui, sans-serif',
  fontSize: '13px',
  fontWeight: 500,
  borderRadius: '12px',
  boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  padding: '12px 16px',
  lineHeight: '1.4',
  letterSpacing: '-0.01em',
};

const variantStyle: Record<ToastVariant, React.CSSProperties> = {
  info: {},
  success: {
    border: '1px solid rgba(52, 211, 153, 0.15)',
    boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 20px rgba(52,211,153,0.08)',
  },
  error: {
    border: '1px solid rgba(251, 113, 133, 0.15)',
    boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 20px rgba(251,113,133,0.08)',
  },
  action: {},
};

/**
 * ObsidianToaster — Drop into AppShell root.
 * Styled to match ESSENCE dark surface tokens.
 */
export const ObsidianToaster = () => {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextIdRef = useRef(1);
  const timeoutIdsRef = useRef<number[]>([]);

  const removeToast = useCallback((id: number) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastEventPayload>).detail;
      if (!detail || !detail.message) return;

      const id = nextIdRef.current++;
      setEntries((prev) => [...prev, { ...detail, id }]);

      const timeoutId = window.setTimeout(() => removeToast(id), Math.max(800, detail.duration || 3000));
      timeoutIdsRef.current.push(timeoutId);
    };

    window.addEventListener(TOAST_EVENT, onToast as EventListener);

    return () => {
      window.removeEventListener(TOAST_EVENT, onToast as EventListener);
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
    };
  }, [removeToast]);

  const containerClass = useMemo(
    () =>
      'fixed bottom-20 left-1/2 z-[120] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 pointer-events-none',
    []
  );

  return (
    <div className={containerClass} aria-live="polite" aria-atomic="false">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto"
          role="status"
          style={{ ...baseStyle, ...variantStyle[entry.variant] }}
        >
          {entry.message}
        </div>
      ))}
    </div>
  );
};

// --- Pre-configured toast helpers matching Obsidian semantics ---

export const obsidianToast = {
  /** Generic info toast */
  info: (message: string) => toast(message),

  /** Success — emerald accent */
  success: (message: string) => toast.success(message),

  /** Error — rose accent */
  error: (message: string) => toast.error(message),

  /** Action confirmation — pin, copy, etc */
  action: (message: string) => queueToast(message, 'action', 2000),
};

export { toast };
export default ObsidianToaster;
