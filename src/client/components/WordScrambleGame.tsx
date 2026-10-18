// Minijuego interactivo: Descifrar la palabra (Word Scramble).
// Muestra el significado y contexto del libro, y desordena las letras
// de la palabra en fichas táctiles. El lector puede pulsar las fichas,
// escribir con el teclado, barajar, borrar o pedir pistas.
// Al completar la palabra correctamente, festeja con animación y
// avanza la calificación automáticamente.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { conciseMeaning, scrambleWord } from "../lib/practice";
import { PracticeContext } from "./PracticeContext";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import { speakWord } from "../lib/speech";

export interface WordScrambleGameProps {
  targetWord: string;
  meaning?: string | null;
  pos?: string | null;
  context?: string | null;
  language?: string;
  disabled?: boolean;
  onSolve: (metrics?: {
    responseTimeMs: number;
    errorCount: number;
    usedHint: boolean;
  }) => void;
  onWrong?: () => void;
  onAskHint?: () => void;
  hintText?: string | null;
  hintBusy?: boolean;
  // Fase 2: Consolidación episódica
  chapterSentence?: string | null;
  shortGloss?: string | null;
  timeLimitSeconds?: number | null;
  autoPronounceOnSolve?: boolean;
}

interface Tile {
  id: string;
  char: string;
  used: boolean;
}

interface Slot {
  id: string;
  expectedChar: string;
  char: string;
  poolId: string;
}

const normChar = (c: string) =>
  c.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * Divide la palabra en bloques silábicos de 2-3 letras para palabras largas (> 7 letras)
 * para evitar que descifrar una palabra extensa sea visualmente abrumador.
 */
export function splitWordIntoSyllables(word: string): string[] {
  const clean = word.trim();
  if (clean.length <= 7) return [...clean];

  const pattern =
    /[^aeiouáéíóúü]*[aeiouáéíóúü]+(?:[^aeiouáéíóúü]+(?=[^aeiouáéíóúü][aeiouáéíóúü])|[^aeiouáéíóúü]+(?=$))?/gi;
  const rawMatches = clean.match(pattern);
  let matches: string[];
  if (!rawMatches || rawMatches.join("").toLowerCase() !== clean.toLowerCase()) {
    matches = [];
    let i = 0;
    while (i < clean.length) {
      const rem = clean.length - i;
      const size = rem === 4 || rem === 2 ? 2 : rem >= 3 ? 3 : rem;
      matches.push(clean.slice(i, i + size));
      i += size;
    }
  } else {
    matches = [...rawMatches];
  }

  const merged: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const chunk = matches[i];
    if (chunk.length === 1 && merged.length > 0) {
      merged[merged.length - 1] += chunk;
    } else if (chunk.length === 1 && i + 1 < matches.length) {
      matches[i + 1] = chunk + matches[i + 1];
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

export function scrambleChunks(chunks: string[]): string[] {
  const upper = chunks.map((c) => c.toUpperCase());
  if (upper.length <= 1) return upper;
  const copy = [...upper];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (copy.every((c, idx) => c === upper[idx])) {
    const temp = copy[0];
    copy[0] = copy[1];
    copy[1] = temp;
  }
  return copy;
}

export function WordScrambleGame({
  targetWord,
  meaning,
  pos,
  context,
  language = "es",
  disabled = false,
  onSolve,
  onWrong,
  onAskHint,
  hintText,
  hintBusy,
  chapterSentence,
  shortGloss,
  timeLimitSeconds,
  autoPronounceOnSolve = true,
}: WordScrambleGameProps) {
  const instanceId = useId();
  const cleanTarget = useMemo(() => targetWord.trim(), [targetWord]);
  const isSyllableMode = cleanTarget.length > 7;
  const effectiveContext = chapterSentence ?? context;
  const effectiveMeaning = shortGloss ?? meaning;
  const isForeign = Boolean(language && !language.toLowerCase().startsWith("es"));

  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    timeLimitSeconds !== undefined && timeLimitSeconds !== null
      ? timeLimitSeconds
      : null,
  );

  const [prevTimerKey, setPrevTimerKey] = useState(
    () => `${cleanTarget}:${timeLimitSeconds ?? "none"}`,
  );
  const currentTimerKey = `${cleanTarget}:${timeLimitSeconds ?? "none"}`;
  if (currentTimerKey !== prevTimerKey) {
    setPrevTimerKey(currentTimerKey);
    setSecondsLeft(
      timeLimitSeconds !== undefined && timeLimitSeconds !== null
        ? timeLimitSeconds
        : null,
    );
  }

  const expectedChunks = useMemo(
    () => splitWordIntoSyllables(cleanTarget).map((c) => c.toUpperCase()),
    [cleanTarget],
  );

  // Inicializa las fichas mezcladas (letras individuales o sílabas si > 7 letras)
  const [tiles, setTiles] = useState<Tile[]>(() => {
    const scrambled =
      cleanTarget.length <= 7
        ? scrambleWord(cleanTarget).letters
        : scrambleChunks(expectedChunks);
    return scrambled.map((char, index) => ({
      id: `${instanceId}-tile-${index}-${char}`,
      char,
      used: false,
    }));
  });

  // Casillas para armar la palabra
  const [slots, setSlots] = useState<(Slot | null)[]>(() =>
    new Array(expectedChunks.length).fill(null),
  );

  const [solved, setSolved] = useState(false);
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (secondsLeft === null || solved || disabled || secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft, solved, disabled]);

  const startTimeRef = useRef<number>(0);
  const errorCountRef = useRef<number>(0);
  const usedHintRef = useRef<boolean>(false);

  // Auto-ayuda por inactividad: si pasan 8s sin tocar ninguna ficha, hacer brillar la primera ficha correcta
  const [idleHintId, setIdleHintId] = useState<string | null>(null);
  const idleTimer = useRef<number | null>(null);

  const [prevTarget, setPrevTarget] = useState(cleanTarget);
  if (cleanTarget !== prevTarget) {
    setPrevTarget(cleanTarget);
    const newExpected = splitWordIntoSyllables(cleanTarget).map((c) => c.toUpperCase());
    const scrambled =
      cleanTarget.length <= 7
        ? scrambleWord(cleanTarget).letters
        : scrambleChunks(newExpected);
    setTiles(
      scrambled.map((char, index) => ({
        id: `${instanceId}-tile-${index}-${char}`,
        char,
        used: false,
      })),
    );
    setSlots(new Array(newExpected.length).fill(null));
    setSolved(false);
    setShaking(false);
    setIdleHintId(null);
  }

  useEffect(() => {
    startTimeRef.current = Date.now();
    errorCountRef.current = 0;
    usedHintRef.current = false;
  }, [cleanTarget]);

  useEffect(() => {
    return () => {
      if (shakeTimer.current !== null) {
        window.clearTimeout(shakeTimer.current);
      }
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, []);

  // Temporizador de inactividad de 8 segundos
  useEffect(() => {
    if (disabled || solved) return;
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
    }
    idleTimer.current = window.setTimeout(() => {
      const nextSlotIdx = slots.findIndex((s) => s === null);
      if (nextSlotIdx !== -1) {
        const nextExpected = expectedChunks[nextSlotIdx];
        const matchingTile = tiles.find(
          (t) => !t.used && t.char === nextExpected,
        );
        if (matchingTile) {
          setIdleHintId(matchingTile.id);
        }
      }
    }, 8000);

    return () => {
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, [slots, tiles, expectedChunks, disabled, solved]);

  const checkSolution = (currentSlots: (Slot | null)[]) => {
    // Si aún quedan casillas vacías, no verifica todavía
    if (currentSlots.some((s) => s === null)) return;

    const spelled = currentSlots.map((s) => s?.char ?? "").join("");
    const targetUpper = cleanTarget.toUpperCase();

    if (spelled === targetUpper) {
      if (solved) return;
      setSolved(true);
      setIdleHintId(null);
      triggerPurrHaptic();
      playCompanionSound("purr");
      if (isForeign && autoPronounceOnSolve !== false) {
        void speakWord(cleanTarget, language).catch(() => {});
      }
      const elapsed =
        startTimeRef.current > 0
          ? Math.max(100, Date.now() - startTimeRef.current)
          : 500;
      const metrics = {
        responseTimeMs: elapsed,
        errorCount: errorCountRef.current,
        usedHint: usedHintRef.current,
      };
      window.setTimeout(() => {
        onSolve(metrics);
      }, 700);
    } else {
      setShaking(true);
      triggerHaptic(24);
      errorCountRef.current += 1;
      onWrong?.();
      if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => {
        setShaking(false);
        shakeTimer.current = null;
      }, 650);
    }
  };

  const pickTile = (tileId: string) => {
    if (disabled || solved) return;
    setIdleHintId(null);
    const tileIndex = tiles.findIndex((t) => t.id === tileId);
    if (tileIndex === -1 || tiles[tileIndex].used) return;

    // Buscar la primera casilla libre
    const emptySlotIndex = slots.findIndex((s) => s === null);
    if (emptySlotIndex === -1) return;

    triggerHaptic(12);

    const tile = tiles[tileIndex];
    const newTiles = [...tiles];
    newTiles[tileIndex] = { ...tile, used: true };
    setTiles(newTiles);

    const newSlots = [...slots];
    newSlots[emptySlotIndex] = {
      id: `${instanceId}-slot-${emptySlotIndex}`,
      expectedChar: expectedChunks[emptySlotIndex],
      char: tile.char,
      poolId: tile.id,
    };
    setSlots(newSlots);

    checkSolution(newSlots);
  };

  const removeSlot = (slotIndex: number) => {
    if (disabled || solved) return;
    setIdleHintId(null);
    const slot = slots[slotIndex];
    if (!slot) return;

    triggerHaptic(8);

    // Devolver ficha a disponibles
    setTiles((prev) =>
      prev.map((t) => (t.id === slot.poolId ? { ...t, used: false } : t)),
    );

    const newSlots = [...slots];
    newSlots[slotIndex] = null;
    setSlots(newSlots);
  };

  const removeLastSlot = () => {
    if (disabled || solved) return;
    setIdleHintId(null);
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i] !== null) {
        removeSlot(i);
        break;
      }
    }
  };

  const clearAllSlots = () => {
    if (disabled || solved) return;
    setIdleHintId(null);
    triggerHaptic(10);
    setTiles((prev) => prev.map((t) => ({ ...t, used: false })));
    setSlots(new Array(expectedChunks.length).fill(null));
  };

  const shufflePool = () => {
    if (disabled || solved) return;
    setIdleHintId(null);
    triggerHaptic(10);
    setTiles((prev) => {
      const unused = prev.filter((t) => !t.used);
      const used = prev.filter((t) => t.used);
      // Mezcla los no usados
      const shuffledUnused = [...unused].sort(() => Math.random() - 0.5);
      return [...used, ...shuffledUnused];
    });
  };

  const provideNextLetterHint = () => {
    if (disabled || solved) return;
    usedHintRef.current = true;
    setIdleHintId(null);
    // Buscar la primera casilla que esté vacía o que tenga una letra/sílaba incorrecta
    let targetIndex = -1;
    for (let i = 0; i < expectedChunks.length; i++) {
      const slot = slots[i];
      if (!slot || slot.char !== expectedChunks[i]) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return;

    const neededChar = expectedChunks[targetIndex];

    // Si la casilla actual tiene una ficha incorrecta, la liberamos
    const currentWrong = slots[targetIndex];
    let nextTiles = [...tiles];
    if (currentWrong) {
      nextTiles = nextTiles.map((t) =>
        t.id === currentWrong.poolId ? { ...t, used: false } : t,
      );
    }

    // Si la ficha que necesitamos ya está colocada en otra casilla incorrecta más adelante, la liberamos
    const nextSlots = [...slots];
    nextSlots[targetIndex] = null;
    for (let j = 0; j < nextSlots.length; j++) {
      if (
        j !== targetIndex &&
        nextSlots[j]?.char === neededChar &&
        nextSlots[j]?.char !== expectedChunks[j]
      ) {
        const stolen = nextSlots[j]!;
        nextTiles = nextTiles.map((t) =>
          t.id === stolen.poolId ? { ...t, used: false } : t,
        );
        nextSlots[j] = null;
        break;
      }
    }

    // Buscar una ficha libre con el bloque deseado
    const freeTileIndex = nextTiles.findIndex(
      (t) => !t.used && t.char === neededChar,
    );
    if (freeTileIndex === -1) return;

    triggerHaptic(14);
    const tile = nextTiles[freeTileIndex];
    nextTiles[freeTileIndex] = { ...tile, used: true };

    nextSlots[targetIndex] = {
      id: `${instanceId}-slot-${targetIndex}`,
      expectedChar: neededChar,
      char: tile.char,
      poolId: tile.id,
    };

    setTiles(nextTiles);
    setSlots(nextSlots);
    checkSolution(nextSlots);
  };

  // Soporte de teclado (escribir letras directamente o borrar con Backspace)
  useEffect(() => {
    if (disabled || solved) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        setIdleHintId(null);
        removeLastSlot();
        return;
      }

      const key = event.key;
      if (key.length === 1 && /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]$/i.test(key)) {
        event.preventDefault();
        const normKey = normChar(key);
        // Buscar ficha disponible que coincida exactamente o comience con esa letra
        const match = tiles.find((t) => {
          if (t.used) return false;
          if (
            t.char.toLowerCase() === key.toLowerCase() ||
            normChar(t.char) === normKey
          ) {
            return true;
          }
          if (
            isSyllableMode &&
            t.char.length > 0 &&
            (t.char[0].toLowerCase() === key.toLowerCase() ||
              normChar(t.char[0]) === normKey)
          ) {
            return true;
          }
          return false;
        });
        if (match) {
          setIdleHintId(null);
          pickTile(match.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, slots, disabled, solved, isSyllableMode]);

  return (
    <div className="scramble-game">
      {secondsLeft !== null ? (
        <div
          className="scramble-timer"
          role="timer"
          aria-label={`Tiempo restante: ${secondsLeft} segundos`}
        >
          <span
            className={`scramble-timer-badge${secondsLeft <= 3 ? " is-urgent" : ""}`}
          >
            ⏱️ {secondsLeft}s
          </span>
          <div className="scramble-timer-track">
            <div
              className={`scramble-timer-fill${secondsLeft <= 3 ? " is-urgent" : ""}`}
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, (secondsLeft / (timeLimitSeconds || 10)) * 100),
                )}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="index-card nb-card scramble-card">
        <p className="nb-card-front">
          <span className="scramble-card-prompt">Alquimia de Palabras</span>
          {pos ? <span className="card-pos"> · {pos}</span> : null}
        </p>

        {effectiveMeaning ? (
          <p className="scramble-meaning">
            {conciseMeaning(effectiveMeaning, 120)}
          </p>
        ) : null}

        {effectiveContext ? (
          <PracticeContext
            key={cleanTarget}
            text={effectiveContext}
            target={cleanTarget}
            language={language}
            slotTarget={true}
          />
        ) : null}
      </div>

      {/* Casillas de la palabra */}
      <div
        className={`scramble-slots${shaking ? " is-shaking" : ""}${
          solved ? " is-solved" : ""
        }${isSyllableMode ? " is-syllables" : ""}`}
        role="group"
        aria-label="Casillas de la palabra a formar"
      >
        {slots.map((slot, index) => (
          <button
            key={slot ? slot.id : `empty-${index}`}
            type="button"
            className={`scramble-slot${slot ? " is-filled" : " is-empty"}${
              isSyllableMode ? " is-syllable" : ""
            }${solved ? " is-correct" : ""}`}
            disabled={!slot || disabled || solved}
            onClick={() => {
              setIdleHintId(null);
              removeSlot(index);
            }}
            aria-label={
              slot
                ? `Casilla ${index + 1}: ${isSyllableMode ? "sílaba" : "letra"} ${slot.char}. Toca para quitarla.`
                : `Casilla ${index + 1} vacía.`
            }
          >
            {slot ? slot.char : ""}
          </button>
        ))}
      </div>

      {/* Fichas desordenadas disponibles */}
      <div
        className={`scramble-pool${isSyllableMode ? " is-syllables" : ""}`}
        role="group"
        aria-label="Letras o sílabas disponibles para ordenar"
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`scramble-tile${tile.used ? " is-used" : ""}${
              isSyllableMode ? " is-syllable" : ""
            }${idleHintId === tile.id ? " pulse-hint" : ""}`}
            disabled={tile.used || disabled || solved}
            onClick={() => {
              setIdleHintId(null);
              pickTile(tile.id);
            }}
            aria-label={`${isSyllableMode ? "Sílaba" : "Letra"} ${tile.char}`}
          >
            {tile.char}
          </button>
        ))}
      </div>

      {/* Barra de acciones rápidas */}
      <div className="scramble-actions">
        <button
          type="button"
          className="btn btn--quiet scramble-action-btn"
          disabled={disabled || solved}
          onClick={shufflePool}
          title="Mezclar fichas restantes"
        >
          <span aria-hidden="true">🔀</span> Barajar
        </button>

        <button
          type="button"
          className="btn btn--quiet scramble-action-btn"
          disabled={disabled || solved || slots.every((s) => s === null)}
          onClick={removeLastSlot}
          title="Borrar última letra (o pulsa Backspace)"
        >
          <span aria-hidden="true">⌫</span> Borrar
        </button>

        <button
          type="button"
          className="btn btn--quiet scramble-action-btn"
          disabled={disabled || solved || slots.every((s) => s === null)}
          onClick={clearAllSlots}
          title="Reiniciar todas las letras"
        >
          Reiniciar
        </button>

        <button
          type="button"
          className="btn btn--quiet scramble-action-btn"
          disabled={disabled || solved || hintBusy}
          onClick={() => {
            provideNextLetterHint();
            onAskHint?.();
          }}
          title="Colocar la siguiente letra correcta o pedir pista"
        >
          <span aria-hidden="true">💡</span> Pista
        </button>
      </div>

      {hintText ? (
        <p className="scramble-hint-box" role="status">
          <strong>Pista:</strong> {hintText}
        </p>
      ) : null}

      <p className="meta nb-keys-hint">
        Toca las fichas o escribe directamente con el teclado.
      </p>
    </div>
  );
}
