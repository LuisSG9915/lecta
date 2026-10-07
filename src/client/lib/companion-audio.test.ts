// @vitest-environment jsdom
// Pruebas del audio del compañero: la preferencia apagada de fábrica
// no reproduce nada, un clip corta al anterior y el sonido muere al
// cerrar, ocultar la pestaña o apagar la preferencia. `Audio` se
// simula con una clase falsa que registra play/pause/currentTime —
// jsdom no reproduce medios de verdad.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTMLAudioElement falso: graba cada llamada para afirmar sin audio
// real. `playError` simula el rechazo de la política de autoplay.
class FakeAudio {
  static instances: FakeAudio[] = [];
  static playError: unknown = null;

  src: string;
  volume = 1;
  preload = "";
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  playing = false;

  constructor(src?: string) {
    this.src = src ?? "";
    FakeAudio.instances.push(this);
  }

  play() {
    this.playCalls += 1;
    if (FakeAudio.playError) return Promise.reject(FakeAudio.playError);
    this.playing = true;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.playing = false;
  }
}

type AudioModule = typeof import("./companion-audio");

let audio: AudioModule;

const lastClip = () =>
  FakeAudio.instances[FakeAudio.instances.length - 1];

beforeEach(async () => {
  FakeAudio.instances = [];
  FakeAudio.playError = null;
  vi.stubGlobal("Audio", FakeAudio);
  // Módulo fresco por prueba: `enabled`, `clips` y `current` viven en
  // el singleton y no deben fugarse entre casos.
  vi.resetModules();
  audio = await import("./companion-audio");
});

afterEach(() => {
  audio.stopCompanionSound();
  vi.unstubAllGlobals();
});

describe("companion-audio", () => {
  it("con la preferencia apagada (default) no reproduce nada", () => {
    audio.playCompanionSound("meow");
    audio.playCompanionSound("purr");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("activada, reproduce el maullido a volumen bajo", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("meow");
    const clip = lastClip();
    expect(clip.src).toBe("/audio/cat-softmew.wav");
    expect(clip.volume).toBeLessThanOrEqual(0.4);
    expect(clip.playCalls).toBe(1);
    expect(clip.playing).toBe(true);
  });

  it("un clip nuevo corta al anterior — nunca suenan dos a la vez", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("meow");
    const meow = lastClip();
    audio.playCompanionSound("purr");
    const purr = lastClip();
    expect(meow).not.toBe(purr);
    expect(meow.pauseCalls).toBe(1);
    expect(meow.playing).toBe(false);
    expect(purr.src).toBe("/audio/cat-purr.wav");
    expect(purr.playing).toBe(true);
  });

  it("pedir el mismo clip otra vez lo reinicia desde cero", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("meow");
    const clip = lastClip();
    clip.currentTime = 0.8;
    audio.playCompanionSound("meow");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(clip.pauseCalls).toBe(1);
    expect(clip.playCalls).toBe(2);
    expect(clip.currentTime).toBe(0);
  });

  it("stop recorta el ronroneo: pausa y rebobina", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("purr");
    const purr = lastClip();
    purr.currentTime = 5.2; // como si llevara un rato sonando
    audio.stopCompanionSound();
    expect(purr.pauseCalls).toBe(1);
    expect(purr.playing).toBe(false);
    expect(purr.currentTime).toBe(0);
  });

  it("apagar la preferencia corta el clip en curso", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("meow");
    const clip = lastClip();
    audio.setSoundEnabled(false);
    expect(clip.playing).toBe(false);
    // Y ya no suena aunque se vuelva a pedir.
    audio.playCompanionSound("meow");
    expect(clip.playCalls).toBe(1);
  });

  it("el rechazo de play() por autoplay se traga sin lanzar", async () => {
    FakeAudio.playError = new DOMException("autoplay", "NotAllowedError");
    audio.setSoundEnabled(true);
    expect(() => audio.playCompanionSound("meow")).not.toThrow();
    // El .catch interno corre y la promesa rechazada no queda suelta.
    await Promise.resolve();
  });

  it("ocultar la pestaña corta el clip en curso", () => {
    audio.setSoundEnabled(true);
    audio.playCompanionSound("purr");
    const purr = lastClip();
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      if (descriptor) {
        Object.defineProperty(document, "visibilityState", descriptor);
      } else {
        delete (document as { visibilityState?: string }).visibilityState;
      }
    }
    expect(purr.playing).toBe(false);
    expect(purr.pauseCalls).toBe(1);
  });

  it("sin Audio disponible el gesto no rompe", () => {
    vi.stubGlobal("Audio", undefined);
    audio.setSoundEnabled(true);
    expect(() => audio.playCompanionSound("meow")).not.toThrow();
    expect(() => audio.stopCompanionSound()).not.toThrow();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("nada reproduce solo: la superficie son tres funciones explícitas", () => {
    // Visitas del lector, sync, logros y celebraciones jamás llaman a
    // este módulo — el único camino al altavoz es playCompanionSound,
    // que solo se invoca desde el gesto voluntario (abrir la hoja /
    // acariciar). Ni activar la preferencia ni detener crean audio.
    expect(Object.keys(audio).sort()).toEqual([
      "playCompanionSound",
      "setSoundEnabled",
      "stopCompanionSound",
    ]);
    audio.setSoundEnabled(true);
    audio.stopCompanionSound();
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
