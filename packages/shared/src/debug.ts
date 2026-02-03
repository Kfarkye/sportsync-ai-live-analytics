
/**
 * SRE Debug Manager - "No Guessing" Logging Infrastructure
 * Centralizes all trace logs for client-side identity and odds resolution.
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRACE';

interface DebugLog {
    timestamp: string;
    level: LogLevel;
    component: string;
    event: string;
    matchId?: string;
    data?: any;
}

class DebugManager {
    private logs: DebugLog[] = [];
    private maxLogs = 500;
    private subscribers: ((log: DebugLog) => void)[] = [];

    constructor() {
        if (typeof window !== 'undefined') {
            (window as any).__DEBUG_MANAGER = this;
            console.log("🚀 SRE DebugManager initialized. Inspect logs at window.__DEBUG_MANAGER.getLogs()");
        }
    }

    log(level: LogLevel, component: string, event: string, matchId?: string, data?: any) {
        const log: DebugLog = {
            timestamp: new Date().toISOString(),
            level,
            component,
            event,
            matchId,
            data
        };

        this.logs.unshift(log);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }

        // Emit to console in a structured way for the browser
        if (typeof window !== 'undefined') {
            const color = {
                TRACE: '#a855f7',
                INFO: '#3b82f6',
                WARN: '#f59e0b',
                ERROR: '#ef4444'
            }[level];

            console.log(
                `%c[${level}] [${component}] %c${event} ${matchId ? `(${matchId})` : ''}`,
                `color: ${color}; font-weight: bold;`,
                'color: inherit;',
                data || ''
            );
        }

        this.subscribers.forEach(sub => sub(log));
    }

    info(component: string, event: string, matchId?: string, data?: any) {
        this.log('INFO', component, event, matchId, data);
    }

    warn(component: string, event: string, matchId?: string, data?: any) {
        this.log('WARN', component, event, matchId, data);
    }

    error(component: string, event: string, matchId?: string, data?: any) {
        this.log('ERROR', component, event, matchId, data);
    }

    trace(component: string, event: string, matchId?: string, data?: any) {
        this.log('TRACE', component, event, matchId, data);
    }

    getLogs() {
        return this.logs;
    }

    getLogsForMatch(matchId: string) {
        return this.logs.filter(l => l.matchId === matchId || (l.data?.canonicalId === matchId));
    }

    subscribe(fn: (log: DebugLog) => void) {
        this.subscribers.push(fn);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== fn);
        };
    }

    clear() {
        this.logs = [];
    }
}

export const debugManager = new DebugManager();
