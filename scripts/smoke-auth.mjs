// Prueba de humo de autorización: corre contra el dev server en marcha
// (pnpm dev). Crea dos cuentas temporales y verifica que ni libros ni
// vocabulario crucen entre usuarios, además de los 401 sin sesión.
//   node scripts/smoke-auth.mjs  (o SMOKE_URL=http://127.0.0.1:5174 node …)
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5174";

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
};

async function api(path, { method = "GET", body, cookie, json, baseUrl = BASE } = {}) {
  const headers = { origin: baseUrl };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? (json === false ? body : JSON.stringify(body)) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { /* cuerpo binario */ }
  return { status: response.status, data, setCookie: response.headers.getSetCookie?.() ?? [] };
}

async function signUp(user, baseUrl = BASE) {
  const res = await api("/api/auth/sign-up/email", { method: "POST", body: user, baseUrl });
  if (res.status !== 200) throw new Error(`Registro falló para ${user.email}: ${res.status}`);
  const cookie = res.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
  if (!cookie) throw new Error(`Sin cookie de sesión para ${user.email}`);
  return cookie;
}

export async function verifyKindleLinkSmokeTest(baseUrl = BASE, sessionCookie = "") {
  try {
    // 1. Obtener página /kindle sin sesión para extraer el código de 4 letras
    const kindlePageRes = await fetch(`${baseUrl}/kindle`);
    if (kindlePageRes.status !== 200) {
      console.log(`FAIL Kindle portal status ${kindlePageRes.status}`);
      return false;
    }
    const html = await kindlePageRes.text();
    const codeMatch = html.match(/<div[^>]*font-size:\s*3\.5rem[^>]*>\s*([A-Z0-9]{4})\s*<\/div>/);
    const code = codeMatch ? codeMatch[1] : null;
    if (!code) {
      console.log("FAIL No se encontró código de 4 letras en /kindle");
      return false;
    }

    // 2. Vincular código desde móvil/PC con cookie de sesión
    const linkHeaders = {
      "content-type": "application/json",
      origin: baseUrl,
    };
    if (sessionCookie) {
      linkHeaders.cookie = sessionCookie;
    }
    const linkRes = await fetch(`${baseUrl}/api/kindle/link`, {
      method: "POST",
      headers: linkHeaders,
      body: JSON.stringify({ code }),
    });
    if (linkRes.status !== 200) {
      console.log(`FAIL Vinculación Kindle status ${linkRes.status}`);
      return false;
    }

    // 3. Consultar estado desde Kindle
    const statusRes = await fetch(`${baseUrl}/api/kindle/status?code=${code}`);
    const statusData = await statusRes.json().catch(() => null);
    const linkedOk = statusRes.status === 200 && statusData?.linked === true;
    check("Kindle vincula y confirma estado", linkedOk, `status: ${statusRes.status}`);
    return linkedOk;
  } catch (err) {
    console.log(`FAIL Error en prueba de humo de Kindle: ${err?.message || err}`);
    return false;
  }
}

export async function runSmokeTests(baseUrl = BASE) {
  const ts = Date.now();
  const USER_A = { email: `a-${ts}@smoke.test`, password: "prueba-smoke-1234", name: "A" };
  const USER_B = { email: `b-${ts}@smoke.test`, password: "prueba-smoke-1234", name: "B" };

  // --- alta de cuentas ---
  const cookieA = await signUp(USER_A, baseUrl);
  const cookieB = await signUp(USER_B, baseUrl);
  console.log("Cuentas A y B creadas.");

  // --- libros ---
  // EPUB mínimo válido para el servidor: cabecera local ZIP con la
  // primera entrada "mimetype" sin comprimir. El hash debe corresponder
  // al contenido: el endpoint lo verifica.
  const epubHeader = Buffer.alloc(30);
  epubHeader.writeUInt32LE(0x04034b50, 0);
  epubHeader.writeUInt16LE(20, 4);
  epubHeader.writeUInt16LE(8, 26); // nombre "mimetype" (8 bytes), sin extra
  const fakeEpub = Buffer.concat([
    epubHeader,
    Buffer.from("mimetype"),
    Buffer.from("application/epub+zip"),
    Buffer.alloc(100),
  ]);
  const HASH_A = createHash("sha256").update(fakeEpub).digest("hex");

  const upA = await api(`/api/books/${HASH_A}?name=libro-a.epub`, {
    method: "PUT", body: fakeEpub, cookie: cookieA, json: false, baseUrl,
  });
  check("A puede subir su libro", upA.status === 200, `status ${upA.status}`);

  const listB = await api("/api/books", { cookie: cookieB, baseUrl });
  check("B no ve libros de A", listB.status === 200 && listB.data?.books?.length === 0);

  const getB = await api(`/api/books/${HASH_A}`, { cookie: cookieB, baseUrl });
  check("B no puede descargar el libro de A", getB.status === 404, `status ${getB.status}`);

  const delB = await api(`/api/books/${HASH_A}`, { method: "DELETE", cookie: cookieB, baseUrl });
  const getAAfter = await api(`/api/books/${HASH_A}`, { cookie: cookieA, baseUrl });
  check(
    "DELETE de B no borra el libro de A",
    delB.status === 200 && getAAfter.status === 200,
    `B:${delB.status} A:${getAAfter.status}`,
  );

  // --- vocabulario ---
  const putA = await api("/api/vocab", {
    method: "PUT", cookie: cookieA, baseUrl,
    body: { words: [{ form: "perenne", language: "es", meaning: "de A", savedAt: 1, updatedAt: 100 }] },
  });
  check("A puede guardar palabra", putA.status === 200);

  const vocabB = await api("/api/vocab?lang=es", { cookie: cookieB, baseUrl });
  check("B no ve el vocabulario de A", vocabB.status === 200 && vocabB.data?.words?.length === 0);

  await api("/api/vocab", {
    method: "PUT", cookie: cookieB, baseUrl,
    body: { words: [{ form: "perenne", language: "es", meaning: "de B", savedAt: 2, updatedAt: 200 }] },
  });
  const vocabAAfter = await api("/api/vocab?lang=es", { cookie: cookieA, baseUrl });
  const wordA = vocabAAfter.data?.words?.find((w) => w.form === "perenne");
  check(
    "La palabra de B no pisa la de A",
    wordA?.meaning === "de A",
    `significado de A: "${wordA?.meaning}"`,
  );

  // --- posiciones de lectura ---
  const putPos = await api("/api/positions", {
    method: "PUT", cookie: cookieA, baseUrl,
    body: {
      positions: [
        { bookHash: "smoke", sectionIndex: 2, ratio: 0.5, progress: 0.4, updatedAt: Date.now() },
      ],
    },
  });
  check("A puede guardar su posición", putPos.status === 200, `status ${putPos.status}`);

  const posA = await api("/api/positions", { cookie: cookieA, baseUrl });
  const posSmoke = posA.data?.positions?.find((p) => p.bookHash === "smoke");
  check(
    "La posición guardada se recupera",
    posA.status === 200 && posSmoke?.sectionIndex === 2 && posSmoke?.progress === 0.4,
    posSmoke ? `sección ${posSmoke.sectionIndex}, avance ${posSmoke.progress}` : "sin posición",
  );

  const posB = await api("/api/positions", { cookie: cookieB, baseUrl });
  check(
    "B no ve la posición de A",
    posB.status === 200 && !posB.data?.positions?.some((p) => p.bookHash === "smoke"),
  );

  // --- repasos del cuaderno ---
  const REVIEW_ID = `smoke-${ts}`;
  const putRev = await api("/api/reviews", {
    method: "PUT", cookie: cookieA, baseUrl,
    body: {
      reviews: [
        { id: REVIEW_ID, language: "es", form: "perenne", kind: "meaning", rating: "good", hints: 0, createdAt: Date.now() },
      ],
    },
  });
  check("A puede guardar un repaso", putRev.status === 200, `status ${putRev.status}`);

  const revA = await api("/api/reviews", { cookie: cookieA, baseUrl });
  check(
    "El repaso guardado se recupera",
    revA.status === 200 && revA.data?.reviews?.some((r) => r.id === REVIEW_ID),
  );

  const revB = await api("/api/reviews", { cookie: cookieB, baseUrl });
  check(
    "B no ve el repaso de A",
    revB.status === 200 && !revB.data?.reviews?.some((r) => r.id === REVIEW_ID),
  );

  // --- modelo de conocimiento ---
  const putKnow = await api("/api/knowledge", {
    method: "PUT", cookie: cookieA, baseUrl,
    body: {
      rows: [
        { language: "es", lemma: "perenne", known: true, source: "calibration", updatedAt: 1_000 },
      ],
    },
  });
  check("A puede guardar conocimiento", putKnow.status === 200, `status ${putKnow.status}`);

  const knowA = await api("/api/knowledge?language=es", { cookie: cookieA, baseUrl });
  const rowA = knowA.data?.rows?.find((r) => r.lemma === "perenne");
  check(
    "La fila de conocimiento se recupera",
    knowA.status === 200 && rowA?.known === true && rowA?.source === "calibration",
  );

  const knowB = await api("/api/knowledge", { cookie: cookieB, baseUrl });
  check(
    "B no ve el conocimiento de A",
    knowB.status === 200 && !knowB.data?.rows?.some((r) => r.lemma === "perenne"),
  );

  // Un sello más viejo no pisa la fila: updated_at arbitra como en vocab.
  await api("/api/knowledge", {
    method: "PUT", cookie: cookieA, baseUrl,
    body: {
      rows: [
        { language: "es", lemma: "perenne", known: false, source: "inferred", updatedAt: 500 },
      ],
    },
  });
  const knowAAfter = await api("/api/knowledge?language=es", { cookie: cookieA, baseUrl });
  const rowAAfter = knowAAfter.data?.rows?.find((r) => r.lemma === "perenne");
  check(
    "El upsert con updatedAt menor no pisa la fila",
    rowAAfter?.known === true && rowAAfter?.source === "calibration",
    `known=${rowAAfter?.known} source=${rowAAfter?.source}`,
  );

  // --- muestra del catálogo para la calibración (pública) ---
  const sample = await api("/api/lexicon/sample?language=es", { baseUrl });
  const sampleWords = Array.isArray(sample.data?.words) ? sample.data.words : [];
  check(
    "GET /api/lexicon/sample devuelve la muestra de calibración",
    sample.status === 200 &&
      sampleWords.length >= 1 &&
      sampleWords.length <= 36 &&
      new Set(sampleWords.map((w) => w?.lemma)).size === sampleWords.length &&
      sampleWords.every(
        (w) => typeof w?.lemma === "string" && w.lemma.trim() !== "",
      ),
    `status ${sample.status}, ${sampleWords.length} palabras`,
  );
  const sampleLang = await api("/api/lexicon/sample?language=en", { baseUrl });
  check(
    "GET /api/lexicon/sample rechaza idioma sin muestra",
    sampleLang.status === 400,
    `status ${sampleLang.status}`,
  );

  // --- vinculación Kindle instantánea por código de 4 letras ---
  await verifyKindleLinkSmokeTest(baseUrl, cookieA);

  // --- sin sesión ---
  for (const [name, path, method] of [
    ["GET /api/books", "/api/books", "GET"],
    ["PUT /api/books/:hash", `/api/books/${HASH_A}`, "PUT"],
    ["GET /api/vocab", "/api/vocab?lang=es", "GET"],
    ["PUT /api/vocab", "/api/vocab", "PUT"],
    ["GET /api/positions", "/api/positions", "GET"],
    ["PUT /api/positions", "/api/positions", "PUT"],
    ["GET /api/reviews", "/api/reviews", "GET"],
    ["PUT /api/reviews", "/api/reviews", "PUT"],
    ["GET /api/knowledge", "/api/knowledge", "GET"],
    ["PUT /api/knowledge", "/api/knowledge", "PUT"],
    ["POST /api/lexicon/enrich", "/api/lexicon/enrich", "POST"],
    ["POST /api/lexicon/enrich-batch", "/api/lexicon/enrich-batch", "POST"],
  ]) {
    const res = await api(path, {
      method,
      baseUrl,
      body: method === "GET" ? undefined : { form: "palabrarandom", language: "es", forms: ["palabrarandom"] },
    });
    check(`${name} sin sesión → 401`, res.status === 401, `status ${res.status}`);
  }

  // stopword no necesita sesión para el rechazo temprano… debe dar 401 primero
  const stop = await api("/api/lexicon/enrich", {
    method: "POST", body: { form: "pero", language: "es" }, baseUrl,
  });
  check("stopword sin sesión → 401 primero", stop.status === 401, `status ${stop.status}`);

  console.log(failures ? `\n${failures} prueba(s) fallaron.` : "\nTodas las pruebas pasaron.");
  if (failures) process.exitCode = 1;
  return failures === 0;
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  runSmokeTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
