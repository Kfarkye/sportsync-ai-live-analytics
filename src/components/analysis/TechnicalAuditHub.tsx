import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/essence';

// ════════════════════════════════════════════════════════════════════════════
// TECHNICAL AUDIT HUB — Obsidian Weissach v7
// ════════════════════════════════════════════════════════════════════════════
// Visual: Glass morphism on obsidian. Emerald signals. Data-first density.
// Typography: Instrument Sans (prose), SF Mono (data).
// Principle: Every element earned. No decoration without function.
// ════════════════════════════════════════════════════════════════════════════

// ── Type Definitions ──────────────────────────────────────────────────────

type VeracityGrade = 'AAA' | 'AA' | 'A' | 'B' | 'FAIL';
type CtaTier = 'EXECUTE_ARBITRAGE' | 'VIEW_TECHNICAL_AUDIT' | 'MONITOR_MARKET_FLUX';

interface PinnacleSnapshot {
    spread: number;
    moneyline: number;
    total: number;
    timestamp: string;
}

interface PredictionMarketSnapshot {
    probability: number;
    volume: number;
    contract_price: number;
    timestamp: string;
}

interface EvidenceSnapshot {
    pinnacle: PinnacleSnapshot | null;
    polymarket: PredictionMarketSnapshot | null;
    kalshi: PredictionMarketSnapshot | null;
    resolution_logic: string;
    captured_at: string;
}

interface TechnicalAuditData {
    audit_id: string;
    internal_id: string;
    game_state_engine: string;
    market_dislocation_pts: number;
    data_veracity: number;
    sync_latency_ms: number;
    veracity_grade: VeracityGrade;
    kernel_trace: string;
    evidence_snapshot: EvidenceSnapshot;
    resolution_logic: string;
    source_url: string;
    generated_at: string;
}

interface PlatformOddsRow {
    id: string;
    internal_id: string;
    platform: string;
    market_type: string;
    price: number;
    implied_probability: number | null;
    volume: number | null;
    affiliate_url: string | null;
    fetched_at: string;
}

interface CanonicalEvent {
    internal_id: string;
    home_team: string | null;
    away_team: string | null;
    sport: string | null;
    league: string | null;
    event_date: string | null;
}

// ── Design Tokens ─────────────────────────────────────────────────────────

const T = {
    // Surfaces
    base: '#09090b',
    surface: 'rgba(24,24,27,0.60)',
    surfaceBorder: 'rgba(63,63,70,0.25)',
    surfaceHover: 'rgba(39,39,42,0.50)',

    // Typography
    primary: '#fafafa',
    secondary: '#a1a1aa',
    tertiary: '#52525b',
    muted: '#3f3f46',
    ghost: '#27272a',

    // Signals
    emerald: '#34d399',
    emeraldDim: 'rgba(52,211,153,0.08)',
    amber: '#f59e0b',
    red: '#ef4444',
    redDim: 'rgba(239,68,68,0.08)',

    // Layout
    radius: 12,
    radiusSm: 8,
    panelPad: 20,
    gap: 12,

    // Fonts
    mono: "'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace",
    sans: "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

const glassPanel: React.CSSProperties = {
    background: T.surface,
    backdropFilter: 'blur(24px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
    border: `1px solid ${T.surfaceBorder}`,
    borderRadius: T.radius,
};

const sectionLabel: React.CSSProperties = {
    fontFamily: T.mono,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: T.tertiary,
};

// ── Domain Logic ──────────────────────────────────────────────────────────

function getCtaTier(pts: number): CtaTier {
    if (pts > 5.0) return 'EXECUTE_ARBITRAGE';
    if (pts > 2.5) return 'VIEW_TECHNICAL_AUDIT';
    return 'MONITOR_MARKET_FLUX';
}

function calcGrade(score: number): VeracityGrade {
    if (score >= 95) return 'AAA';
    if (score >= 85) return 'AA';
    if (score >= 70) return 'A';
    if (score >= 50) return 'B';
    return 'FAIL';
}

function fmtOdds(price: number, type: string): string {
    if (type === 'contract_yes' || type === 'contract_no') return `${(price * 100).toFixed(0)}¢`;
    if (type === 'moneyline') return price > 0 ? `+${price}` : `${price}`;
    if (type === 'spread') return price > 0 ? `+${price.toFixed(1)}` : price.toFixed(1);
    return price.toFixed(1);
}

function fmtProb(p: number | null): string {
    if (p === null || p === undefined) return '—';
    return `${(p * 100).toFixed(1)}%`;
}

function fmtVol(v: number | null): string {
    if (v === null || v === undefined) return '—';
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
}

function fmtTimeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Platform Registry ─────────────────────────────────────────────────────

const PLATFORMS: Record<string, { label: string; accent: string; tag: string }> = {
    pinnacle: { label: 'Pinnacle', accent: '#f59e0b', tag: 'SHARP' },
    polymarket: { label: 'Polymarket', accent: '#818cf8', tag: 'CROWD' },
    kalshi: { label: 'Kalshi', accent: '#34d399', tag: 'CROWD' },
    draftkings: { label: 'DraftKings', accent: '#22d3ee', tag: 'BOOK' },
    fanduel: { label: 'FanDuel', accent: '#60a5fa', tag: 'BOOK' },
    robinhood: { label: 'Robinhood', accent: '#4ade80', tag: 'PRED' },
    bet365: { label: 'Bet365', accent: '#127e5e', tag: 'GLOBAL' },
    betfair: { label: 'Betfair', accent: '#ffb80c', tag: 'EXCH' },
    stake: { label: 'Stake', accent: '#607d8b', tag: 'CRYPTO' },
};

const GRADE_MAP: Record<VeracityGrade, { color: string; bg: string; ring: string }> = {
    AAA: { color: '#34d399', bg: 'rgba(52,211,153,0.06)', ring: 'rgba(52,211,153,0.20)' },
    AA: { color: '#6ee7b7', bg: 'rgba(110,231,183,0.05)', ring: 'rgba(110,231,183,0.14)' },
    A: { color: '#facc15', bg: 'rgba(250,204,21,0.05)', ring: 'rgba(250,204,21,0.10)' },
    B: { color: '#fb923c', bg: 'rgba(251,146,60,0.05)', ring: 'rgba(251,146,60,0.10)' },
    FAIL: { color: '#f87171', bg: 'rgba(248,113,113,0.05)', ring: 'rgba(248,113,113,0.10)' },
};

const SORT_ORDER: Record<string, number> = { SHARP: 0, CROWD: 1, PRED: 2, BOOK: 3 };

// ════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

// ── Dislocation Gauge ─────────────────────────────────────────────────────

function DislocationGauge({ pts }: { pts: number }) {
    const tier = getCtaTier(pts);
    const isHot = tier === 'EXECUTE_ARBITRAGE';
    const isWarm = tier === 'VIEW_TECHNICAL_AUDIT';
    const signalColor = isHot ? T.red : isWarm ? T.emerald : T.tertiary;
    const pct = Math.min(Math.abs(pts) / 10, 1);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', width: 120, height: 4, borderRadius: 2, background: T.ghost, overflow: 'hidden' }}>
                <div
                    style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${pct * 100}%`,
                        background: `linear-gradient(90deg, ${signalColor}88, ${signalColor})`,
                        borderRadius: 2,
                        transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                        boxShadow: isHot ? `0 0 12px ${signalColor}40` : 'none',
                    }}
                />
                {/* 2.5pt threshold marker */}
                <div style={{ position: 'absolute', left: '25%', top: -2, bottom: -2, width: 1, background: T.muted }} />
                {/* 5pt threshold marker */}
                <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: T.muted }} />
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 700, color: signalColor, letterSpacing: -0.5 }}>
                {pts > 0 ? '+' : ''}{pts.toFixed(1)}
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.tertiary, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                pts
            </span>
        </div>
    );
}

// ── Veracity Badge ────────────────────────────────────────────────────────

function VeracityBadge({ score, grade, latencyMs }: { score: number; grade: VeracityGrade; latencyMs: number }) {
    const g = GRADE_MAP[grade] || GRADE_MAP.FAIL;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
                style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: g.bg,
                    border: `1px solid ${g.ring}`,
                    fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: g.color,
                    letterSpacing: 1,
                }}
            >
                {grade}
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.secondary }}>
                {score.toFixed(1)}
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                {latencyMs}ms
            </span>
        </div>
    );
}

// ── Affiliate Link (enforces rel="sponsored" globally) ────────────────────

function AffLink({ href, platform, children }: { href: string; platform: string; children: React.ReactNode }) {
    const [hover, setHover] = useState(false);
    const meta = PLATFORMS[platform] || { accent: T.tertiary };

    return (
        <a
            href={href}
            rel="sponsored noopener"
            target="_blank"
            data-platform={platform}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                color: hover ? meta.accent : T.secondary,
                textDecoration: 'none',
                transition: 'color 0.15s ease',
                cursor: 'pointer',
            }}
        >
            {children}
        </a>
    );
}

// ── Odds Row ──────────────────────────────────────────────────────────────

function OddsRow({ odd, isLast }: { odd: PlatformOddsRow; isLast: boolean }) {
    const [hover, setHover] = useState(false);
    const meta = PLATFORMS[odd.platform] || { label: odd.platform, accent: T.tertiary, tag: '—' };

    return (
        <div
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 0.7fr 0.65fr 0.65fr 0.65fr 0.5fr',
                alignItems: 'center',
                padding: '10px 16px',
                borderBottom: isLast ? 'none' : `1px solid ${T.ghost}`,
                background: hover ? T.surfaceHover : 'transparent',
                transition: 'background 0.12s ease',
            }}
        >
            {/* Platform */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 3, height: 16, borderRadius: 1.5, background: meta.accent, opacity: 0.7 }} />
                <AffLink href={odd.affiliate_url || '#'} platform={odd.platform}>
                    <span style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 500 }}>{meta.label}</span>
                </AffLink>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, letterSpacing: 1.2, color: T.muted, textTransform: 'uppercase' }}>
                    {meta.tag}
                </span>
            </div>

            {/* Price */}
            <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600, color: T.primary, letterSpacing: -0.3 }}>
                {fmtOdds(odd.price, odd.market_type)}
            </span>

            {/* Market Type */}
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.tertiary, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                {odd.market_type.replace('_', ' ')}
            </span>

            {/* Implied */}
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.secondary }}>
                {fmtProb(odd.implied_probability)}
            </span>

            {/* Volume */}
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.tertiary, textAlign: 'right' }}>
                {fmtVol(odd.volume)}
            </span>

            {/* Freshness */}
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, textAlign: 'right' }}>
                {fmtTimeAgo(odd.fetched_at)}
            </span>
        </div>
    );
}

// ── Evidence Stat Row ─────────────────────────────────────────────────────

function EvStat({ label, value }: { label: string; value: string | number }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{label}</span>
            <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.primary }}>{value}</span>
        </div>
    );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export const TechnicalAuditHub = ({ canonicalId }: { canonicalId?: string }) => {
    const [auditData, setAuditData] = useState<TechnicalAuditData | null>(null);
    const [eventData, setEventData] = useState<CanonicalEvent | null>(null);
    const [oddsData, setOddsData] = useState<PlatformOddsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandKernel, setExpandKernel] = useState(false);
    const [sealing, setSealing] = useState(false);
    const [permalink, setPermalink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [mounted, setMounted] = useState(false);
    const kernelRef = useRef<HTMLDivElement>(null);

    // ── Mount animation ─────────────────────────────────────────────────────

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 50);
        return () => clearTimeout(t);
    }, []);

    // ── Data Fetching ───────────────────────────────────────────────────────

    const fetchAll = useCallback(async () => {
        if (!canonicalId) {
            setLoading(false);
            return;
        }

        const [auditRes, eventRes, oddsRes] = await Promise.all([
            supabase
                .from('technical_audits')
                .select('*')
                .eq('internal_id', canonicalId)
                .order('generated_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('canonical_registry')
                .select('internal_id, home_team, away_team, sport, league, event_date')
                .eq('internal_id', canonicalId)
                .maybeSingle(),
            supabase
                .from('platform_odds')
                .select('*')
                .eq('internal_id', canonicalId)
                .order('fetched_at', { ascending: false })
                .limit(20),
        ]);

        if (!auditRes.error && auditRes.data) setAuditData(auditRes.data as TechnicalAuditData);
        if (!eventRes.error && eventRes.data) setEventData(eventRes.data as CanonicalEvent);
        if (!oddsRes.error && oddsRes.data) setOddsData(oddsRes.data as PlatformOddsRow[]);

        // Check for existing permalink
        const { data: permData } = await supabase
            .from('audit_permanence')
            .select('short_hash')
            .eq('internal_id', canonicalId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (permData?.short_hash) setPermalink(permData.short_hash);

        setLoading(false);
    }, [canonicalId]);

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 15000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    // ── Seal Audit ──────────────────────────────────────────────────────────

    const sealEvidence = async () => {
        if (!auditData || sealing || permalink) return;
        setSealing(true);
        try {
            const { data, error } = await supabase.rpc('seal_technical_audit', {
                p_internal_id: auditData.internal_id,
                p_game_state_engine: auditData.game_state_engine,
                p_market_dislocation_pts: auditData.market_dislocation_pts,
                p_data_veracity: auditData.data_veracity,
                p_kernel_trace: auditData.kernel_trace,
                p_evidence_snapshot: auditData.evidence_snapshot,
                p_resolution_logic: auditData.resolution_logic || 'final_score',
                p_sync_latency_ms: auditData.sync_latency_ms,
                p_source_url: auditData.source_url,
            });
            if (!error && data?.[0]) {
                setPermalink(data[0].short_hash);
            }
        } finally {
            setSealing(false);
        }
    };

    const copyPermalink = useCallback(() => {
        if (!permalink) return;
        navigator.clipboard?.writeText(`https://thedrip.ai/v/${permalink}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [permalink]);

    // ── Loading States ──────────────────────────────────────────────────────

    if (loading && !auditData) {
        return (
            <div
                style={{
                    height: 192,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: T.base,
                    borderRadius: T.radius,
                    border: `1px solid ${T.ghost}`,
                }}
            >
                <span
                    style={{
                        fontFamily: T.mono,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 3,
                        color: T.tertiary,
                        animation: 'pulse 2s ease infinite',
                    }}
                >
                    Initializing Audit
                </span>
            </div>
        );
    }

    if (!auditData) {
        return (
            <div
                style={{
                    padding: 32,
                    background: T.base,
                    borderRadius: T.radius,
                    border: `1px dashed ${T.ghost}`,
                    textAlign: 'center',
                }}
            >
                <span
                    style={{
                        fontFamily: T.mono,
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 2,
                        color: T.tertiary,
                    }}
                >
                    No audit data for this event
                </span>
            </div>
        );
    }

    // ── Derived Values ──────────────────────────────────────────────────────

    const grade = auditData.veracity_grade || calcGrade(auditData.data_veracity);
    const gradeStyle = GRADE_MAP[grade] || GRADE_MAP.FAIL;
    const tier = getCtaTier(auditData.market_dislocation_pts);
    const ev = auditData.evidence_snapshot;

    // Deduplicate odds by platform+market_type (keep most recent)
    const oddsMap = new Map<string, PlatformOddsRow>();
    for (const o of oddsData) {
        const key = `${o.platform}_${o.market_type}`;
        if (!oddsMap.has(key)) oddsMap.set(key, o);
    }
    const sortedOdds = Array.from(oddsMap.values()).sort((a, b) => {
        const tagA = PLATFORMS[a.platform]?.tag || 'BOOK';
        const tagB = PLATFORMS[b.platform]?.tag || 'BOOK';
        return (SORT_ORDER[tagA] ?? 9) - (SORT_ORDER[tagB] ?? 9);
    });

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div
            style={{
                fontFamily: T.sans,
                color: T.primary,
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
        >
            {/* ════ AFFILIATE DISCLOSURE ════ */}
            <div
                style={{
                    fontFamily: T.mono,
                    fontSize: 9,
                    color: T.muted,
                    letterSpacing: 1,
                    marginBottom: 16,
                    textTransform: 'uppercase',
                }}
            >
                Sponsored · Platform links may earn referral compensation
            </div>

            {/* ════ HEADER ════ */}
            <div style={{ marginBottom: 24 }}>
                {eventData && (
                    <>
                        {/* League + Date */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            {eventData.league && (
                                <span
                                    style={{
                                        fontFamily: T.mono,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: 1.4,
                                        color: eventData.league?.includes('WORLD') ? '#ffb80c' : T.emerald,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {eventData.league}
                                </span>
                            )}
                            {eventData.event_date && (
                                <>
                                    <span style={{ color: T.ghost }}>·</span>
                                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.tertiary, letterSpacing: 0.5 }}>
                                        {fmtDate(eventData.event_date)}
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Matchup */}
                        {eventData.away_team && eventData.home_team && (
                            <h2
                                style={{
                                    fontFamily: T.sans,
                                    fontSize: 28,
                                    fontWeight: 700,
                                    letterSpacing: -0.8,
                                    color: T.primary,
                                    margin: 0,
                                    lineHeight: 1.15,
                                }}
                            >
                                {eventData.away_team}
                                <span style={{ color: T.muted, fontWeight: 400, margin: '0 10px', fontSize: 20 }}>at</span>
                                {eventData.home_team}
                            </h2>
                        )}
                    </>
                )}

                {!eventData && (
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.tertiary, textTransform: 'uppercase' }}>
                        {canonicalId}
                    </span>
                )}

                {/* Subtitle bar: dislocation gauge + veracity badge */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 16,
                        flexWrap: 'wrap',
                        gap: 12,
                    }}
                >
                    <DislocationGauge pts={auditData.market_dislocation_pts} />
                    <VeracityBadge score={auditData.data_veracity} grade={grade} latencyMs={auditData.sync_latency_ms} />
                </div>
            </div>

            {/* ════ KERNEL TRACE (Market Divergence Analysis) ════ */}
            <div style={{ ...glassPanel, padding: T.panelPad, marginBottom: T.gap }}>
                <div style={{ ...sectionLabel, marginBottom: 12 }}>Market Divergence Analysis</div>

                <div
                    ref={kernelRef}
                    style={{
                        position: 'relative',
                        maxHeight: expandKernel ? 600 : 96,
                        overflow: 'hidden',
                        transition: 'max-height 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                >
                    <p
                        style={{
                            fontFamily: T.sans,
                            fontSize: 14.5,
                            lineHeight: 1.75,
                            color: '#d4d4d8',
                            margin: 0,
                            fontWeight: 400,
                        }}
                    >
                        {auditData.kernel_trace}
                    </p>
                    {!expandKernel && (
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: 56,
                                background: `linear-gradient(transparent, ${T.surface.replace('0.60', '0.98')})`,
                                pointerEvents: 'none',
                            }}
                        />
                    )}
                </div>

                <button
                    onClick={() => setExpandKernel(!expandKernel)}
                    style={{
                        marginTop: 10,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 0',
                        fontFamily: T.mono,
                        fontSize: 11,
                        color: T.emerald,
                        letterSpacing: 0.5,
                        opacity: 0.8,
                        transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                >
                    {expandKernel ? 'Collapse ▲' : 'Read full analysis ▼'}
                </button>

                {/* Source + Timestamp */}
                <div
                    style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: `1px solid ${T.ghost}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <a
                        href={auditData.source_url}
                        target="_blank"
                        rel="noopener"
                        style={{
                            fontFamily: T.mono,
                            fontSize: 10,
                            color: T.muted,
                            textDecoration: 'none',
                            borderBottom: `1px dotted ${T.ghost}`,
                            transition: 'color 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = T.tertiary; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = T.muted; }}
                    >
                        Source: {auditData.source_url.includes('espn') ? 'ESPN' : 'Primary'}
                    </a>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                        {fmtTimeAgo(auditData.generated_at)}
                    </span>
                </div>
            </div>

            {/* ════ CROSS-MARKET COMPARISON TABLE ════ */}
            {sortedOdds.length > 0 && (
                <div style={{ ...glassPanel, overflow: 'hidden', marginBottom: T.gap }}>
                    <div style={{ ...sectionLabel, padding: '16px 16px 0' }}>Cross-Market Comparison</div>

                    {/* Table Header */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1.6fr 0.7fr 0.65fr 0.65fr 0.65fr 0.5fr',
                            padding: '10px 16px 8px',
                            borderBottom: `1px solid ${T.ghost}`,
                        }}
                    >
                        {['Platform', 'Price', 'Type', 'Implied', 'Volume', 'Age'].map((h) => (
                            <span
                                key={h}
                                style={{
                                    ...sectionLabel,
                                    textAlign: (h === 'Volume' || h === 'Age') ? 'right' as const : 'left' as const,
                                }}
                            >
                                {h}
                            </span>
                        ))}
                    </div>

                    {/* Rows */}
                    {sortedOdds.map((o, i) => (
                        <OddsRow key={o.id} odd={o} isLast={i === sortedOdds.length - 1} />
                    ))}
                </div>
            )}

            {/* ════ EVIDENCE SNAPSHOT ════ */}
            {ev && (ev.pinnacle || ev.polymarket || ev.kalshi) && (
                <div style={{ ...glassPanel, padding: T.panelPad, marginBottom: T.gap }}>
                    <div style={{ ...sectionLabel, marginBottom: 14 }}>Evidence Snapshot</div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                        {/* Pinnacle */}
                        {ev.pinnacle && (
                            <div>
                                <div
                                    style={{
                                        fontFamily: T.mono,
                                        fontSize: 10,
                                        color: PLATFORMS.pinnacle.accent,
                                        letterSpacing: 1,
                                        marginBottom: 8,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Pinnacle
                                </div>
                                <EvStat label="Spread" value={ev.pinnacle.spread > 0 ? `+${ev.pinnacle.spread}` : `${ev.pinnacle.spread}`} />
                                <EvStat label="ML" value={ev.pinnacle.moneyline > 0 ? `+${ev.pinnacle.moneyline}` : `${ev.pinnacle.moneyline}`} />
                                <EvStat label="Total" value={ev.pinnacle.total} />
                            </div>
                        )}

                        {/* Polymarket */}
                        {ev.polymarket && (
                            <div>
                                <div
                                    style={{
                                        fontFamily: T.mono,
                                        fontSize: 10,
                                        color: PLATFORMS.polymarket.accent,
                                        letterSpacing: 1,
                                        marginBottom: 8,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Polymarket
                                </div>
                                <EvStat label="Prob" value={fmtProb(ev.polymarket.probability)} />
                                <EvStat label="Price" value={`${(ev.polymarket.contract_price * 100).toFixed(0)}¢`} />
                                <EvStat label="Vol" value={fmtVol(ev.polymarket.volume)} />
                            </div>
                        )}

                        {/* Kalshi */}
                        {ev.kalshi && (
                            <div>
                                <div
                                    style={{
                                        fontFamily: T.mono,
                                        fontSize: 10,
                                        color: PLATFORMS.kalshi.accent,
                                        letterSpacing: 1,
                                        marginBottom: 8,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Kalshi
                                </div>
                                <EvStat label="Prob" value={fmtProb(ev.kalshi.probability)} />
                                <EvStat label="Price" value={`${(ev.kalshi.contract_price * 100).toFixed(0)}¢`} />
                                <EvStat label="Vol" value={fmtVol(ev.kalshi.volume)} />
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.ghost}`, display: 'flex', gap: 16 }}>
                        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                            Resolution: <span style={{ color: T.tertiary }}>{(ev.resolution_logic || 'final_score').replace(/_/g, ' ')}</span>
                        </span>
                        {ev.captured_at && (
                            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                                Captured: <span style={{ color: T.tertiary }}>{fmtTimeAgo(ev.captured_at)}</span>
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ════ TECHNICAL SPECIFICATION ════ */}
            <div style={{ ...glassPanel, padding: T.panelPad, marginBottom: T.gap }}>
                <div style={{ ...sectionLabel, marginBottom: 14 }}>Technical Specification</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                    {([
                        { k: 'Engine', v: auditData.game_state_engine },
                        { k: 'Dislocation', v: `${auditData.market_dislocation_pts > 0 ? '+' : ''}${auditData.market_dislocation_pts.toFixed(1)} pts` },
                        { k: 'Veracity', v: `${auditData.data_veracity.toFixed(1)} / 100` },
                        { k: 'Latency', v: `${auditData.sync_latency_ms}ms` },
                        { k: 'Resolution', v: (auditData.resolution_logic || 'final_score').replace(/_/g, ' ') },
                        { k: 'Grade', v: grade },
                    ] as const).map(({ k, v }) => (
                        <div key={k}>
                            <div
                                style={{
                                    fontFamily: T.mono,
                                    fontSize: 9,
                                    color: T.muted,
                                    letterSpacing: 1.4,
                                    textTransform: 'uppercase',
                                    marginBottom: 4,
                                }}
                            >
                                {k}
                            </div>
                            <div
                                style={{
                                    fontFamily: T.mono,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color:
                                        k === 'Grade' ? gradeStyle.color :
                                            k === 'Dislocation' ? (tier === 'EXECUTE_ARBITRAGE' ? T.red : T.emerald) :
                                                T.primary,
                                }}
                            >
                                {v}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ════ CTA ════ */}
            {tier !== 'MONITOR_MARKET_FLUX' && (
                <div style={{ marginBottom: T.gap }}>
                    <button
                        style={{
                            width: '100%',
                            padding: '14px 24px',
                            borderRadius: T.radiusSm,
                            border: `1px solid ${tier === 'EXECUTE_ARBITRAGE' ? 'rgba(239,68,68,0.25)' : 'rgba(52,211,153,0.15)'}`,
                            background: tier === 'EXECUTE_ARBITRAGE' ? T.redDim : T.emeraldDim,
                            color: tier === 'EXECUTE_ARBITRAGE' ? '#fca5a5' : '#6ee7b7',
                            fontFamily: T.mono,
                            fontSize: 13,
                            fontWeight: 600,
                            letterSpacing: 0.4,
                            cursor: 'pointer',
                            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                            boxShadow: tier === 'EXECUTE_ARBITRAGE'
                                ? '0 0 24px rgba(239,68,68,0.10)'
                                : '0 0 16px rgba(52,211,153,0.06)',
                        }}
                        onMouseEnter={(e) => {
                            const el = e.currentTarget as HTMLElement;
                            el.style.transform = 'translateY(-1px)';
                            el.style.boxShadow = tier === 'EXECUTE_ARBITRAGE'
                                ? '0 0 32px rgba(239,68,68,0.18)'
                                : '0 0 24px rgba(52,211,153,0.12)';
                        }}
                        onMouseLeave={(e) => {
                            const el = e.currentTarget as HTMLElement;
                            el.style.transform = 'translateY(0)';
                            el.style.boxShadow = tier === 'EXECUTE_ARBITRAGE'
                                ? '0 0 24px rgba(239,68,68,0.10)'
                                : '0 0 16px rgba(52,211,153,0.06)';
                        }}
                    >
                        {tier === 'EXECUTE_ARBITRAGE' ? '⚠ Critical Dislocation — View Platforms' : 'View Technical Audit →'}
                    </button>
                </div>
            )}

            {/* ════ FOOTER: Seal + Permalink + Audit ID ════ */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderTop: `1px solid ${T.ghost}`,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {permalink ? (
                        <span
                            onClick={copyPermalink}
                            style={{
                                fontFamily: T.mono,
                                fontSize: 10,
                                color: copied ? T.emerald : T.muted,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                                borderBottom: `1px dotted ${T.ghost}`,
                            }}
                            title="Copy permalink"
                        >
                            {copied ? 'Copied ✓' : `thedrip.ai/v/${permalink}`}
                        </span>
                    ) : (
                        <button
                            onClick={sealEvidence}
                            disabled={sealing}
                            style={{
                                padding: '4px 10px',
                                borderRadius: T.radiusSm,
                                border: `1px solid ${T.surfaceBorder}`,
                                background: sealing ? 'transparent' : T.surface,
                                backdropFilter: 'blur(12px)',
                                color: sealing ? T.tertiary : T.secondary,
                                fontFamily: T.mono,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: 1,
                                textTransform: 'uppercase',
                                cursor: sealing ? 'wait' : 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            {sealing ? 'Sealing...' : 'Seal Audit'}
                        </button>
                    )}
                </div>

                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.ghost }}>
                    {auditData.audit_id.slice(0, 8)}
                </span>
            </div>

            {/* ── Font Import + Keyframes ── */}
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
        </div>
    );
};
