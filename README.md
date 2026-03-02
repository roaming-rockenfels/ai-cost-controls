# ai-cost-controls

Framework-agnostic AI cost controls: per-user rate limiting, token budget tracking, and response caching with pluggable cache backends.

**Zero runtime dependencies.** Bring your own cache backend (ioredis, @upstash/redis, Cloudflare KV, etc.) or use the built-in in-memory backend.

## Install

```bash
npm install ai-cost-controls
```

## Quick Start

```typescript
import { CostControls } from 'ai-cost-controls';

const controls = new CostControls({
  config: {
    rateLimitPerMinute: 20,
    dailyTokenBudget: 100_000,
  },
});

// Check rate limit before making an AI call
if (!(await controls.checkRateLimit(userId))) {
  throw new Error('Rate limited');
}

// Check cache first
const cached = await controls.getCachedResponse(userId, userMessage);
if (cached) return cached;

// After getting AI response, cache it and track tokens
await controls.cacheResponse(userId, userMessage, aiResponse);
await controls.trackTokenUsage(userId, inputTokens, outputTokens);
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `rateLimitPerMinute` | `20` | Max requests per user per minute |
| `cacheTtlSeconds` | `300` | Response cache TTL (5 minutes) |
| `dailyTokenBudget` | `100,000` | Max tokens per user per day |
| `monthlyTokenBudget` | `2,000,000` | Max tokens per user per month |

### Static Config

```typescript
const controls = new CostControls({
  config: {
    rateLimitPerMinute: 10,
    dailyTokenBudget: 50_000,
  },
});
```

### Dynamic Config (e.g., from database)

```typescript
const controls = new CostControls({
  configLoader: async () => {
    const row = await db.query('SELECT * FROM ai_config LIMIT 1');
    return {
      rateLimitPerMinute: row.rate_limit,
      dailyTokenBudget: row.daily_budget,
    };
  },
});
```

## Cache Backends

The package ships with `InMemoryCacheBackend` (single-process only). For production multi-process or serverless deployments, implement the `CacheBackend` interface with your preferred client.

### Interface

```typescript
interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}
```

### ioredis

```typescript
import Redis from 'ioredis';
import { CostControls, CacheBackend } from 'ai-cost-controls';

const redis = new Redis();

const redisBackend: CacheBackend = {
  async get(key) {
    return redis.get(key);
  },
  async set(key, value, ttlMs) {
    await redis.set(key, value, 'PX', ttlMs);
  },
};

const controls = new CostControls({ cacheBackend: redisBackend });
```

### @upstash/redis

```typescript
import { Redis } from '@upstash/redis';
import { CostControls, CacheBackend } from 'ai-cost-controls';

const redis = new Redis({ url: '...', token: '...' });

const upstashBackend: CacheBackend = {
  async get(key) {
    return redis.get<string>(key);
  },
  async set(key, value, ttlMs) {
    await redis.set(key, value, { px: ttlMs });
  },
};

const controls = new CostControls({ cacheBackend: upstashBackend });
```

### Cloudflare KV

```typescript
import { CacheBackend } from 'ai-cost-controls';

// In a Cloudflare Worker
const kvBackend: CacheBackend = {
  async get(key) {
    return env.AI_CACHE.get(key);
  },
  async set(key, value, ttlMs) {
    await env.AI_CACHE.put(key, value, { expirationTtl: Math.ceil(ttlMs / 1000) });
  },
};
```

## Framework Integration

### Vercel AI SDK

```typescript
import { streamText } from 'ai';
import { CostControls } from 'ai-cost-controls';

const controls = new CostControls();

async function chat(userId: string, message: string) {
  if (!(await controls.checkRateLimit(userId))) {
    return new Response('Rate limited', { status: 429 });
  }

  const cached = await controls.getCachedResponse(userId, message);
  if (cached) return new Response(cached);

  const result = await streamText({ model, messages: [{ role: 'user', content: message }] });
  const text = await result.text;

  await controls.cacheResponse(userId, message, text);
  await controls.trackTokenUsage(userId, result.usage.promptTokens, result.usage.completionTokens);

  return new Response(text);
}
```

### Express Middleware

```typescript
import express from 'express';
import { CostControls } from 'ai-cost-controls';

const controls = new CostControls();
const app = express();

app.use('/ai', async (req, res, next) => {
  const userId = req.user.id;

  if (!(await controls.checkRateLimit(userId))) {
    return res.status(429).json({ error: 'Rate limited' });
  }

  next();
});
```

## API Reference

### `new CostControls(options?: CostControlsOptions)`

Creates a new instance.

### `checkRateLimit(userId: string): Promise<boolean>`

Returns `true` if the request is allowed, `false` if rate-limited.

### `getCachedResponse(userId: string, message: string): Promise<string | null>`

Returns a cached response or `null`. Cache keys are case-insensitive and trim-aware.

### `cacheResponse(userId: string, message: string, response: string): Promise<void>`

Stores a response in the cache.

### `trackTokenUsage(userId: string, inputTokens: number, outputTokens: number): Promise<boolean>`

Tracks token usage. Returns `false` if the daily or monthly budget would be exceeded.

### `getTokenUsage(userId: string, period: 'daily' | 'monthly'): Promise<number>`

Returns current token usage for the specified period.

### `getConfig(): Promise<CostControlsConfig>`

Returns the resolved configuration (static defaults merged with `configLoader` result).

## License

MIT
