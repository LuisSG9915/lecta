#!/usr/bin/env node
// Empaqueta la tabla de voces oficial de Kitten TTS 0.8 (voices.npz de
// KittenML/kitten-tts-nano-0.8-int8) en public/tts/kitten-voices-v1.bin.
//
// Formato: float32 little-endian crudo, sin cabecera. 8 voces × 400 filas × 256
// floats = 3 276 800 bytes, en el orden de VOICE_ORDER (el mismo que
// KITTEN_VOICE_ORDER en src/client/lib/kittenModel.ts). La fila que usa cada
// síntesis es min(len(texto), 399); ver runKittenInference en el worker.
//
// Uso: node scripts/kitten-voices-pack.mjs [ruta/a/voices.npz]
// Sin argumento la descarga de Hugging Face. Imprime el SHA-256 para pegarlo en
// KITTEN_VOICES_SHA256 (kittenModel.ts). Si cambia el contenido, sube la versión
// del nombre (-v2.bin): la ruta se sirve con Cache-Control immutable.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const VOICE_ORDER = [
  "expr-voice-2-f",
  "expr-voice-2-m",
  "expr-voice-3-f",
  "expr-voice-3-m",
  "expr-voice-4-f",
  "expr-voice-4-m",
  "expr-voice-5-f",
  "expr-voice-5-m",
];
const ROWS = 400;
const DIMS = 256;
const SOURCE = "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/tts/kitten-voices-v1.bin");

/** Lee las entradas de un zip (stored o deflate) por el directorio central. */
export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No es un zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Directorio central corrupto");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (method !== 0 && method !== 8) throw new Error(`Método zip ${method} no soportado (${name})`);
    out.set(name, method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Devuelve los float32 de un .npy `<f4` de forma (ROWS, DIMS). */
export function npyTable(npy, name) {
  if (npy.toString("latin1", 1, 6) !== "NUMPY") throw new Error(`${name}: no es .npy`);
  const headerLen = npy.readUInt16LE(8);
  const header = npy.toString("latin1", 10, 10 + headerLen);
  if (!header.includes("'<f4'") || !header.includes(`(${ROWS}, ${DIMS})`) || header.includes("True")) {
    throw new Error(`${name}: se esperaba <f4 (${ROWS}, ${DIMS}) C-order; cabecera: ${header.trim()}`);
  }
  const body = npy.subarray(10 + headerLen);
  if (body.length !== ROWS * DIMS * 4) throw new Error(`${name}: tamaño ${body.length} inesperado`);
  return body;
}

export function packVoices(npz) {
  const entries = readZipEntries(npz);
  const parts = VOICE_ORDER.map((id) => {
    const npy = entries.get(`${id}.npy`);
    if (!npy) throw new Error(`Falta ${id}.npy en el npz`);
    return npyTable(npy, id);
  });
  return Buffer.concat(parts);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const npz = arg
    ? readFileSync(arg)
    : Buffer.from(await (await fetch(SOURCE)).arrayBuffer());
  const bin = packVoices(npz);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bin);
  console.log(`${OUT}\n  bytes:  ${bin.length}\n  sha256: ${createHash("sha256").update(bin).digest("hex")}`);
}
