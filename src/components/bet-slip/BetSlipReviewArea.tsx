/**
 * BetSlipReviewArea.tsx
 * "Trust Layer" — Human-in-the-loop verification UI for AI-parsed bet slips.
 *
 * CRITICAL FIXES:
 * ├─ Deep copy in state updater: prevents React strict-mode mutation bugs
 * ├─ Safe negative odds input: parseInt("-") → NaN crash is handled
 * ├─ Confidence-aware highlighting: amber border on low-confidence legs
 * └─ Confirm gate: button disabled until all flagged legs are reviewed
 *
 * Design: Obsidian dark theme matching the existing ChatWidget aesthetic
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppBetSlip, AppBetLeg } from '../../../lib/schemas/betSlipSchema';
import { americanToDecimal } from '../../../lib/schemas/betSlipSchema';

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS (matching Obsidian Weissach v29.1)
// ═══════════════════════════════════════════════════════════════════════════

const OW = {
    bg: '#0A0A0B',
    surface: '#111113',
    surfaceHover: '#19191D',
    border: 'rgba(255,255,255,0.06)',
    borderWarn: 'rgba(245,158,11,0.4)',
    t1: '#FAFAFA',
    t2: '#A1A1AA',
    t3: '#52525B',
    mint: '#34D399',
    mintDim: 'rgba(52,211,153,0.08)',
    amber: '#F59E0B',
    amberDim: 'rgba(245,158,11,0.08)',
    red: '#EF4444',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface BetSlipReviewAreaProps {
    initialData: AppBetSlip;
    onConfirm: (slip: AppBetSlip) => void;
    onCancel: () => void;
}

export default function BetSlipReviewArea({ initialData, onConfirm, onCancel }: BetSlipReviewAreaProps) {
    const [slip, setSlip] = useState<AppBetSlip>(initialData);

    const hasPendingReviews = useMemo(
        () => slip.legs.some(leg => leg.needs_review || leg.confidence_score < 85),
        [slip.legs]
    );

    const overallConfidence = useMemo(
        () => Math.round(slip.legs.reduce((sum, l) => sum + l.confidence_score, 0) / slip.legs.length),
        [slip.legs]
    );

    const updateLeg = useCallback((index: number, updates: Partial<AppBetLeg>) => {
        setSlip(prev => {
            // 🛡️ DEEP COPY to avoid mutating React state directly
            const newLegs = prev.legs.map((leg, i) => {
                if (i !== index) return leg;
                return {
                    ...leg,
                    ...updates,
                    // Clear warning flags once user manually edits a field
                    needs_review: false,
                    confidence_score: 100,
                };
            });
            return { ...prev, legs: newLegs, verified: !newLegs.some(l => l.needs_review || l.confidence_score < 85) };
        });
    }, []);

    const handleConfirm = useCallback(() => {
        if (hasPendingReviews) return;
        onConfirm({ ...slip, verified: true });
    }, [hasPendingReviews, onConfirm, slip]);

    const impliedPayout = useMemo(() => {
        if (!slip.total_stake) return null;
        const combinedDecimal = slip.legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
        return Math.round(slip.total_stake * combinedDecimal * 100) / 100;
    }, [slip.legs, slip.total_stake]);

    return (
        <div style={{ background: OW.bg, borderRadius: 16, overflow: 'hidden', border: `1px solid ${OW.border}` }}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${OW.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: OW.t3, letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
                            VERIFY YOUR SLIP
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: OW.t1, marginTop: 4 }}>
                            {slip.sportsbook} · {slip.wager_type === 'parlay' || slip.wager_type === 'sgp'
                                ? `${slip.legs.length}-Leg ${slip.wager_type.toUpperCase()}`
                                : 'Straight Bet'}
                        </div>
                    </div>
                    <div style={{
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: 10,
                        fontWeight: 700,
                        background: overallConfidence >= 90 ? OW.mintDim : OW.amberDim,
                        color: overallConfidence >= 90 ? OW.mint : OW.amber,
                        border: `1px solid ${overallConfidence >= 90 ? 'rgba(52,211,153,0.2)' : OW.borderWarn}`,
                    }}>
                        {overallConfidence}% CONFIDENT
                    </div>
                </div>
            </div>

            {/* Legs */}
            <div style={{ padding: '12px 16px' }}>
                <AnimatePresence>
                    {slip.legs.map((leg, index) => {
                        const requiresAttention = leg.needs_review || leg.confidence_score < 85;

                        return (
                            <motion.div
                                key={leg.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05, duration: 0.2 }}
                                style={{
                                    padding: 16,
                                    marginBottom: 8,
                                    borderRadius: 12,
                                    background: requiresAttention ? OW.amberDim : OW.surface,
                                    border: `1px solid ${requiresAttention ? OW.borderWarn : OW.border}`,
                                    transition: 'background 0.2s, border-color 0.2s',
                                }}
                            >
                                {requiresAttention && (
                                    <div style={{
                                        fontSize: 9,
                                        fontWeight: 700,
                                        color: OW.amber,
                                        letterSpacing: '0.15em',
                                        textTransform: 'uppercase' as const,
                                        marginBottom: 8,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}>
                                        <span>⚠️</span>
                                        <span>VERIFY THIS LEG · {leg.confidence_score}% CONFIDENCE</span>
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                    {/* Entity name */}
                                    <input
                                        value={leg.entity_name}
                                        onChange={(e) => updateLeg(index, { entity_name: e.target.value })}
                                        style={{
                                            flex: 1,
                                            background: 'transparent',
                                            color: OW.t1,
                                            fontSize: 14,
                                            fontWeight: 600,
                                            border: 'none',
                                            borderBottom: `1px solid ${requiresAttention ? OW.borderWarn : OW.border}`,
                                            outline: 'none',
                                            padding: '4px 0',
                                        }}
                                    />

                                    {/* Market type badge */}
                                    <span style={{
                                        fontSize: 9,
                                        fontWeight: 700,
                                        color: OW.t3,
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase' as const,
                                        whiteSpace: 'nowrap' as const,
                                    }}>
                                        {leg.market_type.replace('_', ' ')}
                                    </span>

                                    {/* Line (if applicable) */}
                                    {leg.line !== null && (
                                        <input
                                            value={leg.line}
                                            type="text"
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '-' || val === '+' || val === '') {
                                                    // Allow intermediate typing states
                                                    return;
                                                }
                                                const parsed = parseFloat(val);
                                                if (!isNaN(parsed)) updateLeg(index, { line: parsed });
                                            }}
                                            style={{
                                                width: 56,
                                                background: 'transparent',
                                                color: OW.t1,
                                                fontSize: 13,
                                                fontFamily: 'monospace',
                                                fontWeight: 600,
                                                textAlign: 'right' as const,
                                                border: 'none',
                                                borderBottom: `1px solid ${OW.border}`,
                                                outline: 'none',
                                                padding: '4px 0',
                                            }}
                                        />
                                    )}

                                    {/* 🛡️ Odds: Safely handle typing negative American odds like "-110" */}
                                    <input
                                        value={leg.odds === 0 ? '' : leg.odds}
                                        type="text"
                                        placeholder="-110"
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            // Allow typing a bare minus/plus sign without crashing
                                            if (val === '-' || val === '+' || val === '') return;
                                            const parsed = parseInt(val, 10);
                                            if (!isNaN(parsed)) updateLeg(index, { odds: parsed });
                                        }}
                                        style={{
                                            width: 64,
                                            background: 'transparent',
                                            color: OW.mint,
                                            fontSize: 13,
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            textAlign: 'right' as const,
                                            border: 'none',
                                            borderBottom: `1px solid ${OW.border}`,
                                            outline: 'none',
                                            padding: '4px 0',
                                        }}
                                    />
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${OW.border}`, display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                {/* Stakes summary */}
                {(slip.total_stake || impliedPayout) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {slip.total_stake && (
                            <span style={{ fontSize: 12, color: OW.t2 }}>
                                Stake: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: OW.t1 }}>${slip.total_stake}</span>
                            </span>
                        )}
                        {impliedPayout && (
                            <span style={{ fontSize: 12, color: OW.t2 }}>
                                Potential: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: OW.mint }}>${impliedPayout.toLocaleString()}</span>
                            </span>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={onCancel}
                        style={{
                            flex: 1,
                            padding: '14px 0',
                            borderRadius: 10,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase' as const,
                            background: 'transparent',
                            color: OW.t3,
                            border: `1px solid ${OW.border}`,
                            cursor: 'pointer',
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={hasPendingReviews}
                        style={{
                            flex: 2,
                            padding: '14px 0',
                            borderRadius: 10,
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase' as const,
                            background: hasPendingReviews ? OW.surface : OW.mint,
                            color: hasPendingReviews ? OW.t3 : OW.bg,
                            border: 'none',
                            cursor: hasPendingReviews ? 'not-allowed' : 'pointer',
                            opacity: hasPendingReviews ? 0.5 : 1,
                            transition: 'all 0.2s',
                        }}
                    >
                        {hasPendingReviews ? 'Review Highlighted Fields' : 'Looks Good — Track Bet'}
                    </button>
                </div>
            </div>
        </div>
    );
}
