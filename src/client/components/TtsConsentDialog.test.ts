// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TtsConsentDialog from "./TtsConsentDialog";
import * as kittenEngine from "../lib/kittenTtsEngine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TtsConsentDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  const render = (props: Parameters<typeof TtsConsentDialog>[0]) => {
    act(() => {
      root.render(h(TtsConsentDialog, props));
    });
  };

  it("muestra la explicación de KittenTTS Neural (~24 MB) y opciones de activación", () => {
    render({
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
    });

    expect(container.textContent).toContain("KittenTTS Neural (~24 MB)");
    expect(container.textContent).toContain("Descargar KittenTTS Neural (24 MB)");
    expect(container.textContent).toContain("Usar voz ligera del sistema (0 MB)");
  });

  it("permite elegir 'Usar voz ligera del sistema (0 MB)' sin descargar", () => {
    const onAccept = vi.fn();
    render({
      onAccept,
      onDismiss: vi.fn(),
    });

    const browserBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Usar voz ligera del sistema"),
    );
    expect(browserBtn).not.toBeUndefined();
    act(() => browserBtn?.click());

    expect(onAccept).toHaveBeenCalledWith("browser");
  });

  it("descarga el modelo neural mostrando progreso y activa kitten-neural", async () => {
    const onAccept = vi.fn();
    const downloadSpy = vi
      .spyOn(kittenEngine, "downloadKittenModel")
      .mockImplementation(async (onProgress) => {
        onProgress?.({ status: "downloading", percent: 50 });
        onProgress?.({ status: "ready", percent: 100 });
      });

    render({
      onAccept,
      onDismiss: vi.fn(),
    });

    const downloadBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Descargar KittenTTS Neural"),
    );
    expect(downloadBtn).not.toBeUndefined();

    await act(async () => {
      downloadBtn?.click();
    });

    expect(downloadSpy).toHaveBeenCalled();
    expect(onAccept).toHaveBeenCalledWith("kitten-neural");
  });

  it("cierra el diálogo al pulsar 'Ahora no' o Escape", () => {
    const onDismiss = vi.fn();
    render({
      onAccept: vi.fn(),
      onDismiss,
    });

    const dismissBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Ahora no"),
    );
    act(() => dismissBtn?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("renderiza el porcentaje de progreso cuando downloadProgress={45}", () => {
    render({
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
      downloadProgress: 45,
    });

    const progress = container.querySelector('[role="progressbar"]');
    expect(progress).toBeTruthy();
    expect(progress?.getAttribute("aria-valuenow")).toBe("45");
    expect(container.textContent).toContain("Descargando Voz Neural HD (Offline)... 45%");
  });

  it("renderiza y dispara onDeleteModel cuando isModelDownloaded={true}", () => {
    const onDeleteModel = vi.fn();
    render({
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
      isModelDownloaded: true,
      onDeleteModel,
    });

    const deleteBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Borrar datos de voz offline"),
    );
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn?.textContent).toContain("🗑️ Borrar datos de voz offline (~24 MB)");

    act(() => {
      deleteBtn?.click();
    });
    expect(onDeleteModel).toHaveBeenCalledTimes(1);
  });
});

