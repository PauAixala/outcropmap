// A small, explicitly bounded LRU cache. Insertion order in a Map already tracks recency: a re-get
// or re-set moves the entry to the end, and the oldest entry (the first key) is evicted on overflow.

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    private readonly maxSize: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {
    if (maxSize <= 0) throw new Error('LruCache maxSize must be positive');
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestValue = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (this.onEvict && oldestValue !== undefined) this.onEvict(oldestKey, oldestValue);
    }
  }

  /** Explicit removal also triggers the eviction callback (closing a bitmap, say), same as an
   * LRU-driven eviction or `clear()` -- callers that need to drop a specific entry (e.g.
   * `TileManager.invalidateLayer`) rely on this to release its resources deterministically. */
  delete(key: K): boolean {
    if (!this.map.has(key)) return false;
    const value = this.map.get(key);
    this.map.delete(key);
    if (this.onEvict && value !== undefined) this.onEvict(key, value);
    return true;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) this.onEvict(key, value);
    }
    this.map.clear();
  }
}
