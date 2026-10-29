// Prueba de humo del contrato de sincronización:
// Utiliza una cuenta canónica (o temporal) y realiza operaciones idempotentes (UPSERTs),
// verificando que el pull incremental viaje con syncedAt del servidor.
// Limpia y reutiliza el registro canónico para evitar bloat en la base de datos.
//   node scripts/smoke-sync.mjs                      (dev en 127.0.0.1:5174)
//   SMOKE_URL=https://lecta.luis-sg9915.workers.dev node scripts/smoke-sync.mjs

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5174";
const CANONICAL_EMAIL = process.env.SMOKE_SYNC_EMAIL ?? "sync-smoke-canonical@example.com";
const PASSWORD = process.env.SMOKE_SYNC_PASSWORD ?? "lecta-smoke-2026";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

export async function waitForHealth(baseUrl = BASE, maxAttempts = 3, baseDelayMs = 15000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { origin: baseUrl } });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.db === "connected" || data?.ok || data?.status === "ok") {
          console.log(`PASS Healthcheck OK en intento ${attempt} (${baseUrl})`);
          return true;
        }
      }
      console.warn(`[health] Intento ${attempt}/${maxAttempts} no saludable (status: ${response.status}).`);
    } catch (err) {
      console.warn(`[health] Intento ${attempt}/${maxAttempts} error de conexión: ${err?.message || err}`);
    }
    if (attempt < maxAttempts) {
      const delay = Math.round(baseDelayMs * Math.pow(1.5, attempt - 1));
      console.log(`[health] Esperando ${Math.round(delay / 1000)}s antes de reintentar...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
}

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

// 1. Health check con backoff
const isHealthy = await waitForHealth(BASE);
check("health 200 + db conectada", isHealthy);
if (!isHealthy) {
  console.error("FAIL Servidor no disponible tras reintentos con backoff.");
  process.exit(1);
}

// 2. Autenticación con cuenta canónica (idempotente) o fallback a efímera
let cookie;
let emailUsed = CANONICAL_EMAIL;

// Intentar iniciar sesión primero (cuenta canónica persistente)
let authRes = await api("/api/auth/sign-in/email", {
  method: "POST",
  body: { email: CANONICAL_EMAIL, password: PASSWORD },
});

if (authRes.status === 200) {
  cookie = authRes.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
  check("inicio de sesión con cuenta canónica", Boolean(cookie));
} else {
  // Si no existe, intentar registrarla
  authRes = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: { email: CANONICAL_EMAIL, password: PASSWORD, name: "Sync Smoke Canonical" },
  });
  if (authRes.status === 200) {
    cookie = authRes.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
    check("registro de cuenta canónica", Boolean(cookie));
  } else {
    // Fallback a cuenta efímera si las credenciales de la canónica cambiaron
    emailUsed = `sync-smoke-${Date.now()}@example.com`;
    console.warn(`Advertencia: No se pudo usar cuenta canónica (status: ${authRes.status}). Usando efímera: ${emailUsed}`);
    const fallback = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: emailUsed, password: PASSWORD, name: "Sync Smoke Fallback" },
    });
    cookie = fallback.setCookie?.find((c) => c.includes("session_token"))?.split(";")[0];
    check("registro de cuenta efímera (fallback)", fallback.status === 200 && Boolean(cookie));
  }
}

if (!cookie) {
  console.error("FAIL No se pudo obtener sesión para pruebas de sync.");
  process.exit(1);
}

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

console.log(`Smoke sync completado para cuenta en ${BASE}: ${emailUsed}`);
console.log(failures === 0 ? "E2E OK" : `E2E CON ${failures} FALLOS`);
process.exitCode = failures === 0 ? 0 : 1;
