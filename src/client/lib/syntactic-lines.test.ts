// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applySyntacticLines,
  clearSyntacticLines,
  SYNTACTIC_LINE_CLASS,
  syntacticBreaks,
  syntacticSegments,
} from "./syntactic-lines";

const LONG =
  "El gato dormía sobre los libros viejos de la biblioteca, pero " +
  "cuando entró la luz de la tarde abrió un ojo. Miró la ventana, " +
  "bostezó despacio y volvió a acomodarse entre las páginas, porque " +
  "el silencio del lugar era su mejor almohada. Nadie lo molestaba " +
  "jamás en esas horas mientras la tarde caía sobre los estantes.";

describe("syntacticBreaks / syntacticSegments", () => {
  it("corta tras puntuación fuerte cuando ambos lados tienen cuerpo", () => {
    const segs = syntacticSegments(
      "La tarde caía lenta sobre el pueblo. El gato cerró los ojos.",
    );
    expect(segs).toEqual([
      "La tarde caía lenta sobre el pueblo.",
      "El gato cerró los ojos.",
    ]);
  });

  it("corta antes de conectores solo con línea ya larga", () => {
    const segs = syntacticSegments(LONG);
    // «porque» y «mientras» abren línea nueva; «pero» queda dentro
    // de la suya porque el corte anterior cayó en «de la biblioteca».
    expect(segs.some((s) => s.startsWith("porque"))).toBe(true);
    expect(segs.some((s) => s.startsWith("mientras"))).toBe(true);
    expect(segs.some((s) => s.includes(", pero "))).toBe(true);
    // Toda la cadena queda cubierta: sin pérdida de texto.
    expect(segs.join(" ").replace(/\s+/g, " ")).toBe(
      LONG.replace(/\s+/g, " ").trim(),
    );
  });

  it("no parte conectores al inicio de una línea corta", () => {
    // «y» muy pronto y el corte tras «fue.» dejaría un fragmento
    // diminuto: el párrafo queda en una sola línea.
    const segs = syntacticSegments("Vino y se fue. Descansó.");
    expect(segs).toEqual(["Vino y se fue. Descansó."]);
  });

  it("no deja fragmentos diminutos al final", () => {
    const text = `${"largo ".repeat(12)}final. Ya.`;
    for (const seg of syntacticSegments(text)) {
      expect(seg.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("el texto sin puntuación ni conectores queda en una línea", () => {
    const segs = syntacticSegments("una sola frase corrida aquí");
    expect(segs).toEqual(["una sola frase corrida aquí"]);
    // Corte fuerte con ambos lados con cuerpo: posición exacta.
    const t = "Esta frase es lo bastante larga. Y esta otra también lo es.";
    expect(syntacticBreaks(t)).toEqual([t.indexOf("Y ")]);
    // Un fragmento diminuto descarta el corte.
    expect(syntacticBreaks("corto. Fin.")).toEqual([]);
  });
});

describe("applySyntacticLines / clearSyntacticLines", () => {
  const para = (text: string) => {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  };

  it("envuelve cada unidad en un span de línea", () => {
    const root = document.createElement("div");
    root.append(para(LONG));
    applySyntacticLines(root);
    const lines = root.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0].textContent).toContain("El gato dormía");
    // El texto total se conserva (espacios inter-linea aparte).
    const joined = [...lines]
      .map((l) => l.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    expect(joined).toBe(LONG);
  });

  it("respeta elementos anidados sin rasgarlos", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.innerHTML = `Llegó muy tarde aquella noche de invierno. <em>Después de la lluvia</em> siguió el camino largo y cansado hacia casa sin prisa.`;
    root.append(p);
    applySyntacticLines(root);
    const em = p.querySelector("em");
    expect(em?.textContent).toBe("Después de la lluvia");
    // El <em> completo vive dentro de una sola línea.
    expect(em?.closest(`.${SYNTACTIC_LINE_CLASS}`)).not.toBeNull();
  });

  it("no toca la tarjeta «Antes de leer» ni contenido no prosa", () => {
    const root = document.createElement("div");
    const slot = document.createElement("div");
    slot.className = "section-preview-slot";
    slot.append(para(LONG));
    const pre = document.createElement("pre");
    pre.textContent = LONG;
    root.append(slot, pre);
    applySyntacticLines(root);
    expect(root.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`)).toHaveLength(0);
  });

  it("es idempotente y desenrolla sin perder marcas", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.innerHTML = `Llegó muy tarde aquella noche de invierno. <mark class="saved-word">Marcada</mark> siguió el camino largo hacia su casa.`;
    root.append(p);
    applySyntacticLines(root);
    applySyntacticLines(root);
    expect(p.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`).length).toBeGreaterThan(0);
    clearSyntacticLines(root);
    expect(root.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`)).toHaveLength(0);
    expect(root.querySelector("mark.saved-word")?.textContent).toBe("Marcada");
    expect(p.textContent).toContain("Llegó muy tarde");
  });
});
