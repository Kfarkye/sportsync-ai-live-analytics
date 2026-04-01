// lib/proof-rules.ts
// Purpose: Proof section must be explicit. If no sources, show "No sources available".

export type ProofSource = {
    title: string;
    url?: string;
    book?: string;
    line?: string;
};

export type ProofBlock = {
    label: string; // "Proof"
    sources: ProofSource[];
    emptyText: string; // "No sources available"
};

export function buildProofBlock(sources: ProofSource[] | null | undefined): ProofBlock {
    const safe = Array.isArray(sources) ? sources.filter(Boolean) : [];
    return {
        label: "Proof",
        sources: safe,
        emptyText: "No sources available",
    };
}
