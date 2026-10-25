// Franja única de avisos flotantes del lector. Todo lo que flota sobre el
// dock (toast, pista, marcapasos, párrafo bilingüe) se apila aquí en columna;
// nunca se posiciona a mano en `bottom`, así no se pisan entre sí.
import type { ReactNode } from "react";

export function ReaderFloatingLane({ children }: { children: ReactNode }) {
  return (
    <div className="reader-floating-lane">
      {children}
    </div>
  );
}
