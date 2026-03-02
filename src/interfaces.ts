/**
 * Pluggable cache backend interface.
 * Implement with ioredis, node-redis, @upstash/redis, Cloudflare KV, etc.
 */
export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

/** Cost controls configuration values. */
export interface CostControlsConfig {
  rateLimitPerMinute: number;
  cacheTtlSeconds: number;
  dailyTokenBudget: number;
  monthlyTokenBudget: number;
}

/** Minimal logger interface — bring your own logger. */
export interface Logger {
  debug(msg: string): void;
  warn(msg: string): void;
}

/** Constructor options for CostControls. */
export interface CostControlsOptions {
  /** Static config overrides (merged with defaults). */
  config?: Partial<CostControlsConfig>;
  /** Cache backend — defaults to InMemoryCacheBackend. */
  cacheBackend?: CacheBackend;
  /** Dynamic config loader (e.g., from DB). Called on each operation. */
  configLoader?: () => Promise<Partial<CostControlsConfig>>;
  /** Optional logger. */
  logger?: Logger;
}

/** Default configuration values. */
export const DEFAULT_CONFIG: CostControlsConfig = {
  rateLimitPerMinute: 20,
  cacheTtlSeconds: 300,
  dailyTokenBudget: 100_000,
  monthlyTokenBudget: 2_000_000
};
