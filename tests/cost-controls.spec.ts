import { CostControls } from '../src/cost-controls';
import { InMemoryCacheBackend } from '../src/in-memory-backend';
import { CacheBackend } from '../src/interfaces';

describe('CostControls', () => {
  let controls: CostControls;

  beforeEach(() => {
    controls = new CostControls();
  });

  describe('getConfig', () => {
    it('should return default config when no options provided', async () => {
      const config = await controls.getConfig();

      expect(config.rateLimitPerMinute).toBe(20);
      expect(config.cacheTtlSeconds).toBe(300);
      expect(config.dailyTokenBudget).toBe(100_000);
      expect(config.monthlyTokenBudget).toBe(2_000_000);
    });

    it('should merge static config overrides', async () => {
      controls = new CostControls({
        config: { rateLimitPerMinute: 10, cacheTtlSeconds: 60 }
      });

      const config = await controls.getConfig();

      expect(config.rateLimitPerMinute).toBe(10);
      expect(config.cacheTtlSeconds).toBe(60);
      expect(config.dailyTokenBudget).toBe(100_000);
      expect(config.monthlyTokenBudget).toBe(2_000_000);
    });

    it('should use configLoader values when provided', async () => {
      controls = new CostControls({
        configLoader: async () => ({
          dailyTokenBudget: 50_000,
          monthlyTokenBudget: 500_000
        })
      });

      const config = await controls.getConfig();

      expect(config.dailyTokenBudget).toBe(50_000);
      expect(config.monthlyTokenBudget).toBe(500_000);
    });

    it('should let configLoader override static config', async () => {
      controls = new CostControls({
        config: { rateLimitPerMinute: 10 },
        configLoader: async () => ({ rateLimitPerMinute: 5 })
      });

      const config = await controls.getConfig();

      expect(config.rateLimitPerMinute).toBe(5);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests within the rate limit', async () => {
      const allowed = await controls.checkRateLimit('user-1');

      expect(allowed).toBe(true);
    });

    it('should block requests exceeding the rate limit', async () => {
      controls = new CostControls({ config: { rateLimitPerMinute: 3 } });

      expect(await controls.checkRateLimit('user-1')).toBe(true);
      expect(await controls.checkRateLimit('user-1')).toBe(true);
      expect(await controls.checkRateLimit('user-1')).toBe(true);
      expect(await controls.checkRateLimit('user-1')).toBe(false);
    });

    it('should track rate limits per user', async () => {
      controls = new CostControls({ config: { rateLimitPerMinute: 1 } });

      expect(await controls.checkRateLimit('user-1')).toBe(true);
      expect(await controls.checkRateLimit('user-1')).toBe(false);

      // Different user should still be allowed
      expect(await controls.checkRateLimit('user-2')).toBe(true);
    });
  });

  describe('getCachedResponse / cacheResponse', () => {
    it('should return null for uncached queries', async () => {
      const result = await controls.getCachedResponse('user-1', 'test query');

      expect(result).toBeNull();
    });

    it('should return cached response for identical queries', async () => {
      await controls.cacheResponse('user-1', 'test query', 'cached answer');

      const result = await controls.getCachedResponse('user-1', 'test query');

      expect(result).toBe('cached answer');
    });

    it('should not return cache for different users', async () => {
      await controls.cacheResponse('user-1', 'test query', 'cached answer');

      const result = await controls.getCachedResponse('user-2', 'test query');

      expect(result).toBeNull();
    });

    it('should be case-insensitive and trim-aware', async () => {
      await controls.cacheResponse('user-1', 'Test Query', 'cached answer');

      const result = await controls.getCachedResponse(
        'user-1',
        '  test query  '
      );

      expect(result).toBe('cached answer');
    });
  });

  describe('trackTokenUsage', () => {
    it('should allow usage within budget', async () => {
      const allowed = await controls.trackTokenUsage('user-1', 500, 200);

      expect(allowed).toBe(true);
    });

    it('should reject when daily budget exceeded', async () => {
      controls = new CostControls({ config: { dailyTokenBudget: 1000 } });

      // Use 800 tokens
      expect(await controls.trackTokenUsage('user-1', 500, 300)).toBe(true);

      // Try to use 300 more (would exceed 1000)
      expect(await controls.trackTokenUsage('user-1', 200, 100)).toBe(false);
    });

    it('should track usage per user', async () => {
      controls = new CostControls({ config: { dailyTokenBudget: 1000 } });

      expect(await controls.trackTokenUsage('user-1', 900, 0)).toBe(true);

      // Different user should have separate budget
      expect(await controls.trackTokenUsage('user-2', 900, 0)).toBe(true);
    });
  });

  describe('getTokenUsage', () => {
    it('should return 0 for users with no usage', async () => {
      const usage = await controls.getTokenUsage('user-1', 'daily');

      expect(usage).toBe(0);
    });

    it('should return accumulated usage after tracking', async () => {
      await controls.trackTokenUsage('user-1', 500, 200);

      const usage = await controls.getTokenUsage('user-1', 'daily');

      expect(usage).toBe(700);
    });
  });

  describe('with custom CacheBackend', () => {
    it('should use the provided backend for caching', async () => {
      const mockBackend: CacheBackend = {
        get: jest.fn().mockResolvedValue('from-backend'),
        set: jest.fn().mockResolvedValue(undefined)
      };

      controls = new CostControls({ cacheBackend: mockBackend });

      const result = await controls.getCachedResponse('user-1', 'query');

      expect(result).toBe('from-backend');
      expect(mockBackend.get).toHaveBeenCalled();
    });

    it('should gracefully handle backend errors on read', async () => {
      const failingBackend: CacheBackend = {
        get: jest.fn().mockRejectedValue(new Error('connection refused')),
        set: jest.fn().mockResolvedValue(undefined)
      };

      const warnSpy = jest.fn();
      controls = new CostControls({
        cacheBackend: failingBackend,
        logger: { debug: jest.fn(), warn: warnSpy }
      });

      const result = await controls.getCachedResponse('user-1', 'query');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('connection refused')
      );
    });

    it('should gracefully handle backend errors on write', async () => {
      const failingBackend: CacheBackend = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockRejectedValue(new Error('write failed'))
      };

      const warnSpy = jest.fn();
      controls = new CostControls({
        cacheBackend: failingBackend,
        logger: { debug: jest.fn(), warn: warnSpy }
      });

      // Should not throw
      await controls.cacheResponse('user-1', 'query', 'response');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('write failed')
      );
    });
  });
});
