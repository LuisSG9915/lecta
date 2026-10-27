// Lógica del armario: requisitos con número, contadores por ranura,
// la prenda «más cerca» y los looks de cinco piezas.
//
// Se prueba sobre `emptyGameState()` y estados construidos a mano: son
// funciones puras, así que el estado entra y sale sin IndexedDB ni DOM.
import { describe, expect, it } from "vitest";
import {
  COMPANION_LOOKS,
  HIDDEN_ARTICLES,
  ARTICLE_STORIES,
  closetComment,
  closetRequirement,
  coatCards,
  gridArticles,
  initialSelection,
  labelFor,
  lookStatus,
  nextUnlock,
  readingTimeFor,
  requiredLevel,
  SEASONAL_WINDOWS,
  seasonalNow,
  seasonalWindow,
  slotInventory,
  sortForGrid,
  storyFor,
  surpriseLook,
} from "./companion-closet";
import { emptyGameState, type GameState } from "./gamification";
import { COMPANION_ARTICLES, type CompanionArticle } from "../../shared/companion-data";

const state = (over: Partial<GameState> = {}): GameState => ({
  ...emptyGameState(),
  ...over,
  stats: { ...emptyGameState().stats, ...(over.stats ?? {}) },
});

const owned = (...articles: string[]) => new Set<string>(["chaleco", ...articles]);

describe("inventario por ranura", () => {
  it("cuenta lo tuyo sobre el total de cada ranura, pelajes incluidos", () => {
    const inv = slotInventory(owned("bufanda", "pelaje-atigrado"));
    const bySlot = new Map(inv.map((s) => [s.slot, s]));
    expect(bySlot.get("neck")).toMatchObject({ owned: 1, total: 8 });
    expect(bySlot.get("head")).toMatchObject({ owned: 0, total: 7 });
    expect(bySlot.get("coat")).toMatchObject({ owned: 1, total: 5 });
    // Los ids de paleta legados no cuentan: no se muestran ni se ganan.
    expect(bySlot.get("coat")!.total).toBe(5);
  });

  it("sin nada ganado, el chaleco ya cuenta como tuyo", () => {
    const inv = slotInventory(owned());
    expect(inv.find((s) => s.slot === "body")!.owned).toBe(1);
  });
});

describe("qué se ve en la rejilla", () => {
  it("los pelajes no son prendas: no aparecen en «Todo»", () => {
    const all = gridArticles("all");
    expect(all.every((a) => COMPANION_ARTICLES[a] !== "coat")).toBe(true);
    expect(all.length).toBe(25);
  });

  it("tampoco aparecen los ids de paleta legados", () => {
    for (const hidden of HIDDEN_ARTICLES) {
      expect(gridArticles("all")).not.toContain(hidden);
    }
  });

  it("el filtro de una ranura devuelve sólo esa ranura, en orden de catálogo", () => {
    expect(gridArticles("head")).toEqual([
      "moño",
      "boina",
      "beret_poet",
      "wizard_hat",
      "laurel_crown",
      "headphones_cozy",
      "pluma",
    ]);
    // El pelaje tiene su propio selector: la rejilla de esa ranura va vacía.
    expect(gridArticles("coat")).toEqual([]);
  });

  it("lo tuyo va primero; los candados no entierran lo que ya usas", () => {
    const all = gridArticles("all");
    const sorted = sortForGrid(all, owned("bufanda", "monoculo"));
    expect(sorted.slice(0, 3)).toEqual(["bufanda", "monoculo", "chaleco"]);
    // El resto conserva su orden relativo original.
    const rest = sorted.slice(3);
    expect(rest).toEqual(all.filter((a) => !["bufanda", "monoculo", "chaleco"].includes(a)));
  });

  it("cinco paletas con su nombre y su historia", () => {
    const coats = coatCards();
    expect(coats).toHaveLength(5);
    expect(coats.map((c) => c.name)).toEqual([
      "Tinta y Crema",
      "Crema Canela",
      "Naranja Miel",
      "Gris Neblina",
      "Calicó Literario",
    ]);
    expect(coats.every((c) => c.story.length > 10)).toBe(true);
    // El nombre del pelaje no es el del artículo crudo.
    expect(labelFor("pelaje-atigrado")).toBe("Naranja Miel");
    expect(storyFor("pelaje-atigrado")).toBe(
      "Pelaje naranja cálido con rayitas frontales y ojos verde esmeralda",
    );
  });
});

describe("requisitos con número", () => {
  it("una prenda tuya no tiene requisito", () => {
    expect(closetRequirement("bufanda", state(), owned("bufanda"))).toBeNull();
  });

  it("el corbatín tiene dos caminos y se anuncia el más corto", () => {
    // Regalo del nivel 2 (30 puntos) y del logro de diez minutos de una
    // sentada: manda el logro, que es comportamiento concreto.
    const req = closetRequirement("corbatin", state(), owned());
    expect(req).toMatchObject({
      kind: "achievement",
      achievementId: "primer_cuarto",
      desc: "Lee 10 minutos de una sentada",
    });
    // Ya cumplido el logro, la prenda es tuya y no pide nada.
    const hecho = state({
      stats: { ...emptyGameState().stats, longestSessionMin: 12 },
    });
    expect(closetRequirement("corbatin", hecho, owned())?.kind).toBe(
      "achievement",
    );
  });

  it("los regalos de nivel dicen cuántos puntos faltan", () => {
    const req = closetRequirement("bufanda", state({ xp: 60 }), owned());
    expect(req).toMatchObject({
      kind: "level",
      level: 3,
      missing: 30,
      text: "Nivel 3 · faltan 30 pts",
    });
    if (req?.kind !== "level") throw new Error("se esperaba nivel");
    // A mitad de camino entre 30 y 90 puntos.
    expect(req.ratio).toBeCloseTo(0.5, 5);
  });

  it("la distancia se traduce a tiempo de lectura", () => {
    // 1 punto = 1 minuto leído; se redondea a 5 minutos.
    expect(readingTimeFor(30)).toBe("≈ 30 min de lectura");
    expect(readingTimeFor(320)).toBe("≈ 5 h 20 min de lectura");
    expect(readingTimeFor(180)).toBe("≈ 3 h de lectura");
    expect(readingTimeFor(3)).toBe("≈ 5 min de lectura");
    const req = closetRequirement("moño", state(), owned());
    if (req?.kind !== "level") throw new Error("se esperaba nivel");
    expect(req.equivalent).toBe("unas 5 h 20 min de lectura");
    // A menos de 10 puntos, la equivalencia no aporta nada.
    const cerca = closetRequirement("bufanda", state({ xp: 85 }), owned());
    if (cerca?.kind !== "level") throw new Error("se esperaba nivel");
    expect(cerca.missing).toBe(5);
    expect(cerca.equivalent).toBe("");
  });

  it("los pelajes piden su nivel de paleta", () => {
    expect(requiredLevel("pelaje-gris")).toBe(4);
    expect(closetRequirement("pelaje-gris", state(), owned())).toMatchObject({
      kind: "level",
      level: 4,
    });
  });

  it("los logros dicen avance y meta con su unidad", () => {
    const s = state({ stats: { ...emptyGameState().stats, saved: 38 } });
    const req = closetRequirement("glasses_round", s, owned());
    expect(req).toMatchObject({
      kind: "achievement",
      achievementId: "palabras_100",
      current: 38,
      goal: 100,
      text: "Guarda 100 palabras · 38 de 100 palabras",
    });
    if (req?.kind !== "achievement") throw new Error("se esperaba logro");
    expect(req.ratio).toBeCloseTo(0.38, 5);
  });

  it("con metas de una o dos unidades el avance se lee en porcentaje", () => {
    // «Termina 3 libros» con 1 leído: 33 % se entiende mejor que «1 de 3».
    const s = state({ stats: { ...emptyGameState().stats, booksFinished: 1 } });
    const req = closetRequirement("cape_modernist", s, owned());
    expect(req?.kind).toBe("achievement");
    if (req?.kind !== "achievement") throw new Error("se esperaba logro");
    expect(req.text).toBe("Termina 3 libros · 33%");
  });

  it("las metas largas se leen en unidades", () => {
    const s = state({ stats: { ...emptyGameState().stats, streakDays: 3 } });
    const req = closetRequirement("scarf_amber", s, owned());
    if (req?.kind !== "achievement") throw new Error("se esperaba logro");
    expect(req.text).toBe("Lee 7 días en racha · 3 de 7 días");
  });

  it("sin avance la descripción sola basta (la barra marca el cero)", () => {
    const req = closetRequirement("beret_poet", state(), owned());
    if (req?.kind !== "achievement") throw new Error("se esperaba logro");
    expect(req.text).toBe("Lee 30 minutos de una sentada");
  });

  it("sin estado del juego no se inventa un requisito", () => {
    expect(closetRequirement("bufanda", null, owned())).toBeNull();
  });
});

describe("la prenda más cerca", () => {
  it("elige la de mayor avance, no la primera de la lista", () => {
    // 38 palabras: 38 % de las Gafas (100) y 76 % del Monóculo (50).
    const s = state({ stats: { ...emptyGameState().stats, saved: 38 } });
    const hint = nextUnlock(s, owned(), gridArticles("all"));
    expect(hint?.article).toBe("monocle_gold");
    expect(hint?.label).toBe("Monóculo de Crítico");
    expect(hint?.ratio).toBeCloseTo(0.76, 5);
    expect(hint?.requirement.kind).toBe("achievement");
  });

  it("no propone nada que ya tengas", () => {
    const s = state();
    const mine = owned(...gridArticles("all"));
    expect(nextUnlock(s, mine, gridArticles("all"))).toBeNull();
  });

  it("sin estado no hay pista", () => {
    expect(nextUnlock(null, owned(), gridArticles("all"))).toBeNull();
  });
});

describe("looks", () => {
  it("tres looks con nombre y sólo las piezas que tienes", () => {
    expect(COMPANION_LOOKS.map((l) => l.name)).toEqual([
      "Uniforme de biblioteca",
      "Noche de lluvia",
      "Detective de biblioteca",
      "Poeta de provincia",
    ]);
    // El primero se puede poner desde el minuto cero: el chaleco es gratis.
    const uniforme = lookStatus(COMPANION_LOOKS[0], owned());
    expect(Object.keys(uniforme.available)).toEqual(["body"]);
    const status = lookStatus(COMPANION_LOOKS[1], owned("scarf_amber"));
    expect(status.available).toEqual({ neck: "scarf_amber" });
    expect(status.missing).toEqual(["stage_rainy_window", "pelaje-gris"]);
    expect(status.ready).toBe(false);
  });

  it("con todas las piezas el look está completo", () => {
    const look = COMPANION_LOOKS[3];
    const status = lookStatus(
      look,
      owned("corbatin", "boina", "pelaje-atigrado"),
    );
    expect(status.ready).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.available).toEqual({
      neck: "corbatin",
      head: "boina",
      coat: "pelaje-atigrado",
    });
  });
});

describe("prenda de temporada", () => {
  it("cada mes cae en una ventana y una sola", () => {
    for (let mes = 1; mes <= 12; mes += 1) {
      const activa = SEASONAL_WINDOWS.filter((w) =>
        w.from <= w.to ? mes >= w.from && mes <= w.to : mes >= w.from || mes <= w.to,
      );
      expect(activa).toHaveLength(1);
      expect(seasonalWindow(mes)).toEqual(activa[0]);
    }
    expect(seasonalWindow(0)).toBeNull();
    expect(seasonalWindow(13)).toBeNull();
  });

  it("el invierno cruza el año y la fecha manda", () => {
    expect(seasonalWindow(12)?.article).toBe("scarf_amber");
    expect(seasonalWindow(1)?.article).toBe("scarf_amber");
    expect(seasonalWindow(2)?.article).toBe("scarf_amber");
    expect(seasonalWindow(3)?.article).toBe("stage_rainy_window");
    expect(seasonalNow(new Date("2026-07-15T12:00:00"))?.article).toBe(
      "glasses_round",
    );
    expect(seasonalNow(new Date("2026-10-24T12:00:00"))?.article).toBe(
      "cape_modernist",
    );
  });

  it("la prenda de temporada se pone la primera de la rejilla", () => {
    const all = gridArticles("all");
    const sorted = sortForGrid(all, owned("chaleco"), "cape_modernist");
    expect(sorted[0]).toBe("cape_modernist");
    // Sin temporada, el orden de siempre (lo tuyo primero).
    expect(sortForGrid(all, owned("chaleco"), null)[0]).toBe("chaleco");
  });
});

describe("«Sorpréndeme»", () => {
  const base = {
    head: null,
    neck: null,
    face: null,
    body: null,
    coat: null,
  } as const;

  it("sólo elige entre prendas tuyas y cambia al menos una ranura", () => {
    const mine = owned("bufanda", "moño", "pelaje-atigrado");
    // Determinista: primer sorteo de cada ranura.
    const look = surpriseLook(mine, { ...base }, () => 0)!;
    expect(look).toBeTruthy();
    for (const [slot, article] of Object.entries(look)) {
      if (article === null) continue;
      expect(mine.has(article)).toBe(true);
      // La ranura declarada por el catálogo coincide.
      expect(["head", "neck", "face", "body", "coat"]).toContain(slot);
    }
    const changed = (Object.keys(look) as (keyof typeof base)[]).some(
      (slot) => look[slot] !== base[slot],
    );
    expect(changed).toBe(true);
  });

  it("nunca devuelve el mismo look que ya lleva puesto", () => {
    const mine = owned("chaleco");
    const worn = { ...base, body: "chaleco" };
    // Azar que siempre acierta lo puesto: el respaldo cambia una ranura.
    const look = surpriseLook(mine, { ...worn }, () => 0.999)!;
    expect(look).not.toEqual(worn);
    expect(
      (Object.keys(look) as (keyof typeof worn)[]).some(
        (slot) => look[slot] !== worn[slot],
      ),
    ).toBe(true);
  });

  it("sin inventario no inventa un look", () => {
    const vacío = {
      head: null,
      neck: null,
      face: null,
      body: null,
      coat: null,
    };
    // Sin una sola prenda no hay nada que sortear (ni siquiera quitarse algo).
    expect(surpriseLook(new Set<string>(), { ...vacío }, () => 0.5)).toBeNull();
  });

  it("con el chaleco puesto, desnudarse también cuenta como sorpresa", () => {
    const vacío = {
      head: null,
      neck: null,
      face: null,
      body: null,
      coat: null,
    };
    const look = surpriseLook(owned(), { ...vacío, body: "chaleco" }, () => 0);
    expect(look).not.toBeNull();
    expect(look).not.toEqual({ ...vacío, body: "chaleco" });
  });
});

describe("selección y voz", () => {
  it("la ficha arranca en lo que llevas puesto en esa ranura", () => {
    const equipped = {
      head: "boina",
      neck: null,
      face: null,
      body: null,
      coat: null,
    };
    expect(initialSelection("head", equipped)).toBe("boina");
    // Ranura vacía: la primera prenda disponible del catálogo.
    expect(initialSelection("neck", equipped)).toBe("bufanda");
    expect(initialSelection("all", equipped)).toBeNull();
  });

  it("un id legado no se propone como selección", () => {
    const equipped = {
      head: null,
      neck: null,
      face: null,
      body: null,
      coat: "tuxedo",
    };
    // El primer pelaje del selector es la paleta Tinta y Crema.
    expect(initialSelection("coat", equipped)).toBe("pelaje-tuxedo");
  });

  it("el gato comenta lo que se pone, por ranura", () => {
    expect(closetComment("boina")).toContain("queda bien");
    expect(closetComment("bufanda")).toContain("apretado");
    expect(closetComment(null)).toContain("Sin nada puesto");
  });
});

describe("historias", () => {
  it("todas las prendas visibles tienen una línea propia", () => {
    const articles = gridArticles("all");
    const faltan = articles.filter((a) => storyFor(a as CompanionArticle).length < 10);
    expect(faltan).toEqual([]);
    // Y ninguna historia se repite: cada prenda cuenta algo distinto.
    const stories = articles.map((a) => ARTICLE_STORIES[a]);
    expect(new Set(stories).size).toBe(stories.length);
  });
});
