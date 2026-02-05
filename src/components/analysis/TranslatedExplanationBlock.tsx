
import React, { useState } from 'react';
import { TranslatedExplanation } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

interface TranslatedExplanationBlockProps {
    explanation: TranslatedExplanation;
    theme?: 'emerald' | 'violet';
}

/**
 * PRODUCTION-GRADE CONTEXTUAL TRANSLATION
 * 
 * SEMANTIC RULES:
 * - This block is a DERIVATIVE of the numeric signal
 * - It adds NO new information, only translates
 * - Visual hierarchy: Anchor Data → Plain Language → Trust Marker
 * 
 * VISUAL SEMANTICS:
 * - Subdued palette: This is supplementary, not primary
 * - Collapsed by default: User must opt-in to detail
 * - Grid structure: Financial-grade data presentation
 */
export const TranslatedExplanationBlock: React.FC<TranslatedExplanationBlockProps> = ({
    explanation,
    theme = 'violet'
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const themeTokens = {
        emerald: {
            accent: 'text-emerald-400',
            border: 'border-emerald-500/15',
            bar: 'bg-emerald-500/40',
            hoverBorder: 'hover:border-emerald-500/30'
        },
        violet: {
            accent: 'text-violet-400',
            border: 'border-violet-500/15',
            bar: 'bg-violet-500/40',
            hoverBorder: 'hover:border-violet-500/30'
        }
    };

    const tokens = themeTokens[theme];

    return (
        <div className={`mt-8 pt-6 border-t ${tokens.border}`}>
            {/* === TRIGGER BUTTON === */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between group transition-all duration-300 py-2 px-1 -mx-1 rounded-md ${tokens.hoverBorder} border border-transparent`}
            >
                <div className="flex items-center gap-4">
                    <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                        Contextual Translation
                    </span>
                    {/* Expanding line - indicates interactivity */}
                    <div className="h-[1px] w-6 bg-zinc-800 group-hover:w-10 transition-all duration-500" />
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400 transition-colors">
                        {isOpen ? 'Close' : 'View'}
                    </span>
                    {/* Geometric Toggle - No icons, pure CSS */}
                    <div className="relative w-3 h-3 flex items-center justify-center">
                        <div className={`absolute w-[10px] h-[1.5px] bg-zinc-600 rounded-full transition-all duration-400 group-hover:bg-zinc-400 ${isOpen ? 'rotate-0 opacity-0' : ''}`} />
                        <div className={`absolute w-[1.5px] h-[10px] bg-zinc-600 rounded-full transition-all duration-400 group-hover:bg-zinc-400 ${isOpen ? 'rotate-90 opacity-0' : ''}`} />
                        <div className={`absolute w-[10px] h-[1.5px] bg-zinc-600 rounded-full transition-all duration-400 group-hover:bg-zinc-400 ${isOpen ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, y: 8 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: 4 }}
                        transition={{ duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="pt-6 space-y-6">
                            {/* === ANCHOR DATA GRID === */}
                            {/* Financial-style: Each cell is atomic, scannable */}
                            <div className="grid grid-cols-4 gap-[1px] bg-zinc-900/50 rounded-md overflow-hidden border border-white/[0.04]">
                                {[
                                    { label: 'Signal', value: explanation.signal, isHighlight: true },
                                    { label: 'Market Total', value: explanation.market_total },
                                    { label: 'Game Clock', value: explanation.time },
                                    { label: 'Current Score', value: explanation.score }
                                ].map((item, i) => (
                                    <div
                                        key={i}
                                        className="bg-[#0A0A0A] p-4 flex flex-col justify-between min-h-[72px] group/cell hover:bg-[#0C0C0C] transition-colors duration-300"
                                    >
                                        <span className="text-[9px] text-zinc-600 uppercase font-bold tracking-[0.15em] leading-none">
                                            {item.label}
                                        </span>
                                        <span className={`text-[12px] font-bold tracking-tight mt-2 tabular-nums ${item.isHighlight ? tokens.accent : 'text-zinc-200'}`}>
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* === NARRATIVE BLOCK === */}
                            <div className="relative p-5 rounded-md bg-[#0A0A0A] border border-white/[0.04]">
                                {/* Semantic Accent: Connects to parent confidence color */}
                                <div className={`absolute left-0 top-0 w-[2px] h-full rounded-full ${tokens.bar}`} />
                                <p className="pl-4 text-[12px] text-zinc-300 leading-[1.8] font-medium">
                                    {explanation.why_now}
                                </p>
                            </div>

                            {/* === TRUST MARKER === */}
                            {/* Subdued: This is metadata, not content */}
                            <div className="flex items-center gap-3 opacity-50">
                                <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                                <span className="text-[9px] text-zinc-600 uppercase font-semibold tracking-[0.15em]">
                                    Derivative Logic Block // Locked Signal
                                </span>
                                <div className="flex-grow h-[1px] bg-zinc-900" />
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
