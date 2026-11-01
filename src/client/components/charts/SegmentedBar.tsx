type Segment = {
  id: string;
  label: string;
  value: number;
  /** Índice de tono 0–5 para el color del tramo. */
  tone: number;
};

type SegmentedBarProps = {
  parts: Segment[];
  ariaLabel: string;
  emptyLabel?: string;
};

// Barra al 100% por tramos con leyenda y números: el reparto se lee
// también en la leyenda, no solo en el color.
export function SegmentedBar({ parts, ariaLabel, emptyLabel }: SegmentedBarProps) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) {
    return (
      <p className="chart-empty" role="note">
        {emptyLabel ?? "Sin datos todavía."}
      </p>
    );
  }
  return (
    <div className="chart-seg" role="img" aria-label={ariaLabel}>
      <div className="chart-seg-track">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const pct = (p.value / total) * 100;
            return (
              <span
                key={p.id}
                className={`chart-seg-part chart-seg-tone-${p.tone}`}
                style={{ flexBasis: `${pct}%` }}
                title={`${p.label}: ${p.value} (${Math.round(pct)}%)`}
              />
            );
          })}
      </div>
      <ul className="chart-legend chart-seg-legend">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <li key={p.id} className="chart-legend-item">
              <span
                className={`chart-legend-swatch chart-seg-tone-${p.tone}`}
                aria-hidden="true"
              />
              <span>
                {p.label} — {p.value.toLocaleString("es-MX")} (
                {Math.round((p.value / total) * 100)}%)
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
