import { describe, expect, it } from "vitest";
import { buildChapterCatalog, targetAt } from "./chapters";
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
