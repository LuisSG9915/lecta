// Sastrería del compañero — herramienta de DESARROLLO.
//
// Sirve para llenar el apartado de arte nuevo sin adivinar: el gato grande,
// las guías anatómicas sacadas del propio dibujo (getBBox del gato real, no
// de una copia a mano), todas las capas conmutables y un banco de pruebas de
// `d` paths que se ve al instante. Al terminar, el botón copia el snippet con
// los seis sitios que hay que tocar (y `companion-art.test.ts` vigila que
// ninguno se quede atrás).
//
// No entra en el bundle: `vite build` sólo compila index.html. Se abre con
// `pnpm dev` en http://localhost:5173/sastreria.html

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../client/styles/fonts.css";
import "../client/styles/tokens.css";
import "../client/styles/base.css";
import "../client/styles/components.css";
import "../client/styles/game.css";
import { Companion, WEAR_LAYERS } from "../client/components/Companion";
import { CAT_BOX, STAGES } from "../client/components/companion-sprites";
import {
  COMPANION_ARTICLES,
  COMPANION_COATS,
  COMPANION_COAT_IDS,
  resolveCoatId,
  type CompanionArticle,
} from "../shared/companion-data";
import { ARTICLE_LABELS, ARTICLE_STORIES } from "../client/lib/companion-closet";

type Guide = { label: string; x: number; y: number; w: number; h: number };

// Anclas medidas sobre el gato dibujado: si el arte cambia, las guías lo
// siguen solas.
function readGuides(svg: SVGSVGElement | null): Guide[] {
  if (!svg) return [];
  const box = (selector: string, label: string): Guide | null => {
    const el = svg.querySelector(selector);
    if (!el) return null;
    const b = (el as SVGGraphicsElement).getBBox();
    return {
      label,
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  };
  return [
    box(".cat-head", "cabeza"),
    box(".cat-muzzle", "hocico"),
    box(".cat-body", "cuerpo"),
    box(".cat-ear--left", "oreja izq."),
    box(".cat-ear--right", "oreja der."),
    box(".cat-tail", "cola"),
  ].filter((g): g is Guide => g !== null);
}

function Sastreria() {
  const [stage, setStage] = useState(0);
  const [coat, setCoat] = useState<string>("pelaje-tuxedo");
  const [layer, setLayer] = useState<string>("");
  const [paths, setPaths] = useState("");
  const [color, setColor] = useState("#b23a2b");
  const [guides, setGuides] = useState(true);
  const [grid, setGrid] = useState(true);
  const [worn, setWorn] = useState<string[]>(["chaleco"]);
  const [tick, setTick] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const [medidas, setMedidas] = useState<Guide[]>([]);

  // Re-mide cuando cambia lo dibujado (capas, etapa, pelaje).
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg.cat") ?? null;
    setMedidas(readGuides(svg));
  }, [stage, coat, worn, tick]);

  const accessories = useMemo(() => [coat, ...worn], [coat, worn]);

  const testPaths = paths
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Quitar si ya está; si no, ponerla SUSTITUYENDO a la de su ranura (el
  // gato sólo lleva una por sitio). Así se puede montar un look completo.
  const slotOf = (id: string) =>
    WEAR_LAYERS.find((layer) => layer.ids.includes(id))?.slot;
  const toggle = (id: string) =>
    setWorn((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const slot = slotOf(id);
      return [...prev.filter((x) => slotOf(x) !== slot), id];
    });

  const snippet = () => {
    const id = layer || "nueva-prenda";
    const slot = (COMPANION_ARTICLES[id as CompanionArticle] ?? "head") as string;
    const d = testPaths.length
      ? testPaths.map((p) => `  \`${p}\`,`).join("\n")
      : "  `M …`,";
    return `// 1. shared/companion-data.ts → COMPANION_ARTICLES
  ${id}: "${slot}",

// 2. components/companion-sprites.ts → dentro de makeStage, junto a las demás
  wear.${id} = [
${d}
  ];

// 3. components/Companion.tsx → WEAR_LAYERS, en su ranura
  { slot: "${slot}", ids: [ … "${id}"] },

// 4. styles/game.css → color de los trazos
.cat .cat-wear--${id} path {
  fill: ${color};
  stroke: var(--ink);
  stroke-width: 1.2;
}

// 5. lib/companion-closet.ts → ARTICLE_LABELS y ARTICLE_STORIES
  ${id}: "Nombre de la prenda",
  ${id}: "Una línea de historia, en la voz del armario.",

// 6. fuente de desbloqueo (una de las dos)
//    gamification.ts → LEVEL_REWARDS[n] = "${id}"
//    o   ITEM_ACHIEVEMENT_REWARDS["${id}"] = { id: "<logro>", title: "<Logro>" }

// Y después: pnpm gate (companion-art.test.ts falla si falta cualquiera)`;
  };

  const [copiado, setCopiado] = useState("");

  return (
    <div style={{ display: "flex", gap: 24, padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ flex: "0 0 520px" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Sastrería del compañero</h1>
        <div
          ref={hostRef}
          style={{
            position: "relative",
            width: 480,
            height: 480,
            background: "var(--paper-raised, #fff)",
            border: "1px solid var(--rule, #ddd)",
            borderRadius: 12,
          }}
        >
          <Companion
            stage={stage}
            mood="awake"
            accessories={accessories}
            decorative
            size={480}
          />
          {grid ? (
            <svg
              viewBox={`0 0 ${CAT_BOX} ${CAT_BOX}`}
              width={480}
              height={480}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
              aria-hidden="true"
            >
              {Array.from({ length: 17 }, (_, i) => i * 10).map((v) => (
                <g key={v}>
                  <line
                    x1={v}
                    y1={0}
                    x2={v}
                    y2={CAT_BOX}
                    stroke="#000"
                    strokeWidth={v % 40 === 0 ? 0.4 : 0.12}
                    opacity={v % 40 === 0 ? 0.35 : 0.18}
                  />
                  <line
                    x1={0}
                    y1={v}
                    x2={CAT_BOX}
                    y2={v}
                    stroke="#000"
                    strokeWidth={v % 40 === 0 ? 0.4 : 0.12}
                    opacity={v % 40 === 0 ? 0.35 : 0.18}
                  />
                </g>
              ))}
              {guides
                ? medidas.map((g) => (
                    <g key={g.label}>
                      <rect
                        x={g.x}
                        y={g.y}
                        width={g.w}
                        height={g.h}
                        fill="none"
                        stroke="#1a7f6b"
                        strokeWidth={0.5}
                        strokeDasharray="2 2"
                      />
                      <text x={g.x} y={g.y - 2} fontSize={4} fill="#1a7f6b">
                        {g.label} {g.x},{g.y} {g.w}×{g.h}
                      </text>
                    </g>
                  ))
                : null}
              {testPaths.length ? (
                <g>
                  {testPaths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill={i === 0 ? color : "none"}
                      stroke={color}
                      strokeWidth={0.8}
                      opacity={0.85}
                    />
                  ))}
                </g>
              ) : null}
            </svg>
          ) : null}
        </div>
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Lienzo 160×160 · grid cada 10 · guías medidas del propio dibujo
        </p>
        <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
          />{" "}
          grid y banco de pruebas
        </label>
        <label style={{ fontSize: 13, display: "block" }}>
          <input
            type="checkbox"
            checked={guides}
            onChange={(e) => setGuides(e.target.checked)}
          />{" "}
          guías anatómicas
        </label>
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Las guías se miden del gato dibujado: si el arte cambia, se mueven
          solas. Usa el rectángulo de la cabeza para sombreros, el del hocico
          para cuello/gafas y el del cuerpo para capas.
        </p>
      </div>

      <div style={{ flex: 1, minWidth: 360 }}>
        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}>
          <legend style={{ fontSize: 12 }}>Gato</legend>
          <label style={{ fontSize: 13 }}>
            Etapa{" "}
            <input
              type="range"
              min={0}
              max={STAGES.length - 1}
              value={stage}
              onChange={(e) => setStage(Number(e.target.value))}
            />{" "}
            {stage}
          </label>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Pelaje{" "}
            <select value={coat} onChange={(e) => setCoat(e.target.value)}>
              {COMPANION_COAT_IDS.map((id) => (
                <option key={id} value={COMPANION_COATS[id].articleId}>
                  {COMPANION_COATS[id].name}
                </option>
              ))}
            </select>{" "}
            <button
              type="button"
              onClick={() => setCoat(COMPANION_COATS[resolveCoatId(null)].articleId)}
            >
              natural
            </button>
          </div>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}>
          <legend style={{ fontSize: 12 }}>Capas (una por ranura)</legend>
          {WEAR_LAYERS.map((l) => (
            <div key={l.slot} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{l.slot}</strong>:{" "}
              {l.ids.map((id) => (
                <label key={id} style={{ marginRight: 8 }}>
                  <input
                    type="checkbox"
                    checked={worn.includes(id)}
                    onChange={() => toggle(id)}
                  />{" "}
                  {ARTICLE_LABELS[id] ?? id}
                </label>
              ))}
            </div>
          ))}
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}>
          <legend style={{ fontSize: 12 }}>Banco de paths</legend>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
            Capa destino{" "}
            <input
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              placeholder="p. ej. pañuelo"
              style={{ width: 160 }}
            />{" "}
            color{" "}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <textarea
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            placeholder={"Un `d` por línea, coordenadas del lienzo 160×160:\nM 60 92 Q 80 104 100 92 L 98 100 Q 80 110 62 100 Z"}
            rows={6}
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                const text = snippet();
                void navigator.clipboard?.writeText(text).then(
                  () => setCopiado("Snippet copiado: seis puntos y el gate."),
                  () => setCopiado("No se pudo copiar; selecciona el texto."),
                );
              }}
            >
              Copiar snippet completo
            </button>{" "}
            <button type="button" onClick={() => setTick((t) => t + 1)}>
              Re-medir guías
            </button>
            <span style={{ fontSize: 12, marginLeft: 8, color: "#1a7f6b" }}>{copiado}</span>
          </div>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8 }}>
          <legend style={{ fontSize: 12 }}>Ficha de la prenda</legend>
          {worn.length === 0 ? (
            <p style={{ fontSize: 12, color: "#666" }}>
              Marca una capa para ver cómo se anunciaría en el armario.
            </p>
          ) : (
            worn.map((id) => (
              <p key={id} style={{ fontSize: 12, margin: "2px 0" }}>
                <strong>{ARTICLE_LABELS[id] ?? id}</strong> —{" "}
                {ARTICLE_STORIES[id] ?? "(sin historia)"}
              </p>
            ))
          )}
        </fieldset>
      </div>
    </div>
  );
}

const mount = document.getElementById("sastreria-root");
if (mount) createRoot(mount).render(<Sastreria />);
