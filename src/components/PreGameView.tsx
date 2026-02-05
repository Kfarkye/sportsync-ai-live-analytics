
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
            <div className="flex-1 p-3 bg-white/[0.03] rounded-lg border border-white/5">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">{label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${data.fatigueScore > 70 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        Load: {data.fatigueScore}%
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="text-center">
                        <div className="text-[9px] text-zinc-500 uppercase">Rest</div>
                        <div className="text-sm font-mono font-bold text-white">{data.daysRest}d</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[9px] text-zinc-500 uppercase">Travel</div>
                        <div className="text-sm font-mono font-bold text-white">{data.milesTraveled}mi</div>
                    </div>
                </div>
                <p className="text-[10px] text-zinc-400 italic leading-tight">{data.note}</p>
            </div>
        );
    };

    return (
        <div className="bg-[#09090B] border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
                <Plane size={14} className="text-blue-400" />
                <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Travel & Schedule</h3>
            </div>
            <div className="flex flex-col md:flex-row gap-4">
                {renderMetrics(fatigue.away, 'Away')}
                {renderMetrics(fatigue.home, 'Home')}
            </div>
        </div>
    );
};

const OfficiatingCard: React.FC<{ stats: OfficialStats }> = ({ stats }) => (
    <div className="bg-[#09090B] border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
            <Scale size={14} className="text-yellow-400" />
            <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Officiating Crew</h3>
        </div>

        <div className="flex justify-between items-start mb-4">
            <div>
                <div className="text-sm font-bold text-white">{stats.crewName || "Unknown Crew"}</div>
                <div className="text-[10px] text-zinc-500 uppercase">{stats.referee}</div>
            </div>
            <div className={`px-2 py-1 rounded text-[10px] font-bold border ${stats.bias?.includes('Home') ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                stats.bias?.includes('Neutral') ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' :
                    'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                {stats.bias || "Neutral"}
            </div>
        </div>

        <div className="grid grid-cols-3 gap-2 bg-white/[0.03] rounded-lg p-2 border border-white/5">
            <div className="text-center">
                <div className="text-[9px] text-zinc-500 uppercase">Home Win</div>
                <div className="font-mono font-bold text-white">{stats.homeWinPct}%</div>
            </div>
            <div className="text-center border-x border-white/5">
                <div className="text-[9px] text-zinc-500 uppercase">Over</div>
                <div className="font-mono font-bold text-white">{stats.overPct}%</div>
            </div>
            <div className="text-center">
                <div className="text-[9px] text-zinc-500 uppercase">Fouls/Gm</div>
                <div className="font-mono font-bold text-white">{stats.foulsPerGame}</div>
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
            <div className="flex flex-col items-center justify-center py-12 border border-white/5 rounded-xl bg-white/[0.02]">
                <FileText className="text-zinc-600 mb-3" size={32} />
                <p className="text-sm text-zinc-400 mb-4">Deep analysis report not generated yet.</p>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="bg-white text-black px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
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
                <div className="flex items-center gap-2 text-emerald-500">
                    <CheckCircle2 size={14} />
                    <span className="text-xs font-bold uppercase tracking-wider">Analysis Active</span>
                    <span className="text-[10px] text-zinc-500">• {new Date(news.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="text-zinc-500 hover:text-white transition-colors"
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
                    <div className="bg-[#09090B] border border-white/5 rounded-xl overflow-hidden relative group">
                        {/* Header: Zero UI Style */}
                        <div className="p-6 border-b border-white/5 flex justify-between items-end bg-gradient-to-r from-transparent via-white/[0.01] to-transparent">
                            <div>
                                <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">Internal Briefing</div>
                                <h2 className="text-2xl font-bold text-white tracking-tight leading-none">{match.awayTeam.name} <span className="text-zinc-600">@</span> {match.homeTeam.name}</h2>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-mono text-zinc-500 mb-1">{new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                                <div className="flex gap-3 text-xs font-mono font-bold">
                                    <span className="text-white">{(match.odds?.homeSpread !== null && match.odds?.homeSpread !== undefined) ? (Number(match.odds.homeSpread) === 0 ? 'PK' : (Number(match.odds.homeSpread) > 0 ? `+${match.odds.homeSpread}` : match.odds.homeSpread)) : 'OFF'}</span>
                                    <span className="text-zinc-500">{(match.odds?.total !== null && match.odds?.total !== undefined) ? match.odds.total : 'OFF'}</span>
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
                                        <p className="text-sm text-zinc-300 font-medium leading-relaxed tracking-wide opacity-90">
                                            {structured.away_form}
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            <div className="w-1 h-1 bg-indigo-500 rounded-full" /> Home Identity
                                        </div>
                                        <p className="text-sm text-zinc-300 font-medium leading-relaxed tracking-wide opacity-90">
                                            {structured.home_form}
                                        </p>
                                    </div>
                                </div>

                                {/* Section 2: Intel Grid */}
                                <div className="grid md:grid-cols-2 gap-4 mb-8">
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-lg">
                                        <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-2 font-mono">Market Signal</div>
                                        <p className="text-xs text-zinc-400 font-mono leading-relaxed">
                                            {structured.betting_splits}
                                        </p>
                                    </div>
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-lg">
                                        <div className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mb-2 font-mono">Key Trend</div>
                                        <p className="text-xs text-zinc-400 font-mono leading-relaxed">
                                            {structured.key_trend}
                                        </p>
                                    </div>
                                </div>

                                {/* Section 3: The Verdict */}
                                <div className="relative pl-4 border-l-2 border-white/10">
                                    <div className="text-[10px] font-bold text-white uppercase tracking-widest mb-3 absolute -top-3 left-4 bg-[#09090B] px-2">The Verdict</div>
                                    <div className="prose prose-invert prose-sm max-w-none text-zinc-300 prose-p:leading-relaxed prose-strong:text-white prose-p:mb-2 prose-p:opacity-90">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{structured.analysis}</ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Legacy Markdown Fallback */
                            <div className="p-6 prose prose-invert prose-sm max-w-none text-zinc-300 prose-headings:text-indigo-400 prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:text-xs prose-p:leading-relaxed">
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
                <div className="bg-[#09090B] border border-white/10 rounded-2xl p-4 md:p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <CheckCircle2 size={12} className="text-emerald-400" />
                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Shareable Insight</span>
                    </div>
                    <InsightCard data={insightCardData} />
                </div>
            )}

            {/* 2. Qualitative Context Grid */}
            <div className="grid md:grid-cols-2 gap-4">
                {/* Narrative Trends (was Market Edge) */}
                <div className="bg-[#09090B] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={14} className="text-violet-400" />
                        <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Narrative Trends</h3>
                    </div>
                    <div className="space-y-3">
                        {news.bettingFactors.map((f, i) => (
                            <div key={i} className="flex gap-3">
                                <div className={`w-1 self-stretch rounded-full ${f.trend === 'NEUTRAL' ? 'bg-zinc-600' : 'bg-emerald-500'}`} />
                                <div>
                                    <div className="text-sm font-bold text-white">{f.title}</div>
                                    <div className="text-xs text-zinc-400 leading-snug">{f.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    {news.weather && (
                        <div className="bg-gradient-to-br from-indigo-950/20 to-[#09090B] border border-indigo-500/20 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 text-indigo-400">
                                    <Thermometer size={14} />
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest">Hyper-Local</h3>
                                </div>
                                <span className="text-xl font-mono font-bold text-white">{news.weather.temp}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                <div><div className="text-zinc-500 text-[10px] uppercase">Wind</div><div className="font-bold text-white">{news.weather.wind}</div></div>
                                <div><div className="text-zinc-500 text-[10px] uppercase">Humid</div><div className="font-bold text-white">{news.weather.humidity}</div></div>
                                <div><div className="text-zinc-500 text-[10px] uppercase">Condition</div><div className="font-bold text-white">{news.weather.condition}</div></div>
                            </div>
                            {news.weather.impact && (
                                <div className="mt-3 pt-3 border-t border-indigo-500/10 text-[11px] text-indigo-300">
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

                <div className="bg-[#09090B] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity size={14} className="text-rose-400" />
                        <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Critical Injuries</h3>
                    </div>
                    <div className="space-y-3">
                        {news.keyInjuries.length === 0 ? (
                            <div className="text-xs text-zinc-500 italic">No critical injuries reported.</div>
                        ) : (
                            news.keyInjuries.map((inj, i) => (
                                <div key={i} className="bg-white/[0.02] p-2 rounded border border-white/5">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-xs font-bold text-white">{inj.player} <span className="text-zinc-500">({inj.team})</span></span>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 bg-rose-500/10 text-rose-400 rounded border border-rose-500/20">{inj.status}</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-400">{inj.analysis || inj.description || inj.details}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>



            {/* Sources */}
            {news.sources && news.sources.length > 0 && (
                <div className="pt-4 border-t border-white/5">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
                        <FileText size={12} /> Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {news.sources.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-zinc-400 hover:text-white transition-colors">
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
