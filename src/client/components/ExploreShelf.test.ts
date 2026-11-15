// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExploreShelf from "./ExploreShelf";

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
