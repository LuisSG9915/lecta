import { useSyncExternalStore } from "react";

// Media query reactiva con useSyncExternalStore: lee matchMedia en
// getSnapshot, así el primer render ya trae el valor real sin parpadeo.
// Sin matchMedia (jsdom u otros entornos) siempre regresa false — los
// componentes que la usan deben tratar false como «móvil».
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}
