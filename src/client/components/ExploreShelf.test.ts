// @vitest-environment jsdom
import { act, createElement as h, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExploreShelf from "./ExploreShelf";
import {
  ExploreCommunityContext,
  type ExploreCommunityBridge,
} from "./explore-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = (props: Partial<Parameters<typeof ExploreShelf>[0]> = {}) =>
  act(async () => {
    root.render(
      h(ExploreShelf, {
        community: h("p", null, "Guías de la comunidad"),
        catalog: h("p", null, "Catálogo gratuito"),
        screen: h("p", null, "Obras de pantalla"),
        ...props,
      }),
    );
  });

const tabs = () =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(
    (b) => b.textContent,
  );

const panel = (id: string) =>
  host.querySelector<HTMLElement>(`#explore-panel-${id}`);

describe("ExploreShelf — pestañas", () => {
  it("muestra las tres pestañas en orden y activa Comunidad por defecto", async () => {
    await render();
    expect(tabs()).toEqual([
      "Comunidad",
      "Libros gratuitos",
      "Series y películas",
    ]);
    const community = host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    expect(community.textContent).toBe("Comunidad");
    expect(panel("community")!.hidden).toBe(false);
    expect(panel("catalog")!.hidden).toBe(true);
    expect(panel("screen")!.hidden).toBe(true);
  });

  it("sin catálogo la pestaña Libros gratuitos no existe", async () => {
    await render({ catalog: undefined });
    expect(tabs()).toEqual(["Comunidad", "Series y películas"]);
  });

  it("la sección de pantalla se monta al abrir su pestaña y queda oculta después", async () => {
    const screenNode = h("p", { "data-testid": "screen-body" }, "Obras");
    await render({ screen: screenNode });
    const screenPanel = panel("screen")!;
    expect(screenPanel.querySelector("[data-testid]")).toBeNull();

    const screenTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Series y películas",
    )!;
    await act(async () => screenTab.click());
    expect(screenPanel.hidden).toBe(false);
    expect(screenPanel.querySelector("[data-testid]")).not.toBeNull();

    // Al volver a Comunidad el contenido sigue montado (solo oculto).
    const communityTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Comunidad",
    )!;
    await act(async () => communityTab.click());
    expect(screenPanel.hidden).toBe(true);
    expect(screenPanel.querySelector("[data-testid]")).not.toBeNull();
  });

  it("sin sesión la pestaña de pantalla muestra la invitación", async () => {
    const onOpenAccount = vi.fn();
    await render({ screen: undefined, onOpenAccount });
    const screenTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Series y películas",
    )!;
    await act(async () => screenTab.click());
    expect(panel("screen")!.textContent).toContain(
      "Inicia sesión para preparar vocabulario de series y películas.",
    );
    const login = [...panel("screen")!.querySelectorAll("button")].find(
      (b) => b.textContent === "Iniciar sesión",
    )!;
    await act(async () => login.click());
    expect(onOpenAccount).toHaveBeenCalled();
  });

  it("las flechas del teclado mueven la selección entre pestañas", async () => {
    await render();
    const communityTab = host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    await act(async () => {
      communityTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const selected = host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    expect(selected.textContent).toBe("Libros gratuitos");
  });
});

describe("ExploreShelf — montaje diferido del catálogo", () => {
  const catalogNode = h(
    "p",
    { "data-testid": "catalog-body" },
    "Catálogo gratuito",
  );
  const catalogTab = () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Libros gratuitos",
    )!;
  const communityTab = () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent === "Comunidad",
    )!;

  it("el catálogo no se monta hasta abrir su pestaña y queda montado después", async () => {
    await render({ catalog: catalogNode });
    // El panel existe (es el tabpanel) pero el contenido aún no.
    expect(
      panel("catalog")!.querySelector("[data-testid='catalog-body']"),
    ).toBeNull();

    await act(async () => catalogTab().click());
    expect(
      panel("catalog")!.querySelector("[data-testid='catalog-body']"),
    ).not.toBeNull();

    // Al volver a Comunidad el contenido sigue montado (solo oculto).
    await act(async () => communityTab().click());
    expect(panel("catalog")!.hidden).toBe(true);
    expect(
      panel("catalog")!.querySelector("[data-testid='catalog-body']"),
    ).not.toBeNull();
  });

  it("sin Comunidad el catálogo es la pestaña inicial y se monta de entrada", async () => {
    await render({ community: undefined, catalog: catalogNode });
    expect(panel("catalog")!.hidden).toBe(false);
    expect(
      panel("catalog")!.querySelector("[data-testid='catalog-body']"),
    ).not.toBeNull();
  });

  it("cuando Comunidad reporta 0 guías se monta y activa el catálogo", async () => {
    let bridge: ExploreCommunityBridge | null = null;
    const Probe = () => {
      bridge = useContext(ExploreCommunityContext);
      return h("p", null, "Comunidad");
    };
    await render({ community: h(Probe), catalog: catalogNode });
    await act(async () => bridge!.onLoaded(0));
    expect(panel("catalog")!.hidden).toBe(false);
    expect(
      panel("catalog")!.querySelector("[data-testid='catalog-body']"),
    ).not.toBeNull();
  });

  it("los tres paneles son tabbable para que Tab entre al contenido", async () => {
    await render();
    for (const id of ["community", "catalog", "screen"]) {
      expect(panel(id)!.tabIndex).toBe(0);
    }
  });
});

describe("ExploreShelf — contadores de pestaña", () => {
  const tabByText = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (b) => b.textContent?.includes(label),
    )!;

  it("Comunidad muestra el número de guías que reporta el puente", async () => {
    let bridge: ExploreCommunityBridge | null = null;
    const Probe = () => {
      bridge = useContext(ExploreCommunityContext);
      return h("p", null, "Comunidad");
    };
    await render({ community: h(Probe) });
    // Sin reporte aún: sin contador.
    expect(tabByText("Comunidad").querySelector(".shelf-explore-count")).toBeNull();

    await act(async () => bridge!.onLoaded(12));
    const tab = tabByText("Comunidad");
    expect(tab.querySelector(".shelf-explore-count")?.textContent).toBe("12");
    expect(tab.getAttribute("aria-label")).toBe("Comunidad, 12 guías");
  });

  it("el singular y el tope 99+ se ajustan", async () => {
    let bridge: ExploreCommunityBridge | null = null;
    const Probe = () => {
      bridge = useContext(ExploreCommunityContext);
      return h("p", null, "Comunidad");
    };
    await render({ community: h(Probe) });
    await act(async () => bridge!.onLoaded(1));
    expect(tabByText("Comunidad").getAttribute("aria-label")).toBe(
      "Comunidad, 1 guía",
    );
    await act(async () => bridge!.onLoaded(140));
    expect(
      tabByText("Comunidad").querySelector(".shelf-explore-count")
        ?.textContent,
    ).toBe("99+");
  });

  it("Series y películas muestra los títulos instalados; 0 no muestra nada", async () => {
    await render({ screenCount: 3 });
    const tab = tabByText("Series y películas");
    expect(tab.querySelector(".shelf-explore-count")?.textContent).toBe("3");
    expect(tab.getAttribute("aria-label")).toBe(
      "Series y películas, 3 títulos",
    );

    await render({ screenCount: 0 });
    expect(
      tabByText("Series y películas").querySelector(".shelf-explore-count"),
    ).toBeNull();
  });

  it("openCatalog cambia a la pestaña de catálogo", async () => {
    let bridge: ExploreCommunityBridge | null = null;
    const Probe = () => {
      bridge = useContext(ExploreCommunityContext);
      return h("p", null, "Comunidad");
    };
    await render({ community: h(Probe), catalog: h("p", null, "Catálogo") });
    expect(bridge!.openCatalog).not.toBeNull();
    await act(async () => bridge!.openCatalog!());
    expect(panel("catalog")!.hidden).toBe(false);
  });
});
