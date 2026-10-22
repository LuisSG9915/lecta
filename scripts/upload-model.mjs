import fs from "node:fs";
import child_process from "node:child_process";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const DEFAULT_SOURCE_URL =
  process.env.MODEL_SOURCE_URL ||
  "https://huggingface.co/KittenTTS/kitten-tts-nano-es/resolve/main/kitten-tts-quantized.onnx";

const DEFAULT_BUCKET = process.env.R2_BUCKET_NAME || "lecta-books";
const MODEL_FILENAME = process.env.MODEL_FILENAME || "kitten-tts-quantized.onnx";
const R2_KEY = `models/${MODEL_FILENAME}`;
const CACHE_DIR = process.env.MODEL_CACHE_DIR || resolve(".cache/models");
const LOCAL_PATH = resolve(CACHE_DIR, MODEL_FILENAME);
const MIN_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function ensureModelDownloaded(
  sourceUrl = DEFAULT_SOURCE_URL,
  localPath = LOCAL_PATH,
) {
  if (fs.existsSync(localPath)) {
    const stats = fs.statSync(localPath);
    if (stats.size >= MIN_SIZE_BYTES) {
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

  const result = child_process.spawnSync("npx", args, { stdio: "inherit" });
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
    const isRemote = !process.argv.includes("--local");
    const localFile = await ensureModelDownloaded();
    uploadToR2(localFile, DEFAULT_BUCKET, R2_KEY, isRemote);
    console.log("✓ Proceso completado exitosamente.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
