import type { ReactNode } from "react";

type ChartFrameProps = {
  /** Título visible sobre la gráfica. */
  title: string;
  /** Aclaración pequeña junto al título (unidades, estimaciones). */
  hint?: string;
  /** Resumen para lectores de pantalla si la gráfica no se entiende sola. */
  summary?: string;
  /** Tabla equivalente detrás de «Ver como tabla». */
  table?: ReactNode;
  children: ReactNode;
};

// Marco común de las gráficas del panel: título, cuerpo y una tabla
// equivalente plegable. Los datos nunca viajan solo en color ni en
// forma: siempre hay una tabla con los mismos números.
export function ChartFrame({
  title,
  hint,
  summary,
  table,
  children,
}: ChartFrameProps) {
  return (
    <figure className="chart-frame">
      <figcaption className="chart-frame-head">
        <span className="chart-frame-title">{title}</span>
        {hint ? <span className="chart-frame-hint">{hint}</span> : null}
      </figcaption>
      {summary ? <p className="visually-hidden">{summary}</p> : null}
      <div className="chart-frame-body">{children}</div>
      {table ? (
        <details className="chart-table">
          <summary>Ver como tabla</summary>
          <div className="chart-table-scroll">{table}</div>
        </details>
      ) : null}
    </figure>
  );
}
