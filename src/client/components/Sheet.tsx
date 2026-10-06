import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useModalBehavior } from "../lib/modal";

type SheetProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
  // En pantallas anchas la hoja se acopla al margen indicado como
  // marginalia; en pantallas estrechas sigue siendo hoja inferior.
  side?: "right" | "left";
};

// Punto de corte donde la hoja deja de ser hoja inferior (components.css).
const DOCKED_QUERY = "(min-width: 64rem)";

// Zonas donde un arrastre no debe convertirse en swipe: ahí el gesto
// pertenece al control (botón, enlace, interruptor, selección…).
const INTERACTIVE =
  "button, a, input, select, textarea, summary, [role='switch'], [role='radio'], [contenteditable='true']";

type DragTrack = {
  id: number;
  startY: number;
  lastY: number;
  lastT: number;
  vel: number;
  on: boolean;
};

export default function Sheet({ label, onClose, children, side }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalBehavior(ref, onClose);
  const docked =
    side === "left" ? " sheet--docked sheet--docked-left" : side === "right" ? " sheet--docked" : "";
  // Cierra solo si el mismo puntero empezó y terminó sobre el fondo:
  // arrastrar desde dentro o soltar fuera tras empezar dentro no cierra.
  const downOnScrim = useRef(false);

  // --- Arrastre hacia abajo para cerrar ---
  const drag = useRef<DragTrack | null>(null);
  const [dragY, setDragY] = useState(0);
  const [swiping, setSwiping] = useState(false);

  // React registra touchmove como oyente pasivo: para frenar el scroll
  // nativo una vez que el gesto es nuestro hace falta preventDefault
  // real, así que el oyente se conecta a mano.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stopNativeScroll = (event: TouchEvent) => {
      if (drag.current?.on) event.preventDefault();
    };
    el.addEventListener("touchmove", stopNativeScroll, { passive: false });
    return () => el.removeEventListener("touchmove", stopNativeScroll);
  }, []);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.id) return;
    drag.current = null;
    if (!d.on) return;
    setSwiping(false);
    const height = ref.current?.offsetHeight ?? 0;
    const dy = event.clientY - d.startY;
    // Cierra si pasó el 28% de la hoja, o si venía rápido aunque corto.
    if (dy > height * 0.28 || (d.vel > 0.5 && dy > 40)) onClose();
    else setDragY(0);
  };

  return (
    <div
      className="sheet-scrim"
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
        className={`sheet${docked}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-swiping={swiping || undefined}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        onPointerDown={(event) => {
          // La hoja acoplada al margen no se arrastra: ahí es panel
          // lateral, no hoja inferior.
          if (drag.current) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (side !== undefined && window.matchMedia(DOCKED_QUERY).matches)
            return;
          const el = ref.current;
          // Con contenido desplazado el gesto es del scroll, no de la hoja.
          if (!el || el.scrollTop > 0) return;
          const target = event.target;
          if (target instanceof Element && target.closest(INTERACTIVE)) return;
          drag.current = {
            id: event.pointerId,
            startY: event.clientY,
            lastY: event.clientY,
            lastT: event.timeStamp,
            vel: 0,
            on: false,
          };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || event.pointerId !== d.id) return;
          const el = ref.current;
          const dy = event.clientY - d.startY;
          if (!d.on) {
            // Tirón hacia arriba o contenido que se movió: el gesto es
            // del scroll; el candidato muere y la hoja quieta.
            if (dy < -4 || (el && el.scrollTop > 0)) {
              drag.current = null;
              return;
            }
            // Histeresis de 8px para no secuestrar toques ni selecciones.
            if (dy < 8) return;
            d.on = true;
            el?.setPointerCapture(event.pointerId);
            setSwiping(true);
          }
          const dt = event.timeStamp - d.lastT;
          if (dt > 0)
            d.vel = d.vel * 0.7 + ((event.clientY - d.lastY) / dt) * 0.3;
          d.lastY = event.clientY;
          d.lastT = event.timeStamp;
          // Resistencia elástica: pasada media hoja, cada píxel cuesta más.
          const h = el?.offsetHeight ?? 400;
          const capped = dy <= h * 0.5 ? dy : h * 0.5 + (dy - h * 0.5) * 0.35;
          setDragY(capped);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {/* Asa de agarre: anuncia que la hoja se arrastra hacia abajo.
            En modo acoplado (margen) se oculta por CSS. */}
        <div className="sheet-grabber" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
