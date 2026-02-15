import React, { useMemo, useRef, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Activity } from "lucide-react";

export interface CitationSpan {
  startIndex: number;
  endIndex: number;
  url: string;
  title?: string;
}

interface Props {
  text: string;
  citations?: CitationSpan[];
}

const SECTION_HEADERS = new Set([
  "KEY FACTORS",
  "MARKET DYNAMICS",
  "WHAT TO WATCH",
]);

function flattenText(children: React.ReactNode): string {
  return React.Children.toArray(children).reduce<string>((acc, child) => {
    if (typeof child === "string") return acc + child;
    if (typeof child === "number") return acc + String(child);
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) return acc + flattenText(child.props.children);
    return acc;
  }, "");
}

function normalizeHeader(text: string): string {
  return text.toUpperCase().trim().replace(/^[●•·]\s*/, "");
}

function escapeTitle(title: string): string {
  return title.replace(/"/g, "'");
}

function applyCitationLinks(text: string, citations?: CitationSpan[]): string {
  if (!text || !citations?.length) return text;

  const sorted = citations
    .filter((c) => Number.isFinite(c.startIndex) && Number.isFinite(c.endIndex) && c.endIndex > c.startIndex)
    .sort((a, b) => b.startIndex - a.startIndex);

  if (!sorted.length) return text;

  let output = text;
  let cutoff = text.length + 1;

  for (const c of sorted) {
    let start = Math.max(0, Math.min(output.length, c.startIndex));
    let end = Math.max(0, Math.min(output.length, c.endIndex));
    if (end <= start) continue;

    const segment = output.slice(start, end);
    const newlineIndex = segment.indexOf("\n");
    if (newlineIndex !== -1) end = start + newlineIndex;

    while (start < end && /\s/.test(output[start])) start += 1;
    while (end > start && /\s/.test(output[end - 1])) end -= 1;
    while (end > start && /[.,;:)\]]/.test(output[end - 1])) end -= 1;
    while (start < end && /[(\[]/.test(output[start])) start += 1;

    if (end <= start) continue;
    if (end > cutoff) continue;
    if (!c.url) continue;

    const slice = output.slice(start, end);
    const title = c.title ? ` "${escapeTitle(c.title)}"` : "";
    const link = `[${slice}](${c.url}${title})`;
    output = output.slice(0, start) + link + output.slice(end);
    cutoff = start;
  }

  return output;
}

const REGEX_CITATION_PLACEHOLDER =
  /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;
const REGEX_MULTI_SPACE = /\s{2,}/g;

function stripCitationTokens(text: string): string {
  return text
    .replace(REGEX_CITATION_PLACEHOLDER, "")
    .replace(REGEX_MULTI_SPACE, " ")
    .trim();
}

const markdownComponents: Components = {
  p: ({ children }) => <span>{children}</span>,
  strong: ({ children }) => {
    const label = normalizeHeader(flattenText(children));
    if (SECTION_HEADERS.has(label)) {
      return (
        <span className="block mt-8 mb-3 flex items-center gap-2.5">
          <span className="w-4 h-4 rounded-[5px] bg-emerald-500/8 border border-emerald-500/12 flex items-center justify-center">
            <Activity size={9} className="text-emerald-500" />
          </span>
          <span className="text-[10px] font-mono font-medium text-zinc-400 uppercase tracking-[0.12em]">{children}</span>
        </span>
      );
    }
    return <strong className="font-semibold">{children}</strong>;
  },
  a: ({ href, children, title }) => (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-500/20 underline-offset-4 transition-colors"
    >
      {children}
    </a>
  ),
};

const RichTextWithCitations = ({ text, citations }: Props) => {
  const hydrated = useMemo(() => {
    const linked = applyCitationLinks(text, citations);
    return stripCitationTokens(linked);
  }, [text, citations]);
  if (!hydrated) return null;
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const debug = new URLSearchParams(window.location.search).get("debug");
    if (debug !== "citations") return;
    const html = containerRef.current?.innerHTML;
    if (!html) return;
    console.debug("[Citations] Rendered HTML:", html);
  }, [hydrated, citations]);
  return (
    <span ref={containerRef}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {hydrated}
      </ReactMarkdown>
    </span>
  );
};

export default RichTextWithCitations;
