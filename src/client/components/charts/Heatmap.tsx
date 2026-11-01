type HeatmapProps = {
  /** Nombre de cada fila («Lun»…«Dom» o «ene»…). */
  rowLabels: string[];
  /** Nombre de cada columna (horas, semanas…); con `colLabelEvery`
      solo se imprime una de cada N para que no se apelmacen. */
  colLabels: string[];
  colLabelEvery?: number;
  /** Intensidad por celda, 0..max (se normaliza dentro). */
  values: number[][];
  ariaLabel: string;
  /** Formato del valor en el tooltip de la celda. */
  cellLabel?: (row: number, col: number, value: number) => string;
  emptyLabel?: string;
};

// Mapa de calor accesible: cada celda es un botón de solo lectura con
// su etiqueta completa; la intensidad también se anuncia en la tabla
// equivalente del ChartFrame.
export function Heatmap({
  rowLabels,
  colLabels,
  colLabelEvery = 1,
  values,
  ariaLabel,
  cellLabel,
  emptyLabel,
}: HeatmapProps) {
  const max = Math.max(0, ...values.flat());
  if (max <= 0) {
    return (
      <p className="chart-empty" role="note">
        {emptyLabel ?? "Sin datos en el periodo."}
      </p>
    );
  }
  return (
    <div className="chart-heat" role="img" aria-label={ariaLabel}>
      <div className="chart-heat-row chart-heat-head">
        <span className="chart-heat-corner" aria-hidden="true" />
        {colLabels.map((c, i) => (
          <span key={i} className="chart-heat-collabel">
            {i % colLabelEvery === 0 ? c : ""}
          </span>
        ))}
      </div>
      {rowLabels.map((rowLabel, r) => (
        <div className="chart-heat-row" key={rowLabel}>
          <span className="chart-heat-rowlabel">{rowLabel}</span>
          {colLabels.map((colLabel, c) => {
            const v = values[r]?.[c] ?? 0;
            const intensity = Math.min(1, v / max);
            return (
              <span
                key={c}
                className="chart-heat-cell"
                title={cellLabel?.(r, c, v) ?? `${rowLabel} ${colLabel}: ${v}`}
              >
                <i style={{ opacity: 0.06 + intensity * 0.94 }} aria-hidden="true" />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
