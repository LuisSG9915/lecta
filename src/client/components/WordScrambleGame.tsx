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

export interface WordScrambleGameProps {
  targetWord: string;
  meaning?: string | null;
  pos?: string | null;
  context?: string | null;
  language?: string;
  disabled?: boolean;
  onSolve: () => void;
  onWrong?: () => void;
  onAskHint?: () => void;
  hintText?: string | null;
  hintBusy?: boolean;
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
}: WordScrambleGameProps) {
  const instanceId = useId();
  const cleanTarget = useMemo(() => targetWord.trim(), [targetWord]);
  const expectedChars = useMemo(
    () => [...cleanTarget].map((c) => c.toUpperCase()),
    [cleanTarget],
  );

  // Inicializa las fichas mezcladas para la palabra actual
  const [tiles, setTiles] = useState<Tile[]>(() => {
    const scrambled = scrambleWord(cleanTarget);
    return scrambled.letters.map((char, index) => ({
      id: `${instanceId}-tile-${index}-${char}`,
      char,
      used: false,
    }));
  });

  // Casillas para armar la palabra
  const [slots, setSlots] = useState<(Slot | null)[]>(() =>
    new Array(expectedChars.length).fill(null),
  );

  const [solved, setSolved] = useState(false);
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<number | null>(null);

  const [prevTarget, setPrevTarget] = useState(cleanTarget);
  if (cleanTarget !== prevTarget) {
    setPrevTarget(cleanTarget);
    const scrambled = scrambleWord(cleanTarget);
    setTiles(
      scrambled.letters.map((char, index) => ({
        id: `${instanceId}-tile-${index}-${char}`,
        char,
        used: false,
      })),
    );
    setSlots(new Array(expectedChars.length).fill(null));
    setSolved(false);
    setShaking(false);
  }

  useEffect(() => {
    return () => {
      if (shakeTimer.current !== null) {
        window.clearTimeout(shakeTimer.current);
      }
    };
  }, []);

  const checkSolution = (currentSlots: (Slot | null)[]) => {
    // Si aún quedan casillas vacías, no verifica todavía
    if (currentSlots.some((s) => s === null)) return;

    const spelled = currentSlots.map((s) => s?.char ?? "").join("");
    const targetUpper = cleanTarget.toUpperCase();

    if (spelled === targetUpper) {
      if (solved) return;
      setSolved(true);
      triggerPurrHaptic();
      playCompanionSound("purr");
      window.setTimeout(() => {
        onSolve();
      }, 700);
    } else {
      setShaking(true);
      triggerHaptic(24);
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
      expectedChar: expectedChars[emptySlotIndex],
      char: tile.char,
      poolId: tile.id,
    };
    setSlots(newSlots);

    checkSolution(newSlots);
  };

  const removeSlot = (slotIndex: number) => {
    if (disabled || solved) return;
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
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i] !== null) {
        removeSlot(i);
        break;
      }
    }
  };

  const clearAllSlots = () => {
    if (disabled || solved) return;
    triggerHaptic(10);
    setTiles((prev) => prev.map((t) => ({ ...t, used: false })));
    setSlots(new Array(expectedChars.length).fill(null));
  };

  const shufflePool = () => {
    if (disabled || solved) return;
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
    // Buscar la primera casilla que esté vacía o que tenga una letra incorrecta
    let targetIndex = -1;
    for (let i = 0; i < expectedChars.length; i++) {
      const slot = slots[i];
      if (!slot || slot.char !== expectedChars[i]) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return;

    const neededChar = expectedChars[targetIndex];

    // Si la casilla actual tiene una letra incorrecta, la liberamos
    const currentWrong = slots[targetIndex];
    let nextTiles = [...tiles];
    if (currentWrong) {
      nextTiles = nextTiles.map((t) =>
        t.id === currentWrong.poolId ? { ...t, used: false } : t,
      );
    }

    // Si la letra que necesitamos ya está colocada en otra casilla incorrecta más adelante, la liberamos
    const nextSlots = [...slots];
    nextSlots[targetIndex] = null;
    for (let j = 0; j < nextSlots.length; j++) {
      if (j !== targetIndex && nextSlots[j]?.char === neededChar && nextSlots[j]?.char !== expectedChars[j]) {
        const stolen = nextSlots[j]!;
        nextTiles = nextTiles.map((t) =>
          t.id === stolen.poolId ? { ...t, used: false } : t,
        );
        nextSlots[j] = null;
        break;
      }
    }

    // Buscar una ficha libre con la letra deseada
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
        removeLastSlot();
        return;
      }

      const key = event.key;
      if (key.length === 1 && /^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]$/i.test(key)) {
        event.preventDefault();
        const normKey = normChar(key);
        // Buscar ficha disponible que coincida exactamente o por versión normalizada
        const match = tiles.find(
          (t) =>
            !t.used &&
            (t.char.toLowerCase() === key.toLowerCase() ||
              normChar(t.char) === normKey),
        );
        if (match) {
          pickTile(match.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, slots, disabled, solved]);

  return (
    <div className="scramble-game">
      <div className="index-card nb-card scramble-card">
        <p className="nb-card-front">
          <span className="scramble-card-prompt">Descifra la palabra:</span>
          {pos ? <span className="card-pos"> · {pos}</span> : null}
        </p>

        {meaning ? (
          <p className="scramble-meaning">
            {conciseMeaning(meaning, 120)}
          </p>
        ) : null}

        {context ? (
          <PracticeContext
            key={cleanTarget}
            text={context}
            target={cleanTarget}
            language={language}
          />
        ) : null}
      </div>

      {/* Casillas de la palabra */}
      <div
        className={`scramble-slots${shaking ? " is-shaking" : ""}${
          solved ? " is-solved" : ""
        }`}
        role="group"
        aria-label="Casillas de la palabra a formar"
      >
        {slots.map((slot, index) => (
          <button
            key={slot ? slot.id : `empty-${index}`}
            type="button"
            className={`scramble-slot${slot ? " is-filled" : " is-empty"}${
              solved ? " is-correct" : ""
            }`}
            disabled={!slot || disabled || solved}
            onClick={() => removeSlot(index)}
            aria-label={
              slot
                ? `Casilla ${index + 1}: letra ${slot.char}. Toca para quitarla.`
                : `Casilla ${index + 1} vacía.`
            }
          >
            {slot ? slot.char : ""}
          </button>
        ))}
      </div>

      {/* Fichas desordenadas disponibles */}
      <div
        className="scramble-pool"
        role="group"
        aria-label="Letras disponibles para ordenar"
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`scramble-tile${tile.used ? " is-used" : ""}`}
            disabled={tile.used || disabled || solved}
            onClick={() => pickTile(tile.id)}
            aria-label={`Letra ${tile.char}`}
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
