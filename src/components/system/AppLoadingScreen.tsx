import React from 'react';
import { ESSENCE, cn } from '@/lib/essence';

export function AppLoadingScreen() {
    return (
        <div
            className={cn(
                'min-h-screen flex items-center justify-center',
                'bg-[var(--bg)] text-[var(--text)]'
            )}
        >
            <div className={cn(ESSENCE.card.base, 'flex items-center gap-3')}>
                <div
                    className="h-4 w-4 rounded-full border border-slate-300 border-t-slate-900 animate-spin"
                    aria-label="Loading"
                />
                <div className={cn(ESSENCE.tw.sectionLabel)}>Loading</div>
            </div>
        </div>
    );
}
