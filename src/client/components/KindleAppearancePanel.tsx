import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { accountFetch } from "../lib/account-fetch";
import {
  DEFAULT_KINDLE_PREFS,
  KINDLE_PREF_LABELS,
  KINDLE_PRESETS,
  KINDLE_PREVIEW_FONT_SIZES,
  KINDLE_PREVIEW_FONT_STACKS,
  KINDLE_PREVIEW_LINE_HEIGHTS,
  KINDLE_PREVIEW_MARGINS,
  KINDLE_PREVIEW_SAMPLE,
  anchorSplitIndex,
  matchKindlePreset,
  normalizeKindlePrefs,
  type KindleMarginPref,
  type KindleApproach,
  type KindleAlign,
  type KindleLayoutPref,
  type KindleLineHeight,
  type KindlePrefs,
} from "../../shared/kindle-prefs";

/**
 * Panel «Tu Kindle» (K8): configura la apariencia del lector de tinta
 * electrónica desde el celular. Los ajustes viven en la cuenta (API
 * /api/kindle/prefs) y los consume cualquier Kindle vinculado. La vista
 * previa es local e inmediata: el mismo pasaje de muestra y los mismos
 * mapas de tamaño que el lector /k (shared/kindle-prefs.ts), sin iframe.
 */

const WORD_RE = /([\p{L}\p{M}]{2,}(?:['’][\p{L}\p{M}]+)?)/gu;

// Enfoque «Anclas de lectura»: misma regla que el lector /k — negrita en
// el ~40% inicial de cada palabra de 4+ letras (anchorSplitIndex).
function anchorize(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const word = m[0];
    const cut = anchorSplitIndex(word);
    parts.push(
      cut > 0 ? (
        <span key={key++}>
          <strong className="kindle-preview-anc">{word.slice(0, cut)}</strong>
          {word.slice(cut)}
        </span>
      ) : (
        word
      ),
    );
    last = idx + word.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type SegmentedFieldProps = {
  legend: string;
  name: keyof KindlePrefs;
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (name: keyof KindlePrefs, value: string) => void;
};

// Grupo segmentado para opciones cortas (alineación, disposición,
// enfoque…): mismo control que «Animaciones del gato» en Tú.
function SegmentedField({ legend, name, options, value, onChange }: SegmentedFieldProps) {
  return (
    <div className="kindle-pref-field">
      <span className="kindle-pref-legend">{legend}</span>
      <div className="segmented segmented--wrap" role="group" aria-label={legend}>
        {options.map(([opt, label]) => (
          <button
            key={opt}
            type="button"
            data-active={value === opt || undefined}
            aria-pressed={value === opt}
            onClick={() => onChange(name, opt)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function KindleAppearancePanel() {
  const [prefs, setPrefs] = useState<KindlePrefs>(DEFAULT_KINDLE_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    accountFetch("/api/kindle/prefs")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { prefs?: unknown } | null) => {
        if (alive && data?.prefs) {
          setPrefs(normalizeKindlePrefs(data.prefs));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = (name: keyof KindlePrefs, value: string) => {
    setPrefs((prev) => normalizeKindlePrefs({ ...prev, [name]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await accountFetch("/api/kindle/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "No se pudo guardar. Intenta de nuevo en unos minutos.");
      }
    } catch {
      setError("Error al contactar al servidor.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <p className="meta">Cargando tus ajustes de Kindle…</p>;
  }

  const activePreset = matchKindlePreset(prefs);
  const margin = KINDLE_PREVIEW_MARGINS[prefs.margin];
  const previewTextStyle: CSSProperties = {
    fontFamily: KINDLE_PREVIEW_FONT_STACKS[prefs.fontFamily],
    fontSize: `${KINDLE_PREVIEW_FONT_SIZES[prefs.fontSize]}rem`,
    lineHeight: KINDLE_PREVIEW_LINE_HEIGHTS[prefs.lineHeight],
    textAlign: prefs.align,
    padding: `${margin.y}px ${margin.x}px`,
  };

  return (
    <div className="kindle-panel">
      <p className="setting-hint">
        Así se verá tu lectura en el Kindle. Cambia los ajustes y guárdalos en tu cuenta.
      </p>

      {/* Estilos rápidos: combinaciones completas de los 7 ajustes.
          Al servidor siempre viajan las prefs resueltas, nunca el id. */}
      <div className="kindle-pref-field kindle-presets">
        <span className="kindle-pref-legend">Estilos rápidos</span>
        <div className="kindle-presets-row">
          <div className="segmented segmented--wrap" role="group" aria-label="Estilos rápidos">
            {KINDLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-active={activePreset === preset.id || undefined}
                aria-pressed={activePreset === preset.id}
                onClick={() => {
                  setPrefs(normalizeKindlePrefs(preset.prefs));
                  setSaved(false);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {activePreset === null ? (
            <span className="meta kindle-presets-custom">Personalizado</span>
          ) : null}
        </div>
      </div>

      <div className="kindle-panel-grid">
        {/* Vista previa local e inmediata: superficie tipo E-Ink con el
            pasaje de muestra compartido (sin iframe ni espera de red). */}
        <div className="kindle-preview-col">
          <div
            className={`kindle-preview kindle-preview--${prefs.layout}`}
            role="img"
            aria-label={`Vista previa del lector Kindle con ${KINDLE_PREF_LABELS.fontSize[prefs.fontSize]?.toLowerCase() ?? ""} tamaño de letra`}
          >
            <div className="kindle-preview-content" style={previewTextStyle}>
              <h2 className="kindle-preview-title">{KINDLE_PREVIEW_SAMPLE.title}</h2>
              {KINDLE_PREVIEW_SAMPLE.paragraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className={[
                    "kindle-preview-p",
                    prefs.approach === "paragraphs" ? "kindle-preview-p--numbered" : "",
                    i === 0 && prefs.approach !== "paragraphs" ? "kindle-preview-p--first" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {prefs.approach === "paragraphs" ? (
                    <span className="kindle-preview-pnum" aria-hidden="true">
                      §{i + 1}
                    </span>
                  ) : null}
                  {prefs.approach === "anchors" ? anchorize(paragraph) : paragraph}
                </p>
              ))}
            </div>
            {prefs.layout === "paged" ? (
              <div className="kindle-preview-bar" aria-hidden="true">
                ‹&nbsp;&nbsp;18 %&nbsp;&nbsp;›
              </div>
            ) : null}
          </div>
        </div>

        <div className="kindle-prefs-controls">
          <div className="kindle-pref-field">
            <label className="kindle-pref-legend" htmlFor="kindle-pref-font">
              Tipografía
            </label>
            <select
              id="kindle-pref-font"
              aria-label="Tipografía"
              value={prefs.fontFamily}
              onChange={(e) => update("fontFamily", e.target.value)}
            >
              {Object.entries(KINDLE_PREF_LABELS.fontFamily).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="kindle-pref-field">
            <label className="kindle-pref-legend" htmlFor="kindle-pref-size">
              Tamaño de letra
            </label>
            <select
              id="kindle-pref-size"
              aria-label="Tamaño de letra"
              value={prefs.fontSize}
              onChange={(e) => update("fontSize", e.target.value)}
            >
              {Object.entries(KINDLE_PREF_LABELS.fontSize).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <SegmentedField
            legend="Interlineado"
            name="lineHeight"
            value={prefs.lineHeight}
            onChange={update}
            options={Object.entries(KINDLE_PREF_LABELS.lineHeight) as ReadonlyArray<
              readonly [KindleLineHeight, string]
            >}
          />

          <SegmentedField
            legend="Margen"
            name="margin"
            value={prefs.margin}
            onChange={update}
            options={Object.entries(KINDLE_PREF_LABELS.margin) as ReadonlyArray<
              readonly [KindleMarginPref, string]
            >}
          />

          <SegmentedField
            legend="Alineación"
            name="align"
            value={prefs.align}
            onChange={update}
            options={Object.entries(KINDLE_PREF_LABELS.align) as ReadonlyArray<
              readonly [KindleAlign, string]
            >}
          />

          <SegmentedField
            legend="Enfoque de lectura"
            name="approach"
            value={prefs.approach}
            onChange={update}
            options={Object.entries(KINDLE_PREF_LABELS.approach) as ReadonlyArray<
              readonly [KindleApproach, string]
            >}
          />

          <SegmentedField
            legend="Disposición"
            name="layout"
            value={prefs.layout}
            onChange={update}
            options={Object.entries(KINDLE_PREF_LABELS.layout) as ReadonlyArray<
              readonly [KindleLayoutPref, string]
            >}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={save}
        disabled={saving}
        style={{ minHeight: "48px" }}
      >
        {saving ? "Guardando…" : "Guardar en mi Kindle"}
      </button>
      {saved ? (
        <p className="meta" style={{ color: "var(--accent, #16a34a)", fontWeight: 500 }}>
          Ajustes guardados. Tu Kindle los usará al abrir cualquier página.
        </p>
      ) : null}
      {error ? (
        <p className="meta" style={{ color: "var(--danger, #dc2626)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default KindleAppearancePanel;
