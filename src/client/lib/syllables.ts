// Separación silábica en español (fonológica / ortográfica estándar de la RAE).
// Útil para la micro-glosa de lectura rápida y apoyo léxico en concentración / TDAH.

const STRONG_VOWELS = new Set(["a", "e", "o", "á", "é", "ó", "í", "ú"]);
const WEAK_VOWELS = new Set(["i", "u", "ü"]);
const ALL_VOWELS = new Set([...STRONG_VOWELS, ...WEAK_VOWELS]);

const INSEPARABLE_CLUSTERS = new Set([
  "bl", "cl", "fl", "gl", "kl", "pl",
  "br", "cr", "dr", "fr", "gr", "kr", "pr", "tr",
  "ch", "ll", "rr",
]);

export function syllabifySpanish(word: string, separator = "·"): string {
  const clean = word.trim();
  if (!clean || clean.length <= 2) return clean;

  // Si contiene caracteres no alfabéticos, devolver tal cual
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/u.test(clean)) return clean;

  const chars = Array.from(clean);
  const n = chars.length;
  const isVowel = (idx: number) => {
    if (idx < 0 || idx >= n) return false;
    return ALL_VOWELS.has(chars[idx].toLowerCase());
  };

  const isStrong = (idx: number) => {
    if (idx < 0 || idx >= n) return false;
    return STRONG_VOWELS.has(chars[idx].toLowerCase());
  };

  // Encontrar posiciones de vocales
  const vowelIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isVowel(i)) vowelIndices.push(i);
  }

  // 0 o 1 vocal = monosílabo (o sin vocales)
  if (vowelIndices.length <= 1) return clean;

  const cuts: number[] = [];

  // Analizar intervalos entre núcleos vocálicos consecutivos
  for (let v = 0; v < vowelIndices.length - 1; v++) {
    const v1 = vowelIndices[v];
    const v2 = vowelIndices[v + 1];
    const consCount = v2 - v1 - 1;

    if (consCount === 0) {
      // Dos vocales juntas: hiato o diptongo
      // Hiato: dos vocales fuertes (po-e-ta) o fuerte + débil con acento (he-ge-mo-ní-a)
      if (isStrong(v1) && isStrong(v2)) {
        cuts.push(v2);
      }
    } else if (consCount === 1) {
      // Una consonante entre vocales: va con la segunda (ca-sa)
      cuts.push(v1 + 1);
    } else if (consCount === 2) {
      // Dos consonantes:
      const cluster = (chars[v1 + 1] + chars[v1 + 2]).toLowerCase();
      if (INSEPARABLE_CLUSTERS.has(cluster)) {
        // Inseparable va con la segunda vocal (ha-blar, pa-dre, co-che)
        cuts.push(v1 + 1);
      } else {
        // Se separan (ac-to, can-tar, ob-jeto)
        cuts.push(v1 + 2);
      }
    } else if (consCount === 3) {
      // Tres consonantes: las dos primeras con la anterior salvo que las dos últimas sean inseparables
      const lastTwo = (chars[v2 - 2] + chars[v2 - 1]).toLowerCase();
      if (INSEPARABLE_CLUSTERS.has(lastTwo)) {
        // ej. es-tre-lla, des-pre-cio
        cuts.push(v2 - 2);
      } else {
        // ej. trans-por-te, cons-pi-rar
        cuts.push(v2 - 1);
      }
    } else if (consCount >= 4) {
      // Cuatro consonantes: dos y dos (cons-truc-ción)
      cuts.push(v1 + 3);
    }
  }

  if (cuts.length === 0) return clean;

  const syllables: string[] = [];
  let start = 0;
  for (const c of cuts) {
    syllables.push(clean.slice(start, c));
    start = c;
  }
  syllables.push(clean.slice(start));
  return syllables.join(separator);
}
