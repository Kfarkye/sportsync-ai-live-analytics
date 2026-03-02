import React, { ErrorInfo, ReactNode } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';
import { cn, ESSENCE } from '@/lib/essence';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className={cn('relative flex min-h-screen flex-col items-center justify-center p-6', ESSENCE.tw.surface.subtle)}>
        <div className={cn('relative z-10 flex w-full max-w-md flex-col items-center text-center', ESSENCE.card.base)}>
          <div
            className={cn('mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border')}
            style={{ borderColor: ESSENCE.colors.accent.danger, background: ESSENCE.colors.accent.dangerMuted }}
          >
            <Activity className="h-8 w-8" style={{ color: ESSENCE.colors.accent.danger }} />
          </div>

          <h1 className="mb-3 text-xl font-bold tracking-tight" style={{ color: ESSENCE.colors.text.primary }}>
            Application Halted
          </h1>
          <p className="mb-2 text-sm leading-relaxed" style={{ color: ESSENCE.colors.text.secondary }}>
            A critical rendering error interrupted the session.
          </p>
          <p className="mb-8 font-mono text-xs leading-relaxed" style={{ color: ESSENCE.colors.text.tertiary }}>
            {this.state.error?.message || 'Unknown exception'}
          </p>

          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all active:scale-95"
            style={{ background: ESSENCE.colors.accent.primary, color: ESSENCE.colors.surface.pure }}
          >
            <RefreshCcw size={16} />
            Restart
          </button>

          {process.env.NODE_ENV === 'development' && (
            <pre
              className="mt-8 max-w-full overflow-auto rounded-lg p-4 text-left text-[10px]"
              style={{
                border: `1px solid ${ESSENCE.colors.border.default}`,
                background: ESSENCE.colors.surface.subtle,
                color: ESSENCE.colors.text.secondary,
              }}
            >
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
