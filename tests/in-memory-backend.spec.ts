import { InMemoryCacheBackend } from '../src/in-memory-backend';

describe('InMemoryCacheBackend', () => {
  let backend: InMemoryCacheBackend;

  beforeEach(() => {
    backend = new InMemoryCacheBackend();
  });

  it('should return null for missing keys', async () => {
    expect(await backend.get('missing')).toBeNull();
  });

  it('should store and retrieve values', async () => {
    await backend.set('key1', 'value1', 60_000);

    expect(await backend.get('key1')).toBe('value1');
  });

  it('should expire entries after TTL', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await backend.set('key1', 'value1', 1000);

    // Advance past TTL
    jest.spyOn(Date, 'now').mockReturnValue(now + 1001);

    expect(await backend.get('key1')).toBeNull();

    jest.restoreAllMocks();
  });

  it('should evict oldest entry when at max size', async () => {
    const small = new InMemoryCacheBackend(2);

    await small.set('a', '1', 60_000);
    await small.set('b', '2', 60_000);
    await small.set('c', '3', 60_000);

    expect(await small.get('a')).toBeNull();
    expect(await small.get('b')).toBe('2');
    expect(await small.get('c')).toBe('3');
  });

  it('should overwrite existing keys without eviction', async () => {
    const small = new InMemoryCacheBackend(2);

    await small.set('a', '1', 60_000);
    await small.set('b', '2', 60_000);
    await small.set('a', 'updated', 60_000);

    expect(small.size).toBe(2);
    expect(await small.get('a')).toBe('updated');
  });

  it('should clear all entries', async () => {
    await backend.set('a', '1', 60_000);
    await backend.set('b', '2', 60_000);

    backend.clear();

    expect(backend.size).toBe(0);
    expect(await backend.get('a')).toBeNull();
  });
});
