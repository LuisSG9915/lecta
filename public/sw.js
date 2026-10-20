// Service worker de Lecta: shell + assets + libros y locuciones
// incluidos, para que la app instalada abra y lea sin conexión.
//
// Reglas:
// - Solo GET del mismo origen. /api/, /kindle/ y /sw.js jamás se cachean
//   (sesiones, vistas e-ink dinámicas y el propio SW no pasan por el almacén).
// - Navegaciones: red primero con { cache: 'no-store' } y timeout de 3500ms;
//   copia fresca a «/index.html» y «/» y, solo si falla la red, la versión guardada.
// - Contenido precacheado: cache-first (rellena el cache si falta).
// - Validación estricta MIME: jamás cachear ni entregar text/html para .css, .js o /assets/*.
// - Autocuración de assets: reintento y notificación ASSET_MISMATCH_RELOAD ante hashes obsoletos.

// Versión y marca de compilación para invalidación de caché PWA en navegadores y móviles
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var SW_VERSION = "2.2.0-20261018";
var CACHE_PREFIX = "lecta-v2-";
var MANIFEST_URL = "/sw-manifest.json";
var NAVIGATION_TIMEOUT_MS = 3500;
const KITTEN_TTS_CACHE = 'lecta-kitten-tts-v1';

// Lista blanca de cachés persistentes que NUNCA deben borrarse al actualizar la app
const PERSISTENT_DLC_CACHES = new Set([
  KITTEN_TTS_CACHE,
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

// 1. Install: activar inmediatamente sin bloquearse en waiting
self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    fetch(MANIFEST_URL, { cache: "no-store" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        var version = (manifest && manifest.version) || "0";
        var seen = {};
        var urls = ["/", "/index.html", "/manifest.webmanifest", MANIFEST_URL]
          .concat((manifest && manifest.assets) || [])
          .filter(function (url) {
            if (seen[url]) return false;
            seen[url] = true;
            return true;
          });
        cachedName = CACHE_PREFIX + version;
        return caches.open(cachedName).then(function (cache) {
          return cache.addAll(urls);
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
        return fetch(MANIFEST_URL, { cache: "no-store" })
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .catch(function () {
            return null;
          });
      })
      .then(function (manifest) {
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

  // 5. Excluir explícitamente de la caché del Service Worker las rutas /api/*, /kindle/* y /sw.js
  if (
    url.pathname.indexOf("/api/") === 0 ||
    url.pathname.indexOf("/kindle/") === 0 ||
    url.pathname.indexOf("/k/") === 0 ||
    url.pathname === "/k" ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  // Ruta rápida y blindada para modelos .onnx de Kitten TTS:
  // - Si ya fue descargado en 'lecta-kitten-tts-v1', servirlo al instante (incluso 100% offline).
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

  // Navegación: Network-First real sin caché HTTP con timeout de seguridad de 3500ms
  var isNavigation =
    req.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html";

  if (isNavigation) {
    event.respondWith(
      new Promise(function (resolve) {
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = null;

        function fallbackToCache() {
          return caches.match("/index.html").then(function (cached) {
            if (cached) return cached;
            return caches.match("/").then(function (cachedRoot) {
              return cachedRoot || Response.error();
            });
          });
        }

        if (controller) {
          timer = setTimeout(function () {
            controller.abort();
          }, NAVIGATION_TIMEOUT_MS);
        }

        var fetchOptions = { cache: "no-store" };
        if (controller) {
          fetchOptions.signal = controller.signal;
        }

        var networkRequest = new Request(req.url, fetchOptions);

        fetch(networkRequest)
          .then(function (res) {
            if (timer) clearTimeout(timer);
            if (res && res.ok) {
              var resClone1 = res.clone();
              var resClone2 = res.clone();
              lectaCache().then(function (name) {
                caches.open(name).then(function (cache) {
                  cache.put("/index.html", resClone1);
                  cache.put("/", resClone2);
                });
              });
              resolve(res);
              return;
            }
            if (res) {
              resolve(res);
            } else {
              fallbackToCache().then(resolve);
            }
          })
          .catch(function () {
            if (timer) clearTimeout(timer);
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
