import { useState } from "react";
import Dialog from "./Dialog";
import Toggle from "./Toggle";
import {
  triggerHaptic,
  type DeepReadingConfig,
  type DeepReadingDuration,
} from "../lib/deep-reading";

export interface DeepReadingModalProps {
  onStart: (config: DeepReadingConfig) => void;
  onClose: () => void;
}

const DURATION_OPTIONS: { value: DeepReadingDuration; label: string; desc: string }[] = [
  { value: 15, label: "15 min", desc: "Pausa breve de concentración" },
  { value: 20, label: "20 min", desc: "Inmersión recomendada" },
  { value: 30, label: "30 min", desc: "Profundidad sostenida" },
  { value: 45, label: "45 min", desc: "Retiro extenso" },
  { value: 0, label: "Libre", desc: "Sin límite de tiempo" },
];

export default function DeepReadingModal({ onStart, onClose }: DeepReadingModalProps) {
  const [duration, setDuration] = useState<DeepReadingDuration>(20);
  const [fullscreen, setFullscreen] = useState(false);
  const [keepAwake, setKeepAwake] = useState(true);

  const handleStart = () => {
    triggerHaptic("success");
    onStart({
      durationMinutes: duration,
      fullscreen,
      keepScreenAwake: keepAwake,
    });
  };

  return (
    <Dialog label="Retiro de lectura" onClose={onClose}>
      <div className="sheet-head">
        <h2 className="sheet-title">Retiro de lectura</h2>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar configuración"
        >
          Cerrar
        </button>
      </div>

      <p className="meta" style={{ margin: "var(--s-1) 0 var(--s-3)" }}>
        Una sesión inmersiva libre de distracciones. Las barras y contadores se ocultan
        para que solo exista el texto ante tus ojos.
      </p>

      <section className="settings-section">
        <h3 className="eyebrow">Duración de la sesión</h3>
        <div className="segmented-grid" role="group" aria-label="Duración del retiro">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`segmented-opt${duration === opt.value ? " is-active" : ""}`}
              onClick={() => {
                setDuration(opt.value);
                triggerHaptic("selection");
              }}
              aria-pressed={duration === opt.value}
            >
              <strong className="segmented-opt-label">{opt.label}</strong>
              <span className="segmented-opt-desc">{opt.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section" style={{ marginTop: "var(--s-3)" }}>
        <h3 className="eyebrow">Entorno</h3>
        <div className="setting-row">
          <span className="setting-label">Pantalla completa</span>
          <Toggle
            label="Pantalla completa"
            checked={fullscreen}
            onChange={(val) => {
              setFullscreen(val);
              triggerHaptic("selection");
            }}
          />
        </div>
        <p className="meta" style={{ fontSize: "var(--fs-xs)" }}>
          Oculta las barras del navegador y del sistema operativo.
        </p>

        <div className="setting-row" style={{ marginTop: "var(--s-2)" }}>
          <span className="setting-label">Mantener pantalla encendida</span>
          <Toggle
            label="Mantener pantalla encendida"
            checked={keepAwake}
            onChange={(val) => {
              setKeepAwake(val);
              triggerHaptic("selection");
            }}
          />
        </div>
        <p className="meta" style={{ fontSize: "var(--fs-xs)" }}>
          Evita que el dispositivo se suspenda mientras lees párrafos largos.
        </p>
      </section>

      <div style={{ marginTop: "var(--s-4)", display: "flex", justifyContent: "flex-end", gap: "var(--s-2)" }}>
        <button type="button" className="btn--quiet" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn" onClick={handleStart} data-autofocus>
          Comenzar retiro
        </button>
      </div>
    </Dialog>
  );
}
