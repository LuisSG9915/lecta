import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOURCE_URL,
  ensureModelDownloaded,
  resolveChecksumPolicy,
  uploadToR2,
} from "./upload-model.mjs";
import fs from "node:fs";
import child_process from "node:child_process";
import { Writable } from "node:stream";

// SHA-256 real del kitten_tts_nano_v0_8.onnx (24 369 971 bytes).
const MODEL_SHA256 =
  "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc";

describe("scripts/upload-model", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("apunta al modelo KittenML vigente", () => {
    expect(DEFAULT_SOURCE_URL).toContain("KittenML/kitten-tts-nano-0.8-int8");
    expect(DEFAULT_SOURCE_URL.endsWith(".onnx")).toBe(true);
  });

  it("reutiliza el modelo existente si su tamaño supera los 10 MB", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 15 * 1024 * 1024 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await ensureModelDownloaded("https://example.com/model.onnx", "/fake/path/model.onnx");

    expect(result).toBe("/fake/path/model.onnx");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("elimina y re-descarga el archivo si su tamaño previo es menor a 10 MB", async () => {
    let exists = true;
    vi.spyOn(fs, "existsSync").mockImplementation(() => exists);
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      exists = false;
    });
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    vi.spyOn(fs, "createWriteStream").mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );

    let callCount = 0;
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      callCount++;
      return { size: callCount === 1 ? 100 : 15 * 1024 * 1024 };
    });

    const mockReadableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: mockReadableStream,
    });

    const result = await ensureModelDownloaded("https://example.com/model.onnx", "/fake/path/model.onnx");
    expect(unlinkSpy).toHaveBeenCalledWith("/fake/path/model.onnx");
    expect(result).toBe("/fake/path/model.onnx");
  });

  it("lanza error si la descarga entrega un archivo corrupto o menor a 10 MB", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    vi.spyOn(fs, "createWriteStream").mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );

    vi.spyOn(fs, "statSync").mockReturnValue({
      size: 5 * 1024 * 1024, // solo 5 MB
    });

    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});

    const mockReadableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: mockReadableStream,
    });

    await expect(
      ensureModelDownloaded("https://example.com/model.onnx", "/fake/path/model.onnx"),
    ).rejects.toThrow("menor a 10 MB");

    expect(unlinkSpy).toHaveBeenCalledWith("/fake/path/model.onnx");
  });

  it("ejecuta wrangler r2 object put con los argumentos correctos", () => {
    const spawnSpy = vi.spyOn(child_process, "spawnSync").mockReturnValue({
      status: 0,
    });

    uploadToR2("/local/path/model.onnx", "lecta-books", "models/kitten.onnx", true);

    expect(spawnSpy).toHaveBeenCalledWith(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        "lecta-books/models/kitten.onnx",
        "--file=/local/path/model.onnx",
        "--content-type=application/octet-stream",
        "--remote",
      ],
      { stdio: "inherit" },
    );
  });

  describe("resolveChecksumPolicy", () => {
    it("normaliza un SHA-256 en mayúsculas o con espacios", () => {
      expect(
        resolveChecksumPolicy({ expected: `  ${MODEL_SHA256.toUpperCase()}  ` }),
      ).toBe(MODEL_SHA256);
    });

    it("sin --verify y sin hash devuelve vacío: se avisa y se continúa", () => {
      vi.stubEnv("MODEL_SHA256", "");
      expect(resolveChecksumPolicy({ verify: false })).toBe("");
    });

    it("con --verify exige MODEL_SHA256", () => {
      vi.stubEnv("MODEL_SHA256", "");
      expect(() => resolveChecksumPolicy({ verify: true })).toThrow(
        /obligatorio con --verify/,
      );
    });

    it("rechaza un hash con formato inválido", () => {
      expect(() =>
        resolveChecksumPolicy({ verify: false, expected: "f7b0afcb" }),
      ).toThrow(/no es un SHA-256 válido/);
    });
  });
});
