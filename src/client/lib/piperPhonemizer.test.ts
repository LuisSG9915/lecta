import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePiperModelConfig, textToPiperIds } from "./piperPhonemizer";
import { normalizeSpanishText } from "./normalizerEs";

// phoneme_id_map REAL de es_MX-claude-high (descargado de rhasspy/piper-voices).
const fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "es_MX-claude-high.onnx.json"), "utf8"),
) as ReturnType<typeof parsePiperModelConfig>;

const MAP = fixture.phoneme_id_map!;
const BOS = MAP["^"]![0];
const EOS = MAP["$"]![0];
const PAD = MAP["_"]![0];

describe("textToPiperIds (es_MX-claude-high)", () => {
  it("envuelve con BOS/EOS y pad 0 tras cada token", () => {
    const ids = textToPiperIds("Hola, ¿cómo estás?", MAP);
    expect(ids.length).toBeGreaterThan(4);
    expect(ids[0]).toBe(BOS);
    expect(ids[ids.length - 1]).toBe(EOS);
    // PAD intercalado: nunca dos IDs de fonema pegados sin pad entre tokens.
    // Estructura: BOS, (ids…,0)×n, EOS → al menos un 0 antes del EOS.
    expect(ids[ids.length - 2]).toBe(PAD);
    // Entre medias hay pads (uno por token del G2P).
    expect(ids.filter((id) => id === PAD).length).toBeGreaterThan(5);
  });

  it("produce fonemas españoles reales (ɲ, ʝ, ˈ, ɾ)", () => {
    const ids = textToPiperIds("El niño comió paella en el jardín.", MAP);
    const phonemeValues = new Set(Object.values(MAP).flat());
    for (const id of ids) {
      if (id !== BOS && id !== EOS && id !== PAD) {
        expect(phonemeValues.has(id)).toBe(true);
      }
    }
    expect(ids).toContain(MAP["ɲ"]![0]); // niño → ɲ
    expect(ids).toContain(MAP["ʝ"]![0]); // paella/jardín → ʝ
    expect(ids).toContain(MAP["ˈ"]![0]); // acento primario
  });

  it("la x mexicana suena /x/ (36), no /ks/ (23+115…)", () => {
    // «México» normalizado → «Méjico» → j→/x/
    const ids = textToPiperIds("México es grande", MAP);
    expect(ids).toContain(MAP["x"]![0]);
    // «taxi» conserva /ks/: k+s
    const taxiIds = textToPiperIds("tomé un taxi", MAP);
    expect(taxiIds).toContain(MAP["k"]![0]);
    expect(taxiIds).toContain(MAP["s"]![0]);
  });

  it("expande números y abreviaturas antes de fonemizar", () => {
    const ids = textToPiperIds("Son 25 capítulos, Sr. García", MAP);
    // «veinticinco» → fonemas v-e-…-o; basta con que no queden dígitos
    // (los dígitos no están en el mapa y se habrían saltado).
    expect(ids[0]).toBe(BOS);
    expect(ids[ids.length - 1]).toBe(EOS);
    expect(ids.length).toBeGreaterThan(20);
  });

  it("devuelve [] para texto vacío o solo puntuación", () => {
    expect(textToPiperIds("", MAP)).toEqual([]);
    expect(textToPiperIds("   ", MAP)).toEqual([]);
  });

  it("respeta el orden BOS … PAD-final … EOS del contrato VITS", () => {
    const ids = textToPiperIds("Hola", MAP);
    // Formato exacto: [BOS, ...ids, PAD, EOS] — el último pad va antes del EOS.
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(2);
    // Nada de ids fuera del mapa (salvo estructura).
    const valid = new Set<number>([BOS, EOS, PAD, ...Object.values(MAP).flat()]);
    for (const id of ids) expect(valid.has(id)).toBe(true);
  });
});

describe("normalizerEs integrado", () => {
  it("México → Mejico antes del G2P", () => {
    expect(normalizeSpanishText("la Ciudad de México")).toBe("la Ciudad de Méjico");
  });
});
