import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BYTES,
  readClientModelConfig,
  verifyModelEndpoint,
} from "./check-model.mjs";

const BASE = "https://lecta.test";

function responseWith(headers = {}, status = 200) {
  return new Response(null, { status, headers });
}

const goodHeaders = {
  "content-length": String(DEFAULT_MODEL_BYTES),
  etag: '"abc123"',
  "cache-control": "public, max-age=31536000, immutable",
  "content-type": "application/octet-stream",
};

describe("check-model", () => {
  it("lee la URL y el hash del cliente, sin duplicar la verdad", () => {
    const client = readClientModelConfig();
    expect(client.url).toBe("/models/kitten-tts-nano-0.8-int8-v1.onnx");
    expect(client.filename).toBe("kitten-tts-nano-0.8-int8-v1.onnx");
    expect(client.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(client.sha256).toBe(
      "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc",
    );
  });

  it("acepta un modelo publicado con tamaño, ETag y caché inmutable", async () => {
    const report = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "kitten-tts-nano-0.8-int8-v1.onnx",
      fetchImpl: async () => responseWith(goodHeaders),
    });
    expect(report.ok).toBe(true);
    expect(report.url).toBe(`${BASE}/models/kitten-tts-nano-0.8-int8-v1.onnx`);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it("rechaza un Content-Length fuera del ±2 %", async () => {
    const report = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "model.onnx",
      fetchImpl: async () =>
        responseWith({ ...goodHeaders, "content-length": String(DEFAULT_MODEL_BYTES / 2) }),
    });
    expect(report.ok).toBe(false);
    expect(report.results.find((r) => r.name === "Content-Length esperado")?.ok).toBe(false);
  });

  it("rechaza un 404 y no sigue comprobando cabeceras", async () => {
    const report = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "model.onnx",
      fetchImpl: async () => responseWith({}, 404),
    });
    expect(report.ok).toBe(false);
    expect(report.results.find((r) => r.name === "HEAD responde 200")?.ok).toBe(false);
  });

  it("rechaza la falta de ETag o de Cache-Control inmutable", async () => {
    const noEtag = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "model.onnx",
      fetchImpl: async () => responseWith({ ...goodHeaders, etag: "" }),
    });
    expect(noEtag.ok).toBe(false);

    const noImmutable = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "model.onnx",
      fetchImpl: async () =>
        responseWith({ ...goodHeaders, "cache-control": "public, max-age=60" }),
    });
    expect(noImmutable.ok).toBe(false);
  });

  it("informa del fallo de red sin lanzar", async () => {
    const report = await verifyModelEndpoint({
      baseUrl: BASE,
      filename: "model.onnx",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].detail).toContain("ECONNREFUSED");
  });
});
