/** Pantalla de carga con brillo suave; reemplaza los «Abriendo…» de texto plano. */
export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      <span className="loading-screen__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className="loading-screen__label">{label}</p>
      <div className="skeleton skeleton--line" aria-hidden="true" />
      <div className="skeleton skeleton--line is-short" aria-hidden="true" />
    </div>
  );
}
