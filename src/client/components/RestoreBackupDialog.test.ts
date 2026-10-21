// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RestoreBackupDialog from "./RestoreBackupDialog";
import * as exportLib from "../lib/export";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RestoreBackupDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renderiza el botón trigger y activa el input de archivo al hacer clic", () => {
    const onRestored = vi.fn();
    act(() => {
      root.render(
        h(RestoreBackupDialog, {
          onRestored,
          trigger: (openPicker) =>
            h("button", { type: "button", onClick: openPicker }, "Abrir Restaurar"),
        }),
      );
    });

    const triggerBtn = host.querySelector("button");
    expect(triggerBtn?.textContent).toBe("Abrir Restaurar");

    const input = host.querySelector<HTMLInputElement>(
      'input[data-testid="restore-backup-file-input"]',
    );
    expect(input).not.toBeNull();
    const clickSpy = vi.spyOn(input!, "click");

    act(() => {
      triggerBtn?.click();
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("muestra la vista previa honesta con el texto requerido y ejecuta onRestored al confirmar", async () => {
    const onRestored = vi.fn();
    const restoreSpy = vi
      .spyOn(exportLib, "restoreBackupPayload")
      .mockResolvedValue({
        booksRestored: 0,
        positionsRestored: 2,
        wordsRestored: 5,
        annotationsRestored: 1,
        activityRestored: 3,
        reviewsRestored: 2,
        knowledgeRestored: 1,
      });

    vi.spyOn(exportLib, "inspectBackupPayload").mockReturnValue({
      version: 1,
      exportedAt: "2026-10-21T00:00:00.000Z",
      booksCount: 2,
      wordsCount: 5,
      annotationsCount: 1,
      positionsCount: 2,
      hasCompanionState: true,
      reviewsCount: 2,
      activityCount: 3,
    });

    act(() => {
      root.render(
        h(RestoreBackupDialog, {
          onRestored,
          trigger: (openPicker) =>
            h("button", { type: "button", onClick: openPicker }, "Restaurar"),
        }),
      );
    });

    const input = host.querySelector<HTMLInputElement>(
      'input[data-testid="restore-backup-file-input"]',
    )!;

    const file = new File(
      [JSON.stringify({ version: 1, words: [], books: [] })],
      "backup.json",
      { type: "application/json" },
    );

    // Simular lectura de FileReader
    await act(async () => {
      const changeEvent = new Event("change", { bubbles: true });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(changeEvent);
    });

    // Esperar microtasks de FileReader
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verificar que el diálogo de vista previa está presente
    const dialog = document.body.querySelector(".dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Restaurar respaldo");

    // Verificar que incluye el texto honesto sobre no transportar EPUBs
    expect(dialog?.textContent).toContain(
      "El respaldo guarda tus palabras, notas, posiciones e historial. Los archivos EPUB no viajan en el archivo de respaldo",
    );

    // Botón de confirmación
    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restaurar y fusionar datos"),
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(restoreSpy).toHaveBeenCalled();
    expect(onRestored).toHaveBeenCalled();
  });
});
