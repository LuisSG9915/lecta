// Comprueba desde fuera que el modelo de Kitten TTS está publicado y que el
// cliente apunta al mismo binario. Pensado para correr a mano o en un workflow
// programado: no necesita credenciales y no modifica nada.
//
//   node scripts/check-model.mjs --url https://lecta.luis-sg9915.workers.dev
//
// Sale con código 1 si algo no cuadra.
import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MODEL_BYTES = 24_369_971;
export const SIZE_TOLERANCE_RATIO = 0.02;
export const CLIENT_MODEL_CONFIG_PATH = resolve("src/client/lib/kittenModel.ts");

/** Extrae la URL y el hash que usa el cliente, para no duplicar la verdad. */
export function readClientModelConfig(filePath = CLIENT_MODEL_CONFIG_PATH) {
  const source = fs.readFileSync(filePath, "utf8");
  const url = source.match(/KITTEN_MODEL_URL\s*=\s*"([^"]+)"/)?.[1];
  const sha256 = source
    .match(/KITTEN_MODEL_SHA256\s*=\s*\n?\s*"([0-9a-f]{64})"/i)?.[1]
    ?.toLowerCase();
  if (!url) throw new Error(`No se encontró KITTEN_MODEL_URL en ${filePath}`);
  if (!sha256) throw new Error(`No se encontró KITTEN_MODEL_SHA256 en ${filePath}`);
  const filename = url.split("/").pop();
  if (!filename) throw new Error(`KITTEN_MODEL_URL no tiene nombre de archivo: ${url}`);
  return { url, filename, sha256 };
}

/**
 * HEAD contra /models/<archivo> y comprobaciones de tamaño, ETag y caché.
 * `fetchImpl` es inyectable para probarlo sin red.
 */
export async function verifyModelEndpoint({
  baseUrl,
  filename,
  expectedBytes = DEFAULT_MODEL_BYTES,
  toleranceRatio = SIZE_TOLERANCE_RATIO,
  fetchImpl = fetch,
} = {}) {
  if (!baseUrl) throw new Error("Falta baseUrl");
  if (!filename) throw new Error("Falta filename");

  const url = `${baseUrl.replace(/\/+$/, "")}/models/${filename}`;
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: Boolean(ok), detail });
    return ok;
  };

  let response;
  try {
    response = await fetchImpl(url, { method: "HEAD" });
  } catch (error) {
    check("HEAD /models responde", false, error.message);
    return { url, ok: false, results };
  }

  check("HEAD responde 200", response.status === 200, `status ${response.status}`);

  const length = Number(response.headers.get("content-length"));
  const tolerance = Math.round(expectedBytes * toleranceRatio);
  check(
    "Content-Length esperado",
    Number.isFinite(length) && length > 0 && Math.abs(length - expectedBytes) <= tolerance,
    `${length} vs ${expectedBytes} (±${tolerance})`,
  );

  const etag = response.headers.get("etag");
  check("ETag presente", Boolean(etag), etag ?? "sin ETag");

  const cacheControl = response.headers.get("cache-control") ?? "";
  check(
    "Cache-Control inmutable",
    cacheControl.includes("immutable"),
    cacheControl || "sin Cache-Control",
  );

  return { url, ok: results.every((r) => r.ok), results };
}

function printReport({ url, ok, results }) {
  console.log(`\nModelo: ${url}\n`);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(ok ? "\nTodo en orden.\n" : "\nHay comprobaciones que fallan.\n");
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    const urlIndex = process.argv.indexOf("--url");
    const baseUrl = urlIndex > -1 ? process.argv[urlIndex + 1] : "http://127.0.0.1:5173";
    const bytesIndex = process.argv.indexOf("--bytes");
    const expectedBytes =
      bytesIndex > -1 ? Number(process.argv[bytesIndex + 1]) : DEFAULT_MODEL_BYTES;

    const client = readClientModelConfig();
    const report = await verifyModelEndpoint({
      baseUrl,
      filename: client.filename,
      expectedBytes,
    });
    console.log(
      `Cliente: ${client.url} · SHA-256 ${client.sha256.slice(0, 12)}…`,
    );
    printReport(report);
    // La URL del cliente y el archivo comprobado son el mismo por construcción.
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}
