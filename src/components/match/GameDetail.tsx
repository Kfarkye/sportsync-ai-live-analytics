import React, { useState, useEffect } from 'react';
import { Game, AIAnalysis } from '../../types';
import { getMatchAnalysis } from '../../services/geminiService';
import { ResponsiveContainer, XAxis, YAxis, Tooltip, AreaChart, Area, CartesianGrid } from 'recharts';
import { Sparkles, Activity, Shield, DollarSign, RefreshCw, TrendingUp } from 'lucide-react';

interface GameDetailProps {
    game: Game;
}

const TABS = [
    { id: 'AI', label: 'Gemini Insights', icon: Sparkles },
    { id: 'OVERVIEW', label: 'Match Center', icon: Activity },
    { id: 'STATS', label: 'Box Score', icon: Shield },
    { id: 'ODDS', label: 'Betting', icon: DollarSign },
] as const;

type TabId = typeof TABS[number]['id'];

const GameDetail: React.FC<GameDetailProps> = ({ game }) => {
    const [activeTab, setActiveTab] = useState<TabId>('AI');
    const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
    const [loadingAi, setLoadingAi] = useState(false);

    useEffect(() => {
        const fetchAi = async () => {
            setLoadingAi(true);
            const result = await getMatchAnalysis(game);
            setAnalysis(result);
            setLoadingAi(false);
        };
        fetchAi();
    }, [game]);

    const momentumData = game.momentum?.map((val, idx) => ({ name: idx, value: val })) || [];

    return (
        <div className="h-full flex flex-col bg-slate-900 overflow-y-auto custom-scrollbar">
            {/* Hero Header */}
            <div className="relative h-48 w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-b border-slate-800 p-6 flex items-center justify-between overflow-hidden">
                {/* Abstract Background Elements */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

                <div className="z-10 flex flex-col items-center w-1/3">
                    <img src={game.awayTeam.logo} alt={game.awayTeam.name} className="w-20 h-20 object-contain drop-shadow-2xl" />
                    <h2 className="mt-2 text-lg font-bold text-white text-center">{game.awayTeam.name}</h2>
                    <p className="text-slate-400 text-sm">{game.awayTeam.record}</p>
                </div>

                <div className="z-10 flex flex-col items-center justify-center w-1/3 h-full">
                    <span className="text-xs font-bold text-rose-500 tracking-widest uppercase mb-2">{game.status === 'LIVE' ? '● LIVE' : game.time}</span>
                    <div className="text-5xl font-black text-white tracking-tighter flex items-center gap-4">
                        <span>{game.awayTeam.score}</span>
                        <span className="text-slate-600 text-2xl font-medium">:</span>
                        <span>{game.homeTeam.score}</span>
                    </div>
                    <div className="mt-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-300 backdrop-blur-sm">
                        {game.venue}
                    </div>
                </div>

                <div className="z-10 flex flex-col items-center w-1/3">
                    <img src={game.homeTeam.logo} alt={game.homeTeam.name} className="w-20 h-20 object-contain drop-shadow-2xl" />
                    <h2 className="mt-2 text-lg font-bold text-white text-center">{game.homeTeam.name}</h2>
                    <p className="text-slate-400 text-sm">{game.homeTeam.record}</p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-20">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 text-sm font-semibold transition-colors relative ${activeTab === tab.id ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                            }`}
                    >
                        <tab.icon size={16} />
                        {tab.label}
                        {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="p-6 flex-1">
                {activeTab === 'AI' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Sparkles className="text-purple-400" size={20} />
                                Live Intelligence
                            </h3>
                            <button
                                onClick={() => { setLoadingAi(true); setTimeout(async () => { setAnalysis(await getMatchAnalysis(game)); setLoadingAi(false); }, 1000) }}
                                className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                disabled={loadingAi}
                            >
                                <RefreshCw size={16} className={loadingAi ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        {loadingAi ? (
                            <div className="h-64 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span className="text-slate-400 text-sm animate-pulse">Consulting Gemini Models...</span>
                                </div>
                            </div>
                        ) : analysis ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 p-5 rounded-2xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Sparkles size={100} />
                                        </div>
                                        <h4 className="text-purple-400 text-xs font-bold uppercase tracking-wider mb-2">Live Summary</h4>
                                        <p className="text-slate-200 leading-relaxed font-medium">{analysis.summary}</p>
                                    </div>

                                    <div className="bg-gradient-to-br from-emerald-900/20 to-slate-900 border border-emerald-500/30 p-5 rounded-2xl relative overflow-hidden">
                                        <h4 className="text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">Smart Bet Insight</h4>
                                        <p className="text-white leading-relaxed font-medium">{analysis.bettingInsight}</p>
                                        <div className="mt-4 flex items-center gap-2">
                                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20">Win Prob: {game.odds?.winProbability}%</span>
                                            <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-1 rounded">High Confidence</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-slate-800/50 border border-slate-700 p-5 rounded-2xl">
                                    <h4 className="text-blue-400 text-xs font-bold uppercase tracking-wider mb-4">Tactical Breakdown</h4>
                                    <div className="space-y-4">
                                        <div>
                                            <span className="text-slate-400 text-xs block mb-1">Key Matchup</span>
                                            <p className="text-slate-200 text-sm">{analysis.keyMatchup}</p>
                                        </div>
                                        <div>
                                            <span className="text-slate-400 text-xs block mb-1">AI Prediction</span>
                                            <p className="text-slate-200 text-sm">{analysis.prediction}</p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </div>
                )}

                {activeTab === 'OVERVIEW' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Momentum Chart */}
                        <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <TrendingUp size={18} className="text-emerald-500" />
                                Game Momentum
                            </h3>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={momentumData}>
                                        <defs>
                                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Match Info Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-800/30 p-4 rounded-xl border border-slate-800">
                                <span className="text-slate-500 text-xs uppercase tracking-wider block mb-1">Stadium</span>
                                <span className="text-white font-medium">{game.venue}</span>
                            </div>
                            <div className="bg-slate-800/30 p-4 rounded-xl border border-slate-800">
                                <span className="text-slate-500 text-xs uppercase tracking-wider block mb-1">Attendance</span>
                                <span className="text-white font-medium">{game.context?.attendance?.toLocaleString() || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'STATS' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {(game.stats || []).map((stat, idx) => (
                            <div key={idx} className="bg-slate-800/30 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                                <span className="text-white font-mono font-bold w-12 text-left">{stat.awayValue}</span>
                                <div className="flex-1 px-4">
                                    <div className="flex justify-between text-xs text-slate-400 mb-1 uppercase tracking-wider">
                                        <span>{game.awayTeam.name}</span>
                                        <span>{stat.label}</span>
                                        <span>{game.homeTeam.name}</span>
                                    </div>
                                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden flex">
                                        {/* Simple visual representation based on values if parsable, otherwise 50/50 */}
                                        <div className="h-full bg-blue-500" style={{ width: '50%' }}></div>
                                        <div className="h-full bg-emerald-500" style={{ width: '50%' }}></div>
                                    </div>
                                </div>
                                <span className="text-white font-mono font-bold w-12 text-right">{stat.homeValue}</span>
                            </div>
                        ))}
                        {(!game.stats || game.stats.length === 0) && (
                            <div className="text-center py-10 text-slate-500">No stats available for this match.</div>
                        )}
                    </div>
                )}

                {activeTab === 'ODDS' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-gradient-to-br from-emerald-900/10 to-slate-900 border border-emerald-500/20 rounded-2xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                    <DollarSign size={20} />
                                </div>
                                <div>
                                    <h3 className="text-white font-bold">Live Odds</h3>
                                    <p className="text-emerald-400 text-xs">Provider: {game.odds?.provider || 'Consensus'}</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                    <span className="text-slate-400 text-sm">Moneyline (Home)</span>
                                    {(game.odds?.moneylineHome || game.odds?.homeWin) ? (
                                        <span className="text-white font-mono font-bold text-lg">{game.odds?.moneylineHome || game.odds?.homeWin}</span>
                                    ) : (
                                        <span className="text-zinc-600 font-mono text-sm italic">N/A</span>
                                    )}
                                </div>
                                <div className="flex justify-between items-center p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                    <span className="text-slate-400 text-sm">Moneyline (Away)</span>
                                    {(game.odds?.moneylineAway || game.odds?.awayWin) ? (
                                        <span className="text-white font-mono font-bold text-lg">{game.odds?.moneylineAway || game.odds?.awayWin}</span>
                                    ) : (
                                        <span className="text-zinc-600 font-mono text-sm italic">N/A</span>
                                    )}
                                </div>
                                <div className="flex justify-between items-center p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                    <span className="text-slate-400 text-sm">Spread</span>
                                    {game.odds?.spread ? (
                                        <span className="text-white font-mono font-bold text-lg">{game.odds?.spread}</span>
                                    ) : (
                                        <span className="text-zinc-600 font-mono text-sm italic">N/A</span>
                                    )}
                                </div>
                                <div className="flex justify-between items-center p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                    <span className="text-slate-400 text-sm">Total (O/U)</span>
                                    {game.odds?.overUnder ? (
                                        <span className="text-white font-mono font-bold text-lg">{game.odds?.overUnder}</span>
                                    ) : (
                                        <span className="text-zinc-600 font-mono text-sm italic">N/A</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GameDetail;
