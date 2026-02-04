
import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { X, Mail, Lock, Loader2, ArrowRight, ShieldAlert } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
            }
            onClose();
        } catch (err: Error | { message?: string } | string) {
            if (typeof err === 'string') setError(err);
            else setError(err?.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    // If backend is missing, show a helpful error but allow closing
    if (!isSupabaseConfigured()) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
                <div className="relative bg-[#111] border border-red-500/20 w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                    <button onClick={onClose} className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                    <div className="text-center py-6">
                        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                            <ShieldAlert size={32} className="text-red-500" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Authentication Unavailable</h2>
                        <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                            The backend connection is missing API keys. You can still browse live scores and odds in <strong>Guest Mode</strong>.
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={onClose}
                                className="bg-white text-black font-bold px-6 py-3 rounded-xl hover:bg-zinc-200 transition-colors text-sm w-full"
                            >
                                Continue as Guest
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>

            <div className="relative bg-[#111] border border-white/10 w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-white mb-2">
                        {isLogin ? 'Welcome Back' : 'Join Sharp Edge'}
                    </h2>
                    <p className="text-zinc-400 text-sm">
                        {isLogin ? 'Sign in to sync your pins and track your bets.' : 'Create an account to start tracking your sharp picks.'}
                    </p>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                    {error && (
                        <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400 text-xs">
                            {error}
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-all"
                                placeholder="sharp@edge.ai"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 mt-4"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : (
                            <>
                                {isLogin ? 'Sign In' : 'Create Account'}
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-xs text-zinc-500 hover:text-white transition-colors"
                    >
                        {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
