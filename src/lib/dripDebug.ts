
/* src/lib/dripDebug.ts
   Meticulous structured debugging for SportSync AI ("The Drip")
   - Ring buffer log store (in-memory + optional localStorage persistence)
   - Spans/timers
   - Console groups (collapsed) with structured meta
   - Global access: window.__DRIP_DEBUG__
*/

export type DripLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DripLogEntry = {
  ts: string;              // ISO timestamp
  t: number;               // performance.now
  level: DripLogLevel;
  scope: string;           // "useMatchData"
  event: string;           // "edge.invoke.start", "edge.invoke.end", etc.
  message?: string;
  meta?: Record<string, DripMetaValue>;
};

type DripSpan = {
  id: string;
  name: string;
  scope: string;
  start: number;
  startIso: string;
  meta?: Record<string, DripMetaValue>;
};

type DripLoggerOptions = {
  scope: string;
  maxEntries?: number;
  enabled?: boolean;
  persist?: boolean; // persist ring buffer into localStorage
  persistKey?: string;
  consoleEcho?: boolean; // echo to console
};

const DEFAULT_MAX = 600;
const DEFAULT_PERSIST_KEY = '__drip_debug_logs__';
const DEFAULT_FLAGS_KEY = '__drip_debug_flags__';

function nowIso() {
  return new Date().toISOString();
}

type DripMetaValue = string | number | boolean | null | DripMetaValue[] | { [key: string]: DripMetaValue };
type Serializable = DripMetaValue | undefined;

function safeStringify(value: Serializable): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function clampRing<T>(arr: T[], max: number) {
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

function loadFlags(): { enabled?: boolean; persist?: boolean; consoleEcho?: boolean } {
  try {
    const raw = localStorage.getItem(DEFAULT_FLAGS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    return {
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : undefined,
      persist: typeof obj.persist === 'boolean' ? obj.persist : undefined,
      consoleEcho: typeof obj.consoleEcho === 'boolean' ? obj.consoleEcho : undefined,
    };
  } catch {
    return {};
  }
}

function saveFlags(flags: { enabled?: boolean; persist?: boolean; consoleEcho?: boolean }) {
  try {
    localStorage.setItem(DEFAULT_FLAGS_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

function loadPersisted(key: string): DripLogEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DripLogEntry[];
  } catch {
    return [];
  }
}

function persistLogs(key: string, logs: DripLogEntry[]) {
  try {
    localStorage.setItem(key, safeStringify(logs));
  } catch {
    // ignore
  }
}

function consoleEmit(entry: DripLogEntry) {
  const label = `[${entry.scope}] ${entry.event}`;
  const payload = entry.meta ? { ...entry.meta } : undefined;

  switch (entry.level) {
    case 'debug':
      console.debug(label, entry.message ?? '', payload ?? '');
      break;
    case 'info':
      console.info(label, entry.message ?? '', payload ?? '');
      break;
    case 'warn':
      console.warn(label, entry.message ?? '', payload ?? '');
      break;
    case 'error':
      console.error(label, entry.message ?? '', payload ?? '');
      break;
  }
}

export class DripLogger {
  private scope: string;
  private maxEntries: number;
  private enabled: boolean;
  private persist: boolean;
  private persistKey: string;
  private consoleEcho: boolean;

  private logs: DripLogEntry[] = [];
  private spans = new Map<string, DripSpan>();

  constructor(opts: DripLoggerOptions) {
    const flags = typeof window !== 'undefined' ? loadFlags() : {};

    this.scope = opts.scope;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX;

    // Priority: constructor opts -> persisted flags -> env-ish defaults
    this.enabled = (opts.enabled ?? flags.enabled) ?? true;
    this.persist = (opts.persist ?? flags.persist) ?? false;
    this.persistKey = opts.persistKey ?? DEFAULT_PERSIST_KEY;
    this.consoleEcho = (opts.consoleEcho ?? flags.consoleEcho) ?? true;

    if (this.persist) {
      this.logs = clampRing(loadPersisted(this.persistKey), this.maxEntries);
    }

    // Expose a global handle for quick inspection in devtools.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__DRIP_DEBUG__ = (window as any).__DRIP_DEBUG__ ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = (window as any).__DRIP_DEBUG__;
    root.getLogs = () => this.getLogs();
    root.clearLogs = () => this.clear();
    root.setEnabled = (v: boolean) => this.setEnabled(v);
    root.setPersist = (v: boolean) => this.setPersist(v);
    root.setConsoleEcho = (v: boolean) => this.setConsoleEcho(v);
    root.help = () => ({
      usage: [
        "window.__DRIP_DEBUG__.getLogs()",
        "window.__DRIP_DEBUG__.clearLogs()",
        "window.__DRIP_DEBUG__.setEnabled(true|false)",
        "window.__DRIP_DEBUG__.setPersist(true|false)",
        "window.__DRIP_DEBUG__.setConsoleEcho(true|false)",
      ],
      flagsKey: DEFAULT_FLAGS_KEY,
      logsKey: this.persistKey,
    });
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    saveFlags({ enabled: v, persist: this.persist, consoleEcho: this.consoleEcho });
  }

  setPersist(v: boolean) {
    this.persist = v;
    saveFlags({ enabled: this.enabled, persist: v, consoleEcho: this.consoleEcho });
    if (v) persistLogs(this.persistKey, this.logs);
  }

  setConsoleEcho(v: boolean) {
    this.consoleEcho = v;
    saveFlags({ enabled: this.enabled, persist: this.persist, consoleEcho: v });
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.spans.clear();
    if (this.persist) persistLogs(this.persistKey, this.logs);
  }

  log(level: DripLogLevel, event: string, message?: string, meta?: Record<string, DripMetaValue>) {
    if (!this.enabled) return;

    const entry: DripLogEntry = {
      ts: nowIso(),
      t: performance.now(),
      level,
      scope: this.scope,
      event,
      message,
      meta,
    };

    this.logs = clampRing([...this.logs, entry], this.maxEntries);

    if (this.persist) persistLogs(this.persistKey, this.logs);
    if (this.consoleEcho) consoleEmit(entry);
  }

  groupCollapsed(title: string, meta?: Record<string, DripMetaValue>) {
    if (!this.enabled) return;
    try {
      console.groupCollapsed(title);

    } catch {
      // ignore
    }
  }

  groupEnd() {
    if (!this.enabled) return;
    try {
      console.groupEnd();
    } catch {
      // ignore
    }
  }

  startSpan(name: string, meta?: Record<string, DripMetaValue>) {
    const id = `${name}:${Math.random().toString(16).slice(2)}`;
    const span: DripSpan = {
      id,
      name,
      scope: this.scope,
      start: performance.now(),
      startIso: nowIso(),
      meta,
    };
    this.spans.set(id, span);
    this.log('debug', `${name}.start`, undefined, { spanId: id, ...meta });
    return id;
  }

  endSpan(spanId: string, meta?: Record<string, DripMetaValue>) {
    const span = this.spans.get(spanId);
    if (!span) {
      this.log('warn', 'span.end.missing', 'Span not found', { spanId, ...meta });
      return { ms: -1 };
    }
    const ms = Math.round(performance.now() - span.start);
    this.spans.delete(spanId);
    this.log('debug', `${span.name}.end`, undefined, { spanId, ms, ...span.meta, ...meta });
    return { ms };
  }
}
