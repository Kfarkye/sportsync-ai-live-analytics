import React, { useMemo, useState } from 'react';
import { createCheckoutSession, getGatewayUrl } from '@/services/sportsyncAccessService';
import SEOHead from '@/components/seo/SEOHead';

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Source Serif 4', Georgia, serif",
};

const bodyFontStyle: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', sans-serif",
};

const monoFontStyle: React.CSSProperties = {
  fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace",
};

const LAYERS = [
  {
    id: '01',
    title: 'Track The Live Move',
    description:
      'Pull live score, clock, odds, and recent events continuously. Measure line movement against the pregame number and keep state in sync every cycle.',
  },
  {
    id: '02',
    title: 'Test It With Math',
    description:
      'Run deterministic checks against pace, efficiency, and shot quality. Flag moves that are supported by game conditions and isolate moves that look stretched.',
  },
  {
    id: '03',
    title: 'Explain The Driver',
    description:
      'Read play-by-play and leaders to explain what changed: momentum, foul pressure, injuries, rotation shifts, or shooting variance.',
  },
];

const DECISION_SURFACES = [
  'Pressure Score',
  'Flow Score',
  'Wall Quality',
  'Toxicity',
  'Reversion',
  'Breakout',
];

const ENDPOINT_ROWS = [
  { endpoint: 'scores', access: 'Free', notes: 'live score and status' },
  { endpoint: 'lines', access: 'Free', notes: 'opening and current lines' },
  { endpoint: 'trends', access: 'Free', notes: 'team and market trend profile' },
  { endpoint: 'intel', access: 'Pro', notes: 'match-level context layer' },
  { endpoint: 'consensus', access: 'Pro', notes: 'market consensus surface' },
  { endpoint: 'kalshi_live', access: 'Pro', notes: 'live prediction-market pricing' },
  { endpoint: 'signals', access: 'Pro', notes: 'decision-state outputs' },
];

const evidencePacketExample = JSON.stringify(
  {
    match: { id: '401810862_ncaamb', league: 'NCAAB', status: 'live' },
    scoreboard: { home: 35, away: 32, period: '1H', clock: '4:22', freshness_seconds: 8 },
    market: { live_total: 157.5, open_total: 160.5, movement_total: -3.0 },
    market_structure: {
      trigger_window: { corridor_width_points: 7.5 },
      clob_repricing: { delta_open_to_latest: 0.064, coverage_grade: 'usable' },
    },
    answerability: {
      can_answer_scoreboard: true,
      can_answer_top_scorer: true,
      can_answer_recent_events: true,
      can_answer_market_movement: true,
    },
    events: [{ t: '4:22', text: 'Foul on Jordan Pope' }],
    packet_meta: { as_of: '2026-03-19T23:12:04Z', freshness_seconds: 8 },
  },
  null,
  2,
);

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(trimmed) ? trimmed : null;
}

const SportsyncApiLandingPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const gatewayUrl = getGatewayUrl();

  const curlExamples = useMemo(
    () => ({
      scoreboard: `curl "${gatewayUrl}?endpoint=scores&league=ncaab&limit=1"`,
      context: `curl -H "x-api-key: ssk_..." "${gatewayUrl}?endpoint=intel&league=ncaab&limit=1"`,
    }),
    [gatewayUrl],
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
        title="Track The Game Behind The Line | SportsSync API"
        description="We track the game behind the line. As the market moves, we follow the game, test the move against the numbers, and show what is driving the odds."
        canonicalPath="/sportsync"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'SportsSync API',
          url: 'https://thedrip.bet/sportsync',
          description:
            'We track the game behind the line. As the market moves, we follow the game, test the move against the numbers, and show what is driving the odds.',
        }}
      />

      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-[#EDECE8]">
        <div className="mx-auto w-full max-w-[920px]">
          <header className="border-b border-white/10 pb-9">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9E9C95]" style={monoFontStyle}>
              Sportsync API
            </p>
            <h1 className="mt-2 text-[46px] leading-[1.03] md:text-[58px]" style={sectionTitleStyle}>
              Track The Game Behind The Line.
            </h1>
            <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-[#B5B3AC]" style={bodyFontStyle}>
              As the market moves, we follow the game, check the line against the numbers, and show what is driving
              the odds. Live tracking, deterministic math, and contextual explanation in one system.
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

          <section className="mt-10">
            <h2 className="text-[32px]" style={sectionTitleStyle}>
              How It Works
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {LAYERS.map((layer) => (
                <article key={layer.id} className="rounded-2xl border border-white/10 bg-[#111111] p-5">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#8F8D87]" style={monoFontStyle}>
                    Layer {layer.id}
                  </p>
                  <h3 className="mt-2 text-[23px] leading-tight" style={sectionTitleStyle}>
                    {layer.title}
                  </h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-[#B5B3AC]" style={bodyFontStyle}>
                    {layer.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-10 grid gap-5 md:grid-cols-[1.12fr_0.88fr]">
            <article className="rounded-2xl border border-white/10 bg-[#111111] p-5">
              <h2 className="text-[30px]" style={sectionTitleStyle}>
                Trusted Match Packet
              </h2>
              <p className="mt-2 text-[14px] text-[#B5B3AC]" style={bodyFontStyle}>
                One packet per game. Score, movement, context, answerability flags, and freshness in a single read.
              </p>
              <pre
                className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-[#0D0D0D] p-4 text-[12px] leading-relaxed text-[#DCDAD2]"
                style={monoFontStyle}
              >
{evidencePacketExample}
              </pre>
            </article>

            <article className="rounded-2xl border border-white/10 bg-[#111111] p-5">
              <h2 className="text-[30px]" style={sectionTitleStyle}>
                Decision Surfaces
              </h2>
              <p className="mt-2 text-[14px] text-[#B5B3AC]" style={bodyFontStyle}>
                We reduce noisy feeds into decision states that can be acted on quickly.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {DECISION_SURFACES.map((item) => (
                  <div
                    key={item}
                    className="rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-[12px] text-[#DCDAD2]"
                    style={monoFontStyle}
                  >
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-[#D2A74B]/35 bg-[#15120A] p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#D2A74B]" style={monoFontStyle}>
                  Live Query
                </p>
                <pre className="mt-2 overflow-x-auto text-[11px] text-[#E8D8B2]" style={monoFontStyle}>
{curlExamples.scoreboard}
                </pre>
                <pre className="mt-2 overflow-x-auto text-[11px] text-[#E8D8B2]" style={monoFontStyle}>
{curlExamples.context}
                </pre>
              </div>
            </article>
          </section>

          <section className="mt-10">
            <h2 className="text-[32px]" style={sectionTitleStyle}>
              Endpoint Surface
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full border-collapse text-left">
                <thead className="bg-[#111111] text-[12px] text-[#B5B3AC]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Endpoint</th>
                    <th className="px-4 py-3 font-medium">Access</th>
                    <th className="px-4 py-3 font-medium">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINT_ROWS.map((row) => (
                    <tr key={row.endpoint} className="border-t border-white/10 text-[13px]">
                      <td className="px-4 py-3" style={monoFontStyle}>
                        {row.endpoint}
                      </td>
                      <td className="px-4 py-3">{row.access}</td>
                      <td className="px-4 py-3 text-[#B5B3AC]">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-[32px]" style={sectionTitleStyle}>
              Pricing
            </h2>
            <div className="mt-3 rounded-2xl border border-white/10 bg-[#111111] p-5">
              <p className="text-[24px]" style={sectionTitleStyle}>
                $149/mo
              </p>
              <p className="mt-2 text-[14px] text-[#B5B3AC]" style={bodyFontStyle}>
                50K requests per day. Cancel anytime. Free data stays open, premium market context is gated.
              </p>
            </div>
          </section>

          <footer className="mt-12 border-t border-white/10 py-5 text-[12px] text-[#8D8B84]" style={monoFontStyle}>
            SportsSync API
          </footer>
        </div>
      </div>
    </>
  );
};

export default SportsyncApiLandingPage;
