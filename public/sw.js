// Service worker de Lecta: shell + assets + libros y locuciones
// incluidos, para que la app instalada abra y lea sin conexión.
//
// Reglas:
// - Solo GET del mismo origen. /api/ jamás se cachea (sesiones,
//   datos de cuenta y correo no pasan por el almacén del SW).
// - Navegaciones: red primero, copia fresca a «/» y, si falla, la
//   versión guardada — la app sigue abriendo aunque no haya red.
// - Contenido precacheado: cache-first (rellena el cache si falta,
//   p. ej. tras actualizar el SW antes de recargar).
// - El resto de estáticos (rutas de las listas de abajo): cache
//   primero con relleno; nunca inventa respuestas.
//
// La lista exacta de archivos llega de /sw-manifest.json, que el
// build genera recorriendo el directorio de salida — este archivo
// no enumera assets hasheados porque cambian en cada deploy.

var CACHE_PREFIX = "lecta-";
var MANIFEST_URL = "/sw-manifest.json";

// El único cache lecta-* vigente (tras activate solo queda uno).
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

self.addEventListener("install", function (event) {
  event.waitUntil(
    fetch(MANIFEST_URL, { cache: "no-cache" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        var version = (manifest && manifest.version) || "0";
        // addAll rechaza con peticiones repetidas; el manifiesto ya
        // trae /index.html y /manifest.webmanifest.
        var seen = {};
        var urls = ["/", "/manifest.webmanifest", MANIFEST_URL]
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
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    // La versión que este SW instaló decide qué cache conservar; si
    // el manifiesto no responde (offline durante la activación) no
    // se borra nada — peor caso es un cache viejo extra.
    fetch(MANIFEST_URL, { cache: "no-cache" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        var keep = manifest ? CACHE_PREFIX + manifest.version : cachedName;
        return caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              if (key.indexOf(CACHE_PREFIX) === 0 && key !== keep)
                return caches.delete(key);
              return undefined;
            })
          );
        });
      })
      .catch(function () {
        return undefined;
      })
      .then(function () {
        return self.clients.claim();
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

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Sesión, datos de cuenta, correo y sincronización: siempre a la
  // red. El SW no debe fingir veredictos de auth ni datos frescos.
  if (url.pathname.indexOf("/api/") === 0) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res.ok) {
            return lectaCache().then(function (name) {
              return caches
                .open(name)
                .then(function (cache) {
                  return cache.put("/", res.clone());
                })
                .then(function () {
                  return res;
                });
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match("/").then(function (cached) {
            return cached || Response.error();
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res.ok && refillable(url.pathname)) {
          return lectaCache().then(function (name) {
            return caches
              .open(name)
              .then(function (cache) {
                return cache.put(req, res.clone());
              })
              .then(function () {
                return res;
              });
          });
        }
        return res;
      });
    })
  );
});
