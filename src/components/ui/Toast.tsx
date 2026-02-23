// ============================================================================
// TOAST SYSTEM — Obsidian Weissach
// ============================================================================
// Global feedback layer using Sonner.
// Every user action deserves tactile confirmation.
//
// Linear's principle: "When you touch an element, it lifts up slightly,
// providing a quick pulse of feedback."
// ============================================================================

import { Toaster as SonnerToaster, toast } from 'sonner';
import React from 'react';

/**
 * ObsidianToaster — Drop into AppShell root.
 * Styled to match ESSENCE dark surface tokens.
 */
export const ObsidianToaster = () => (
  <SonnerToaster
    position="bottom-center"
    offset={80}
    gap={8}
    toastOptions={{
      duration: 3000,
      className: 'obsidian-toast',
      style: {
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
      },
    }}
  />
);

// --- Pre-configured toast helpers matching Obsidian semantics ---

export const obsidianToast = {
  /** Generic info toast */
  info: (message: string) => toast(message),

  /** Success — emerald accent */
  success: (message: string) => toast.success(message, {
    style: {
      background: '#111113',
      border: '1px solid rgba(52, 211, 153, 0.15)',
      color: '#FAFAFA',
      fontFamily: 'Geist, system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: 500,
      borderRadius: '12px',
      boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 20px rgba(52,211,153,0.08)',
    },
  }),

  /** Error — rose accent */
  error: (message: string) => toast.error(message, {
    style: {
      background: '#111113',
      border: '1px solid rgba(251, 113, 133, 0.15)',
      color: '#FAFAFA',
      fontFamily: 'Geist, system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: 500,
      borderRadius: '12px',
      boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 20px rgba(251,113,133,0.08)',
    },
  }),

  /** Action confirmation — pin, copy, etc */
  action: (message: string) => toast(message, {
    duration: 2000,
    style: {
      background: '#111113',
      border: '1px solid rgba(255,255,255,0.06)',
      color: '#FAFAFA',
      fontFamily: 'Geist, system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: 500,
      borderRadius: '12px',
      boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7)',
    },
  }),
};

export { toast };
export default ObsidianToaster;
