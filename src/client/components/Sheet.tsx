import { useRef, type ReactNode } from "react";
import { useModalBehavior } from "../lib/modal";

type SheetProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
  // En pantallas anchas la hoja se acopla al margen indicado como
  // marginalia; en pantallas estrechas sigue siendo hoja inferior.
  side?: "right" | "left";
};

export default function Sheet({ label, onClose, children, side }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  const docked =
    side === "left" ? " sheet--docked sheet--docked-left" : side === "right" ? " sheet--docked" : "";
  return (
    <div
      ref={ref}
      className={`sheet${docked}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}
