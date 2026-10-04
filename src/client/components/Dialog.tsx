import { useRef, type ReactNode, type MouseEvent } from "react";
import { useModalBehavior } from "../lib/modal";

type DialogProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

export default function Dialog({ label, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  return (
    <div className="dialog-scrim" onMouseDown={onScrimClick}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
