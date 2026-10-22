import fs from "node:fs";
import child_process from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

export const DEFAULT_SOURCE_URL =
  "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx";

// MODEL_SOURCE_URL permite probar con otro espejo sin cambiar la constante
// pública que verifican las pruebas.
const SOURCE_URL = process.env.MODEL_SOURCE_URL || DEFAULT_SOURCE_URL;

const DEFAULT_BUCKET = process.env.R2_BUCKET_NAME || "lecta-books";
const MODEL_FILENAME = process.env.MODEL_FILENAME || "kitten-tts-nano-0.8-int8-v1.onnx";
const R2_KEY = `models/${MODEL_FILENAME}`;
const CACHE_DIR = process.env.MODEL_CACHE_DIR || resolve(".cache/models");
const LOCAL_PATH = resolve(CACHE_DIR, MODEL_FILENAME);
const MIN_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Política del checksum (decisión 0.5 del plan de 8 fases):
 * - con `--verify`, MODEL_SHA256 es obligatorio; si falta o no es un SHA-256
 *   válido, se aborta antes de descargar o subir nada;
 * - sin `--verify`, si falta, se avisa y se continúa para no bloquear una
 *   re-subida puntual del binario.
 */
export function resolveChecksumPolicy({
  verify = false,
  expected = process.env.MODEL_SHA256,
} = {}) {
  const normalized = expected?.trim().toLowerCase() ?? "";
  if (/^[0-9a-f]{64}$/.test(normalized)) return normalized;
  if (normalized) {
    throw new Error(
      `MODEL_SHA256 no es un SHA-256 válido (64 caracteres hex): "${normalized}"`,
    );
  }
  if (verify) {
    throw new Error(
      "MODEL_SHA256 es obligatorio con --verify. Calcula el hash del binario con\n" +
        "  shasum -a 256 <modelo.onnx>\n" +
        "y expórtalo antes de ejecutar `pnpm model:upload --verify`.",
    );
  }
  return "";
}

async function verifyModelChecksum(
  localPath,
  expected = process.env.MODEL_SHA256,
) {
  const normalized = expected?.trim().toLowerCase();
  if (!normalized) return;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      `MODEL_SHA256 no es un SHA-256 válido (64 caracteres hex): "${normalized}"`,
    );
  }

  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(localPath), hash);
  const actual = hash.digest("hex");
  if (actual !== normalized) {
    throw new Error(
      `El SHA-256 del modelo no coincide (esperado ${normalized}, obtenido ${actual}): ${localPath}`,
    );
  }
  console.log("✓ SHA-256 del modelo verificado");
}

export async function ensureModelDownloaded(
  sourceUrl = SOURCE_URL,
  localPath = LOCAL_PATH,
) {
  if (fs.existsSync(localPath)) {
    const stats = fs.statSync(localPath);
    if (stats.size >= MIN_SIZE_BYTES) {
      await verifyModelChecksum(localPath);
      console.log(
        `✓ Modelo encontrado en caché local (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${localPath}`,
      );
      return localPath;
    }
    console.warn(
      `! Archivo existente corrupto o incompleto (${stats.size} bytes). Re-descargando...`,
    );
    fs.unlinkSync(localPath);
  }

  fs.mkdirSync(dirname(localPath), { recursive: true });
  console.log(`Descargando modelo desde ${sourceUrl}...`);
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "Lecta-Model-Uploader/1.0" },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Fallo al descargar modelo (${response.status} ${response.statusText}): ${sourceUrl}`,
    );
  }

  const fileStream = fs.createWriteStream(localPath);
  await pipeline(Readable.fromWeb(response.body), fileStream);

  const stats = fs.statSync(localPath);
  if (stats.size < MIN_SIZE_BYTES) {
    fs.unlinkSync(localPath);
    throw new Error(
      `El archivo descargado es menor a 10 MB (${stats.size} bytes). Puede estar incompleto o corrupto.`,
    );
  }

  console.log(
    `✓ Modelo descargado exitosamente (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${localPath}`,
  );
  await verifyModelChecksum(localPath);
  return localPath;
}

export function uploadToR2(
  localPath,
  bucket = DEFAULT_BUCKET,
  key = R2_KEY,
  isRemote = true,
) {
  const destination = `${bucket}/${key}`;
  console.log(`Subiendo a R2 (${destination})...`);
  const args = [
    "wrangler",
    "r2",
    "object",
    "put",
    destination,
    `--file=${localPath}`,
    "--content-type=application/octet-stream",
  ];
  if (isRemote) {
    args.push("--remote");
  }

  const result = child_process.spawnSync("pnpm", ["exec", ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `Error al subir el modelo a R2 via wrangler (código de salida: ${result.status})`,
    );
  }
  console.log(`✓ Modelo subido a R2 en ${destination}`);
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    const verify = process.argv.includes("--verify");
    const checksum = resolveChecksumPolicy({ verify });
    if (checksum) {
      // Normalizado, para que ensureModelDownloaded verifique exactamente esto.
      process.env.MODEL_SHA256 = checksum;
    } else {
      console.warn(
        "⚠️  MODEL_SHA256 no está definido: el modelo se subirá sin verificar su " +
          "integridad. Usa `pnpm model:upload --verify` para exigirlo.",
      );
    }
    const isRemote = !process.argv.includes("--local");
    const localFile = await ensureModelDownloaded();
    uploadToR2(localFile, DEFAULT_BUCKET, R2_KEY, isRemote);
    console.log("✓ Proceso completado exitosamente.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
