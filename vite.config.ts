import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

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
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), swManifest()],
});
