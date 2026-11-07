import { createTtlCache } from "./ai";

// Guías de papel publicadas (`guides/{hash}.json`): el listado de
// Comunidad las usa para no ofrecer entradas cuyo attach daría 404.
// Recorrer R2 en cada GET salía caro; la lista es global y solo cambia
// al publicar una guía, así que vive en el isolate con TTL corto y se
// invalida explícitamente en la escritura que la modifica.
const guidesCache = createTtlCache<Set<string>>({
  maxEntries: 1,
  ttlMs: 60_000,
});
const GUIDES_CACHE_KEY = "published";

export function invalidateCommunityGuides(): void {
  guidesCache.clear();
}

// El aislante comparte la caché entre casos del mismo archivo de
// prueba; cada test vuelve a listar R2 desde cero.
export function resetCommunityGuidesCacheForTests(): void {
  guidesCache.clear();
}

export async function publishedGuideHashes(
  bucket: R2Bucket | undefined,
): Promise<Set<string> | null> {
  const cached = guidesCache.get(GUIDES_CACHE_KEY);
  if (cached) return cached;
  if (!bucket) return null;

  const hashes = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const listed = await bucket
      .list({ prefix: "guides/", cursor, limit: 1000 })
      .catch(() => null);
    if (!listed) return null;
    for (const object of listed.objects) {
      const match = /^guides\/([a-f0-9]{64})\.json$/.exec(object.key);
      if (match) hashes.add(match[1]);
    }
    if (!listed.truncated) {
      guidesCache.set(GUIDES_CACHE_KEY, hashes);
      return hashes;
    }
    cursor = listed.cursor;
  }
  guidesCache.set(GUIDES_CACHE_KEY, hashes);
  return hashes;
}
