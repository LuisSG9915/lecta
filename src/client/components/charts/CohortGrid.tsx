import type { AdminCohortRow } from "../../../shared/admin-insights";

type CohortGridProps = {
  cohorts: AdminCohortRow[];
  /** Semanas de retención a mostrar (0..N). */
  weeks?: number;
  ariaLabel: string;
};

// Retención por semana de alta: es una tabla de verdad (ya accesible
// por construcción) con la intensidad de color como apoyo visual.
// Cada celda dice «85% · 6» — porcentaje y personas, no solo color.
export function CohortGrid({ cohorts, weeks = 8, ariaLabel }: CohortGridProps) {
  if (cohorts.length === 0) {
    return (
      <p className="chart-empty" role="note">
        Aún no hay altas en las últimas {weeks} semanas.
      </p>
    );
  }
  return (
    <div className="chart-cohort-scroll">
      <table className="chart-cohort" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th scope="col">Alta</th>
            <th scope="col">Personas</th>
            {Array.from({ length: weeks }, (_, w) => (
              <th key={w} scope="col">
                {w === 0 ? "Alta" : `+${w} sem`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <th scope="row">{c.week}</th>
              <td>{c.size}</td>
              {Array.from({ length: weeks }, (_, w) => {
                const pct = c.retainedPct[w];
                const users = c.retainedUsers[w];
                if (pct == null) {
                  return (
                    <td key={w} className="is-future">
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={w}
                    className="chart-cohort-cell"
                    style={{ ["--i" as never]: pct / 100 }}
                    title={`${users} de ${c.size} siguieron activos en la semana ${w}`}
                  >
                    {pct}%
                    <span className="chart-cohort-n"> · {users}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
