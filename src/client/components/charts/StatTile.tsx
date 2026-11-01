type StatTileProps = {
  label: string;
  value: string;
  /** Cambio respecto al periodo anterior, ya formateado («+12%»). */
  delta?: string | null;
  /** true si el cambio es hacia arriba, false hacia abajo, null sin dato. */
  deltaTone?: "up" | "down" | "flat" | null;
  hint?: string;
};

// Tarjeta de cifra con su comparación. El cambio se dice con texto
// («+12%») además del matiz, así no depende solo del color.
export function StatTile({ label, value, delta, deltaTone, hint }: StatTileProps) {
  const toneClass =
    deltaTone === "up"
      ? "is-up"
      : deltaTone === "down"
        ? "is-down"
        : "is-flat";
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {delta != null ? (
        <span className={`adm-stat-delta ${toneClass}`}>{delta}</span>
      ) : null}
      {hint ? <span className="adm-stat-hint">{hint}</span> : null}
    </div>
  );
}
