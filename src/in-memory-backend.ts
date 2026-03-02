import { CacheBackend } from './interfaces';

/**
 * Zero-dependency in-memory cache backend.
 * Suitable for single-process deployments. For multi-process or serverless,
 * provide a Redis/KV CacheBackend instead.
 */
export class InMemoryCacheBackend implements CacheBackend {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private readonly maxSize: number;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  /** Number of entries currently stored (including expired). */
  get size(): number {
    return this.store.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }
}
