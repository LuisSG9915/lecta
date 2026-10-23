// @vitest-environment jsdom
// Pruebas de los ajustes del lector (extraídos de Reader.tsx): parche sobre los
// ajustes vigentes, resolución del modo de enfoque y persistencia por libro.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderSettings, type UseReaderSettingsOptions } from "./useReaderSettings";
import { DEFAULT_SETTINGS, type ReaderSettings } from "../lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ saveReaderSettings: vi.fn() }));

vi.mock("../lib/settings", async (orig) => ({
  ...(await orig<typeof import("../lib/settings")>()),
  saveReaderSettings: mocks.saveReaderSettings,
}));

describe("useReaderSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api!: ReturnType<typeof useReaderSettings>;

  function Probe({ options }: { options: UseReaderSettingsOptions }) {
    api = useReaderSettings(options);
    return null;
  }

  const settingsOptions = (
    over: Partial<UseReaderSettingsOptions> = {},
  ): UseReaderSettingsOptions => ({
    bookHash: "book-1",
    setSettings: vi.fn(),
    setBookOverride: vi.fn(),
    ...over,
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (opts: UseReaderSettingsOptions) =>
    act(() => {
      root.render(h(Probe, { options: opts }));
    });

  /** Aplica el parche sobre los ajustes por defecto y devuelve el resultado. */
  const apply = (opts: UseReaderSettingsOptions, patch: Partial<ReaderSettings>): ReaderSettings => {
    act(() => api.updateSettings(patch));
    const updater = (opts.setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    return updater(DEFAULT_SETTINGS) as ReaderSettings;
  };

  it("mantiene la identidad de updateSettings entre renders", () => {
    render(settingsOptions());
    const first = api.updateSettings;
    render(settingsOptions());
    expect(api.updateSettings).toBe(first);
  });

  it("aplica el parche, lo guarda en el libro y marca la preferencia", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { size: 24 });
    expect(next.size).toBe(24);
    expect(next.font).toBe(DEFAULT_SETTINGS.font);
    expect(mocks.saveReaderSettings).toHaveBeenCalledWith(next, "book-1");
    expect(opts.setBookOverride).toHaveBeenCalledWith(true);
  });

  it("tocar una ayuda de enfoque marca el preset como ajustado", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { focusRuler: true });
    expect(next.strategyPreset).toBe("custom");
    expect(next.readingPreset).toBe("custom");
    expect(next.focusRuler).toBe(true);
    expect(next.paragraphFocus).toBe(false);
    expect(next.focusMode).toBe("ruler");
  });

  it("el foco por párrafo apaga la regla", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { paragraphFocus: true });
    expect(next.paragraphFocus).toBe(true);
    expect(next.focusRuler).toBe(false);
    expect(next.focusMode).toBe("paragraph");
  });

  it("apagar las dos ayudas cae al modo que quede activo", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { focusRuler: false, paragraphFocus: false });
    expect(next.focusRuler).toBe(false);
    expect(next.paragraphFocus).toBe(false);
    expect(["off", "chromatic", "syntactic"]).toContain(next.focusMode);
  });

  it("respeta un focusMode explícito", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { focusMode: "syntactic" });
    expect(next.focusMode).toBe("syntactic");
  });

  it("no marca el preset como ajustado si el parche ya lo trae", () => {
    const opts = settingsOptions();
    render(opts);
    const next = apply(opts, { focusRuler: true, strategyPreset: "guided" });
    expect(next.strategyPreset).toBe("guided");
  });
});
