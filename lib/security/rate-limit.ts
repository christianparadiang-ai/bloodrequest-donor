import { NextRequest } from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp ms
  retryAfterSeconds?: number;
}

export interface RateLimiterStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface WindowRecord {
  timestamps: number[];
}

/**
 * In-memory sliding-window log rate limiter.
 * Suitable for single-node staging and development.
 * Designed with a store abstraction so distributed Redis/Upstash
 * adapters can be swapped in for multi-node deployments.
 */
export class InMemoryRateLimiter implements RateLimiterStore {
  private store = new Map<string, WindowRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically evict expired records every 60 seconds
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = this.store.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.store.set(key, record);
    }

    // Filter out timestamps outside the active window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= limit) {
      const oldestTimestamp = record.timestamps[0];
      const resetAt = oldestTimestamp + windowMs;
      const retryAfterSeconds = Math.ceil(Math.max(0, resetAt - now) / 1000);

      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        retryAfterSeconds,
      };
    }

    // Record this request
    record.timestamps.push(now);
    const resetAt = record.timestamps[0] + windowMs;

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - record.timestamps.length),
      resetAt,
    };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      // Remove records where all timestamps are older than 10 minutes
      if (record.timestamps.every((ts) => now - ts > 600000)) {
        this.store.delete(key);
      }
    }
  }
}

// Global singleton instance for in-memory rate limiting
export const globalRateLimiter = new InMemoryRateLimiter();

/**
 * Distributed Upstash Redis Rate Limiter Store (REST-based, zero extra dependencies).
 * Used when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are configured.
 */
export class UpstashRedisRateLimiter implements RateLimiterStore {
  constructor(
    private url: string,
    private token: string,
    private fallbackStore: RateLimiterStore = globalRateLimiter
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `ratelimit:${key}`;

    try {
      // Execute sliding window log pipeline via Upstash REST API
      const pipelineUrl = `${this.url}/pipeline`;
      const response = await fetch(pipelineUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["ZREMRANGEBYSCORE", redisKey, "0", String(windowStart)],
          ["ZCARD", redisKey],
          ["ZADD", redisKey, String(now), `${now}:${Math.random().toString(36).slice(2, 8)}`],
          ["EXPIRE", redisKey, String(Math.ceil(windowMs / 1000) * 2)],
        ]),
        // Fail-safe timeout: 1500ms max to prevent blocking edge workers
        signal: AbortSignal.timeout(1500),
      });

      if (!response.ok) {
        throw new Error(`Upstash returned HTTP ${response.status}`);
      }

      const results = await response.json();
      const currentCount = (results[1]?.result as number) || 0;

      if (currentCount >= limit) {
        const resetAt = now + windowMs;
        const retryAfterSeconds = Math.ceil(windowMs / 1000);
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt,
          retryAfterSeconds,
        };
      }

      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - currentCount - 1),
        resetAt: now + windowMs,
      };
    } catch (err) {
      // FAIL-SAFE: Gracefully fallback to in-memory rate limiter on network or Redis outage
      console.warn("Upstash rate limit request failed; falling back to in-memory store:", err);
      return this.fallbackStore.consume(key, limit, windowMs);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      const redisKey = `ratelimit:${key}`;
      await fetch(`${this.url}/del/${encodeURIComponent(redisKey)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      await this.fallbackStore.reset(key);
    }
  }
}

/**
 * Returns the appropriate rate limiter store based on environment configuration.
 */
export function getActiveRateLimiter(): RateLimiterStore {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    return new UpstashRedisRateLimiter(upstashUrl, upstashToken, globalRateLimiter);
  }

  return globalRateLimiter;
}

/**
 * Extracts and sanitizes client identification key from request headers.
 * Resolves trusted reverse proxy headers in priority order:
 * 1. cf-connecting-ip (Cloudflare edge)
 * 2. x-real-ip (Vercel edge / Nginx ingress)
 * 3. x-forwarded-for (Client proxy chain fallback)
 */
export function getClientIdentifier(
  req: NextRequest | { headers: Headers },
  prefix = "client"
): string {
  const cfIp = req.headers.get("cf-connecting-ip");
  const realIp = req.headers.get("x-real-ip");
  const forwarded = req.headers.get("x-forwarded-for");

  let rawIp = "127.0.0.1";
  if (cfIp) {
    rawIp = cfIp.trim();
  } else if (realIp) {
    rawIp = realIp.trim();
  } else if (forwarded) {
    rawIp = forwarded.split(",")[0].trim();
  }

  // Sanitize IP: permit only valid IPv4 / IPv6 hex and separator characters to prevent key injection
  const sanitizedIp = rawIp.replace(/[^a-fA-F0-9.:]/g, "").slice(0, 45);
  return `${prefix}:${sanitizedIp || "127.0.0.1"}`;
}

/**
 * Checks rate limit for a given endpoint and returns HTTP response if breached.
 */
export async function checkRateLimit(
  req: NextRequest,
  options: {
    prefix?: string;
    limit?: number;
    windowMs?: number;
  } = {}
): Promise<RateLimitResult> {
  const { prefix = "api", limit = 60, windowMs = 60000 } = options;
  const key = getClientIdentifier(req, prefix);
  const limiter = getActiveRateLimiter();
  return limiter.consume(key, limit, windowMs);
}
