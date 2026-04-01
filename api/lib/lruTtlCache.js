// api/lib/lruTtlCache.js

export class LruTtlCache {
    constructor(opts) {
        if (!Number.isFinite(opts.maxEntries) || opts.maxEntries <= 0) {
            throw new Error(`LruTtlCache: invalid maxEntries=${opts.maxEntries}`);
        }
        if (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0) {
            throw new Error(`LruTtlCache: invalid ttlMs=${opts.ttlMs}`);
        }
        this.maxEntries = Math.floor(opts.maxEntries);
        this.ttlMs = Math.floor(opts.ttlMs);
        this.m = new Map();
    }

    has(key) {
        const e = this.m.get(key);
        if (!e) return false;
        if (Date.now() >= e.exp) {
            this.m.delete(key);
            return false;
        }
        // Touch for LRU bubbling
        this.m.delete(key);
        this.m.set(key, e);
        return true;
    }

    get(key) {
        const e = this.m.get(key);
        if (!e) return undefined;
        if (Date.now() >= e.exp) {
            this.m.delete(key);
            return undefined;
        }
        // Touch for LRU bubbling
        this.m.delete(key);
        this.m.set(key, e);
        return e.v;
    }

    set(key, value) {
        const exp = Date.now() + this.ttlMs;
        // Overwrite equals touch
        if (this.m.has(key)) this.m.delete(key);
        this.m.set(key, { v: value, exp });
        this.prune();
    }

    delete(key) { this.m.delete(key); }
    clear() { this.m.clear(); }

    prune() {
        const now = Date.now();
        for (const [k, e] of this.m) {
            if (now >= e.exp) this.m.delete(k);
        }
        while (this.m.size > this.maxEntries) {
            const oldestKey = this.m.keys().next().value;
            if (oldestKey === undefined) break;
            this.m.delete(oldestKey);
        }
    }
}
