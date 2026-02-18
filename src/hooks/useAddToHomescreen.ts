/**
 * Add-to-Homescreen Prompt — Shows after 3rd visit
 */

import { useState, useEffect, useCallback } from 'react';

const VISIT_KEY = 'drip_visit_count';
const DISMISSED_KEY = 'drip_a2hs_dismissed';
const VISITS_BEFORE_PROMPT = 3;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useAddToHomescreen() {
  const [canPrompt, setCanPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Track visits
    const visits = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) + 1;
    localStorage.setItem(VISIT_KEY, String(visits));

    const dismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
    if (visits < VISITS_BEFORE_PROMPT || dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'dismissed') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
    setDeferredPrompt(null);
    setCanPrompt(false);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setCanPrompt(false);
    setDeferredPrompt(null);
  }, []);

  return { canPrompt, promptInstall, dismiss };
}
