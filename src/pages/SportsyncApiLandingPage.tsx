import React, { useEffect, useMemo, useState } from 'react';
import { createCheckoutSession, getGatewayUrl } from '@/services/sportsyncAccessService';
import SEOHead from '@/components/seo/SEOHead';

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Source Serif 4', Georgia, serif",
};

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(trimmed) ? trimmed : null;
}

const ENDPOINT_ROWS = [
  { endpoint: 'scores', access: 'Free', notes: 'league, status, date' },
  { endpoint: 'lines', access: 'Free', notes: 'sport, league' },
  { endpoint: 'trends', access: 'Free', notes: 'league, min sample size' },
  { endpoint: 'picks', access: 'Free', notes: "today's picks" },
  { endpoint: 'logos', access: 'Free', notes: 'league' },
  { endpoint: 'splits_ou', access: 'Free', notes: 'team O/U profile' },
  { endpoint: 'splits_ats', access: 'Free', notes: 'team ATS profile' },
  { endpoint: 'intel', access: 'Pro', notes: 'match-level context' },
  { endpoint: 'consensus', access: 'Pro', notes: 'market consensus view' },
  { endpoint: 'fair_line', access: 'Pro', notes: 'ESPN fair line' },
  { endpoint: 'kalshi', access: 'Pro', notes: 'Kalshi curve' },
  { endpoint: 'kalshi_live', access: 'Pro', notes: 'live Kalshi prices' },
  { endpoint: 'signals', access: 'Pro', notes: 'proprietary signals' },
];

const SportsyncApiLandingPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [exampleJson, setExampleJson] = useState<string>('Loading sample response...');

  useEffect(() => {
    let cancelled = false;

    const loadExample = async () => {
      try {
        const response = await fetch(`${getGatewayUrl()}?endpoint=scores&league=nba&limit=1`);
        const payload = await response.json();
        if (!cancelled) {
          setExampleJson(JSON.stringify(payload, null, 2));
        }
      } catch {
        if (!cancelled) {
          setExampleJson(
            JSON.stringify(
              {
                endpoint: 'scores',
                count: 1,
                data: [
                  {
                    league: 'nba',
                    home_team_name: 'Los Angeles Lakers',
                    away_team_name: 'Denver Nuggets',
                    status: 'scheduled',
                  },
                ],
              },
              null,
              2,
            ),
          );
        }
      }
    };

    void loadExample();

    return () => {
      cancelled = true;
    };
  }, []);

  const curlExample = useMemo(
    () => `curl "${getGatewayUrl()}?endpoint=scores&league=nba&limit=1"`,
    [],
  );

  const handleCheckout = async () => {
    const validEmail = normalizeEmail(email);
    if (!validEmail) {
      setCheckoutError('Enter a valid email to continue.');
      return;
    }

    setCheckoutError(null);
    setIsCheckoutLoading(true);

    try {
      const checkoutUrl = await createCheckoutSession('api', validEmail);
      window.location.href = checkoutUrl;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Could not open checkout.');
      setIsCheckoutLoading(false);
    }
  };

  return (
    <>
      <SEOHead
        title="SportsSync API Pricing and Access | The Drip"
        description="SportsSync API gives you scores, opening lines, and trend data in one endpoint pattern. Start with free endpoints and unlock premium consensus data."
        canonicalPath="/sportsync"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'SportsSync API',
          url: 'https://thedrip.bet/sportsync',
          description:
            'SportsSync API gives you scores, opening lines, and trend data in one endpoint pattern. Start with free endpoints and unlock premium consensus data.',
        }}
      />
      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-[#EDECE8]">
        <div className="mx-auto w-full max-w-[920px]">
        <header className="border-b border-white/10 pb-9">
          <h1 className="text-[46px] leading-[1.03] md:text-[58px]" style={sectionTitleStyle}>
            Sports data. Every game. Every league. One API.
          </h1>
          <p className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-[#B5B3AC]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', sans-serif" }}>
            Scores and trends are open. Consensus and fair-line data are gated. Use one endpoint pattern and pull what you need.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-xl border border-white/20 bg-[#121212] px-4 text-[14px] text-white outline-none placeholder:text-[#7D7C76] focus:border-white/40"
            />
            <button
              type="button"
              onClick={handleCheckout}
              disabled={isCheckoutLoading}
              className="h-11 rounded-xl bg-[#D2A74B] px-5 text-[14px] font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {isCheckoutLoading ? 'Opening Checkout...' : 'Get Your API Key - $149/mo'}
            </button>
          </div>
          {checkoutError ? <p className="mt-3 text-[13px] text-[#FF9D88]">{checkoutError}</p> : null}
          <a href="/sportsync/docs" className="mt-4 inline-block text-[13px] text-[#D2A74B] hover:text-[#E2BF72]">
            Read API Docs
          </a>
        </header>

        <section className="mt-9 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-[#111111] p-5">
            <h2 className="text-[24px]" style={sectionTitleStyle}>16K+ games</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#B5B3AC]">Live and scheduled scores across leagues.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#111111] p-5">
            <h2 className="text-[24px]" style={sectionTitleStyle}>Opening lines</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#B5B3AC]">DraftKings and market open snapshots.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#111111] p-5">
            <h2 className="text-[24px]" style={sectionTitleStyle}>Trend intelligence</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#B5B3AC]">O/U splits, ATS profile, and game context.</p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Example Response</h2>
          <p className="mt-2 text-[14px] text-[#B5B3AC]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>{curlExample}</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#111111] p-4 text-[12px] leading-relaxed text-[#DCDAD2]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>
{exampleJson}
          </pre>
        </section>

        <section className="mt-10">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Pricing</h2>
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111111] p-5">
            <p className="text-[22px]" style={sectionTitleStyle}>$149/mo</p>
            <p className="mt-2 text-[14px] text-[#B5B3AC]">50K requests per day. All endpoints. Cancel anytime.</p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Endpoints</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#111111] text-[12px] text-[#B5B3AC]">
                <tr>
                  <th className="px-4 py-3 font-medium">Endpoint</th>
                  <th className="px-4 py-3 font-medium">Access</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINT_ROWS.map((row) => (
                  <tr key={row.endpoint} className="border-t border-white/10 text-[13px]">
                    <td className="px-4 py-3" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>{row.endpoint}</td>
                    <td className="px-4 py-3">{row.access}</td>
                    <td className="px-4 py-3 text-[#B5B3AC]">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-12 border-t border-white/10 py-5 text-[12px] text-[#8D8B84]">
          SportsSync API
        </footer>
        </div>
      </div>
    </>
  );
};

export default SportsyncApiLandingPage;
