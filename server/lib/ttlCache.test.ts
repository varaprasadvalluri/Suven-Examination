import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from './ttlCache';

// The cache sits in front of reads that the whole cohort makes at once, so the properties that
// matter are the ones that only show up under concurrency: that simultaneous misses share one
// read, and that a failure isn't held onto.
describe('TtlCache', () => {
  const build = () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, () => now);
    return { cache, advance: (ms: number) => (now += ms) };
  };

  it('serves a cached value without calling the loader again', async () => {
    const { cache } = build();
    const load = vi.fn().mockResolvedValue('value');

    expect(await cache.getOrLoad('k', load)).toBe('value');
    expect(await cache.getOrLoad('k', load)).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed', async () => {
    const { cache, advance } = build();
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    await cache.getOrLoad('k', load);
    advance(999);
    expect(await cache.getOrLoad('k', load)).toBe('first');
    advance(2);
    expect(await cache.getOrLoad('k', load)).toBe('second');
  });

  it('keeps keys apart', async () => {
    const { cache } = build();

    expect(await cache.getOrLoad('a', async () => 'A')).toBe('A');
    expect(await cache.getOrLoad('b', async () => 'B')).toBe('B');
  });

  it('joins concurrent misses onto one read instead of stampeding', async () => {
    const { cache } = build();
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => (release = resolve));
    const load = vi.fn().mockReturnValue(gate);

    const all = Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
    release('value');

    expect(await all).toEqual(['value', 'value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected read rather than replaying the failure for the rest of the TTL', async () => {
    const { cache } = build();
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('recovered');

    await expect(cache.getOrLoad('k', load)).rejects.toThrow('down');
    // Same instant, so a cached rejection would still be live here.
    expect(await cache.getOrLoad('k', load)).toBe('recovered');
  });

  it('propagates the rejection to everyone who joined the failed read', async () => {
    const { cache } = build();
    const load = vi.fn().mockRejectedValue(new Error('down'));

    const first = cache.getOrLoad('k', load);
    const joined = cache.getOrLoad('k', load);

    await expect(first).rejects.toThrow('down');
    await expect(joined).rejects.toThrow('down');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not let an in-flight read repopulate an entry cleared while it ran', async () => {
    const { cache } = build();
    let release!: (value: string) => void;
    const load = vi.fn().mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

    const inFlight = cache.getOrLoad('k', load);
    cache.clear();
    release('stale');
    await inFlight;

    await cache.getOrLoad('k', async () => 'fresh');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
