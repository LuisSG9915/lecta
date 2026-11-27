// Hoja del Carné de Lector sobre el lector (Fase I): permite suscribirse
// desde cualquier PlanNote sin desmontar el libro ni cargar toda la vista «Tú».
import type { PlanSnapshot } from "../lib/account-plan";
import ReaderCard from "./ReaderCard";
import Sheet from "./Sheet";

export default function CarneSheet({
  plan,
  onClose,
}: {
  plan: PlanSnapshot | null;
  onClose: () => void;
}) {
  return (
    <Sheet label="Lecta+" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Lecta+</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>
      <ReaderCard plan={plan} />
    </Sheet>
  );
}
