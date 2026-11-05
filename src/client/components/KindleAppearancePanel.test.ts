// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KindleAppearancePanel } from "./KindleAppearancePanel";

const accountFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/account-fetch", () => ({
  accountFetch: (...args: unknown[]) => accountFetchMock(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("KindleAppearancePanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  async function renderPanel() {
    accountFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        prefs: {
          fontFamily: "source-serif",
          fontSize: "lg",
          lineHeight: "loose",
          margin: "sm",
          align: "left",
          approach: "anchors",
          layout: "scroll",
          persisted: true,
        },
      }),
    });
    await act(async () => {
      root.render(h(KindleAppearancePanel));
      await Promise.resolve();
    });
  }

  it("carga las preferencias de la cuenta y pinta selects + segmentados", async () => {
    await renderPanel();
    // Tipografía y tamaño quedan en selects; las 5 opciones cortas son
    // grupos segmentados (sin cascada de 7 desplegables).
    const selects = host.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    const labels = [...selects].map((s) => s.getAttribute("aria-label"));
    expect(labels).toContain("Tipografía");
    expect(labels).toContain("Tamaño de letra");
    const byLabel = (name: string) =>
      [...selects].find((s) => s.getAttribute("aria-label") === name);
    expect((byLabel("Tipografía") as HTMLSelectElement).value).toBe("source-serif");
    expect((byLabel("Tamaño de letra") as HTMLSelectElement).value).toBe("lg");

    const groups = host.querySelectorAll<HTMLElement>('[role="group"]');
    const groupLabels = [...groups].map((g) => g.getAttribute("aria-label"));
    for (const legend of [
      "Interlineado",
      "Margen",
      "Alineación",
      "Enfoque de lectura",
      "Disposición",
    ]) {
      expect(groupLabels).toContain(legend);
    }
    // Valores de la cuenta reflejados en el botón presionado de cada grupo.
    const pressed = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')];
    const pressedTexts = pressed.map((b) => b.textContent);
    expect(pressedTexts).toContain("Amplio"); // interlineado loose
    expect(pressedTexts).toContain("Estrecho"); // margen sm
    expect(pressedTexts).toContain("Anclas de lectura");
    expect(pressedTexts).toContain("Scroll continuo");
  });

  it("la vista previa local refleja los ajustes sin iframe", async () => {
    await renderPanel();
    expect(host.querySelector("iframe")).toBeNull();

    const preview = host.querySelector<HTMLElement>(".kindle-preview");
    expect(preview).not.toBeNull();
    expect(preview!.className).toContain("kindle-preview--scroll");

    const content = host.querySelector<HTMLElement>(".kindle-preview-content")!;
    // size=lg → 1.35rem, align=left, margin=sm → 6px 12px (mapas reales del /k)
    expect(content.style.fontSize).toBe("1.35rem");
    expect(content.style.textAlign).toBe("left");
    expect(content.style.padding).toBe("6px 12px");
    expect(content.style.fontFamily).toContain("Source Serif");
    expect(content.style.lineHeight).toBe("1.78");

    // Enfoque «anclas»: prefijos en negrita sobre el pasaje de muestra.
    const anchors = content.querySelectorAll(".kindle-preview-anc");
    expect(anchors.length).toBeGreaterThan(0);
  });

  it("Guardar en mi Kindle hace PUT /api/kindle/prefs con los ajustes", async () => {
    await renderPanel();
    accountFetchMock.mockClear();
    accountFetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Kindle"),
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(accountFetchMock).toHaveBeenCalledWith(
      "/api/kindle/prefs",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(accountFetchMock.mock.calls[0][1].body as string);
    expect(body.prefs.approach).toBe("anchors");
    expect(body.prefs.fontFamily).toBe("source-serif");
    expect(host.textContent).toContain("Ajustes guardados");
  });

  it("muestra el error cuando el guardado falla", async () => {
    await renderPanel();
    accountFetchMock.mockClear();
    accountFetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "El servicio de ajustes no está disponible todavía." }),
    });

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Kindle"),
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("El servicio de ajustes no está disponible todavía.");
  });

  it("los estilos rápidos aplican presets completos y marcan «Personalizado» al mezclar", async () => {
    await renderPanel();
    // Las prefs de la cuenta del mock no coinciden con ningún preset.
    expect(host.textContent).toContain("Personalizado");

    const groups = [...host.querySelectorAll<HTMLElement>('[role="group"]')];
    const presetGroup = groups.find(
      (g) => g.getAttribute("aria-label") === "Estilos rápidos",
    )!;
    const dislexia = [...presetGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Dislexia",
    )!;
    await act(async () => {
      dislexia.click();
    });

    expect(dislexia.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toContain("Personalizado");

    // La vista previa refleja el preset: OpenDyslexic + párrafos numerados.
    const content = host.querySelector<HTMLElement>(".kindle-preview-content")!;
    expect(content.style.fontFamily).toContain("OpenDyslexic");
    expect(content.querySelector(".kindle-preview-pnum")).toBeTruthy();

    // El PUT envía las prefs resueltas del preset (nunca el id).
    accountFetchMock.mockClear();
    accountFetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const saveBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Kindle"),
    )!;
    await act(async () => {
      saveBtn.click();
      await Promise.resolve();
    });
    const body = JSON.parse(accountFetchMock.mock.calls[0][1].body as string);
    expect(body.prefs.fontFamily).toBe("opendyslexic");
    expect(body.prefs.approach).toBe("paragraphs");
    expect(body.prefs.id).toBeUndefined();

    // Cambiar un ajuste manual convierte la mezcla en «Personalizado».
    const alignGroup = [...host.querySelectorAll<HTMLElement>('[role="group"]')].find(
      (g) => g.getAttribute("aria-label") === "Alineación",
    )!;
    const justificado = [...alignGroup.querySelectorAll("button")].find(
      (b) => b.textContent === "Justificado",
    )!;
    await act(async () => {
      justificado.click();
    });
    expect(host.textContent).toContain("Personalizado");
    expect(dislexia.getAttribute("aria-pressed")).toBe("false");
  });
});
