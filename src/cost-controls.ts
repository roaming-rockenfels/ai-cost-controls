import { createHash } from 'node:crypto';

import { InMemoryCacheBackend } from './in-memory-backend';
import {
  CacheBackend,
  CostControlsConfig,
  CostControlsOptions,
  DEFAULT_CONFIG,
  Logger
} from './interfaces';

interface RateLimitEntry {
  timestamps: number[];
}

const NOOP_LOGGER: Logger = {
  debug() {},
  warn() {}
};

/**
 * Framework-agnostic AI cost controls: rate limiting, response caching,
 * and token budget tracking with pluggable cache backends.
 */
export class CostControls {
  private readonly backend: CacheBackend;
  private readonly staticConfig: CostControlsConfig;
  private readonly configLoader?: () => Promise<Partial<CostControlsConfig>>;
  private readonly logger: Logger;

  /** In-memory rate limit store (always local — not backed by CacheBackend). */
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  constructor(options?: CostControlsOptions) {
    this.backend = options?.cacheBackend ?? new InMemoryCacheBackend();
    this.configLoader = options?.configLoader;
    this.logger = options?.logger ?? NOOP_LOGGER;
    this.staticConfig = { ...DEFAULT_CONFIG, ...options?.config };
  }

  /**
   * Resolve config: static defaults merged with configLoader result (if provided).
   */
  async getConfig(): Promise<CostControlsConfig> {
    if (!this.configLoader) {
      return this.staticConfig;
    }

    const dynamic = await this.configLoader();

    return {
      ...this.staticConfig,
      ...dynamic
    };
  }

  /**
   * Check and enforce per-user rate limiting.
   * Returns true if the request is allowed, false if rate-limited.
   */
  async checkRateLimit(userId: string): Promise<boolean> {
    const config = await this.getConfig();
    const now = Date.now();
    const windowMs = 60_000;

    let entry = this.rateLimits.get(userId);

    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(userId, entry);
    }

    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

    if (entry.timestamps.length >= config.rateLimitPerMinute) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  /**
   * Get a cached response for a query, if one exists within the cache TTL.
   */
  async getCachedResponse(
    userId: string,
    message: string
  ): Promise<string | null> {
    const cacheKey = this.buildCacheKey(userId, message);

    try {
      const cached = await this.backend.get(cacheKey);

      if (cached) {
        this.logger.debug(`Cache hit for user ${userId}`);
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        `Cache read failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return null;
  }

  /**
   * Store a response in the cache for future identical queries.
   */
  async cacheResponse(
    userId: string,
    message: string,
    response: string
  ): Promise<void> {
    const config = await this.getConfig();
    const cacheKey = this.buildCacheKey(userId, message);
    const ttlMs = config.cacheTtlSeconds * 1000;

    try {
      await this.backend.set(cacheKey, response, ttlMs);
    } catch (error) {
      this.logger.warn(
        `Cache write failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Track token usage for a user. Returns false if budget is exceeded.
   */
  async trackTokenUsage(
    userId: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<boolean> {
    const config = await this.getConfig();
    const dailyKey = this.buildTokenKey(userId, 'daily');
    const monthlyKey = this.buildTokenKey(userId, 'monthly');
    const totalTokens = inputTokens + outputTokens;

    // Read current usage
    let dailyUsage = 0;
    let monthlyUsage = 0;

    try {
      const [dailyRaw, monthlyRaw] = await Promise.all([
        this.backend.get(dailyKey),
        this.backend.get(monthlyKey)
      ]);
      dailyUsage = dailyRaw ? parseInt(dailyRaw, 10) : 0;
      monthlyUsage = monthlyRaw ? parseInt(monthlyRaw, 10) : 0;
    } catch (error) {
      this.logger.warn(
        `Token usage read failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (dailyUsage + totalTokens > config.dailyTokenBudget) {
      this.logger.warn(`Daily token budget exceeded for user ${userId}`);
      return false;
    }

    if (monthlyUsage + totalTokens > config.monthlyTokenBudget) {
      this.logger.warn(`Monthly token budget exceeded for user ${userId}`);
      return false;
    }

    // Write updated usage with appropriate TTLs
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const dailyTtl = endOfDay.getTime() - Date.now();

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1);
    endOfMonth.setHours(0, 0, 0, 0);
    const monthlyTtl = endOfMonth.getTime() - Date.now();

    try {
      await Promise.all([
        this.backend.set(dailyKey, String(dailyUsage + totalTokens), dailyTtl),
        this.backend.set(
          monthlyKey,
          String(monthlyUsage + totalTokens),
          monthlyTtl
        )
      ]);
    } catch (error) {
      this.logger.warn(
        `Token usage write failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return true;
  }

  /**
   * Get current token usage for a user within the specified period.
   */
  async getTokenUsage(
    userId: string,
    period: 'daily' | 'monthly'
  ): Promise<number> {
    const key = this.buildTokenKey(userId, period);

    try {
      const value = await this.backend.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch {
      return 0;
    }
  }

  // --- Private helpers ---

  private buildCacheKey(userId: string, message: string): string {
    const hash = createHash('sha256')
      .update(message.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);

    return `ai-cache:${userId}:${hash}`;
  }

  private buildTokenKey(
    userId: string,
    period: 'daily' | 'monthly'
  ): string {
    const now = new Date();

    if (period === 'daily') {
      return `ai-tokens:${userId}:daily:${now.toISOString().slice(0, 10)}`;
    }

    return `ai-tokens:${userId}:monthly:${now.toISOString().slice(0, 7)}`;
  }
}
