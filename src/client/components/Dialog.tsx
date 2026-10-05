import { useRef, type ReactNode } from "react";
import { useModalBehavior } from "../lib/modal";

type DialogProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

export default function Dialog({ label, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  // Misma regla que la hoja: cierra solo si el puntero empezó y terminó
  // sobre el fondo, sin arrastre ni cancelación de por medio.
  const downOnScrim = useRef(false);
  return (
    <div
      className="dialog-scrim"
      onPointerDown={(event) => {
        downOnScrim.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (downOnScrim.current && event.target === event.currentTarget) {
          onClose();
        }
        downOnScrim.current = false;
      }}
      onPointerCancel={() => {
        downOnScrim.current = false;
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
