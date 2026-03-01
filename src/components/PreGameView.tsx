
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Match, MatchNews, FatigueMetrics, OfficialStats, PregameContext } from '@/types';
import { supabase } from '../lib/supabase';
import {
    RefreshCw,
    Thermometer,
    TrendingUp,
    FileText,
    CheckCircle2,
    Plane,
    ExternalLink,
    Zap,
    Activity,
    Scale
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PregameWatchTags from './pregame/PregameWatchTags';
import InsightCard, { toInsightCard } from './analysis/InsightCard';

// ============================================================================
// Types
// ============================================================================

interface PreGameViewProps {
    match: Match;
    onRefresh?: () => void; // Optional now, as we handle it internally
}

// ============================================================================
// Sub-Components
// ============================================================================

const FatigueCard: React.FC<{ fatigue: { home?: FatigueMetrics, away?: FatigueMetrics } }> = ({ fatigue }) => {
    const renderMetrics = (data: FatigueMetrics | undefined, label: string) => {
        if (!data) return null;
        return (
            <div className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-zinc-600 uppercase">{label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${data.fatigueScore > 70 ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        Load: {data.fatigueScore}%
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="text-center">
                        <div className="text-[9px] text-zinc-500 uppercase">Rest</div>
                        <div className="text-sm font-mono font-bold text-zinc-900">{data.daysRest}d</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[9px] text-zinc-500 uppercase">Travel</div>
                        <div className="text-sm font-mono font-bold text-zinc-900">{data.milesTraveled}mi</div>
                    </div>
                </div>
                <p className="text-[10px] text-zinc-600 italic leading-tight">{data.note}</p>
            </div>
        );
    };

    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <Plane size={14} className="text-blue-600" />
                <h3 className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Travel & Schedule</h3>
            </div>
            <div className="flex flex-col md:flex-row gap-4">
                {renderMetrics(fatigue.away, 'Away')}
                {renderMetrics(fatigue.home, 'Home')}
            </div>
        </div>
    );
};

const OfficiatingCard: React.FC<{ stats: OfficialStats }> = ({ stats }) => (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
            <Scale size={14} className="text-amber-600" />
            <h3 className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Officiating Crew</h3>
        </div>

        <div className="flex justify-between items-start mb-4">
            <div>
                <div className="text-sm font-bold text-zinc-900">{stats.crewName || "Unknown Crew"}</div>
                <div className="text-[10px] text-zinc-500 uppercase">{stats.referee}</div>
            </div>
            <div className={`rounded border px-2 py-1 text-[10px] font-bold ${stats.bias?.includes('Home') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                stats.bias?.includes('Neutral') ? 'border-zinc-200 bg-zinc-100 text-zinc-700' :
                    'border-red-200 bg-red-50 text-red-700'
                }`}>
                {stats.bias || "Neutral"}
            </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
            <div className="text-center">
                <div className="text-[9px] text-zinc-500 uppercase">Home Win</div>
                <div className="font-mono font-bold text-zinc-900">{stats.homeWinPct}%</div>
            </div>
            <div className="text-center border-x border-zinc-200">
                <div className="text-[9px] text-zinc-500 uppercase">Over</div>
                <div className="font-mono font-bold text-zinc-900">{stats.overPct}%</div>
            </div>
            <div className="text-center">
                <div className="text-[9px] text-zinc-500 uppercase">Fouls/Gm</div>
                <div className="font-mono font-bold text-zinc-900">{stats.foulsPerGame}</div>
            </div>
        </div>
    </div>
);

// ============================================================================
// Main Component
// ============================================================================

const PreGameView: React.FC<PreGameViewProps> = ({ match }) => {
    const [news, setNews] = useState<MatchNews | null>(null);
    const [pregameContext, setPregameContext] = useState<PregameContext | null>(null);
    const [contextLoading, setContextLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const insightCardData = useMemo(() => {
        const prop = match.dbProps?.[0];
        if (!prop) return null;

        const norm = (s?: string) => (s || '').toLowerCase();
        const homeKeys = [match.homeTeam.abbreviation, match.homeTeam.shortName, match.homeTeam.name].map(norm);
        const awayKeys = [match.awayTeam.abbreviation, match.awayTeam.shortName, match.awayTeam.name].map(norm);
        const propTeam = norm(prop.team);

        const isHome = propTeam && homeKeys.some((k) => k && propTeam.includes(k));
        const isAway = propTeam && awayKeys.some((k) => k && propTeam.includes(k));

        const teamLabel = prop.team || match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name;
        const opponentLabel = isHome
            ? (match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name)
            : isAway
                ? (match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name)
                : (match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name);

        const statType = (prop.marketLabel || prop.betType || 'Stat')
            .toString()
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return toInsightCard({
            id: prop.id,
            playerName: prop.playerName,
            team: teamLabel,
            opponent: opponentLabel,
            headshotUrl: prop.headshotUrl,
            side: (prop.side || 'OVER').toString().toUpperCase(),
            line: prop.lineValue,
            statType,
            bestOdds: prop.oddsAmerican,
            bestBook: prop.sportsbook,
            affiliateLink: undefined,
            dvpRank: 0,
            edge: news?.sharp_data?.quant_math?.edge_percent ?? 0,
            probability: news?.sharp_data?.quant_math?.fair_win_prob ? (news.sharp_data.quant_math.fair_win_prob * 100) : 50,
            aiAnalysis: news?.sharp_data?.analysis || news?.report || 'Intelligence unavailable.',
            l5Results: [],
            l5HitRate: 0
        });
    }, [match, news]);

    const parseNewsStatus = (value?: string | null): MatchNews['status'] => {
        if (value === 'pending' || value === 'ready' || value === 'failed' || value === 'generating') return value;
        return 'pending';
    };

    const fetchNews = useCallback(async (isInitialLoad = true) => {
        if (isInitialLoad) setLoading(true);
        try {
            const { data } = await supabase
                .from('match_news')
                .select('*')
                .eq('match_id', match.id)
                .maybeSingle();

            if (data) {
                setNews({
                    matchId: data.match_id,
                    report: data.report || '',
                    keyInjuries: data.key_injuries || [],
                    bettingFactors: data.betting_factors || [],
                    lineMovement: data.line_movement || undefined,
                    weather: data.weather_forecast || undefined,
                    fatigue: data.fatigue || undefined,
                    officials: data.officials || undefined,
                    sources: data.sources || [],
                    status: parseNewsStatus(data.status),
                    generatedAt: data.generated_at,
                    expiresAt: data.expires_at,
                    sharp_data: data.sharp_data || undefined
                });
            }
        } catch (err) {
            console.error("Intel fetch failed", err);
        } finally {
            if (isInitialLoad) setLoading(false);
        }
    }, [match.id]);

    // Fetch pregame context from Gemini-generated table
    const fetchPregameContext = useCallback(async () => {
        setContextLoading(true);
        try {
            // Try NBA-specific table first, fall back to generic
            const { data } = await supabase
                .from('nba_pregame_context')
                .select('context_jsonb, generated_at')
                .eq('match_id', match.id)
                .maybeSingle();

            if (data?.context_jsonb) {
                setPregameContext(data.context_jsonb);
            }
        } catch (err) {
            console.error("Pregame context fetch failed", err);
        } finally {
            setContextLoading(false);
        }
    }, [match.id]);

    useEffect(() => { fetchNews(true); }, [fetchNews]);
    useEffect(() => { fetchPregameContext(); }, [fetchPregameContext]);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            // Send flat payload with match_id at top level for easier extraction
            const { error } = await supabase.functions.invoke('news-generator', {
                body: {
                    match_id: match.id,
                    id: match.id,
                    homeTeam: match.homeTeam.name,
                    awayTeam: match.awayTeam.name,
                    leagueId: match.leagueId,
                    startTime: match.startTime,
                    venue: match.context?.venue?.name || 'Unknown Venue',
                    odds: {
                        spread: match.odds?.spread || match.odds?.homeSpread || 'N/A',
                        overUnder: match.odds?.overUnder || match.odds?.total || 'N/A'
                    }
                }
            });

            if (error) throw error;

            // Reload from DB
            await fetchNews(false);
        } catch (e: Error) {
            console.error("Generation failed:", e);
            alert(`Failed to generate report: ${e.message}`);
        } finally {
            setGenerating(false);
        }
    };

    if (loading) return <div className="h-64 flex items-center justify-center text-xs text-zinc-500 animate-pulse">Loading Deep Intel...</div>;

    if (!news) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 py-12">
                <FileText className="mb-3 text-zinc-500" size={32} />
                <p className="mb-4 text-sm text-zinc-600">Deep analysis report not generated yet.</p>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                >
                    {generating ? <RefreshCw className="animate-spin" size={14} /> : <Zap size={14} />}
                    {generating ? 'Researching...' : 'Generate Report'}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 size={14} />
                    <span className="text-xs font-bold uppercase tracking-wider">Analysis Active</span>
                    <span className="text-[10px] text-zinc-500">• {new Date(news.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="text-zinc-500 hover:text-zinc-900 transition-colors"
                    title="Regenerate Report"
                >
                    <RefreshCw size={14} className={generating ? "animate-spin" : ""} />
                </button>
            </div>

            {/* 0. Executive Match Report (Top Priority) */}
            {news.report && (() => {
                let structured: JsonRecord | null = null;
                try {
                    const parsed = JSON.parse(news.report);
                    if (parsed && typeof parsed === 'object') {
                        structured = parsed as JsonRecord;
                    }
                } catch { }

                return (
                    <div className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                        {/* Header: Zero UI Style */}
                        <div className="flex items-end justify-between border-b border-zinc-200 bg-gradient-to-r from-zinc-50 via-white to-zinc-50 p-6">
                            <div>
                                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">Internal Briefing</div>
                                <h2 className="text-2xl font-bold leading-none tracking-tight text-zinc-900">{match.awayTeam.name} <span className="text-zinc-500">@</span> {match.homeTeam.name}</h2>
                            </div>
                            <div className="text-right">
                                <div className="mb-1 text-[10px] font-mono text-zinc-500">{new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                                <div className="flex gap-3 text-xs font-mono font-bold">
                                    <span className="text-zinc-900">{(match.odds?.homeSpread !== null && match.odds?.homeSpread !== undefined) ? (Number(match.odds.homeSpread) === 0 ? 'PK' : (Number(match.odds.homeSpread) > 0 ? `+${match.odds.homeSpread}` : match.odds.homeSpread)) : 'OFF'}</span>
                                    <span className="text-zinc-600">{(match.odds?.total !== null && match.odds?.total !== undefined) ? match.odds.total : 'OFF'}</span>
                                </div>
                            </div>
                        </div>

                        {structured && structured.home_form ? (
                            <div className="p-6">
                                {/* Section 1: Identity & Form */}
                                <div className="grid grid-cols-2 gap-8 mb-8">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            <div className="w-1 h-1 bg-blue-500 rounded-full" /> Away Identity
                                        </div>
                                        <p className="text-sm font-medium leading-relaxed tracking-wide text-zinc-700">
                                            {structured.away_form}
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            <div className="w-1 h-1 bg-indigo-500 rounded-full" /> Home Identity
                                        </div>
                                        <p className="text-sm font-medium leading-relaxed tracking-wide text-zinc-700">
                                            {structured.home_form}
                                        </p>
                                    </div>
                                </div>

                                {/* Section 2: Intel Grid */}
                                <div className="grid md:grid-cols-2 gap-4 mb-8">
                                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                                        <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-2 font-mono">Market Signal</div>
                                        <p className="text-xs font-mono leading-relaxed text-zinc-600">
                                            {structured.betting_splits}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                                        <div className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mb-2 font-mono">Key Trend</div>
                                        <p className="text-xs font-mono leading-relaxed text-zinc-600">
                                            {structured.key_trend}
                                        </p>
                                    </div>
                                </div>

                                {/* Section 3: The Verdict */}
                                <div className="relative border-l-2 border-zinc-200 pl-4">
                                    <div className="absolute -top-3 left-4 mb-3 bg-white px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-900">The Verdict</div>
                                    <div className="prose prose-sm max-w-none text-zinc-700 prose-p:mb-2 prose-p:leading-relaxed prose-strong:text-zinc-900">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{structured.analysis}</ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Legacy Markdown Fallback */
                            <div className="prose prose-sm max-w-none p-6 text-zinc-700 prose-headings:text-indigo-600 prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:text-xs prose-p:leading-relaxed">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{news.report}</ReactMarkdown>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* 1. Pregame Watch Tags (Gemini-Powered Context) */}
            <PregameWatchTags context={pregameContext} loading={contextLoading} />

            {/* 1.5 Shareable Insight Card */}
            {insightCardData && (
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Shareable Insight</span>
                    </div>
                    <InsightCard data={insightCardData} />
                </div>
            )}

            {/* 2. Qualitative Context Grid */}
            <div className="grid md:grid-cols-2 gap-4">
                {/* Narrative Trends (was Market Edge) */}
                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={14} className="text-violet-600" />
                        <h3 className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Narrative Trends</h3>
                    </div>
                    <div className="space-y-3">
                        {news.bettingFactors.map((f, i) => (
                            <div key={i} className="flex gap-3">
                                <div className={`w-1 self-stretch rounded-full ${f.trend === 'NEUTRAL' ? 'bg-zinc-400' : 'bg-emerald-500'}`} />
                                <div>
                                    <div className="text-sm font-bold text-zinc-900">{f.title}</div>
                                    <div className="text-xs leading-snug text-zinc-600">{f.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    {news.weather && (
                        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 text-indigo-600">
                                    <Thermometer size={14} />
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest">Hyper-Local</h3>
                                </div>
                                <span className="text-xl font-mono font-bold text-zinc-900">{news.weather.temp}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                <div><div className="text-zinc-500 text-[10px] uppercase">Wind</div><div className="font-bold text-zinc-900">{news.weather.wind}</div></div>
                                <div><div className="text-zinc-500 text-[10px] uppercase">Humid</div><div className="font-bold text-zinc-900">{news.weather.humidity}</div></div>
                                <div><div className="text-zinc-500 text-[10px] uppercase">Condition</div><div className="font-bold text-zinc-900">{news.weather.condition}</div></div>
                            </div>
                            {news.weather.impact && (
                                <div className="mt-3 border-t border-indigo-200 pt-3 text-[11px] text-indigo-700">
                                    <span className="font-bold">Impact:</span> {news.weather.impact}
                                </div>
                            )}
                        </div>
                    )}
                    {news.officials && <OfficiatingCard stats={news.officials} />}
                </div>
            </div>

            {/* Fatigue & Injuries */}
            <div className="grid md:grid-cols-2 gap-4">
                {news.fatigue && <FatigueCard fatigue={news.fatigue} />}

                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity size={14} className="text-rose-600" />
                        <h3 className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Critical Injuries</h3>
                    </div>
                    <div className="space-y-3">
                        {news.keyInjuries.length === 0 ? (
                            <div className="text-xs text-zinc-500 italic">No critical injuries reported.</div>
                        ) : (
                            news.keyInjuries.map((inj, i) => (
                                <div key={i} className="rounded border border-zinc-200 bg-zinc-50 p-2">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-xs font-bold text-zinc-900">{inj.player} <span className="text-zinc-500">({inj.team})</span></span>
                                        <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">{inj.status}</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-600">{inj.analysis || inj.description || inj.details}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>



            {/* Sources */}
            {news.sources && news.sources.length > 0 && (
                <div className="border-t border-zinc-200 pt-4">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                        <FileText size={12} /> Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {news.sources.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-[10px] text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-zinc-900">
                                <ExternalLink size={10} /> {s.title}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PreGameView;
