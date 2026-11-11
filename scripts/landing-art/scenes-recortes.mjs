// Recortes del gato con fondo transparente para la landing web: una
// figura por etapa del sendero (0 → 4) y el gato de noche con audífonos.
// Salen a `marketing/landing/gato-*.png`; la landing usa las versiones
// `.webp` de `marketing/landing/web/`.
import { cat, filters } from "./kit.mjs";

const CSS = `
  .cat-slot{position:absolute}
  .cat-slot svg{display:block;overflow:visible}
  .no-shadow .cat-ground-shadow{display:none}
  .plush svg{filter:url(#plush)}
`;

const S = 360;
const recorte = (name, spec) => ({
  name,
  width: S,
  height: S,
  transparent: true,
  css: CSS,
  html: `${filters({ blur: 6, depth: 5, spec: 0.5 })}${cat(spec, `left:20px;top:16px;width:${S - 40}px;height:${S - 40}px`, "plush no-shadow")}`,
});

const COATS = ["ginger", "tuxedo", "latte", "mist", "calico"];

// Una figura por pelaje y etapa: `gato-<pelaje>-<etapa>`. El gato que la
// persona elige en la landing la acompaña por todo el sendero.
export const RECORTES = COATS.flatMap((coatId) =>
  [0, 1, 2, 3, 4].map((stage) =>
    recorte(`gato-${coatId}-${stage}`, {
      stage,
      coatId,
      mood: stage === 4 ? "happy" : "idle",
      accessories: stage === 4 ? ["bufanda"] : [],
    }),
  ),
);
