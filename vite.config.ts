import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Garantiza que el binario WASM de ONNX Runtime esté disponible sin hash en /assets/
// tanto en desarrollo local (middleware de Vite) como en producción (copia en dist/client/assets).
function onnxWasmPlugin(): Plugin {
  const wasmSrc = join(
    process.cwd(),
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  );

  return {
    name: "lecta-onnx-wasm",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url === "/assets/ort-wasm-simd-threaded.wasm" ||
          req.url === "/ort-wasm-simd-threaded.wasm"
        ) {
          if (existsSync(wasmSrc)) {
            res.setHeader("Content-Type", "application/wasm");
            res.setHeader("Cache-Control", "no-cache");
            res.end(readFileSync(wasmSrc));
            return;
          }
        }
        next();
      });
    },
    writeBundle(options) {
      if (!existsSync(wasmSrc)) return;
      const targetDirs = [
        options.dir ? join(options.dir, "assets") : null,
        join(process.cwd(), "dist/client/assets"),
      ].filter((d): d is string => !!d);

      for (const dir of targetDirs) {
        if (existsSync(dir)) {
          const dest = join(dir, "ort-wasm-simd-threaded.wasm");
          copyFileSync(wasmSrc, dest);
        }
      }
    },
  };
}

// Excluye binarios WebGPU/JSEP y cualquier artefacto que exceda el límite
// de 25 MiB de Cloudflare Workers (por ejemplo ort-wasm-simd-threaded.jsep.wasm de 27 MiB).
function excludeOversizedOnnxAssets(): Plugin {
  const MAX_ASSET_SIZE_BYTES = 24 * 1024 * 1024; // 24 MiB

  return {
    name: "exclude-oversized-onnx-assets",
    generateBundle(_, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        const isJsepOrAsyncify =
          fileName.includes(".jsep.") || fileName.includes("asyncify.wasm");
        let isOversized = false;
        if (item.type === "asset") {
          const byteLength =
            typeof item.source === "string"
              ? Buffer.byteLength(item.source)
              : item.source.byteLength;
          if (byteLength > MAX_ASSET_SIZE_BYTES) {
            isOversized = true;
          }
        }
        if (isJsepOrAsyncify || isOversized) {
          delete bundle[fileName];
        }
      }
    },
    writeBundle(options) {
      const targetDirs = [
        options.dir ? join(options.dir, "assets") : null,
        join(process.cwd(), "dist/client/assets"),
      ].filter((d): d is string => !!d);

      for (const assetsDir of targetDirs) {
        if (!existsSync(assetsDir)) continue;
        try {
          const files = readdirSync(assetsDir, { withFileTypes: true });
          for (const file of files) {
            if (file.isFile()) {
              const fullPath = join(assetsDir, file.name);
              const shouldRemoveName =
                file.name.includes(".jsep.") || file.name.includes("asyncify.wasm");
              if (shouldRemoveName) {
                unlinkSync(fullPath);
                continue;
              }
              const stats = statSync(fullPath);
              if (stats.size > MAX_ASSET_SIZE_BYTES) {
                unlinkSync(fullPath);
              }
            }
          }
        } catch {
          // Ignorar si el directorio de assets no está disponible en este ciclo
        }
      }
    },
  };
}

// Emite dist/client/sw-manifest.json tras el build del cliente: la
// lista de archivos estáticos que el service worker precachea para
// abrir offline, versionada por su propio contenido (los nombres de
// los assets ya llevan hash). Sin dependencias: un pase sobre el
// directorio de salida.
function swManifest(): Plugin {
  return {
    name: "lecta-sw-manifest",
    applyToEnvironment: (environment) => environment.name === "client",
    closeBundle() {
      const outDir: string | undefined = this.environment?.config?.build?.outDir;
      if (!outDir) return;
      const assets: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith(".")) walk(full);
            continue;
          }
          // _headers/_redirects son reglas del host, no contenido.
          if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
          // Excluir binarios WASM y modelos ONNX pesados del precaché de instalación inicial.
          // Se descargan y cachean bajo demanda con consentimiento del usuario.
          if (entry.name.endsWith(".wasm") || entry.name.endsWith(".onnx")) continue;
          const path = `/${relative(outDir, full).split("\\").join("/")}`;
          if (path === "/sw-manifest.json") continue;
          assets.push(path);
        }
      };
      walk(outDir);
      assets.sort();
      const version = createHash("sha1")
        .update(assets.join("\n"))
        .digest("hex")
        .slice(0, 10);
      writeFileSync(
        join(outDir, "sw-manifest.json"),
        `${JSON.stringify({ version, assets })}\n`,
      );

      // Sincroniza SW_VERSION en sw.js generado con el hash de sw-manifest.json
      const swDist = join(outDir, "sw.js");
      if (existsSync(swDist)) {
        const swContent = readFileSync(swDist, "utf8");
        const updatedSw = swContent.replace(
          /var\s+SW_VERSION\s*=\s*["'][^"']*["'];?/,
          `var SW_VERSION = "${version}";`,
        );
        writeFileSync(swDist, updatedSw, "utf8");
      }
    },
  };
}

function stripDevVarsPlugin(): Plugin {
  return {
    name: "lecta-strip-dev-vars",
    closeBundle() {
      // Elimina cualquier archivo .dev.vars que haya sido copiado a dist/
      for (const candidate of [
        resolve(process.cwd(), "dist/.dev.vars"),
        resolve(process.cwd(), "dist/lecta/.dev.vars"),
        resolve(process.cwd(), "dist/client/.dev.vars"),
      ]) {
        if (existsSync(candidate)) {
          rmSync(candidate, { force: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    excludeOversizedOnnxAssets(),
    onnxWasmPlugin(),
    swManifest(),
    stripDevVarsPlugin(),
  ],
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !dep.includes("lexicon-banks"));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            id.includes("src/shared/calibration-bank") ||
            id.includes("src/shared/english-core-lexicon")
          ) {
            return "lexicon-banks";
          }
        },
      },
    },
  },
});
