import { useEffect, useState } from "react";
import type { LexiconEntry } from "../lib/lexicon";
import { enrichWord, explainInContext, lookupWord, reportSense } from "../lib/lexicon";
import { Rating, scheduleReview } from "../lib/fsrs";
import {
  captureDbScope,
  loadSavedWord,
  removeSavedWord,
  saveKnowledge,
  saveWordWithKnowledge,
  updateSavedWord,
  wordKey,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { pushWordsToServer } from "../lib/vocab";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { recordReview } from "../lib/reviews";
import { loadUseAi } from "../lib/ai-pref";
import { loadNativeLanguage } from "../lib/settings";
import { award, localDayKey } from "../lib/game";
import { triggerHaptic } from "../lib/haptics";
import { speakWord } from "../lib/speech";
import Sheet from "./Sheet";
import Icon from "./Icon";

import type { PhraseHit } from "../lib/phrases";

type WordPanelProps = {
  word: string;
  context?: string;
  // Locución del Wikcionario que cubre la palabra en su oración;
  // es información de contexto — no cambia lo que se guarda ni
  // el modelo de repaso.
  phrase?: PhraseHit;
  // Sesión confirmada: sin ella los botones de IA muestran el aviso
  // de entrada en vez de fallar tras la espera.
  canExplain?: boolean;
  language: string;
  bookHash: string;
  onClose: () => void;
  onSaved: (word: SavedWord) => void;
  onRemoved?: (word: SavedWord) => void;
  // Evidencia persistida (guardada → «saved», «Ya la conocía» →
  // «declared»): quien lleva el perfil la aplica al modelo y
  // remarca el texto sin esperar la próxima carga. `kind` conserva
  // la acción real aunque la fusión haya mantenido una fila previa.
  onKnowledgeChanged?: (
    row: KnownWord,
    context: { form: string; kind: "saved" | "declared" },
  ) => void;
};

type LookupState =
  | { kind: "loading" }
  | { kind: "found"; entries: LexiconEntry[]; offline?: boolean }
  | { kind: "notFound" }
  | { kind: "enriching" }
  | { kind: "error"; message: string; offline?: boolean };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// La oración-hábitat con la palabra marcada en bermellón.
function ContextQuote({ context, word }: { context: string; word: string }) {
  const parts = context.split(new RegExp(`(${escapeRegExp(word)})`, "i"));
  return (
    <p className="card-context">
      “
      {parts.map((part, index) =>
        index % 2 ? (
          <mark key={index} className="ctx-word">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
      ”
    </p>
  );
}

export default function WordPanel({
  word,
  context,
  phrase,
  canExplain = true,
  language,
  bookHash,
  onClose,
  onSaved,
  onRemoved,
  onKnowledgeChanged,
}: WordPanelProps) {
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [savedEntry, setSavedEntry] = useState<SavedWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [syncNote, setSyncNote] = useState(false);
  // Acepción elegida dentro de la ficha (índice de entrada + acepción).
  const [selected, setSelected] = useState({ entryIndex: 0, senseIndex: 0 });
  const [report, setReport] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [reread, setReread] = useState<"idle" | "busy" | "done">("idle");
  // «Explicar en esta oración»: respuesta IA puntual sobre el sentido
  // de la palabra en el contexto leído (no escribe al catálogo).
  // degraded: la IA no respondió y se sirvió la acepción del catálogo.
  const [explanation, setExplanation] = useState<
    { state: "busy" | "done" | "error"; text: string; degraded?: boolean } | null
  >(null);
  // Preferencia «Usar IA» (Cuenta): una sola lectura por apertura de
  // la ficha. Con ella apagada «Definir con IA» ni se ofrece; el
  // catálogo (lookupWord) no usa IA y sigue igual.
  const [useAi, setUseAi] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadUseAi(captureDbScope()).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const [stored, result] = await Promise.all([
        loadSavedWord(language, word, scope),
        lookupWord(word, language, scope),
      ]);
      if (cancelled) return;
      if (stored) setSavedEntry(stored);
      // Ficha nueva: la acepción elegida vuelve a la primera.
      setSelected({ entryIndex: 0, senseIndex: 0 });
      setReport("idle");
      setExplanation(null);
      if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
      else if (!result.found) setLookup({ kind: "notFound" });
      else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
      // Consultar es un acto neutral: no deja evidencia de
      // conocimiento (el trayecto sí la anota como consulta).
    })();
    return () => {
      cancelled = true;
    };
  }, [word, language]);

  const primary = lookup.kind === "found" ? lookup.entries[0] : undefined;
  const totalSenses =
    lookup.kind === "found"
      ? lookup.entries.reduce((count, entry) => count + entry.senses.length, 0)
      : 0;
  const multiSense = totalSenses > 1;

  // Entrada y acepción elegidas (cae a la primera si el índice quedó
  // fuera de rango tras un nuevo resultado).
  const entries = lookup.kind === "found" ? lookup.entries : [];
  const chosenEntry = entries[selected.entryIndex] ?? entries[0];
  const chosenSense = chosenEntry?.senses[selected.senseIndex] ?? chosenEntry?.senses[0];

  const enrich = async () => {
    setLookup({ kind: "enriching" });
    const result = await enrichWord(word, language, context, captureDbScope(), loadNativeLanguage());
    if (!result.ok) setLookup({ kind: "error", message: result.error });
    else setLookup({ kind: "found", entries: result.entries });
  };

  const explain = async () => {
    if (!context || explanation?.state === "busy") return;
    setExplanation({ state: "busy", text: "" });
    const result = await explainInContext(
      word,
      language,
      context,
      captureDbScope(),
      loadNativeLanguage(),
    );
    setExplanation(
      result.ok
        ? { state: "done", text: result.explanation, degraded: result.degraded }
        : { state: "error", text: result.error },
    );
  };

  // Guarda la palabra con la acepción elegida junto a su evidencia
  // «todavía no la sé» en una sola transacción: nunca queda la
  // palabra sin la señal para el modelo (ni al revés).
  const persist = async () => {
    const scope = captureDbScope();
    const { word: entry, knowledge } = await saveWordWithKnowledge({
      word: {
        form: word,
        lemma: chosenEntry?.lemma,
        pos: chosenEntry?.pos,
        meaning: chosenSense?.definition,
        senseEntryId: chosenEntry?.entryId,
        senseOrder: chosenSense?.senseOrder,
        language,
        context,
        bookHash,
      },
      knowledge: {
        language,
        lemma: (chosenEntry?.lemma ?? word).toLowerCase(),
        known: false,
        source: "saved",
      },
    }, scope);
    setSavedEntry(entry);
    triggerHaptic(14);
    onSaved(entry);
    // El premio queda ligado a la fila guardada (key + sello): re-guardar
    // la misma palabra no infla el journal — la fila se fusiona y su
    // updatedAt solo cambia si hubo algo nuevo que persistir.
    const awardedAt = Date.now();
    void award({ kind: "saved", zipf: chosenEntry?.zipf ?? null }, scope, {
      id: `saved:${entry.key}:${entry.updatedAt ?? entry.savedAt}`,
      at: awardedAt,
      dayKey: localDayKey(awardedAt),
    });
    if (knowledge) {
      onKnowledgeChanged?.(knowledge, { form: word, kind: "saved" });
      void pushKnowledgeToServer([knowledge], scope);
    }
    // La palabra ya está a salvo localmente; si el envío falla lo
    // decimos sin fingir sincronización.
    const pushed = await pushWordsToServer([entry], scope);
    if (!pushed) setSyncNote(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      await persist();
    } catch {
      setSaveError("No se pudo guardar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // «Ya la conocía»: la palabra NO va al cuaderno ni crea tarjeta —
  // solo deja la evidencia declarada (alimenta el perfil léxico) y
  // su anotación en el historial; la ficha se cierra en el acto.
  const declareKnown = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSyncNote(false);
    try {
      const scope = captureDbScope();
      const lemma = (chosenEntry?.lemma ?? word).toLowerCase();
      const row = await saveKnowledge(
        {
          language,
          lemma,
          known: true,
          source: "declared",
        },
        scope,
      );
      void pushKnowledgeToServer([row], scope);
      void recordReview(
        {
          language,
          form: word,
          kind: "declared",
          rating: "known",
        },
        scope,
      ).catch(() => {
        /* el historial es auxiliar; no deshace la marca */
      });
      triggerHaptic(10);
      onKnowledgeChanged?.(row, { form: word, kind: "declared" });
      onClose();
    } catch {
      setSaveError("No se pudo guardar la marca. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const scope = captureDbScope();
      const tombstone = await removeSavedWord(wordKey(language, word), scope);
      if (tombstone) {
        setSavedEntry(null);
        setReread("idle");
        onRemoved?.(tombstone);
        void pushWordsToServer([tombstone], scope);
      }
    } catch {
      setSaveError("No se pudo quitar la palabra. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  // Reporta que la acepción elegida no corresponde a esta oración.
  // Requiere entryId y senseOrder del catálogo: sin ellos no hay fila
  // que marcar y el botón ni se muestra.
  const reportSelected = async () => {
    if (chosenEntry?.entryId == null || chosenSense?.senseOrder == null) return;
    if (report === "sending") return;
    setReport("sending");
    const result = await reportSense(
      chosenEntry.entryId,
      chosenSense.senseOrder,
      captureDbScope(),
    );
    setReport(result.ok ? "done" : "error");
  };

  // ¿La recordó al verla marcada? Actualiza la tarjeta como un repaso
  // más: Sí = Bien, No = Otra vez.
  const markReread = async (remembered: boolean) => {
    if (!savedEntry || reread !== "idle") return;
    setReread("busy");
    try {
      const scope = captureDbScope();
      const card = scheduleReview(savedEntry.card, remembered ? Rating.Good : Rating.Again);
      const stored = await updateSavedWord({ ...savedEntry, card }, scope);
      setSavedEntry(stored);
      void pushWordsToServer([stored], scope);
      void recordReview(
        {
          language,
          form: word,
          kind: "reread",
          rating: remembered ? "good" : "again",
        },
        scope,
      ).catch(() => {
        /* el historial es auxiliar; no deshace el repaso */
      });
      setReread("done");
    } catch {
      setSaveError("No se pudo anotar el repaso. Intenta de nuevo.");
      setReread("idle");
    }
  };

  return (
    <Sheet label={`Palabra ${word}`} onClose={onClose} side="right" variant="peek">
      <div className="sheet-head">
        <strong className="sheet-title">
          {word}
          {primary?.pos ? <span className="card-pos"> · {primary.pos}</span> : null}
          <button
            type="button"
            className="btn--pronounce"
            aria-label={`Pronunciar ${word}`}
            title="Escuchar pronunciación"
            onClick={() => void speakWord(word, language)}
          >
            <Icon name="speaker" size={16} />
          </button>
        </strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar ficha"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {context ? <ContextQuote context={context} word={word} /> : null}

      {phrase ? (
        <div className="phrase-hit">
          <p className="meta">En esta frase</p>
          <p className="phrase-hit-lemma">
            «{phrase.lemma}»
            {phrase.pos ? <span className="card-pos"> · {phrase.pos}</span> : null}
          </p>
          <ol className="senses">
            {phrase.definitions.map((definition, index) => (
              <li key={index}>{definition}</li>
            ))}
          </ol>
          <p className="meta phrase-hit-source">Wikcionario</p>
        </div>
      ) : null}

      {lookup.kind === "loading" ? <p className="meta">Buscando en el catálogo…</p> : null}
      {lookup.kind === "enriching" ? <p className="meta">Consultando la ficha…</p> : null}
      {lookup.kind === "error" ? (
        <>
          <p role="alert" className={`status${lookup.offline ? " status--offline" : ""}`}>
            {lookup.message}
          </p>
          {lookup.offline ? (
            <p className="meta">
              Puedes guardar la palabra en tu Cuaderno; su definición se completará automáticamente al reconectarte.
            </p>
          ) : null}
          <button
            type="button"
            className="btn--quiet"
            onClick={() => {
              setLookup({ kind: "loading" });
              void lookupWord(word, language, captureDbScope()).then((result) => {
                if (!result.ok) setLookup({ kind: "error", message: result.error, offline: result.offline });
                else if (!result.found) setLookup({ kind: "notFound" });
                else setLookup({ kind: "found", entries: result.entries, offline: result.offline });
              });
            }}
          >
            Intentar de nuevo
          </button>
        </>
      ) : null}
      {lookup.kind === "notFound" ? (
        <>
          <p className="meta">Aún no está en el catálogo.</p>
          {typeof navigator !== "undefined" && !navigator.onLine ? (
            <p className="meta">
              Sin conexión a internet. Puedes guardar la palabra para definirla al reconectar.
            </p>
          ) : useAi ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={!canExplain}
                onClick={() => void enrich()}
              >
                Definir con IA
              </button>
              {!canExplain ? (
                <p className="meta">Inicia sesión para pedir explicaciones.</p>
              ) : null}
            </>
          ) : (
            <p className="meta">
              Las definiciones con IA están apagadas; actívalas en Cuenta.
            </p>
          )}
        </>
      ) : null}
      {lookup.kind === "found" ? (
        <>
          {lookup.offline ? (
            <p className="meta meta--offline">
              <span className="offline-dot" aria-hidden="true">●</span> Memoria local · Disponible sin conexión
            </p>
          ) : null}
          {multiSense ? (
            <p className="meta">Elige la acepción que corresponde a esta oración:</p>
          ) : null}
          {lookup.entries.map((entry, entryIndex) => (
            <div key={`${entry.lemma}:${entry.pos ?? ""}`} className="word-entry">
              {entry.lemma !== word ? (
                <p className="meta">Forma de «{entry.lemma}»</p>
              ) : null}
              <ol className="senses">
                {entry.senses.map((sense, senseIndex) =>
                  multiSense ? (
                    <li key={senseIndex}>
                      <button
                        type="button"
                        className={`sense-option${
                          selected.entryIndex === entryIndex &&
                          selected.senseIndex === senseIndex
                            ? " is-selected"
                            : ""
                        }`}
                        aria-pressed={
                          selected.entryIndex === entryIndex &&
                          selected.senseIndex === senseIndex
                        }
                        onClick={() => {
                          setSelected({ entryIndex, senseIndex });
                          setReport("idle");
                        }}
                      >
                        {sense.definition}
                      </button>
                    </li>
                  ) : (
                    <li key={senseIndex}>{sense.definition}</li>
                  ),
                )}
              </ol>
            </div>
          ))}
          {useAi && context ? (
            explanation?.state === "done" ? (
              <p className="meta">
                {explanation.degraded
                  ? "La IA no respondió; acepción del catálogo: "
                  : "En esta oración: "}
                {explanation.text}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="btn--quiet"
                  disabled={!canExplain || explanation?.state === "busy" || (typeof navigator !== "undefined" && !navigator.onLine)}
                  onClick={() => void explain()}
                >
                  {explanation?.state === "busy"
                    ? "Consultando…"
                    : "Explicar en esta oración con IA"}
                </button>
                {typeof navigator !== "undefined" && !navigator.onLine ? (
                  <p className="meta">Las explicaciones con IA requieren conexión a internet.</p>
                ) : !canExplain ? (
                  <p className="meta">Inicia sesión para pedir explicaciones.</p>
                ) : null}
                {explanation?.state === "error" ? (
                  <p role="alert" className="status">
                    {explanation.text}
                  </p>
                ) : null}
              </>
            )
          ) : null}
          {chosenEntry?.entryId != null && chosenSense?.senseOrder != null ? (
            report === "done" ? (
              <p className="meta">Gracias, lo anotamos.</p>
            ) : (
              <>
                <button
                  type="button"
                  className="btn--quiet"
                  disabled={report === "sending"}
                  onClick={() => void reportSelected()}
                >
                  {report === "sending" ? "Enviando…" : "Esta explicación no corresponde"}
                </button>
                {report === "error" ? (
                  <p role="alert" className="status">
                    No se pudo enviar. Intenta de nuevo.
                  </p>
                ) : null}
              </>
            )
          ) : null}
        </>
      ) : null}

      <div className="actions">
        {savedEntry ? (
          <>
            <button type="button" className="btn btn--primary" disabled>
              En tu cuaderno
            </button>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => void remove()}
              disabled={saving}
            >
              Quitar
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Guardando…" : "Guardar palabra"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void declareKnown()}
              disabled={saving}
            >
              Ya la conocía
            </button>
          </>
        )}
      </div>
      {!savedEntry && lookup.kind !== "found" ? (
        <p className="meta">Se guardará sin ficha; podrás repasarla cuando tenga definición.</p>
      ) : null}
      {saveError ? (
        <p role="alert" className="status">
          {saveError}
        </p>
      ) : null}
      {syncNote ? (
        <p className="meta">Se guardó en este dispositivo; se sincroniza al volver la conexión.</p>
      ) : null}

      {savedEntry ? (
        reread === "done" ? (
          <p className="meta">Anotado.</p>
        ) : (
          <div className="reread">
            <p className="meta">¿La recordaste al verla marcada?</p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={reread === "busy"}
                onClick={() => void markReread(true)}
              >
                Sí
              </button>
              <button
                type="button"
                className="btn"
                disabled={reread === "busy"}
                onClick={() => void markReread(false)}
              >
                No
              </button>
            </div>
          </div>
        )
      ) : null}
    </Sheet>
  );
}
