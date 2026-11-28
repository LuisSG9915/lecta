import { useEffect, useRef, useState } from "react";
import Dialog from "../Dialog";
import Icon from "../Icon";
import {
  createAudioReviewRunner,
  type AudioReviewSnapshot,
  type AudioReviewWord,
} from "../../lib/audio-review";

export interface AudioReviewPlayerProps {
  words: AudioReviewWord[];
  onClose: () => void;
}

const PHASE_LABELS = {
  prompt: "Escucha la palabra…",
  pause: "Piensa el significado…",
  reveal: "Significado",
} as const;

export default function AudioReviewPlayer({ words, onClose }: AudioReviewPlayerProps) {
  const [snap, setSnap] = useState<AudioReviewSnapshot>({
    status: words.length > 0 ? "playing" : "done",
    index: 0,
    total: words.length,
    phase: "prompt",
    currentWord: words[0] ?? null,
  });
  const [revealedManually, setRevealedManually] = useState(false);

  const runnerRef = useRef<ReturnType<typeof createAudioReviewRunner> | null>(null);

  useEffect(() => {
    const runner = createAudioReviewRunner(words, {
      onChange: (next) => {
        setSnap(next);
        if (next.phase === "prompt") {
          setRevealedManually(false);
        }
      },
    });
    runnerRef.current = runner;
    void runner.start(0).catch(() => undefined);
    return () => {
      runner.stop();
      runnerRef.current = null;
    };
  }, [words]);

  const handleClose = () => {
    runnerRef.current?.stop();
    onClose();
  };

  const word = snap.currentWord;
  const showMeaning = snap.phase === "reveal" || revealedManually;

  return (
    <Dialog label="Repaso en audio" onClose={handleClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Repaso en audio</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={handleClose}
          aria-label="Cerrar repaso en audio"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {snap.status === "done" || !word ? (
        <div className="shelf-options-section">
          <p className="meta">Repaso en audio terminado.</p>
          <div style={{ display: "flex", gap: "var(--s-2)", marginTop: "var(--s-3)" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ minHeight: "44px" }}
              onClick={() => void runnerRef.current?.start(0)}
            >
              Volver a escuchar
            </button>
            <button
              type="button"
              className="btn"
              style={{ minHeight: "44px" }}
              onClick={handleClose}
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <div className="shelf-options-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--s-2)" }}>
            <span className="meta">
              {snap.index + 1} de {snap.total}
            </span>
            <span className="meta">{PHASE_LABELS[snap.phase]}</span>
          </div>

          <p
            lang={word.language || "es"}
            style={{ fontSize: "var(--fs-xl)", fontWeight: 600, margin: "var(--s-3) 0 var(--s-2)" }}
          >
            {word.form}
          </p>

          {word.context ? (
            <p className="meta" lang={word.language || "es"} style={{ marginBottom: "var(--s-3)" }}>
              «{word.context}»
            </p>
          ) : null}

          {showMeaning && word.meaning ? (
            <p style={{ marginBottom: "var(--s-3)" }}>
              <strong>Significado:</strong> {word.meaning}
            </p>
          ) : word.meaning ? (
            <div style={{ marginBottom: "var(--s-3)" }}>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setRevealedManually(true)}
              >
                Mostrar significado
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
            <button
              type="button"
              className="btn"
              style={{ minHeight: "44px", minWidth: "44px" }}
              disabled={snap.index === 0}
              onClick={() => void runnerRef.current?.prev()}
              aria-label="Palabra anterior"
            >
              <Icon name="skip-back" size={16} /> Anterior
            </button>
            {snap.status === "paused" ? (
              <button
                type="button"
                className="btn btn--primary"
                style={{ minHeight: "44px", minWidth: "44px" }}
                onClick={() => void runnerRef.current?.resume()}
              >
                <Icon name="play" size={16} /> Reanudar
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                style={{ minHeight: "44px", minWidth: "44px" }}
                onClick={() => runnerRef.current?.pause()}
              >
                <Icon name="pause" size={16} /> Pausar
              </button>
            )}
            <button
              type="button"
              className="btn"
              style={{ minHeight: "44px", minWidth: "44px" }}
              onClick={() => void runnerRef.current?.next()}
              aria-label="Siguiente palabra"
            >
              Siguiente <Icon name="skip-forward" size={16} />
            </button>
            <button
              type="button"
              className="btn--quiet"
              style={{ minHeight: "44px" }}
              onClick={handleClose}
            >
              Detener
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
