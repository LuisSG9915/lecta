// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applySyntacticLines,
  clearSyntacticLines,
  SYNTACTIC_LINE_CLASS,
  syntacticBreaks,
  syntacticSegments,
  splitSentenceIntoSyntacticChunks,
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

  it("marca data-sub en conectores subordinados y data-new-sentence en oraciones nuevas", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.textContent =
      "El gato dormía sobre los libros viejos, porque la tarde estaba fría. Despertó con calma.";
    root.append(p);
    applySyntacticLines(root);
    const lines = p.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`);
    const subLine = Array.from(lines).find((l) =>
      l.textContent?.trim().startsWith("porque"),
    );
    expect(subLine?.hasAttribute("data-sub")).toBe(true);

    const newSentLine = Array.from(lines).find((l) =>
      l.textContent?.trim().startsWith("Despertó"),
    );
    expect(newSentLine?.hasAttribute("data-new-sentence")).toBe(true);
  });

  it("etiqueta conectores complejos con data-connector='true' para fijación sacádica", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.textContent =
      "El camino era largo y pedregoso; sin embargo, el viajero continuó sin descanso hasta la cima.";
    root.append(p);
    applySyntacticLines(root);
    const connectors = root.querySelectorAll("[data-connector='true']");
    expect(connectors.length).toBeGreaterThan(0);
    expect(Array.from(connectors).some((c) => c.textContent?.toLowerCase() === "sin embargo")).toBe(true);

    // clearSyntacticLines lo limpia todo sin perder el texto
    clearSyntacticLines(root);
    expect(root.querySelectorAll("[data-connector='true']")).toHaveLength(0);
    expect(p.textContent).toBe(
      "El camino era largo y pedregoso; sin embargo, el viajero continuó sin descanso hasta la cima.",
    );
  });

  it("asigna ciclo 0..3 a los chunks cuando chromaticGuide está activo", () => {
    const root = document.createElement("div");
    root.append(para(LONG));
    applySyntacticLines(root, { chromaticGuide: true, syntacticLines: true });
    const chunks = root.querySelectorAll(".lecta-syntactic-chunk");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].getAttribute("data-chunk-cycle")).toBe("0");
    expect(chunks[1].getAttribute("data-chunk-cycle")).toBe("1");
    if (chunks.length > 2) expect(chunks[2].getAttribute("data-chunk-cycle")).toBe("2");
    if (chunks.length > 3) expect(chunks[3].getAttribute("data-chunk-cycle")).toBe("3");
  });

  it("soporta guía cromática inline cuando syntacticLines es false", () => {
    const root = document.createElement("div");
    root.append(para(LONG));
    applySyntacticLines(root, { chromaticGuide: true, syntacticLines: false });
    // No debe tener syn-line (no saltos de bloque)
    expect(root.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`)).toHaveLength(0);
    const inlineChunks = root.querySelectorAll(".lecta-syntactic-chunk[data-inline='true']");
    expect(inlineChunks.length).toBeGreaterThan(0);
    expect(inlineChunks[0].hasAttribute("data-chunk-cycle")).toBe(true);
  });

  it("inyecta anclajes biónicos en palabras clave omitiendo stopwords y elementos mark", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.innerHTML =
      "El gato dormía tranquilamente sobre la alfombra. <mark class='target'>Biblioteca</mark> cerrada.";
    root.append(p);
    applySyntacticLines(root, { bionicAnchors: true, syntacticLines: true });

    const anchors = root.querySelectorAll(".lecta-fixation-anchor");
    expect(anchors.length).toBeGreaterThan(0);
    // Palabras como "gato" o "tranquilamente" deben tener ancla de 1 a 3 letras
    const anchorTexts = Array.from(anchors).map((a) => a.textContent);
    expect(anchorTexts).toContain("ga");
    // "El" o "sobre" o "la" son stopwords y no deben ser anclas
    expect(anchorTexts).not.toContain("El");
    expect(anchorTexts).not.toContain("sobre");

    // Comprobar clases semánticas biónicas OBJ-01
    const bionicAnchors = root.querySelectorAll(".lecta-bionic-anchor");
    expect(bionicAnchors.length).toBe(anchors.length);
    const bionicWords = root.querySelectorAll(".lecta-bionic-word");
    expect(bionicWords.length).toBe(anchors.length);
    const bionicRests = root.querySelectorAll(".lecta-bionic-rest");
    expect(bionicRests.length).toBe(anchors.length);

    // Dentro del elemento mark no debe haberse inyectado anclaje
    const markEl = p.querySelector("mark.target");
    expect(markEl?.querySelector(".lecta-fixation-anchor")).toBeNull();
    expect(markEl?.querySelector(".lecta-bionic-anchor")).toBeNull();

    // clearSyntacticLines restaura el texto perfectamente sin alterar nada
    clearSyntacticLines(root);
    expect(root.querySelectorAll(".lecta-fixation-anchor")).toHaveLength(0);
    expect(root.querySelectorAll(".lecta-bionic-anchor")).toHaveLength(0);
    expect(root.querySelectorAll(".lecta-bionic-word")).toHaveLength(0);
    expect(p.querySelector("mark.target")?.textContent).toBe("Biblioteca");
    expect(p.textContent).toBe(
      "El gato dormía tranquilamente sobre la alfombra. Biblioteca cerrada.",
    );
  });
});

describe("splitSentenceIntoSyntacticChunks", () => {
  it("mantiene palabras sueltas si la oración tiene 5 o menos palabras", () => {
    const res = splitSentenceIntoSyntacticChunks("El libro tiene páginas.");
    expect(res).toEqual(["El", "libro", "tiene", "páginas."]);
  });

  it("divide oraciones largas en 4 a 6 fragmentos con sentido y puntuación pegada", () => {
    const sentence =
      "En aquel jardín silencioso, los cisnes blancos deslizaban su cuello sobre el agua azul.";
    const chunks = splitSentenceIntoSyntacticChunks(sentence);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(6);
    // Unir los fragmentos reconstruye exactamente la oración
    expect(chunks.join(" ")).toBe(sentence);
    // Puntuación pegada
    expect(chunks.some((c) => c.includes("silencioso,"))).toBe(true);
    expect(chunks[chunks.length - 1].endsWith("azul.")).toBe(true);
  });
});

describe("Cadencia Sintáctica Multilingüe (Fase 2)", () => {
  it("segmenta oraciones en inglés cortando antes de cláusulas largas (because, while, although, between)", () => {
    const enText =
      "The cat was resting on the old wooden chair because the afternoon sunlight made it warm and pleasant.";
    const segs = syntacticSegments(enText, "en");
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.some((s) => s.startsWith("because"))).toBe(true);
    expect(segs.join(" ")).toBe(enText);

    const enText2 =
      "She walked through the silent winter garden while the gentle snowfall covered the distant hills.";
    const segs2 = syntacticSegments(enText2, "en");
    expect(segs2.some((s) => s.startsWith("while"))).toBe(true);
  });

  it("segmenta oraciones en francés cortando antes de cláusulas (lorsque, puisque, quoique, que)", () => {
    const frText =
      "Le silence régnait dans la grande bibliothèque lorsque la pluie d'automne commença à frapper les vitres.";
    const segs = syntacticSegments(frText, "fr");
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.some((s) => s.startsWith("lorsque"))).toBe(true);
    expect(segs.join(" ")).toBe(frText);

    const frText2 =
      "Il referma le vieux manuscrit avec soin puisque chaque feuille fragile méritait une attention totale.";
    const segs2 = syntacticSegments(frText2, "fr");
    expect(segs2.some((s) => s.startsWith("puisque"))).toBe(true);
  });

  it("segmenta oraciones en alemán cortando antes de cláusulas subordinadas (weil, obwohl, während, dass)", () => {
    const deText =
      "Der alte Mann saß friedlich am offenen Fenster weil die kühle Abendluft ihm nach der langen Reise guttat.";
    const segs = syntacticSegments(deText, "de");
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.some((s) => s.startsWith("weil"))).toBe(true);
    expect(segs.join(" ")).toBe(deText);

    const deText2 =
      "Sie las den philosophischen Text mit Ruhe obwohl die dichten Gedanken ein hohes Maß an Fokus verlangten.";
    const segs2 = syntacticSegments(deText2, "de");
    expect(segs2.some((s) => s.startsWith("obwohl"))).toBe(true);
  });

  it("aplica cascada data-sub='true' a las cláusulas subordinadas en idiomas extranjeros", () => {
    const root = document.createElement("div");
    const p = document.createElement("p");
    p.textContent =
      "The reader was focused on every printed line because the story was becoming truly fascinating.";
    root.append(p);

    applySyntacticLines(root, { lang: "en", syntacticLines: true });
    const subSpans = root.querySelectorAll<HTMLSpanElement>("[data-sub='true']");
    expect(subSpans.length).toBeGreaterThan(0);
    expect(subSpans[0].textContent).toContain("because");
  });
});
