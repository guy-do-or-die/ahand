/**
 * A memory that forgets the least recently used entry first, bounded by a count and by a total
 * weight (bytes, for cards). A Map keeps insertion order, so a hit is moved to the end and the
 * first key is always the coldest.
 */
export class Lru<V> {
  private readonly entries = new Map<string, { value: V; weight: number }>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get weight(): number {
    return this.total;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, weight = 0): void {
    this.delete(key);
    this.entries.set(key, { value, weight });
    this.total += weight;
    this.trim();
  }

  /** Gives an entry its weight once known (a card's bytes after it is drawn), if it is still there. */
  weigh(key: string, value: V, weight: number): void {
    const entry = this.entries.get(key);
    if (!entry || entry.value !== value) return;
    this.total += weight - entry.weight;
    entry.weight = weight;
    this.trim();
  }

  delete(key: string, value?: V): void {
    const entry = this.entries.get(key);
    if (!entry || (value !== undefined && entry.value !== value)) return;
    this.entries.delete(key);
    this.total -= entry.weight;
  }

  private trim(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.total <= this.maxWeight) return;
      this.entries.delete(key);
      this.total -= entry.weight;
    }
  }
}
