import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useModalBehavior } from "../lib/modal";

type DialogProps = {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
};

export default function Dialog({
  label,
  onClose,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  }, []);

  useModalBehavior(ref, requestClose);

  useEffect(() => {
    if (!closing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };

    const el = ref.current;
    const handleAnimationEnd = (e: AnimationEvent) => {
      if (e.target === el) {
        finish();
      }
    };

    el?.addEventListener("animationend", handleAnimationEnd);
    const timer = setTimeout(finish, 200);

    return () => {
      el?.removeEventListener("animationend", handleAnimationEnd);
      clearTimeout(timer);
    };
  }, [closing, onClose]);

  // Misma regla que la hoja: cierra solo si el puntero empezó y terminó
  // sobre el fondo, sin arrastre ni cancelación de por medio.
  const downOnScrim = useRef(false);
  return (
    <div
      className="dialog-scrim"
      data-closing={closing ? "true" : undefined}
      onPointerDown={(event) => {
        downOnScrim.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (downOnScrim.current && event.target === event.currentTarget) {
          requestClose();
        }
        downOnScrim.current = false;
      }}
      onPointerCancel={() => {
        downOnScrim.current = false;
      }}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement | null;
        const closeBtn = target?.closest?.(
          "button[data-dialog-close], [data-dialog-close], button.dialog-close"
        );
        if (closeBtn) {
          event.stopPropagation();
          event.preventDefault();
          requestClose();
        }
      }}
    >
      <div
        ref={ref}
        className={className ? `dialog ${className}` : "dialog"}
        data-closing={closing ? "true" : undefined}
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
