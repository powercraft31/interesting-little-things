/**
 * B6 Abuse-Control Middleware — rate limiting for POST /api/auth/login
 *
 * - RateLimitStore interface with Redis and Memory implementations
 * - Per-IP (10/15min) and per-email (5/15min) thresholds
 * - 429 with Retry-After header and standard fail envelope
 * - Post-handler hook: failure increments both; success resets email only
 */
import type { Request, Response, NextFunction } from "express";
import { fail } from "../../shared/types/api";

// ── Store interface ─────────────────────────────────────────────────────

export interface RateLimitStore {
  /** Increment counter for key. Returns count after increment. Sets TTL on first increment. */
  increment(key: string, windowSeconds: number): Promise<number>;
  /** Reset counter for key. */
  reset(key: string): Promise<void>;
  /** Current count for key. 0 if key doesn't exist or is expired. */
  getCount(key: string): Promise<number>;
  /** Remaining TTL in seconds for key. 0 if key doesn't exist. */
  getRemainingTtl(key: string): Promise<number>;
}

// ── MemoryRateLimitStore ────────────────────────────────────────────────

interface MemoryEntry {
  count: number;
  expiresAt: number; // epoch ms
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, MemoryEntry>();

  async increment(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing && existing.expiresAt > now) {
      existing.count += 1;
      return existing.count;
    }

    const entry: MemoryEntry = {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    };
    this.entries.set(key, entry);
    return 1;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async getCount(key: string): Promise<number> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return entry.count;
  }

  async getRemainingTtl(key: string): Promise<number> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
}

// ── RedisRateLimitStore ─────────────────────────────────────────────────

// Redis client interface — matches the subset of ioredis we use.
// Avoids compile-time dependency on ioredis types so tests can run without it installed.
interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisClient;

  constructor(redisUrl: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    }) as RedisClient;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count;
  }

  async reset(key: string): Promise<void> {
    await this.client.del(key);
  }

  async getCount(key: string): Promise<number> {
    const val = await this.client.get(key);
    return val ? parseInt(val, 10) : 0;
  }

  async getRemainingTtl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return ttl > 0 ? ttl : 0;
  }
}

// ── Constants ───────────────────────────────────────────────────────────

const WINDOW_SECONDS = 900; // 15 minutes
const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;
const RATE_LIMIT_MESSAGE = "Too many login attempts. Try again later.";

// ── Threshold-hit hook (WS4: bounded auth anomaly runtime fact) ─────────

export type AbuseControlThresholdReason =
  | "ip_threshold_exceeded"
  | "email_threshold_exceeded";

export interface AbuseControlThresholdEvent {
  readonly tenantScope: string;
  readonly reason: AbuseControlThresholdReason;
  readonly retryAfterSeconds: number;
}

export interface AbuseControlMiddlewareOptions {
  /**
   * Fires exactly once per preHandler call that results in a 429, so the
   * BFF runtime spine can convert it into a bounded `bff.auth.anomaly_burst`
   * fact. Errors inside the hook are swallowed — they must never surface to
   * the client or break the 429 response contract.
   */
  readonly onThresholdHit?: (
    event: AbuseControlThresholdEvent,
  ) => Promise<void> | void;
}

// ── Middleware factory ──────────────────────────────────────────────────

export function createAbuseControlMiddleware(
  store: RateLimitStore,
  options: AbuseControlMiddlewareOptions = {},
) {
  function normalizeEmail(raw: unknown): string | null {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    return raw.trim().toLowerCase();
  }

  async function fireThresholdHit(
    event: AbuseControlThresholdEvent,
  ): Promise<void> {
    if (!options.onThresholdHit) return;
    try {
      await options.onThresholdHit(event);
    } catch (err) {
      // Never break auth or 429 response because of a runtime hook.
      console.error("[rate-limit] onThresholdHit hook failed:", err);
    }
  }

  async function preHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = req.ip ?? "unknown";
    const email = normalizeEmail(req.body?.email);

    const ipKey = `login_ip:${ip}`;
    const emailKey = email ? `login_email:${email}` : null;

    // Check IP threshold (count from prior failed attempts)
    const ipCount = await store.getCount(ipKey);
    if (ipCount >= IP_LIMIT) {
      const retryAfter = await store.getRemainingTtl(ipKey);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json(fail(RATE_LIMIT_MESSAGE));
      await fireThresholdHit({
        tenantScope: `ip:${ip}`,
        reason: "ip_threshold_exceeded",
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    // Check email threshold
    if (emailKey) {
      const emailCount = await store.getCount(emailKey);
      if (emailCount >= EMAIL_LIMIT) {
        const retryAfter = await store.getRemainingTtl(emailKey);
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json(fail(RATE_LIMIT_MESSAGE));
        await fireThresholdHit({
          tenantScope: `email:${email}`,
          reason: "email_threshold_exceeded",
          retryAfterSeconds: retryAfter,
        });
        return;
      }
    }

    next();
  }

  async function postHandler(req: Request, res: Response): Promise<void> {
    const ip = req.ip ?? "unknown";
    const email = normalizeEmail(req.body?.email);
    const ipKey = `login_ip:${ip}`;
    const emailKey = email ? `login_email:${email}` : null;

    if (res.statusCode === 200) {
      // Success: reset email counter, do NOT reset IP counter
      if (emailKey) {
        await store.reset(emailKey);
      }
    } else {
      // Failure (401 or other): increment both counters
      await store.increment(ipKey, WINDOW_SECONDS);
      if (emailKey) {
        await store.increment(emailKey, WINDOW_SECONDS);
      }
    }
  }

  return { preHandler, postHandler };
}

// ── Store selection ─────────────────────────────────────────────────────

export function selectRateLimitStore(): RateLimitStore {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isDev = nodeEnv === "development";
  const redisUrl = process.env.RATE_LIMIT_REDIS_URL;

  if (isDev && !redisUrl) {
    console.log("[rate-limit] Development mode: using in-memory rate-limit store");
    return new MemoryRateLimitStore();
  }

  if (redisUrl) {
    console.log("[rate-limit] Using Redis rate-limit store");
    return new RedisRateLimitStore(redisUrl);
  }

  // Non-dev without Redis URL — fatal
  console.error(
    "[rate-limit] FATAL: RATE_LIMIT_REDIS_URL is required in production. " +
    "Cannot start with degraded abuse control.",
  );
  process.exit(1);
}
