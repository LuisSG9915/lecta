import { describe, expect, it } from "vitest";
import {
  buildChapterCatalog,
  reachedRangeEnd,
  suggestedChapterTarget,
  targetAt,
  trackCalibrationOffer,
  type CalibrationTrack,
} from "./chapters";
import type { EpubBook, EpubTocItem } from "./epub";

// Libros sintéticos: solo las piezas que buildChapterCatalog lee
// (sections, toc, landmarks). Nada de documentos ni red.
const section = (id: string, linear?: string) => ({ id, linear }) as never;

type Landmark = { label?: string; href?: string; type?: string[] };

const book = (
  sectionIds: (string | { id: string; linear?: string })[],
  toc: EpubTocItem[] | null,
  landmarks: Landmark[] = [],
): EpubBook =>
  ({
    sections: sectionIds.map((s) =>
      typeof s === "string" ? section(s) : section(s.id, s.linear),
    ),
    toc: toc ?? undefined,
    landmarks: landmarks as never,
  }) as unknown as EpubBook;

const entry = (label: string, href: string, subitems?: EpubTocItem[]) =>
  ({ label, href, subitems }) as EpubTocItem;

describe("buildChapterCatalog", () => {
  it("F1: preliminares por landmarks y capítulos desde bodymatter", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["cover.xhtml", "title.xhtml", "copy.xhtml", "intro.xhtml", "c1.xhtml", "c2.xhtml", "c3.xhtml"],
        [
          entry("Portada", "cover.xhtml"),
          entry("Título", "title.xhtml"),
          entry("Copyright", "copy.xhtml"),
          entry("Introducción", "intro.xhtml"),
          entry("Cap 1", "c1.xhtml"),
          entry("Cap 2", "c2.xhtml"),
          entry("Cap 3", "c3.xhtml"),
        ],
        [
          { href: "cover.xhtml", type: ["cover"] },
          { href: "c1.xhtml", type: ["bodymatter"] },
        ],
      ),
    );
    expect(targets.map((t) => t.kind)).toEqual([
      "preliminary",
      "preliminary",
      "preliminary",
      "preliminary",
      "chapter",
      "chapter",
      "chapter",
    ]);
  });

  it("F2: numeración romana sin landmarks queda uncertain — pedir confirmación", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["s1.xhtml", "s2.xhtml", "s3.xhtml"],
        [entry("I", "s1.xhtml"), entry("II", "s2.xhtml"), entry("III", "s3.xhtml")],
      ),
    );
    expect(targets.every((t) => t.kind === "uncertain")).toBe(true);
  });

  it("F3: padre e hijo al mismo destino no se duplican", () => {
    const { targets } = buildChapterCatalog(
      book(["p1.xhtml", "c1.xhtml", "c2.xhtml", "c3.xhtml", "c4.xhtml", "c5.xhtml", "c6.xhtml"],
        [
          entry("Parte I", "c1.xhtml", [
            entry("Cap 1", "c1.xhtml"),
            entry("Cap 2", "c2.xhtml"),
            entry("Cap 3", "c3.xhtml"),
          ]),
          entry("Parte II", "c4.xhtml", [
            entry("Cap 4", "c4.xhtml"),
            entry("Cap 5", "c5.xhtml"),
            entry("Cap 6", "c6.xhtml"),
          ]),
        ],
        [{ href: "c1.xhtml", type: ["bodymatter"] }],
      ),
    );
    // Parte I (c1.xhtml) y Cap 1 (c1.xhtml) deduplican: 6 targets.
    expect(targets).toHaveLength(6);
    expect(targets.map((t) => t.label)).toEqual([
      "Parte I", "Cap 2", "Cap 3", "Parte II", "Cap 5", "Cap 6",
    ]);
    expect(targets.every((t) => t.kind === "chapter")).toBe(true);
  });

  it("F4: mismo archivo con fragmentos distintos son destinos distintos", () => {
    const { targets, ranges } = buildChapterCatalog(
      book(
        ["novela.xhtml"],
        [
          entry("P1", "novela.xhtml#p1"),
          entry("P2", "novela.xhtml#p2"),
          entry("P3", "novela.xhtml#p3"),
          entry("P4", "novela.xhtml#p4"),
          entry("P5", "novela.xhtml#p5"),
        ],
        [{ href: "novela.xhtml", type: ["bodymatter"] }],
      ),
    );
    expect(targets).toHaveLength(5);
    expect(new Set(targets.map((t) => t.id)).size).toBe(5);
    expect(targets.map((t) => t.fragment)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    // Todos comparten el mismo tramo físico [0, 1).
    for (const range of ranges)
      expect([range.startSection, range.endSection]).toEqual([0, 1]);
  });

  it("F5: fragmento inexistente se conserva en el destino", () => {
    const { targets } = buildChapterCatalog(
      book(["s1.xhtml"], [entry("Inicio", "s1.xhtml#inexistente")]),
    );
    expect(targets[0].fragment).toBe("inexistente");
    expect(targets[0].id).toBe("s1.xhtml#inexistente");
  });

  it("F6: capítulo repartido cubre las secciones no listadas en medio", () => {
    const { ranges } = buildChapterCatalog(
      book(
        ["c1.xhtml", "c2a.xhtml", "c2b.xhtml", "c3.xhtml"],
        [entry("Cap 1", "c1.xhtml"), entry("Cap 2", "c2a.xhtml"), entry("Cap 3", "c3.xhtml")],
        [{ href: "c1.xhtml", type: ["bodymatter"] }],
      ),
    );
    const cap2 = ranges.find((r) => r.target.label === "Cap 2")!;
    // [c2a, c3) incluye c2b aunque no tenga entrada en el índice.
    expect([cap2.startSection, cap2.endSection]).toEqual([1, 3]);
  });

  it("F7: sin índice, catálogo uncertain por sección lineal", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["s1.xhtml", { id: "aux.xhtml", linear: "no" }, "s2.xhtml"],
        null,
      ),
    );
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.label)).toEqual(["Sección 1", "Sección 3"]);
    expect(targets.every((t) => t.kind === "uncertain")).toBe(true);
  });

  it("F8: etiquetas repetidas producen destinos distintos por id", () => {
    const { targets } = buildChapterCatalog(
      book(["a.xhtml", "b.xhtml"], [entry("Capítulo", "a.xhtml"), entry("Capítulo", "b.xhtml")]),
    );
    expect(targets).toHaveLength(2);
    expect(targets[0].id).not.toBe(targets[1].id);
    expect(targets.every((t) => t.label === "Capítulo")).toBe(true);
  });

  it("F9: posición guardada a mitad de rango resuelve su capítulo", () => {
    const { ranges } = buildChapterCatalog(
      book(
        ["s0.xhtml", "s1.xhtml", "s2.xhtml", "s3.xhtml", "s4.xhtml", "s5.xhtml", "s6.xhtml", "s7.xhtml"],
        [entry("Cap 1", "s0.xhtml"), entry("Cap 2", "s4.xhtml"), entry("Cap 3", "s7.xhtml")],
        [{ href: "s0.xhtml", type: ["bodymatter"] }],
      ),
    );
    // s5 dentro de [s4, s7) → cap2.
    expect(targetAt(ranges, 5)?.label).toBe("Cap 2");
    expect(targetAt(ranges, 4)?.label).toBe("Cap 2");
    expect(targetAt(ranges, 7)?.label).toBe("Cap 3");
    expect(targetAt(ranges, 99)).toBeNull();
  });

  it("F10: entradas con href roto se descartan, sin mezclar contenido", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["s1.xhtml"],
        [entry("Roto", "externo.xhtml"), entry("Bien", "s1.xhtml"), entry("Web", "https://x.test/a")],
      ),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe("Bien");
  });

  it("F11: linear=no jamás es capítulo aunque esté listado", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["c1.xhtml", { id: "notas.xhtml", linear: "no" }, "c2.xhtml"],
        [entry("Cap 1", "c1.xhtml"), entry("Notas", "notas.xhtml"), entry("Cap 2", "c2.xhtml")],
        [{ href: "c1.xhtml", type: ["bodymatter"] }],
      ),
    );
    expect(targets.map((t) => t.kind)).toEqual(["chapter", "other", "chapter"]);
  });

  it("identidad estable: mismo input produce los mismos ids", () => {
    const input = book(
      ["a.xhtml", "b.xhtml"],
      [entry("Uno", "a.xhtml"), entry("Dos", "b.xhtml#x")],
      [{ href: "a.xhtml", type: ["bodymatter"] }],
    );
    const first = buildChapterCatalog(input);
    const second = buildChapterCatalog(input);
    expect(first.targets.map((t) => t.id)).toEqual(second.targets.map((t) => t.id));
    expect(second.targets.map((t) => t.id)).toEqual(["a.xhtml", "b.xhtml#x"]);
  });

  it("fuente dañada (toc vacío + sin secciones) devuelve catálogo explícito vacío", () => {
    const { targets, ranges } = buildChapterCatalog(book([], []));
    expect(targets).toEqual([]);
    expect(ranges).toEqual([]);
  });

  it("landmarks EPUB2 (<guide>) también fijan el inicio del cuerpo", () => {
    const { targets } = buildChapterCatalog(
      book(
        ["portada.xhtml", "texto.xhtml"],
        [entry("Portada", "portada.xhtml"), entry("Texto", "texto.xhtml")],
        [
          { href: "portada.xhtml", type: ["cover"], label: "Portada" },
          { href: "texto.xhtml", type: ["text"], label: "Texto" },
        ],
      ),
    );
    expect(targets.map((t) => t.kind)).toEqual(["preliminary", "chapter"]);
  });
});

describe("suggestedChapterTarget", () => {
  it("salta rótulos preliminares aunque su sección quede «chapter»", () => {
    // El caso real de «Juego de tronos»: el landmark bodymatter cae
    // antes de los mapas y «Mapas» hereda kind chapter.
    const catalog = buildChapterCatalog(
      book(
        ["portada.xhtml", "titulo.xhtml", "mapas.xhtml", "prologo.xhtml", "c1.xhtml"],
        [
          entry("Cubierta", "portada.xhtml"),
          entry("Juego de tronos", "titulo.xhtml"),
          entry("Mapas", "mapas.xhtml"),
          entry("Prólogo", "prologo.xhtml"),
          entry("Bran (1)", "c1.xhtml"),
        ],
        [{ href: "titulo.xhtml", type: ["bodymatter"] }],
      ),
    );
    expect(
      suggestedChapterTarget(catalog, "Juego de tronos")?.label,
    ).toBe("Prólogo");
  });

  it("un capítulo tardío con el nombre del libro sí se conserva", () => {
    const catalog = buildChapterCatalog(
      book(
        ["p.xhtml", "s1.xhtml", "s2.xhtml", "s3.xhtml", "s4.xhtml", "s5.xhtml", "s6.xhtml", "s7.xhtml"],
        [entry("Portada", "p.xhtml"), entry("Cap 1", "s1.xhtml"), entry("Novela", "s7.xhtml")],
        [{ href: "s1.xhtml", type: ["bodymatter"] }],
      ),
    );
    // «Novela» es sección 7: repetir el título ahí no delata portada.
    expect(suggestedChapterTarget(catalog, "Novela")?.label).toBe("Cap 1");
  });

  it("rotulado con acentos y signos también se filtra", () => {
    const catalog = buildChapterCatalog(
      book(
        ["a.xhtml", "b.xhtml"],
        [entry("«Agradecimientos»", "a.xhtml"), entry("Uno", "b.xhtml")],
        [{ href: "a.xhtml", type: ["bodymatter"] }],
      ),
    );
    expect(suggestedChapterTarget(catalog)?.label).toBe("Uno");
  });

  it("sin capítulo limpio cae al primer chapter; sin chapters, al primer destino", () => {
    const allFront = buildChapterCatalog(
      book(
        ["a.xhtml", "b.xhtml"],
        [entry("Mapas", "a.xhtml"), entry("Agradecimientos", "b.xhtml")],
        [{ href: "a.xhtml", type: ["bodymatter"] }],
      ),
    );
    expect(suggestedChapterTarget(allFront)?.label).toBe("Mapas");
    const noChapters = buildChapterCatalog(
      book(["a.xhtml"], [entry("Portada", "a.xhtml")]),
    );
    expect(suggestedChapterTarget(noChapters)?.label).toBe("Portada");
    const empty = buildChapterCatalog(book([], []));
    expect(suggestedChapterTarget(empty)).toBeNull();
  });
});

describe("reachedRangeEnd", () => {
  const range = { startSection: 2, endSection: 5 };

  it("dentro del rango o antes de él aún no llega al final", () => {
    expect(reachedRangeEnd(range, 0, 1)).toBe(false);
    expect(reachedRangeEnd(range, 3, 1)).toBe(false);
  });

  it("última sección exige la vista casi completa", () => {
    expect(reachedRangeEnd(range, 4, 0.5)).toBe(false);
    expect(reachedRangeEnd(range, 4, 0.98)).toBe(true);
    expect(reachedRangeEnd(range, 4, 1)).toBe(true);
  });

  it("una sección posterior al rango cuenta como terminado", () => {
    expect(reachedRangeEnd(range, 5, 0)).toBe(true);
    expect(reachedRangeEnd(range, 7, 0.2)).toBe(true);
  });

  it("rango de una sola sección termina con la vista al final", () => {
    const single = { startSection: 0, endSection: 1 };
    expect(reachedRangeEnd(single, 0, 0.4)).toBe(false);
    expect(reachedRangeEnd(single, 0, 0.99)).toBe(true);
  });
});

describe("trackCalibrationOffer", () => {
  // Catálogo sintético: capítulo A [0,3), capítulo B [3,6).
  const ranges = [
    { startSection: 0, endSection: 3 },
    { startSection: 3, endSection: 6 },
  ];
  const rangeFor = (index: number) =>
    ranges.find((r) => r.startSection <= index && index < r.endSection) ?? null;

  // Simula la secuencia de posiciones observadas; devuelve la última
  // decisión y el seguimiento que quedó.
  const run = (
    positions: [section: number, ratio: number][],
    start: CalibrationTrack | null = null,
  ) => {
    let track = start;
    let offer = false;
    for (const [sectionIndex, ratio] of positions) {
      const next = trackCalibrationOffer(track, sectionIndex, ratio, rangeFor);
      track = next.track;
      offer = next.offer;
    }
    return { track, offer };
  };

  it("lectura real del tramo: se arma dentro y dispara al terminar", () => {
    const seq = run([
      [0, 0],
      [1, 0.3],
      [2, 0.5],
      [2, 0.99],
    ]);
    expect(seq.offer).toBe(true);
  });

  it("aterrizar directo en el final no dispara (retomar/marcador)", () => {
    // La posición restaurada cae ya al final de la última sección.
    const seq = run([[2, 1]]);
    expect(seq.offer).toBe(false);
    expect(seq.track).toBeNull();
    // Y al pasar de página el candidato se recalcula en el capítulo B,
    // no dispara «a ciegas» sobre el A.
    const next = run([[3, 0]], seq.track);
    expect(next.offer).toBe(false);
    expect(next.track?.range).toEqual({ startSection: 3, endSection: 6 });
  });

  it("un salto del índice más allá del tramo no dispara", () => {
    // Abrió en la portada y saltó directo a una sección posterior.
    const seq = run([
      [0, 0],
      [4, 0],
    ]);
    expect(seq.offer).toBe(false);
    // El candidato es ahora el tramo B, donde sí se observa lectura.
    expect(seq.track?.range).toEqual({ startSection: 3, endSection: 6 });
    // Terminar B sí ofrece.
    expect(run([[4, 0.5], [5, 1]], seq.track).offer).toBe(true);
  });

  it("pisar la última sección sin llegar al final y pasar dispara", () => {
    // En modo paginado una última sección de una página nunca llega a
    // 0.98: haberla visto y avanzar a la siguiente cuenta.
    const seq = run([
      [0, 0],
      [2, 0.4],
      [3, 0],
    ]);
    expect(seq.offer).toBe(true);
  });

  it("saltar sobre la última sección sin pisarla no dispara", () => {
    // Leyó el inicio del tramo y saltó dos secciones más allá: nunca
    // estuvo en la última, no hay lectura del final.
    const seq = run([
      [0, 0],
      [4, 0],
    ]);
    expect(seq.offer).toBe(false);
  });

  it("retroceder dentro del tramo conserva el armado", () => {
    const seq = run([
      [1, 0],
      [2, 0.6],
      [1, 0],
      [2, 0.5],
      [2, 1],
    ]);
    expect(seq.offer).toBe(true);
  });

  it("tramo de una sección: vista parcial arma, salir sin verla no", () => {
    const single = (index: number) =>
      index === 0 ? { startSection: 0, endSection: 1 } : null;
    // Aterriza a la mitad, baja al final.
    let step = trackCalibrationOffer(null, 0, 0.5, single);
    step = trackCalibrationOffer(step.track, 0, 0.99, single);
    expect(step.offer).toBe(true);
    // Aterriza ya al final: no hubo lectura observada.
    expect(trackCalibrationOffer(null, 0, 1, single).offer).toBe(false);
  });
});
