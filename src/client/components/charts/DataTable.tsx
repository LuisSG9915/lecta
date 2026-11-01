import { useMemo, useState, type ReactNode } from "react";

export type TableColumn<Row> = {
  /** Encabezado visible. */
  label: string;
  /** Valor para ordenar; si falta, la columna no es ordenable. */
  sortValue?: (row: Row) => number | string | null;
  /** Contenido de la celda. */
  cell: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
};

type DataTableProps<Row> = {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  ariaLabel: string;
  /** Clave de la columna inicialmente ordenada. */
  initialSort?: { column: number; desc?: boolean };
  emptyLabel?: string;
};

// Tabla ordenable: el encabezado de cada columna ordenable es un
// botón con aria-sort en el <th>; el sentido se dice con flecha
// además del indicador visual.
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  ariaLabel,
  initialSort,
  emptyLabel,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(
    initialSort ? { col: initialSort.column, desc: initialSort.desc ?? true } : null,
  );

  const sorted = useMemo(() => {
    if (!sort || !columns[sort.col]?.sortValue) return rows;
    const getter = columns[sort.col].sortValue!;
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb), "es") * dir;
    });
  }, [rows, sort, columns]);

  if (rows.length === 0) {
    return (
      <p className="chart-empty" role="note">
        {emptyLabel ?? "Nada que mostrar todavía."}
      </p>
    );
  }

  return (
    <div className="chart-table-scroll">
      <table className="adm-table">
        <caption className="visually-hidden">{ariaLabel}</caption>
        <thead>
          <tr>
            {columns.map((col, i) => {
              const active = sort?.col === i;
              const ariaSort = active
                ? sort!.desc
                  ? "descending"
                  : "ascending"
                : col.sortValue
                  ? "none"
                  : undefined;
              return (
                <th
                  key={i}
                  scope="col"
                  style={{ textAlign: col.align ?? "left" }}
                  aria-sort={ariaSort}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      className={`adm-th-sort${active ? " is-active" : ""}`}
                      onClick={() =>
                        setSort((prev) =>
                          prev?.col === i
                            ? { col: i, desc: !prev.desc }
                            : { col: i, desc: true },
                        )
                      }
                    >
                      {col.label}
                      <span aria-hidden="true">
                        {" "}
                        {active ? (sort!.desc ? "↓" : "↑") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col, i) => (
                <td key={i} style={{ textAlign: col.align ?? "left" }}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
