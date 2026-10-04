import { useRef, type ReactNode } from "react";
import { useModalBehavior } from "../lib/modal";

type SheetProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

// Hoja inferior con asa. En fases siguientes gana la variante de
// margen para pantallas anchas.
export default function Sheet({ label, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  return (
    <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>
  );
}
