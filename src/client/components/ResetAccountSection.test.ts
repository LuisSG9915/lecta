// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetAccountSection } from "./ResetAccountSection";
import * as accountResetModule from "../lib/account-reset";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function changeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ResetAccountSection", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("renderiza el título, descripción y el botón inicial 'Empezar de cero…'", async () => {
    await act(async () => {
      root.render(h(ResetAccountSection, { userId: "user_test_1" }));
    });

    expect(host.textContent).toContain("Empezar de cero");
    expect(host.textContent).toContain(
      "Borra todo tu historial de lectura, libros subidos y palabras guardadas sin eliminar tu cuenta.",
    );

    const openBtn = host.querySelector("button");
    expect(openBtn?.textContent?.trim()).toBe("Empezar de cero…");
  });

  it("al pulsar el botón inicial abre la confirmación con el botón de confirmación deshabilitado", async () => {
    await act(async () => {
      root.render(h(ResetAccountSection, { userId: "user_test_1" }));
    });

    const openBtn = host.querySelector("button")!;
    await act(async () => {
      openBtn.click();
    });

    expect(host.textContent).toContain("Esta acción eliminará permanentemente tus palabras");
    expect(host.textContent).toContain("EMPEZAR DE CERO");

    const input = host.querySelector("input")!;
    expect(input).not.toBeNull();

    const confirmBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Confirmar reinicio"),
    );
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn?.disabled).toBe(true);
  });

  it("el botón Cancelar cierra la confirmación y resetea el texto", async () => {
    await act(async () => {
      root.render(h(ResetAccountSection, { userId: "user_test_1" }));
    });

    const openBtn = host.querySelector("button")!;
    await act(async () => {
      openBtn.click();
    });

    const cancelBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar"),
    );
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      cancelBtn!.click();
    });

    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Empezar de cero…");
  });

  it("habilita el botón solo tras escribir 'EMPEZAR DE CERO' y ejecuta startFromScratch al confirmar", async () => {
    const startFromScratchSpy = vi
      .spyOn(accountResetModule, "startFromScratch")
      .mockResolvedValue(undefined);
    const onResetSuccess = vi.fn();

    await act(async () => {
      root.render(
        h(ResetAccountSection, {
          userId: "user_test_1",
          authToken: "token_123",
          onResetSuccess,
        }),
      );
    });

    // Abrir confirmación
    const openBtn = host.querySelector("button")!;
    await act(async () => {
      openBtn.click();
    });

    const input = host.querySelector("input")!;
    const confirmBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Confirmar reinicio"),
    )!;

    // Escribir texto incorrecto
    await act(async () => {
      changeInputValue(input, "algo distinto");
    });
    expect(confirmBtn.disabled).toBe(true);

    // Escribir palabra clave en minúsculas con espacios alrededor
    await act(async () => {
      changeInputValue(input, "  empezar de cero  ");
    });
    expect(confirmBtn.disabled).toBe(false);

    // Hacer click en confirmar
    await act(async () => {
      confirmBtn.click();
    });

    expect(startFromScratchSpy).toHaveBeenCalledWith("user_test_1", "token_123");
    expect(onResetSuccess).toHaveBeenCalled();
  });

  it("si startFromScratch falla, muestra el mensaje de error en la UI", async () => {
    vi.spyOn(accountResetModule, "startFromScratch").mockRejectedValue(
      new Error("Fallo de conexión con el servidor"),
    );

    await act(async () => {
      root.render(h(ResetAccountSection, { userId: "user_test_1" }));
    });

    const openBtn = host.querySelector("button")!;
    await act(async () => {
      openBtn.click();
    });

    const input = host.querySelector("input")!;
    await act(async () => {
      changeInputValue(input, "EMPEZAR DE CERO");
    });

    const confirmBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Confirmar reinicio"),
    )!;

    await act(async () => {
      confirmBtn.click();
    });

    expect(host.textContent).toContain("Fallo de conexión con el servidor");
  });
});
