// Enlace directo a un libro (?abrir=<sha256>), p. ej. el botón del correo de
// regreso (docs/designs/2026-11-24-correo-de-regreso.md). Solo hashes sha256:
// las obras de pantalla y otros ids no son libros que se abran así.
const SHA256 = /^[0-9a-f]{64}$/;

export function parseOpenBookParam(value: string | null | undefined): string | null {
  const hash = value?.trim().toLowerCase() ?? "";
  return SHA256.test(hash) ? hash : null;
}

export function findDeepLinkItem<T extends { hash: string }>(library: T[], hash: string | null): T | null {
  if (!hash) return null;
  return library.find((item) => item.hash === hash) ?? null;
}
