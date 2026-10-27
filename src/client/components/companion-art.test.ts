// Guardia del arte del armario: la red que evita tarjetas muertas.
//
// El armario se llena dibujando prendas, y dibujar toca varias listas: el
// catálogo (`COMPANION_ARTICLES`), el arte (`wear` en companion-sprites), la
// tabla de capas (`WEAR_LAYERS`), los nombres y las historias del armario y
// una fuente de desbloqueo. Cuando una de esas se queda atrás, la prenda
// aparece en la rejilla y NO se puede ganar ni dibujar — le pasó a cinco ids
// de paleta que el catálogo listaba y ninguna recompensa otorgaba.
//
// Esta prueba recorre todas las listas y falla si alguna no cuadra, así que
// añadir una prenda sin terminar el trabajo rompe el gate en vez de llegar
// al usuario.
import { describe, expect, it } from "vitest";
import { STAGES } from "./companion-sprites";
import { WEAR_LAYERS } from "./Companion";
import {
  COMPANION_ARTICLES,
  COMPANION_COAT_IDS,
  COMPANION_COATS,
  type CompanionArticle,
} from "../../shared/companion-data";
import {
  ARTICLE_LABELS,
  ARTICLE_STORIES,
  HIDDEN_ARTICLES,
  labelFor,
  requiredLevel,
} from "../lib/companion-closet";
import { ITEM_ACHIEVEMENT_REWARDS } from "../lib/gamification";

// Los escenarios no son prendas: se dibujan como fondo del escenario.
const STAGE_BACKDROPS = ["stage_rainy_window", "stage_ancient_library"];

const articles = Object.keys(COMPANION_ARTICLES) as CompanionArticle[];

// Lo que el armario muestra de verdad (los ids de paleta legados no se
// listan: el pelaje se elige entre las cinco paletas).
const visible = articles.filter(
  (article) =>
    !HIDDEN_ARTICLES.includes(article) && !STAGE_BACKDROPS.includes(article),
);

// Los pelajes no son prendas: no llevan `wear` ni historia propia (su nombre
// y su descripción salen de la paleta).
const garments = visible.filter(
  (article) => COMPANION_ARTICLES[article] !== "coat",
);
const coatArticles = visible.filter(
  (article) => COMPANION_ARTICLES[article] === "coat",
);

const wearKeys = Object.keys(STAGES[0].wear);

describe("arte de las prendas", () => {
  it("las cinco etapas dibujan exactamente las mismas prendas", () => {
    // Un id que sólo exista en la etapa 0 desaparece al crecer el gato.
    for (const stage of STAGES) {
      expect(Object.keys(stage.wear).sort()).toEqual(wearKeys.sort());
    }
  });

  it("cada prenda visible tiene arte con al menos un trazo", () => {
    const sinArte = garments.filter((article) => {
      const paths = STAGES[0].wear[article as keyof (typeof STAGES)[0]["wear"]];
      return !paths || paths.length === 0 || paths.some((d) => !d.trim());
    });
    expect(sinArte).toEqual([]);
  });

  it("cada prenda visible está en la tabla de capas (si no, no se dibuja)", () => {
    const enTabla = new Set(WEAR_LAYERS.flatMap((layer) => layer.ids));
    const fuera = garments.filter((article) => !enTabla.has(article));
    expect(fuera).toEqual([]);
  });

  it("la tabla de capas no inventa ids ni repite prenda en dos capas", () => {
    const vistos = new Map<string, string>();
    for (const layer of WEAR_LAYERS) {
      for (const id of layer.ids) {
        expect(COMPANION_ARTICLES[id as CompanionArticle]).toBe(layer.slot);
        expect(vistos.get(id)).toBeUndefined();
        vistos.set(id, layer.slot);
      }
    }
    // Y ninguna capa dibuja algo que no esté en el arte.
    for (const id of vistos.keys()) {
      expect(
        STAGES[0].wear[id as keyof (typeof STAGES)[0]["wear"]],
      ).toBeTruthy();
    }
  });
});

describe("ficha de cada prenda en el armario", () => {
  it("todas las prendas tienen nombre propio y una línea de historia", () => {
    for (const article of garments) {
      expect(ARTICLE_LABELS[article], `nombre de ${article}`).toBeTruthy();
      expect(
        (ARTICLE_STORIES[article] ?? "").length,
        `historia de ${article}`,
      ).toBeGreaterThan(10);
    }
  });

  it("cada una se puede GANAR: nivel, logro o paleta por nivel", () => {
    // El chaleco es el único de serie a propósito: si aparece otro sin
    // fuente, es una tarjeta muerta — el bug de los cinco ids de paleta.
    const sinFuente = visible.filter(
      (article) =>
        requiredLevel(article) === null && !ITEM_ACHIEVEMENT_REWARDS[article],
    );
    expect(sinFuente).toEqual(["chaleco"]);
  });

  it("los nombres visibles no se pisan entre sí", () => {
    // Dos prendas con el mismo nombre son dos tarjetas indistinguibles
    // (pasó con «Boina de poeta» y «Boina de Poeta»).
    const nombres = visible.map((article) => labelFor(article));
    const repetidos = nombres.filter(
      (nombre, i) => nombres.findIndex((n) => n === nombre) !== i,
    );
    expect(repetidos).toEqual([]);
  });
});

describe("paletas", () => {
  it("los pelajes del catálogo son paletas o alias conocidos", () => {
    const paletas = new Set(COMPANION_COAT_IDS.map((id) => COMPANION_COATS[id].articleId));
    // Dos alias históricos que pintan una paleta existente y siguen siendo
    // válidos en un registro guardado (no se muestran en el armario).
    const alias = new Set(["pelaje-negro", "pelaje-dorado"]);
    for (const article of coatArticles) {
      expect(
        paletas.has(article) || alias.has(article),
        `${article} no es paleta ni alias`,
      ).toBe(true);
    }
  });

  it("cada paleta del selector tiene artículo, pintura y descripción", () => {
    expect(COMPANION_COAT_IDS).toHaveLength(5);
    for (const id of COMPANION_COAT_IDS) {
      const coat = COMPANION_COATS[id];
      expect(coat.name.length).toBeGreaterThan(3);
      expect(coat.description.length).toBeGreaterThan(10);
      expect(COMPANION_ARTICLES[coat.articleId as CompanionArticle]).toBe("coat");
      // Los tokens de color son lo que pinta el gato.
      expect(coat.fur).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.chest).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
