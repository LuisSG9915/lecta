type FunnelStep = {
  label: string;
  count: number;
  hint?: string;
};

type FunnelProps = {
  steps: FunnelStep[];
  ariaLabel: string;
};

// Embudo de activación: cada paso muestra el ancho relativo al primero
// y la conversión respecto al paso anterior, en números — el ancho de
// la barra es apoyo, no el único canal.
export function Funnel({ steps, ariaLabel }: FunnelProps) {
  const first = Math.max(1, steps[0]?.count ?? 0);
  return (
    <ol className="chart-funnel" aria-label={ariaLabel}>
      {steps.map((step, i) => {
        const pct = Math.round((step.count / first) * 100);
        const prev = i > 0 ? steps[i - 1].count : null;
        const conv =
          prev != null && prev > 0
            ? Math.round((step.count / prev) * 100)
            : null;
        return (
          <li key={step.label} className="chart-funnel-step">
            <div className="chart-funnel-meta">
              <span className="chart-funnel-label">{step.label}</span>
              <span className="chart-funnel-count">
                {step.count.toLocaleString("es-MX")}
                {i > 0 ? ` · ${pct}%` : ""}
              </span>
            </div>
            <div className="chart-funnel-track">
              <div
                className="chart-funnel-bar"
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            {i > 0 ? (
              <span className="chart-funnel-conv">
                {conv != null ? `→ ${conv}%` : "→ —"}
              </span>
            ) : null}
            {step.hint ? (
              <span className="chart-funnel-hint">{step.hint}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
