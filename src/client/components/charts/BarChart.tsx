type BarDatum = {
  /** Etiqueta del eje (día, semana…). */
  label: string;
  /** Texto corto del eje si la etiqueta completa no cabe. */
  shortLabel?: string;
  value: number;
  /** Texto completo del valor para el tooltip/aria («32 min»). */
  valueLabel?: string;
};

type BarChartProps = {
  data: BarDatum[];
  /** Unidad para el tope y la descripción («min», «personas»). */
  unit?: string;
  ariaLabel: string;
  /** Texto cuando no hay nada que pintar. */
  emptyLabel?: string;
};

// Barras verticales con HTML+CSS (sin librería): cada barra lleva su
// title accesible y el conjunto se anuncia como imagen con resumen.
export function BarChart({ data, unit, ariaLabel, emptyLabel }: BarChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0 || max <= 0) {
    return (
      <p className="chart-empty" role="note">
        {emptyLabel ?? "Sin datos en el periodo."}
      </p>
    );
  }
  return (
    <div className="chart-bars" role="img" aria-label={ariaLabel}>
      {data.map((d) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <div className="chart-bar-col" key={d.label}>
            <div className="chart-bar-wrap">
              <div
                className="chart-bar"
                style={{ height: `${pct}%` }}
                title={d.valueLabel ?? `${d.label}: ${d.value}${unit ? ` ${unit}` : ""}`}
              />
            </div>
            <span className="chart-bar-label" title={d.label}>
              {d.shortLabel ?? d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
