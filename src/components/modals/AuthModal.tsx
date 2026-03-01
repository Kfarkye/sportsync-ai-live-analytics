
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
                <div className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]" onClick={onClose}></div>
                <div className="relative w-full max-w-md rounded-[28px] border border-red-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.22)] animate-in fade-in zoom-in-95 duration-200">
                    <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">
                        <X size={20} />
                    </button>
                    <div className="text-center py-6">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-200 bg-red-50">
                            <ShieldAlert size={32} className="text-red-500" />
                        </div>
                        <h2 className="mb-2 text-xl font-bold text-zinc-900">Authentication Unavailable</h2>
                        <p className="mb-6 text-sm leading-relaxed text-zinc-600">
                            The backend connection is missing API keys. You can still browse live scores and odds in <strong>Guest Mode</strong>.
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={onClose}
                                className="w-full rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-800"
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
            <div className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]" onClick={onClose}></div>

            <div className="relative w-full max-w-md rounded-[28px] border border-zinc-200 bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.22)] animate-in fade-in zoom-in-95 duration-200 sm:p-8">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                >
                    <X size={20} />
                </button>

                <div className="mb-8">
                    <h2 className="mb-2 text-2xl font-bold text-zinc-900">
                        {isLogin ? 'Welcome Back' : 'Join Sharp Edge'}
                    </h2>
                    <p className="text-sm text-zinc-600">
                        {isLogin ? 'Sign in to sync your pins and track your bets.' : 'Create an account to start tracking your sharp picks.'}
                    </p>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="ml-1 text-xs font-bold uppercase tracking-wider text-zinc-500">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-zinc-900 placeholder-zinc-400 transition-all focus:border-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-200"
                                placeholder="sharp@edge.ai"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="ml-1 text-xs font-bold uppercase tracking-wider text-zinc-500">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-zinc-900 placeholder-zinc-400 transition-all focus:border-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-200"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3.5 font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
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
                        className="text-xs text-zinc-600 transition-colors hover:text-zinc-900"
                    >
                        {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
