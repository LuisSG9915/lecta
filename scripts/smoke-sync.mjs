// Prueba de humo del contrato de sincronización: crea una cuenta temporal,
// escribe posiciones, anotaciones y conocimiento por la API y comprueba que
// el pull incremental viaja con `syncedAt` del servidor.
//   node scripts/smoke-sync.mjs                      (dev en 127.0.0.1:5174)
//   SMOKE_URL=https://lecta.luis-sg9915.workers.dev node scripts/smoke-sync.mjs
// Igual que `smoke:auth`, **escribe** en el servidor al que apunte: la cuenta
// queda creada con los datos de prueba.
const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5174";
let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  return { status: response.status, data, setCookie: response.headers.getSetCookie?.() ?? [] };
}

const email = `sync-smoke-${Date.now()}@example.com`;
const signUp = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: { email, password: "lecta-smoke-2026", name: "Sync Smoke" },
});
check("registro", signUp.status === 200, `status ${signUp.status}`);
const cookie = signUp.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
check("cookie de sesión", Boolean(cookie));

const health = await api("/api/health");
check("health 200 + db conectada", health.status === 200 && health.data?.db === "connected", JSON.stringify(health.data));

const sinSesion = await api("/api/positions");
check("positions sin sesión → 401", sinSesion.status === 401, `status ${sinSesion.status}`);

const bookHash = "__e2e_synced_at__";
const updatedAt = Date.now();
const put = await api("/api/positions", {
  method: "PUT",
  cookie,
  body: {
    positions: [{ bookHash, sectionIndex: 3, scrollTop: 640, ratio: 0.4, progress: 12, anchor: "p-12", updatedAt }],
  },
});
check("PUT positions", put.status === 200 && put.data?.upserted === 1, JSON.stringify(put.data));
check("PUT devuelve serverTime", typeof put.data?.serverTime === "number");

const serverTime = put.data?.serverTime ?? 0;
const pull = await api("/api/positions?since=0", { cookie });
const row = pull.data?.positions?.find((p) => p.bookHash === bookHash);
check("GET since=0 devuelve la posición", Boolean(row), JSON.stringify(pull.data?.positions));
check("syncedAt del servidor en la fila", row && Number.isFinite(row.syncedAt) && row.syncedAt >= serverTime);
check("nextCursor entregado", typeof pull.data?.nextCursor === "number", String(pull.data?.nextCursor));

const skip = await api(`/api/positions?since=${serverTime + 1}`, { cookie });
check("cursor posterior no repite la fila", !((skip.data?.positions ?? []).some((p) => p.bookHash === bookHash)));

// Cursor por sello: una fila nueva de un cliente con el reloj un día
// atrasado entra con updated_at viejo pero synced_at del servidor, así que
// el pull incremental por synced_at la ve (antes se perdía para siempre).
const skewHash = "__e2e_skew__";
const skewed = await api("/api/positions", {
  method: "PUT",
  cookie,
  body: { positions: [{ bookHash: skewHash, sectionIndex: 5, scrollTop: 1024, ratio: 0.5, progress: 20, anchor: "p-20", updatedAt: updatedAt - 86_400_000 }] },
});
check("PUT con updatedAt atrasado aceptado", skewed.status === 200 && skewed.data?.upserted === 1, JSON.stringify(skewed.data));
const pullAgain = await api(`/api/positions?since=${serverTime}`, { cookie });
const row2 = pullAgain.data?.positions?.find((p) => p.bookHash === skewHash);
check("la fila reaparece por synced_at nuevo", Boolean(row2) && row2.sectionIndex === 5, JSON.stringify(row2));
check("su updatedAt sigue siendo el viejo", row2 && row2.updatedAt < serverTime, String(row2?.updatedAt));

const annPut = await api("/api/annotations", {
  method: "PUT",
  cookie,
  body: { annotations: [{ bookHash, id: "a1", kind: "passage", sectionIndex: 1, anchor: "x", text: "hola", prefix: "", suffix: "", note: "", createdAt: updatedAt, updatedAt }] },
});
check("PUT annotations", annPut.status === 200 && annPut.data?.upserted === 1, JSON.stringify(annPut.data));
const annPull = await api("/api/annotations?since=0", { cookie });
const ann = annPull.data?.annotations?.find((a) => a.id === "a1");
check("GET annotations con syncedAt", Boolean(ann) && Number.isFinite(ann.syncedAt), JSON.stringify(ann));

const knowPut = await api("/api/knowledge", {
  method: "PUT",
  cookie,
  body: { rows: [{ language: "es", lemma: "prueba", known: true, source: "declared", updatedAt }] },
});
check("PUT knowledge", knowPut.status === 200 && knowPut.data?.upserted >= 1, JSON.stringify(knowPut.data));
const knowPull = await api("/api/knowledge?since=0&includeLanguages=1", { cookie });
check("GET knowledge con syncedAt", (knowPull.data?.rows ?? []).some((k) => k.lemma === "prueba" && Number.isFinite(k.syncedAt)), JSON.stringify(knowPull.data?.rows));

console.log(`cuenta creada en ${BASE}: ${email}`);
console.log(failures === 0 ? "E2E OK" : `E2E CON ${failures} FALLOS`);
process.exitCode = failures === 0 ? 0 : 1;
