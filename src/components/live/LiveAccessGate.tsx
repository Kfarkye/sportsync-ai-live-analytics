import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createCheckoutSession, retrieveApiKey, validateGatewayKey } from '@/services/sportsyncAccessService';

const DRIP_API_KEY_STORAGE = 'drip_api_key';

type AccessState = 'checking' | 'retrieving' | 'authorized' | 'locked' | 'redirecting' | 'error';

type Props = {
  children: React.ReactNode;
};

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(trimmed) ? trimmed : null;
}

export const LiveAccessGate: React.FC<Props> = ({ children }) => {
  const location = useLocation();
  const [state, setState] = useState<AccessState>('checking');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionId = useMemo(
    () => new URLSearchParams(location.search).get('session_id'),
    [location.search],
  );

  useEffect(() => {
    let isCancelled = false;

    const checkAccess = async () => {
      setErrorMessage(null);

      try {
        if (sessionId) {
          setState('retrieving');
          const result = await retrieveApiKey(sessionId);
          localStorage.setItem(DRIP_API_KEY_STORAGE, result.key);

          const cleanPath = location.pathname || '/live';
          window.history.replaceState({}, '', cleanPath);
        }

        const storedKey = localStorage.getItem(DRIP_API_KEY_STORAGE);
        if (!storedKey) {
          if (!isCancelled) setState('locked');
          return;
        }

        setState('checking');
        const isValid = await validateGatewayKey(storedKey);
        if (!isValid) {
          localStorage.removeItem(DRIP_API_KEY_STORAGE);
          if (!isCancelled) {
            setState('locked');
            setErrorMessage('Your live key is no longer active. Start Live to continue.');
          }
          return;
        }

        if (!isCancelled) setState('authorized');
      } catch (error) {
        if (!isCancelled) {
          setState('error');
          setErrorMessage(error instanceof Error ? error.message : 'Live access check failed.');
        }
      }
    };

    void checkAccess();

    return () => {
      isCancelled = true;
    };
  }, [location.pathname, sessionId]);

  const startCheckout = async () => {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setErrorMessage('Enter a valid email to start Live.');
      return;
    }

    setErrorMessage(null);
    setState('redirecting');

    try {
      const checkoutUrl = await createCheckoutSession('drip', normalized);
      window.location.href = checkoutUrl;
    } catch (error) {
      setState('locked');
      setErrorMessage(error instanceof Error ? error.message : 'Could not start checkout.');
    }
  };

  if (state === 'authorized') {
    return <>{children}</>;
  }

  const busy = state === 'checking' || state === 'retrieving' || state === 'redirecting';

  return (
    <div className="mx-auto mt-4 w-full max-w-[920px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_50px_-36px_rgba(15,23,42,0.45)]">
      <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live Access</p>
          <h2
            className="mt-2 text-[34px] leading-[1.05] text-slate-900"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            In-game intelligence. Updated every play.
          </h2>
          <p className="mt-3 max-w-[42ch] text-[14px] leading-relaxed text-slate-600">
            LIVE requires an active plan. Start Live for $200/mo. Cancel anytime.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[12px] font-semibold text-slate-700">What you get</p>
            <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
              <li>Real-time matchup trends</li>
              <li>Live market snapshots</li>
              <li>Cash-out context in-game</li>
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-[#FAFAF7] p-5">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500" htmlFor="live-email">
            Email
          </label>
          <input
            id="live-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none focus:border-slate-500"
          />

          <button
            type="button"
            onClick={startCheckout}
            disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === 'redirecting' ? 'Opening Checkout...' : 'Start Live'}
          </button>

          <p className="mt-2 text-[12px] text-slate-500">
            Returning from checkout? This page will unlock automatically.
          </p>

          {busy ? (
            <p className="mt-4 text-[12px] text-slate-600">
              {state === 'retrieving' ? 'Retrieving your key...' : 'Checking your access...'}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LiveAccessGate;
