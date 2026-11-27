// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = path.resolve(__dirname);
const SYSTEM_EMOJI_RX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\uFE0F/u;

function listTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listTsxFiles(fullPath, out);
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

describe("Regla de diseño editorial: cero emojis de sistema en componentes TSX", () => {
  it("ningún componente TSX contiene emojis Unicode ni dingbats decorativos", () => {
    const offenders: string[] = [];
    for (const file of listTsxFiles(COMPONENTS_DIR)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        const match = line.match(SYSTEM_EMOJI_RX);
        if (match) {
          const rel = path.relative(process.cwd(), file);
          offenders.push(`${rel}:${idx + 1} (${match[0]})`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
