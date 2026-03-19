import React from 'react';
import { getApiKeysUrl, getGatewayUrl } from '@/services/sportsyncAccessService';
import SEOHead from '@/components/seo/SEOHead';

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Source Serif 4', Georgia, serif",
};

const gatewayUrl = getGatewayUrl();
const apiKeysUrl = getApiKeysUrl();

const endpointDocs = [
  { name: 'Scores', endpoint: 'scores', query: 'league=nba', premium: false },
  { name: 'Lines', endpoint: 'lines', query: 'league=nba', premium: false },
  { name: 'Trends', endpoint: 'trends', query: 'league=nba&min_sample_size=20', premium: false },
  { name: 'Picks', endpoint: 'picks', query: '', premium: false },
  { name: 'Logos', endpoint: 'logos', query: 'league=nba', premium: false },
  { name: 'Splits O/U', endpoint: 'splits_ou', query: 'league=nba', premium: false },
  { name: 'Splits ATS', endpoint: 'splits_ats', query: 'league=nba', premium: false },
  { name: 'Intel', endpoint: 'intel', query: 'league=nba', premium: true },
  { name: 'Consensus', endpoint: 'consensus', query: 'league=nba', premium: true },
  { name: 'Fair Line', endpoint: 'fair_line', query: 'league=nba', premium: true },
  { name: 'Kalshi', endpoint: 'kalshi', query: 'league=nba', premium: true },
  { name: 'Kalshi Live', endpoint: 'kalshi_live', query: 'league=nba', premium: true },
  { name: 'Signals', endpoint: 'signals', query: 'league=nba', premium: true },
];

const SportsyncApiDocsPage: React.FC = () => {
  return (
    <>
      <SEOHead
        title="SportsSync API Documentation | The Drip"
        description="Authentication, endpoint reference, curl examples, key management, and error responses for SportsSync API."
        canonicalPath="/sportsync/docs"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'SportsSync API Documentation',
          url: 'https://thedrip.bet/sportsync/docs',
          description:
            'Authentication, endpoint reference, curl examples, key management, and error responses for SportsSync API.',
        }}
      />
      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-[#EDECE8]">
        <div className="mx-auto w-full max-w-[920px]">
        <header className="border-b border-white/10 pb-8">
          <h1 className="text-[46px] leading-[1.03] md:text-[58px]" style={sectionTitleStyle}>
            API Documentation
          </h1>
          <p className="mt-3 text-[15px] text-[#B5B3AC]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', sans-serif" }}>
            One gateway endpoint. Select data with the <code className="font-mono">endpoint</code> query param.
          </p>
        </header>

        <section className="mt-9">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Authentication</h2>
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111111] p-4 text-[13px] leading-relaxed text-[#DCDAD2]">
            <p><code style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>x-api-key: your_key_here</code></p>
            <p className="mt-2">Free endpoints work without a key and are rate limited by IP.</p>
            <p>Premium endpoints require a Pro key.</p>
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Endpoints</h2>
          <div className="mt-4 space-y-4">
            {endpointDocs.map((item) => {
              const endpointUrl = `${gatewayUrl}?endpoint=${item.endpoint}${item.query ? `&${item.query}` : ''}`;
              const curl = item.premium
                ? `curl -H "x-api-key: ssk_..." "${endpointUrl}"`
                : `curl "${endpointUrl}"`;

              return (
                <article key={item.endpoint} className="rounded-2xl border border-white/10 bg-[#111111] p-4">
                  <p className="text-[18px]" style={sectionTitleStyle}>{item.name}</p>
                  <p className="mt-1 text-[13px] text-[#B5B3AC]">
                    GET <span style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>/functions/v1/api?endpoint={item.endpoint}</span>
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#0D0D0D] p-3 text-[12px] text-[#DCDAD2]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>
{curl}
                  </pre>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Key Management</h2>
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111111] p-4 text-[13px] leading-relaxed text-[#DCDAD2]" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>
            <p>Rotate: POST {apiKeysUrl}?action=rotate</p>
            <p>Revoke: POST {apiKeysUrl}?action=revoke</p>
            <p>List: GET {apiKeysUrl}?action=list</p>
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Rate Limits</h2>
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111111] p-4 text-[13px] leading-relaxed text-[#DCDAD2]">
            <p>Pro: 30/min, 50K/day</p>
            <p className="mt-1">Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Daily-Remaining, Retry-After</p>
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-[32px]" style={sectionTitleStyle}>Errors</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full border-collapse">
              <thead className="bg-[#111111] text-left text-[12px] text-[#B5B3AC]">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Body</th>
                </tr>
              </thead>
              <tbody className="text-[13px] text-[#DCDAD2]">
                <tr className="border-t border-white/10">
                  <td className="px-4 py-3">401</td>
                  <td className="px-4 py-3" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>{'{"error":"missing_api_key"}'}</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-4 py-3">403</td>
                  <td className="px-4 py-3" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>{'{"error":"plan_upgrade_required"}'}</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-4 py-3">429</td>
                  <td className="px-4 py-3" style={{ fontFamily: "'SF Mono', Menlo, 'JetBrains Mono', monospace" }}>{'{"error":"rate_limited","retry_after":45}'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        </div>
      </div>
    </>
  );
};

export default SportsyncApiDocsPage;
