// Prueba de humo de autorización: corre contra el dev server en marcha
// (pnpm dev). Crea dos cuentas temporales y verifica que ni libros ni
// vocabulario crucen entre usuarios, además de los 401 sin sesión.
//   node scripts/smoke-auth.mjs  (o SMOKE_URL=http://127.0.0.1:5174 node …)
const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5174";
const ts = Date.now();
const USER_A = { email: `a-${ts}@smoke.test`, password: "prueba-smoke-1234", name: "A" };
const USER_B = { email: `b-${ts}@smoke.test`, password: "prueba-smoke-1234", name: "B" };

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
};

async function api(path, { method = "GET", body, cookie, json } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? (json === false ? body : JSON.stringify(body)) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { /* cuerpo binario */ }
  return { status: response.status, data, setCookie: response.headers.getSetCookie() };
}

async function signUp(user) {
  const res = await api("/api/auth/sign-up/email", { method: "POST", body: user });
  if (res.status !== 200) throw new Error(`Registro falló para ${user.email}: ${res.status}`);
  const cookie = res.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
  if (!cookie) throw new Error(`Sin cookie de sesión para ${user.email}`);
  return cookie;
}

// --- alta de cuentas ---
const cookieA = await signUp(USER_A);
const cookieB = await signUp(USER_B);
console.log("Cuentas A y B creadas.");

// --- libros ---
const fakeEpub = Buffer.from("PK\x03\x04" + "x".repeat(100));
const HASH_A = "a".repeat(64);

const upA = await api(`/api/books/${HASH_A}?name=libro-a.epub`, {
  method: "PUT", body: fakeEpub, cookie: cookieA, json: false,
});
check("A puede subir su libro", upA.status === 200, `status ${upA.status}`);

const listB = await api("/api/books", { cookie: cookieB });
check("B no ve libros de A", listB.status === 200 && listB.data?.books?.length === 0);

const getB = await api(`/api/books/${HASH_A}`, { cookie: cookieB });
check("B no puede descargar el libro de A", getB.status === 404, `status ${getB.status}`);

const delB = await api(`/api/books/${HASH_A}`, { method: "DELETE", cookie: cookieB });
const getAAfter = await api(`/api/books/${HASH_A}`, { cookie: cookieA });
check(
  "DELETE de B no borra el libro de A",
  delB.status === 200 && getAAfter.status === 200,
  `B:${delB.status} A:${getAAfter.status}`,
);

// --- vocabulario ---
const putA = await api("/api/vocab", {
  method: "PUT", cookie: cookieA,
  body: { words: [{ form: "perenne", language: "es", meaning: "de A", savedAt: 1, updatedAt: 100 }] },
});
check("A puede guardar palabra", putA.status === 200);

const vocabB = await api("/api/vocab?lang=es", { cookie: cookieB });
check("B no ve el vocabulario de A", vocabB.status === 200 && vocabB.data?.words?.length === 0);

await api("/api/vocab", {
  method: "PUT", cookie: cookieB,
  body: { words: [{ form: "perenne", language: "es", meaning: "de B", savedAt: 2, updatedAt: 200 }] },
});
const vocabAAfter = await api("/api/vocab?lang=es", { cookie: cookieA });
const wordA = vocabAAfter.data?.words?.find((w) => w.form === "perenne");
check(
  "La palabra de B no pisa la de A",
  wordA?.meaning === "de A",
  `significado de A: "${wordA?.meaning}"`,
);

// --- sin sesión ---
for (const [name, path, method] of [
  ["GET /api/books", "/api/books", "GET"],
  ["PUT /api/books/:hash", `/api/books/${HASH_A}`, "PUT"],
  ["GET /api/vocab", "/api/vocab?lang=es", "GET"],
  ["PUT /api/vocab", "/api/vocab", "PUT"],
  ["POST /api/lexicon/enrich", "/api/lexicon/enrich", "POST"],
  ["POST /api/lexicon/enrich-batch", "/api/lexicon/enrich-batch", "POST"],
]) {
  const res = await api(path, {
    method,
    body: method === "GET" ? undefined : { form: "palabrarandom", language: "es", forms: ["palabrarandom"] },
  });
  check(`${name} sin sesión → 401`, res.status === 401, `status ${res.status}`);
}

// stopword no necesita sesión para el rechazo temprano… debe dar 401 primero
const stop = await api("/api/lexicon/enrich", {
  method: "POST", body: { form: "pero", language: "es" },
});
check("stopword sin sesión → 401 primero", stop.status === 401, `status ${stop.status}`);

console.log(failures ? `\n${failures} prueba(s) fallaron.` : "\nTodas las pruebas pasaron.");
process.exit(failures ? 1 : 0);
