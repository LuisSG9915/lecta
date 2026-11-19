// Nota al margen de Lecta+ (docs/designs/2026-11-12-planes-y-landing.md):
// dos líneas tipográficas y un enlace al Carné. Nunca un modal de pago.
// Ultraligera a propósito: sin estado ni dependencias.
export default function PlanNote({ title, detail }: { title: string; detail: string }) {
  return (
    <p className="plan-note" role="note">
      <span className="plan-note__title">{title}</span>
      <span className="plan-note__detail">
        {detail}{" "}
        <a
          className="plan-note__link"
          href="/?carne=1"
          onClick={(e) => {
            // Abre el Carné sin recargar ni desmontar el lector (App escucha).
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("lecta:open-carne"));
          }}
        >
          Ver Lecta+
        </a>
      </span>
    </p>
  );
}
