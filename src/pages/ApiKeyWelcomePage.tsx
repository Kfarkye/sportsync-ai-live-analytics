import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getGatewayUrl, retrieveApiKey } from '@/services/sportsyncAccessService';
import SEOHead from '@/components/seo/SEOHead';

type RetrievalState = 'loading' | 'ready' | 'error';

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Source Serif 4', Georgia, serif",
};

const ApiKeyWelcomePage: React.FC = () => {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<RetrievalState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [retrievedKey, setRetrievedKey] = useState<string>('');
  const [plan, setPlan] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const sessionId = params.get('session_id');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!sessionId) {
        setStatus('error');
        setErrorMessage('Missing session_id in URL.');
        return;
      }

      try {
        const result = await retrieveApiKey(sessionId);
        if (cancelled) return;

        setRetrievedKey(result.key);
        setPlan(result.plan ?? 'pro');
        setEmail(result.email ?? '');
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not retrieve key.');
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const curlExample = useMemo(() => {
    if (!retrievedKey) return '';
    return `curl -H "x-api-key: ${retrievedKey}" "${getGatewayUrl()}?endpoint=consensus&league=nba&limit=1"`;
  }, [retrievedKey]);

  const copyKey = async () => {
    if (!retrievedKey) return;
    await navigator.clipboard.writeText(retrievedKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <SEOHead
        title="API Key Retrieval | The Drip"
        description="Retrieve your API key after checkout. This page displays your key once."
        canonicalPath="/welcome"
        robots="noindex,nofollow,noarchive"
      />
      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-[#EDECE8]">
        <div className="mx-auto w-full max-w-[920px] rounded-3xl border border-white/10 bg-[#111111] p-7">
        <h1 className="text-[42px] leading-[1.05] md:text-[54px]" style={sectionTitleStyle}>
          Welcome
        </h1>
        <p className="mt-3 text-[15px] text-[#B5B3AC]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', sans-serif" }}>
          Your API key is shown once. Copy it now. If you lose it, rotate from the key endpoint.
        </p>

        {status === 'loading' ? (
          <p className="mt-8 text-[14px] text-[#B5B3AC]">Retrieving key...</p>
        ) : null}

        {status === 'error' ? (
          <div className="mt-8 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 text-[14px] text-rose-200">
            {errorMessage || 'This key has already been retrieved or the session has expired.'}
          </div>
        ) : null}

        {status === 'ready' ? (
          <>
            <div className="mt-8 rounded-2xl border border-white/15 bg-[#0D0D0D] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#9E9C95]">API Key</p>
              <pre className="mt-2 overflow-x-auto text-[13px] text-[#ECEAE3]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>
{retrievedKey}
              </pre>
              <button
                type="button"
                onClick={copyKey}
                className="mt-3 rounded-lg border border-white/15 bg-[#171717] px-3 py-1.5 text-[12px] text-white transition hover:bg-[#202020]"
              >
                {copied ? 'Copied' : 'Copy Key'}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#9E9C95]">Plan</p>
                <p className="mt-1 text-[14px] text-[#ECEAE3]">{plan || 'pro'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0D0D0D] p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#9E9C95]">Email</p>
                <p className="mt-1 text-[14px] text-[#ECEAE3]">{email || 'not returned'}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-[#0D0D0D] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#9E9C95]">Get Started</p>
              <pre className="mt-2 overflow-x-auto text-[12px] text-[#DCDAD2]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>
{curlExample}
              </pre>
            </div>
          </>
        ) : null}
        </div>
      </div>
    </>
  );
};

export default ApiKeyWelcomePage;
