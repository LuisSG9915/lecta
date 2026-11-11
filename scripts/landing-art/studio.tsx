// Estudio de arte de la landing: monta el gato REAL de la app (mismo
// componente, misma geometría, mismo CSS) dentro de una página que
// Playwright fotografía. No se importa desde la app: solo lo empaqueta
// `scripts/landing-art/render.mjs` con esbuild.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Companion, type CompanionProps } from "../../src/client/components/Companion";
import "../../src/client/styles/fonts.css";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/game.css";

type CatSpec = Partial<CompanionProps>;

function mountCats(root: ParentNode): number {
  const slots = root.querySelectorAll<HTMLElement>("[data-cat]");
  slots.forEach((slot) => {
    const spec = JSON.parse(slot.dataset.cat || "{}") as CatSpec;
    flushSync(() => {
      createRoot(slot).render(
        <Companion
          stage={3}
          mood="idle"
          accessories={[]}
          decorative
          still
          size="100%"
          {...spec}
        />,
      );
    });
  });
  return slots.length;
}

(window as unknown as { mountCats: typeof mountCats }).mountCats = mountCats;
