// Service worker de Lecta: shell + assets + libros y locuciones
// incluidos, para que la app instalada abra y lea sin conexión.
//
// Reglas:
// - Solo GET del mismo origen. /api/, /kindle/, /sw.js, /sw-manifest.json y
//   /manifest.webmanifest jamás se cachean (sesiones, vistas e-ink, el propio
//   SW y los manifiestos de versión no pasan por el almacén: si el manifiesto
//   quedara en caché, el SW viejo se lo serviría viejo al SW nuevo durante
//   el install y la versión del precaché quedaría un deploy atrás siempre).
// - Navegaciones: red primero con { cache: 'no-store' }; si la red tarda más
//   de 3500ms se sirve la copia guardada SIN abortar el fetch — cuando la
//   copia fresca llega, se guarda y se avisa LECTA_NAV_STALE para recargar.
// - El install precachea el shell pidiendo /__lecta_shell__ (ruta que el SW
//   viejo no trata como navegación) y guardándolo bajo "/" e "/index.html":
//   pedir esas rutas directas le daría al SW viejo la opción de servir el
//   HTML del deploy anterior si la red tardara más de 3500ms.
// - Contenido precacheado: cache-first (rellena el cache si falta).
// - Validación estricta MIME: jamás cachear ni entregar text/html para .css, .js o /assets/*.
// - Autocuración de assets: reintento y notificación ASSET_MISMATCH_RELOAD ante hashes obsoletos.

// Versión y marca de compilación para invalidación de caché PWA en navegadores y móviles.
// En producción se sincroniza automáticamente durante el build desde sw-manifest.json.
var SW_VERSION = "auto";
var CACHE_PREFIX = "lecta-v2-";
var MANIFEST_URL = "/sw-manifest.json";
var NAVIGATION_TIMEOUT_MS = 3500;
const KITTEN_TTS_CACHE = 'lecta-kitten-tts-v2';

// Lista blanca de cachés persistentes que NUNCA deben borrarse al actualizar la app
const PERSISTENT_DLC_CACHES = new Set([
  KITTEN_TTS_CACHE,
  // Modelo Piper (voz natural en español, ~63 MB; PIPER_CACHE_NAME en piperModel.ts).
  // Sin esta entrada el activate lo borraba en cada deploy (empieza por «lecta-») y
  // la voz neural caía en silencio a la del sistema hasta volver a descargarlo.
  'lecta-tts-models-v1',
  'lecta-offline-dict-v1',
]);

// Helper para detectar si una petición corresponde al modelo ONNX o datos DLC de Kitten TTS
function isKittenModelRequest(url) {
  return (
    url.pathname.endsWith(".onnx") ||
    url.pathname.indexOf("/models/") !== -1
  );
}

// El único cache lecta-v2-* vigente (tras activate solo queda uno).
// Se memoiza pero se re-resuelve si el global del worker se reinicia.
var cachedName = null;
function lectaCache() {
  if (cachedName) return Promise.resolve(cachedName);
  return caches.keys().then(function (keys) {
    var found = keys.find(function (key) {
      return key.indexOf(CACHE_PREFIX) === 0;
    });
    cachedName = found || CACHE_PREFIX + "shell";
    return caches.open(cachedName).then(function () {
      return cachedName;
    });
  });
}

// Validación estricta anti-corrupción por SPA fallback
function isValidAssetResponse(requestUrl, response) {
  if (!response || response.status !== 200) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  var contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (requestUrl.pathname.endsWith(".css") && contentType.indexOf("text/css") === -1) {
    return false;
  }
  if (requestUrl.pathname.endsWith(".js") && contentType.indexOf("text/html") !== -1) {
    return false;
  }
  if (requestUrl.pathname.startsWith("/assets/") && contentType.indexOf("text/html") !== -1) {
    return false;
  }
  if (requestUrl.pathname.endsWith(".wasm") && contentType.indexOf("text/html") !== -1) {
    return false;
  }
  if (requestUrl.pathname.endsWith(".onnx") && contentType.indexOf("text/html") !== -1) {
    return false;
  }
  return true;
}

// "?v=" rompe el match cache-first del SW viejo que aún controla el scope:
// los fetch de install/activate los intercepta él, y sin el parámetro le
// serviría el manifiesto del deploy anterior (con él, la URL no coincide
// con la entrada cacheada y cae a la red).
function manifestRequest() {
  return new Request(
    self.location.origin + MANIFEST_URL + "?v=" + Date.now(),
    { cache: "no-store" },
  );
}

// El shell (index.html) se pide por una ruta que NO es navegación para el
// SW viejo: para "/" e "/index.html" su manejador sirve la copia cacheada
// del deploy anterior cuando la red tarda más de NAVIGATION_TIMEOUT_MS, y
// el precaché quedaba envenenado con el HTML viejo de forma permanente
// (la app se quedaba pegada a la versión anterior hasta borrar caché).
// Una ruta desconocida cae siempre a la red, donde el fallback SPA del
// servidor devuelve el index.html del deploy vigente.
var SHELL_URL = "/__lecta_shell__";
function shellRequest() {
  return new Request(self.location.origin + SHELL_URL + "?v=" + Date.now(), {
    cache: "no-store",
  });
}

// 1. Install: activar inmediatamente sin bloquearse en waiting
self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    fetch(manifestRequest())
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        if (manifest && manifest.version) {
          SW_VERSION = manifest.version;
        }
        var version = (manifest && manifest.version) || SW_VERSION || "0";
        var seen = {};
        var urls = ((manifest && manifest.assets) || [])
          .filter(function (url) {
            if (seen[url]) return false;
            seen[url] = true;
            // Rutas excluidas del fetch handler: cachearlas es peso muerto
            // (jamás se leen del almacén) y el manifiesto además se leería
            // a sí mismo viejo en el próximo install. El shell se guarda
            // aparte vía shellRequest() por la misma razón.
            return (
              url !== "/" &&
              url !== "/index.html" &&
              url !== MANIFEST_URL &&
              url !== "/manifest.webmanifest" &&
              url !== "/sw.js"
            );
          });
        cachedName = CACHE_PREFIX + version;
        return caches.open(cachedName).then(function (cache) {
          // cache.addAll aborta TODO el install si una sola URL falla (un
          // 404, un corte de red) y el SW nuevo se descarta: la app se
          // queda con el SW viejo. Un archivo que falte aquí se rellena
          // solo al pedirlo (refillable), así que se tolera por archivo.
          var tasks = urls.map(function (url) {
            return cache.add(url).catch(function () {
              return undefined;
            });
          });
          // El shell llega por una ruta no-navegación (ver shellRequest):
          // así el SW viejo no puede servir su copia vieja por red lenta.
          // Se guarda bajo las dos claves canónicas que leen las
          // navegaciones. Si la petición falla, la primera navegación la
          // rellena desde la red (siempre network-first).
          tasks.push(
            fetch(shellRequest())
              .then(function (res) {
                if (!res || !res.ok) return undefined;
                var ct = (res.headers.get("content-type") || "").toLowerCase();
                if (ct.indexOf("text/html") === -1) return undefined;
                return Promise.all([
                  cache.put("/index.html", res.clone()),
                  cache.put("/", res),
                ]);
              })
              .catch(function () {
                return undefined;
              }),
          );
          return Promise.all(tasks);
        });
      })
      .catch(function () {
        // En offline durante install o fallo transitorio, no bloquear
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// 2. Message: soporte para SKIP_WAITING manual desde el cliente
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// 3. Activate: clients.claim() y purga de caches obsoletos (incluyendo versiones previas de lecta-*)
self.addEventListener("activate", function (event) {
  event.waitUntil(
    self.clients
      .claim()
      .then(function () {
        return fetch(manifestRequest())
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .catch(function () {
            return null;
          });
      })
      .then(function (manifest) {
        if (manifest && manifest.version) {
          SW_VERSION = manifest.version;
        }
        var keep = manifest && manifest.version ? CACHE_PREFIX + manifest.version : cachedName;
        return caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              if (
                !PERSISTENT_DLC_CACHES.has(key) &&
                (key.indexOf("lecta-") === 0 || key.indexOf(CACHE_PREFIX) === 0) &&
                (!keep || key !== keep)
              ) {
                return caches.delete(key);
              }
              return undefined;
            })
          );
        });
      })
  );
});

// Rutas de contenido estable que vale rellenar en el cache cuando
// lleguen de la red (assets hasheados son inmutables; el resto es
// contenido incluido con la app).
function refillable(path) {
  return (
    path.indexOf("/assets/") === 0 ||
    path.indexOf("/libros/") === 0 ||
    // /dict/ (diccionarios descargables) queda fuera a propósito: el
    // cliente los parsea y guarda en IndexedDB — cachearlos también en
    // el SW duplicaría varios MB por idioma.
    path.indexOf("/lexicon/") === 0 ||
    path.indexOf("/icons/") === 0 ||
    path.indexOf("/audio/") === 0
  );
}

// 4. Fetch: Network-First con cache: 'no-store' para navegación y exclusión de rutas críticas
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 5. Excluir explícitamente de la caché del Service Worker las rutas /api/*,
  // /kindle/*, /sw.js y los manifiestos de versión. El manifiesto del SW debe
  // llegar siempre de la red: si se cacheara, el SW viejo se lo serviría
  // atrasado al SW nuevo en install/activate y la rotación de versiones se
  // rompería.
  if (
    url.pathname.indexOf("/api/") === 0 ||
    url.pathname.indexOf("/kindle/") === 0 ||
    url.pathname.indexOf("/k/") === 0 ||
    url.pathname === "/k" ||
    // Landing de marketing: página estática aparte, siempre de la red.
    url.pathname === "/inicio" ||
    url.pathname.indexOf("/inicio/") === 0 ||
    url.pathname === "/sw.js" ||
    url.pathname === "/sw-manifest.json" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    return;
  }

  // Ruta rápida y blindada para modelos .onnx de Kitten TTS:
  // - Si ya fue descargado en 'lecta-kitten-tts-v2', servirlo al instante (incluso 100% offline).
  // - Soporta cabeceras Range devolviendo 206 Partial Content sintetizado sobre el archivo íntegro.
  // - NUNCA devuelve respuestas cacheadas incompletas (HTTP 206 truncadas) ni fallbacks SPA (text/html).
  // - Si aún no está descargado, pasa directo a la red como stream nativo sin buffering en el Service Worker.
  if (isKittenModelRequest(url)) {
    event.respondWith(
      (async function () {
        try {
          const dlcCache = await caches.open(KITTEN_TTS_CACHE);
          const cachedModel =
            (await dlcCache.match(req)) ||
            (await dlcCache.match(url.pathname)) ||
            (await dlcCache.match(req, { ignoreSearch: true }));

          if (cachedModel && cachedModel.status === 200) {
            const contentType = (cachedModel.headers.get("content-type") || "").toLowerCase();
            if (contentType.indexOf("text/html") === -1) {
              const rangeHeader = req.headers.get("Range");
              if (rangeHeader) {
                // Sintetizar respuesta HTTP 206 Partial Content a partir del buffer cacheado completo
                const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                if (matches) {
                  const fullBuffer = await cachedModel.arrayBuffer();
                  const total = fullBuffer.byteLength;
                  const start = parseInt(matches[1], 10);
                  const end = matches[2] ? parseInt(matches[2], 10) : total - 1;
                  if (start < total && end < total && start <= end) {
                    const slice = fullBuffer.slice(start, end + 1);
                    return new Response(slice, {
                      status: 206,
                      statusText: "Partial Content",
                      headers: {
                        "Content-Type": "application/octet-stream",
                        "Content-Range": `bytes ${start}-${end}/${total}`,
                        "Content-Length": String(slice.byteLength),
                        "Accept-Ranges": "bytes",
                      },
                    });
                  }
                }
              }
              return cachedModel;
            } else {
              // Si el caché almacenó un fallback HTML corrupto, purgarlo
              await dlcCache.delete(req);
            }
          } else if (cachedModel && cachedModel.status === 206) {
            // Respuestas 206 cacheadas incompletas: purgar inmediatamente para que no rompan ONNX
            await dlcCache.delete(req);
          }
        } catch {
          // Ignorar fallo de caché y caer directo a red
        }

        // Descarga directa en streaming desde la red
        return fetch(req);
      })()
    );
    return;
  }

  // Navegación: Network-First real sin caché HTTP. Si la red tarda más de
  // NAVIGATION_TIMEOUT_MS se sirve la copia guardada para no dejar la página
  // en espera — pero el fetch sigue vivo: cuando la copia fresca llega se
  // guarda y se avisa LECTA_NAV_STALE. Antes se abortaba a los 3500ms y el
  // usuario se quedaba con la versión vieja sin saberlo en redes lentas.
  var isNavigation =
    req.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html";

  if (isNavigation) {
    event.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        var servedCached = false;

        function fallbackToCache() {
          return caches.match("/index.html").then(function (cached) {
            if (cached) return cached;
            return caches.match("/").then(function (cachedRoot) {
              return cachedRoot || Response.error();
            });
          });
        }

        var timer = setTimeout(function () {
          if (settled) return;
          fallbackToCache().then(function (cached) {
            if (settled || !cached || (cached.type === "error")) return;
            settled = true;
            servedCached = true;
            resolve(cached);
          });
        }, NAVIGATION_TIMEOUT_MS);

        // redirect "manual": el 301 del host viejo (workers.dev → lectal.app)
        // llega como `opaqueredirect` y se entrega tal cual para que el
        // navegador lo siga. Con "follow" el fetch a otro origen fallaba y
        // se servía la copia vieja del caché para siempre. No es `ok`, así
        // que nunca se guarda en caché.
        var networkRequest = new Request(req.url, { cache: "no-store", redirect: "manual" });

        fetch(networkRequest)
          .then(function (res) {
            if (res && res.ok) {
              var resClone1 = res.clone();
              var resClone2 = res.clone();
              lectaCache().then(function (name) {
                caches.open(name).then(function (cache) {
                  cache.put("/index.html", resClone1);
                  cache.put("/", resClone2);
                });
              });
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(res);
              } else if (servedCached) {
                // Se sirvió la copia vieja por red lenta y ya llegó la
                // fresca: avisar para que el cliente recargue si acaba de
                // abrir. La copia nueva ya quedó en caché.
                self.clients
                  .matchAll({ type: "window", includeUncontrolled: true })
                  .then(function (clients) {
                    clients.forEach(function (client) {
                      client.postMessage({ type: "LECTA_NAV_STALE" });
                    });
                  });
              }
              return;
            }
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              if (res) {
                resolve(res);
              } else {
                fallbackToCache().then(resolve);
              }
            }
          })
          .catch(function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fallbackToCache().then(resolve);
          });
      })
    );
    return;
  }

  // Resto de recursos estáticos: Cache-First con validación estricta y reintento
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached && isValidAssetResponse(url, cached)) {
        return cached;
      }
      if (cached) {
        lectaCache().then(function (name) {
          caches.open(name).then(function (cache) {
            cache.delete(req);
          });
        });
      }

      function handleAssetMismatch() {
        if (url.pathname.startsWith("/assets/")) {
          lectaCache().then(function (name) {
            caches.delete(name);
          });
          self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
            clients.forEach(function (client) {
              client.postMessage({ type: "ASSET_MISMATCH_RELOAD" });
            });
          });
        }
        return new Response("", { status: 404, statusText: "Asset Mismatch" });
      }

      return fetch(req)
        .then(function (res) {
          if (isValidAssetResponse(url, res)) {
            if (refillable(url.pathname)) {
              var copy = res.clone();
              lectaCache().then(function (name) {
                caches.open(name).then(function (cache) {
                  cache.put(req, copy);
                });
              });
            }
            return res;
          }

          // Si el servidor devolvió HTML (not_found_handling SPA) o no es válido,
          // reintentar una vez con cache: 'reload'
          return fetch(req, { cache: "reload" })
            .then(function (retryRes) {
              if (isValidAssetResponse(url, retryRes)) {
                if (refillable(url.pathname)) {
                  var retryCopy = retryRes.clone();
                  lectaCache().then(function (name) {
                    caches.open(name).then(function (cache) {
                      cache.put(req, retryCopy);
                    });
                  });
                }
                return retryRes;
              }
              return handleAssetMismatch();
            })
            .catch(function () {
              return handleAssetMismatch();
            });
        })
        .catch(function () {
          // Reintento ante corte transitorio de red
          return fetch(req, { cache: "reload" })
            .then(function (retryRes) {
              if (isValidAssetResponse(url, retryRes)) {
                return retryRes;
              }
              return handleAssetMismatch();
            })
            .catch(function () {
              return handleAssetMismatch();
            });
        });
    })
  );
});


self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "POST_HABIT_NOTIFICATION" && event.data.payload) {
    var p = event.data.payload;
    if (self.registration && typeof self.registration.showNotification === "function") {
      self.registration.showNotification(p.title, {
        body: p.subtitle ? p.subtitle + "\n" + p.body : p.body,
        tag: p.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        data: { bookHash: p.bookHash },
      });
    }
  }
});

// Scheduler de Notificaciones Locales Respetuosas y Ventana de Hábito (Fase 4 Anti-Abandono)
self.addEventListener("periodicsync", function (event) {
  if (event.tag === "lecta-habit-reminder") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then(function (clientList) {
        if (clientList.length > 0) {
          clientList[0].postMessage({ type: "CHECK_HABIT_NOTIFICATION" });
        }
      })
    );
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  if ("clearAppBadge" in self.navigator && typeof self.navigator.clearAppBadge === "function") {
    self.navigator.clearAppBadge().catch(function () {});
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
    })
  );
});
