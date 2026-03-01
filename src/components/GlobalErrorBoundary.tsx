import React, { ErrorInfo, ReactNode } from 'react';
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
                <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 text-zinc-900">
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/12 blur-[110px]" />
                    </div>

                    <div className="relative z-10 flex w-full max-w-md flex-col items-center rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
                        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-200 bg-red-50">
                            <Activity className="h-8 w-8 text-red-500/70" />
                        </div>

                        <h1 className="mb-3 text-xl font-bold tracking-tight">Application Halted</h1>
                        <p className="mb-2 text-sm leading-relaxed text-zinc-600">
                            A critical rendering error interrupted the session.
                        </p>
                        <p className="mb-8 font-mono text-xs leading-relaxed text-zinc-500">
                            {this.state.error?.message || 'Unknown exception'}
                        </p>

                        <button
                            onClick={this.handleReset}
                            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-zinc-800 active:scale-95"
                        >
                            <RefreshCcw size={16} />
                            Restart
                        </button>

                        {process.env.NODE_ENV === 'development' && (
                            <pre className="mt-8 max-w-full overflow-auto rounded-lg border border-zinc-200 bg-zinc-100 p-4 text-left text-[10px] text-zinc-600">
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
