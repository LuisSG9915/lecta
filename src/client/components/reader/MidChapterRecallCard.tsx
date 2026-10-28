import { useEffect, useRef } from "react";
import { SentenceBuilderGame } from "../SentenceBuilderGame";
import type { EpisodicWordItem } from "../../lib/practice";

export interface MidChapterRecallCardProps {
  item: EpisodicWordItem;
  onSolve: () => void;
  onSkip: () => void;
}

export function MidChapterRecallCard({ item, onSolve, onSkip }: MidChapterRecallCardProps) {
  // El lector puede entrar a la sección con un desplazamiento heredado: sin
  // esto, el repaso queda arriba de la vista y se pierde.
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <section
      ref={ref}
      aria-label="Repaso antes de leer"
      style={{
        margin: "var(--s-3) 0",
        padding: "var(--s-3)",
        background: "var(--paper-sunken)",
        borderRadius: "var(--r-sm)",
      }}
    >
      <p className="meta" style={{ margin: "0 0 var(--s-2)" }}>
        Antes de leer: completa la palabra que guardaste y ya toca repasar.
      </p>
      <SentenceBuilderGame
        key={`recall-${item.lemma}`}
        targetWord={item.surfaceForm || item.lemma}
        chapterSentence={item.chapterSentence}
        shortGloss={item.shortGloss}
        language={item.lang}
        mode="cloze"
        onSolve={() => onSolve()}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--s-2)" }}>
        <button type="button" className="btn--quiet" onClick={onSkip}>
          Saltar
        </button>
      </div>
    </section>
  );
}
