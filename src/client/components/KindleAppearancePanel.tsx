import { useEffect, useMemo, useState } from "react";
import { accountFetch } from "../lib/account-fetch";
import {
  DEFAULT_KINDLE_PREFS,
  KINDLE_PREF_FIELDS,
  KINDLE_PREF_LABELS,
  normalizeKindlePrefs,
  type KindlePrefs,
} from "../../shared/kindle-prefs";

/**
 * Panel «Tu Kindle» (K8): configura la apariencia del lector de tinta
 * electrónica desde el celular. Los ajustes viven en la cuenta (API
 * /api/kindle/prefs) y los consume cualquier Kindle vinculado. La vista
 * previa es la página REAL del lector renderizada por el servidor
 * (/k/preview/page), escalada dentro de un marco tipo Paperwhite.
 */

const PREVIEW_DEBOUNCE_MS = 450;

function previewQuery(prefs: KindlePrefs): string {
  const qs = new URLSearchParams({
    font: prefs.fontFamily,
    size: prefs.fontSize,
    lh: prefs.lineHeight,
    margin: prefs.margin,
    align: prefs.align,
    mode: prefs.approach,
    layout: prefs.layout,
  });
  return qs.toString();
}

const selectStyle = {
  width: "100%",
  minHeight: "44px",
  fontSize: "1rem",
  padding: "0.35rem 0.5rem",
} as const;

export function KindleAppearancePanel() {
  const [prefs, setPrefs] = useState<KindlePrefs>(DEFAULT_KINDLE_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [previewKey, setPreviewKey] = useState(0);

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

  // La vista previa se recarga con calma tras cada cambio (debounce), para no
  // pedir una página nueva al servidor en cada toque de un selector.
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => setPreviewKey((k) => k + 1), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [prefs, loaded]);

  const previewSrc = useMemo(
    () => `/k/preview/page?${previewQuery(prefs)}`,
    [prefs],
  );

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

  return (
    <div style={{ marginTop: "var(--s-3, 0.75rem)", borderTop: "1px solid var(--rule, #ddd)", paddingTop: "var(--s-3, 0.75rem)" }}>
      <strong style={{ display: "block", marginBottom: "var(--s-1, 0.25rem)" }}>Tu Kindle</strong>
      <p className="meta" style={{ marginBottom: "var(--s-2, 0.5rem)" }}>
        Así se verá tu lectura en el Kindle. Cambia los ajustes y guárdalos en tu cuenta.
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          margin: "0.75rem 0",
        }}
      >
        <div
          style={{
            width: "216px",
            height: "292px",
            border: "6px solid #111",
            borderRadius: "10px",
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <iframe
            key={previewKey}
            src={previewSrc}
            title="Vista previa del lector Kindle"
            sandbox="allow-same-origin allow-popups"
            style={{
              width: "620px",
              height: "830px",
              border: 0,
              transform: "scale(0.32)",
              transformOrigin: "0 0",
            }}
          />
        </div>
      </div>
      <p className="meta" style={{ textAlign: "center", marginBottom: "0.75rem" }}>
        <a href={`/k/preview?${previewQuery(prefs)}`} target="_blank" rel="noreferrer">
          Ver la vista previa a tamaño real →
        </a>
      </p>

      {KINDLE_PREF_FIELDS.map((field) => (
        <label
          key={field.name}
          className="meta"
          style={{ display: "block", marginBottom: "0.6rem", fontWeight: 500 }}
        >
          {field.legend}
          <select
            aria-label={field.legend}
            value={prefs[field.name]}
            onChange={(e) => update(field.name, e.target.value)}
            style={selectStyle}
          >
            {Object.entries(KINDLE_PREF_LABELS[field.name] ?? {}).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}

      <button
        type="button"
        className="btn btn--primary"
        onClick={save}
        disabled={saving}
        style={{ width: "100%", minHeight: "48px", marginTop: "0.25rem" }}
      >
        {saving ? "Guardando…" : "Guardar en mi Kindle"}
      </button>
      {saved ? (
        <p className="meta" style={{ color: "var(--accent, #16a34a)", marginTop: "0.5rem", fontWeight: 500 }}>
          Ajustes guardados. Tu Kindle los usará al abrir cualquier página.
        </p>
      ) : null}
      {error ? (
        <p className="meta" style={{ color: "var(--danger, #dc2626)", marginTop: "0.5rem" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
