/**
 * Keeps only the latest record per (pet, title). If a vaccine was applied again,
 * the previous due date no longer counts as pending.
 */
export function latestPerItem<T extends { petId: string; title: string; date: Date }>(
  records: T[],
): T[] {
  const latest = new Map<string, T>();
  for (const r of records) {
    const key = `${r.petId}:${r.title.trim().toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || prev.date < r.date) latest.set(key, r);
  }
  return [...latest.values()];
}
