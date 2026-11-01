type LineSeries = {
  id: string;
  label: string;
  values: number[];
  /** Índice de estilo 0–3: cada serie lleva color Y trazo distintos. */
  tone: 0 | 1 | 2 | 3;
};

type LineChartProps = {
  /** Etiquetas del eje X, una por posición. */
  xLabels: string[];
  series: LineSeries[];
  ariaLabel: string;
  /** Formato del valor máximo del eje («1 240 min»). */
  maxLabel?: string;
  emptyLabel?: string;
};

const W = 720;
const H = 180;
const PAD_X = 8;
const PAD_Y = 14;

// Líneas SVG multi-serie: cada serie se distingue por color y por
// trazo (continua, guiones, puntos) para que no dependa solo del color.
export function LineChart({
  xLabels,
  series,
  ariaLabel,
  maxLabel,
  emptyLabel,
}: LineChartProps) {
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (series.length === 0 || max <= 0) {
    return (
      <p className="chart-empty" role="note">
        {emptyLabel ?? "Sin datos en el periodo."}
      </p>
    );
  }

  const count = Math.max(1, xLabels.length);
  const x = (i: number) =>
    PAD_X + (i / Math.max(1, count - 1)) * (W - PAD_X * 2);
  const y = (v: number) => H - PAD_Y - (v / max) * (H - PAD_Y * 2);

  return (
    <div className="chart-line-wrap">
      <svg
        className="chart-line"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <line
          x1={PAD_X}
          y1={H - PAD_Y}
          x2={W - PAD_X}
          y2={H - PAD_Y}
          className="chart-axis"
        />
        <text x={PAD_X} y={10} className="chart-axis-max">
          {maxLabel ?? String(Math.round(max))}
        </text>
        {series.map((s) => (
          <polyline
            key={s.id}
            className={`chart-line-path chart-line-tone-${s.tone}`}
            fill="none"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <ul className="chart-legend" aria-hidden="false">
        {series.map((s) => (
          <li key={s.id} className={`chart-legend-item chart-line-tone-${s.tone}`}>
            <span className="chart-legend-swatch" aria-hidden="true" />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
