// ---------- Caché Deduplicado de IA por Hash SHA-256 (LRU 300) ----------

const workerAiMemoryCache = new Map<string, string>();
const MAX_WORKER_AI_CACHE = 300;

export async function computeAiCacheKey(
  task: string,
  payload: string,
): Promise<string> {
  const normalized = `${task}::${payload.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `ai:${task}:${hex}`;
}

export function getCachedAiText(key: string): string | null {
  const hit = workerAiMemoryCache.get(key);
  if (hit !== undefined) {
    workerAiMemoryCache.delete(key);
    workerAiMemoryCache.set(key, hit);
    return hit;
  }
  return null;
}

export function setCachedAiText(key: string, value: string): void {
  workerAiMemoryCache.delete(key);
  if (workerAiMemoryCache.size >= MAX_WORKER_AI_CACHE) {
    const oldest = workerAiMemoryCache.keys().next().value;
    if (oldest) workerAiMemoryCache.delete(oldest);
  }
  workerAiMemoryCache.set(key, value);
}
