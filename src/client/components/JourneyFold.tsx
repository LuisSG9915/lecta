import { useState, type ReactNode } from "react";
import Icon from "./Icon";
import { useMediaQuery } from "../hooks/useMediaQuery";

type JourneyFoldProps = {
  title: string;
  // Contenido extra junto al título (p. ej. «2 idiomas»): visible también
  // cuando la sección está plegada.
  headExtra?: ReactNode;
  children: ReactNode;
};

// Sección plegable de «Tu recorrido»: en móvil arranca cerrada (reduce
// el scroll de ~8 pantallas); en escritorio (≥64rem) va siempre abierta
// y el resumen no se puede plegar — el Bento la necesita expandida.
export default function JourneyFold({ title, headExtra, children }: JourneyFoldProps) {
  const isDesktop = useMediaQuery("(min-width: 64rem)");
  const [open, setOpen] = useState(false);
  const expanded = isDesktop || open;

  return (
    <details
      className="journey-fold"
      open={expanded}
      onToggle={(e) => {
        if (!isDesktop) setOpen(e.currentTarget.open);
      }}
    >
      <summary
        className="journey-fold-summary"
        onClick={(e) => {
          if (isDesktop) e.preventDefault();
        }}
      >
        <h2 className="journey-section-title">{title}</h2>
        {headExtra}
        <span className="journey-fold-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
      </summary>
      <div className="journey-fold-body">{children}</div>
    </details>
  );
}
