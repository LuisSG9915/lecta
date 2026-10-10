// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isFullscreen,
  isFullscreenSupported,
  subscribeFullscreenChange,
  toggleFullscreen,
} from "./fullscreen";

describe("fullscreen utilities", () => {
  const originalFullscreenElement = Object.getOwnPropertyDescriptor(
    document,
    "fullscreenElement",
  );
  const originalFullscreenEnabled = Object.getOwnPropertyDescriptor(
    document,
    "fullscreenEnabled",
  );
  const originalRequestFullscreen = document.documentElement.requestFullscreen;
  const originalExitFullscreen = document.exitFullscreen;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalFullscreenElement) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenElement);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (originalFullscreenEnabled) {
      Object.defineProperty(document, "fullscreenEnabled", originalFullscreenEnabled);
    } else {
      Reflect.deleteProperty(document, "fullscreenEnabled");
    }
    document.documentElement.requestFullscreen = originalRequestFullscreen;
    document.exitFullscreen = originalExitFullscreen;
  });

  it("detecta si la pantalla completa está activa o inactiva", () => {
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
    expect(isFullscreen()).toBe(false);

    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    expect(isFullscreen()).toBe(true);
  });

  it("detecta si la pantalla completa está soportada", () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      value: true,
      configurable: true,
    });
    expect(isFullscreenSupported()).toBe(true);

    Object.defineProperty(document, "fullscreenEnabled", {
      value: false,
      configurable: true,
    });
    document.documentElement.requestFullscreen =
      undefined as unknown as typeof document.documentElement.requestFullscreen;
    expect(isFullscreenSupported()).toBe(false);

    document.documentElement.requestFullscreen = vi.fn();
    expect(isFullscreenSupported()).toBe(true);
  });

  it("permite entrar y salir de pantalla completa con toggleFullscreen", async () => {
    const requestMock = vi.fn().mockResolvedValue(undefined);
    const exitMock = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestMock;
    document.exitFullscreen = exitMock;

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
      writable: true,
    });

    // Sin estado activo, toggle entra
    await toggleFullscreen();
    expect(requestMock).toHaveBeenCalledTimes(1);

    // Simular que ahora está activo
    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
      writable: true,
    });

    // Con estado activo, toggle sale
    await toggleFullscreen();
    expect(exitMock).toHaveBeenCalledTimes(1);

    // Parámetro explícito true cuando ya está activo no llama de nuevo
    await toggleFullscreen(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("permite suscribirse a cambios de pantalla completa", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeFullscreenChange(callback);

    document.dispatchEvent(new Event("fullscreenchange"));
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
