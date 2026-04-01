
/**
 * Resilience patterns for API integration
 * - Circuit Breaker
 * - Cache
 * - Rate Limiter
 * - Retry Logic
 * - Request Queue
 */

// ============================================================================
// LOGGER
// ============================================================================
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel = 'info';

  private formatData(data?: any): string {
    if (data === undefined || data === null) return '';
    if (typeof data === 'string') return data;
    if (data instanceof Error) return `${data.name}: ${data.message}\n${data.stack || ''}`;
    
    if (typeof data === 'object') {
      try {
        return JSON.stringify(data, (key, value) => {
          // Custom replacer to handle Error objects nested inside the data
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
              ...value // Include any other custom properties
            };
          }
          return value;
        }, 2);
      } catch (e) {
        return String(data);
      }
    }
    return String(data);
  }

  debug(context: string, message: string, data?: any) {
    if (this.level === 'debug') console.debug(`[${context}] ${message}`, data || '');
  }
  
  info(context: string, message: string, data?: any) {
    console.info(`[${context}] ${message}`, data || '');
  }

  warn(context: string, message: string, data?: any) {
    const dataStr = this.formatData(data);
    console.warn(`[${context}] ${message}`, dataStr);
  }

  error(context: string, message: string, data?: any) {
    const dataStr = this.formatData(data);
    console.error(`[${context}] ${message}`, dataStr);
  }
}

export const logger = new Logger();

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================
interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts?: number;
}

export class CircuitBreaker {
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private failures = 0;
    private lastFailureTime = 0;
    private successfulHalfOpenAttempts = 0;
    private readonly name: string;
    private readonly options: CircuitBreakerOptions;

    constructor(name: string, options: CircuitBreakerOptions) {
        this.name = name;
        this.options = options;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.options.resetTimeoutMs) {
                this.transition('HALF_OPEN');
            } else {
                throw new Error(`CircuitBreaker '${this.name}' is OPEN`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successfulHalfOpenAttempts++;
            this.transition('CLOSED');
        } else if (this.state === 'CLOSED') {
            this.failures = 0;
        }
    }

    private onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.state === 'HALF_OPEN' || this.failures >= this.options.failureThreshold) {
            this.transition('OPEN');
        }
    }

    private transition(newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN') {
        this.state = newState;
        if (newState === 'CLOSED') {
            this.failures = 0;
            this.successfulHalfOpenAttempts = 0;
        }
    }

    getState() { return this.state; }
    reset() { this.transition('CLOSED'); }
}

// ============================================================================
// CACHE
// ============================================================================
export class Cache<T> {
    private map = new Map<string, { val: T, exp: number }>();
    private readonly maxEntries: number;
    private readonly ttlMs: number;

    constructor(maxEntries: number, ttlMs: number) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | null {
        const entry = this.map.get(key);
        if (!entry) return null;
        if (Date.now() > entry.exp) {
            this.map.delete(key);
            return null;
        }
        return entry.val;
    }

    set(key: string, val: T) {
        if (this.map.size >= this.maxEntries) {
            const firstKey = this.map.keys().next().value;
            if (firstKey) this.map.delete(firstKey);
        }
        this.map.set(key, { val, exp: Date.now() + this.ttlMs });
    }

    clear() { this.map.clear(); }
    
    getStats() {
        return { size: this.map.size };
    }
}

// ============================================================================
// RATE LIMITER
// ============================================================================
interface RateLimiterOptions {
    maxRequests: number;
    windowMs: number;
}

export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly maxRequests: number;
    private readonly windowMs: number;

    constructor(options: RateLimiterOptions) {
        this.maxRequests = options.maxRequests;
        this.windowMs = options.windowMs;
        this.tokens = options.maxRequests;
        this.lastRefill = Date.now();
    }

    async acquire(): Promise<void> {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return;
        }
        
        // Wait until next token available
        const waitTime = this.windowMs / this.maxRequests; 
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.acquire();
    }

    private refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed > this.windowMs) {
            this.tokens = this.maxRequests;
            this.lastRefill = now;
        }
    }

    getAvailableTokens() { return this.tokens; }
}

// ============================================================================
// REQUEST QUEUE
// ============================================================================
export class RequestQueue {
    private queue: (() => Promise<void>)[] = [];
    private activeCount = 0;
    private readonly maxConcurrent: number;
    private readonly rateLimiter?: RateLimiter;

    constructor(maxConcurrent: number, rateLimit?: { maxRequests: number, windowMs: number }) {
        this.maxConcurrent = maxConcurrent;
        if (rateLimit) {
            this.rateLimiter = new RateLimiter(rateLimit);
        }
    }

    async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrapper = async () => {
                // Wait for rate limiter if configured
                if (this.rateLimiter) {
                    await this.rateLimiter.acquire();
                }

                try {
                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                } finally {
                    this.activeCount--;
                    this.processNext();
                }
            };

            this.queue.push(wrapper);
            this.processNext();
        });
    }

    private processNext() {
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;
        
        this.activeCount++;
        const next = this.queue.shift();
        if (next) {
            // execute without awaiting here to allow concurrency
            next(); 
        } else {
            this.activeCount--;
        }
    }

    getQueueLength() { return this.queue.length; }
    getActiveCount() { return this.activeCount; }
}

// ============================================================================
// UTILS
// ============================================================================
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: ${context}`)), timeoutMs);
    });
    
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timer);
        return result;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

export async function withRetry<T>(
    fn: () => Promise<T>, 
    options: { maxAttempts: number, baseDelayMs: number }, 
    context: string
): Promise<T> {
    let lastError: any;
    for (let i = 0; i < options.maxAttempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const delay = options.baseDelayMs * Math.pow(2, i);
            if (i < options.maxAttempts - 1) {
                // console.warn(`[${context}] Attempt ${i+1} failed. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

export async function resilientFetch(
    url: string, 
    options: RequestInit = {}, 
    config: { timeoutMs?: number, retry?: { maxAttempts: number, baseDelayMs: number } } = {}
): Promise<Response> {
    
    const doFetch = async () => {
        const res = await fetch(url, options);
        if (!res.ok) {
            // Throw on server errors or rate limits to trigger retry logic
            if (res.status >= 500 || res.status === 429) {
                throw new Error(`Request failed with status ${res.status}`);
            }
        }
        return res;
    };

    let task = doFetch;

    if (config.retry) {
        const originalTask = task;
        task = () => withRetry(originalTask, config.retry!, `fetch:${url}`);
    }

    let promise = task();

    if (config.timeoutMs) {
        promise = withTimeout(promise, config.timeoutMs, `fetch:${url}`);
    }

    return promise;
}
