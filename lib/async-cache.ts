// Small bounded cache for read-only data. Clearing also detaches pending reads,
// so a late response cannot repopulate a newer session's cache.
export function createAsyncCache<T>({
  maxEntries = 60,
  retentionMs = 300_000,
  now = () => Date.now(),
}: { maxEntries?: number; retentionMs?: number; now?: () => number } = {}) {
  const entries = new Map<
    string,
    { value?: T; at: number; pending?: Promise<T> }
  >();
  function peek(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry || now() - entry.at >= retentionMs) return undefined;
    return entry.value;
  }
  function read(
    key: string,
    load: () => Promise<T>,
    maxAgeMs: number,
  ): Promise<T> {
    const existing = entries.get(key);
    if (existing?.pending) return existing.pending;
    if (existing?.value !== undefined && now() - existing.at < maxAgeMs)
      return Promise.resolve(existing.value);
    const entry = existing ?? { at: 0 };
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries)
      entries.delete(entries.keys().next().value!);
    const pending = Promise.resolve()
      .then(load)
      .then((value) => {
        if (entries.get(key) === entry) {
          entry.value = value;
          entry.at = now();
        }
        return value;
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined;
      });
    entry.pending = pending;
    return pending;
  }
  return { peek, read, clear: () => entries.clear() };
}
