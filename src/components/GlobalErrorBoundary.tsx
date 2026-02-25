import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * GlobalErrorBoundary - Handles top-level application failures.
 * Inherits from React.Component to use lifecycle methods.
 */
// Fix: Use React.Component explicitly to ensure properties like 'setState' and 'props' are correctly inherited
export class GlobalErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    // Correctly typed method on class
    private handleReset = () => {
        // Fix: Use setState from React.Component base class
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-900 p-6">
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-red-500/10 blur-[100px] rounded-full" />
                    </div>

                    <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
                            <Activity className="w-8 h-8 text-red-500/60" />
                        </div>

                        <h1 className="text-xl font-bold mb-3 tracking-tight">Something went wrong</h1>
                        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                            We've encountered a critical error. The application has been paused to prevent further issues.
                        </p>

                        <button
                            onClick={this.handleReset}
                            className="flex items-center gap-2 px-6 py-3 bg-slate-50 text-black rounded-full text-sm font-bold uppercase tracking-wider hover:bg-slate-200 transition-all active:scale-95"
                        >
                            <RefreshCcw size={16} />
                            Restart App
                        </button>

                        {process.env.NODE_ENV === 'development' && (
                            <pre className="mt-8 p-4 bg-slate-200 border border-white/5 rounded-lg text-[10px] text-left overflow-auto max-w-full text-slate-500">
                                {this.state.error?.toString()}
                            </pre>
                        )}
                    </div>
                </div>
            );
        }

        // Fix: Access props from React.Component base class
        return this.props.children;
    }
}
