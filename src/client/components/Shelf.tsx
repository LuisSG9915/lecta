import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  captureDbScope,
  listIntervals,
  listPositions,
  listReadingDays,
  listSavedWords,
  listStoredBooks,
  loadLatestBookHash,
  loadSessionValue,
  updateBookMeta,
  type SavedBookPosition,
  type StoredBook,
} from "../lib/idb";
import { displayTitle, readBookMeta } from "../lib/cover";
import { relativeDay } from "../lib/relative-time";
import {
  parseReadingGoal,
  READING_GOAL_KEY,
  weeklyGoalProgress,
  type WeeklyGoalProgress,
} from "../lib/reading-goal";
import { loadActivityHidden } from "../lib/settings";
import { levelProgress } from "../lib/gamification";
import BookCover from "./BookCover";
import { CompanionButton } from "./CompanionButton";
import { useCompanion } from "./CompanionProvider";

// Ítem de la estantería: lo que hace falta para dibujar la tarjeta,
// sin el archivo. remoteOnly marca los que existen en la cuenta pero
// no en este dispositivo (se descargan al abrirlos); pendingUpload
// marca los que aún tienen una subida encolada.
export type ShelfItem = Pick<
  StoredBook,
  "hash" | "name" | "addedAt" | "title" | "author" | "cover" | "sectionCount" | "language"
> & { remoteOnly?: boolean; pendingUpload?: boolean };

type ShelfProps = {
  library: ShelfItem[];
  checking: boolean;
  onOpen: (book: ShelfItem) => void;
  onRemove: (hash: string) => void;
  onAdd: (file: File) => void;
  onLibraryChange: () => void;
  // Sube cuando la sincronización trae intervalos nuevos: la meta de
  // la semana relee su progreso sin recargar la estantería.
  activityVersion?: number;
};

const DAY_MS = 86_400_000;
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// El saludo del gato ocurre una sola vez por sesión visible de la
// app: la estantería se desmonta al abrir un libro, así que la marca
// vive en el módulo — sobrevive a ese remontaje y muere con la app.
const SHELF_GREET_MS = 4_000;
let shelfGreetedThisSession = false;
export function takeShelfGreeting(): boolean {
  if (shelfGreetedThisSession) return false;
  shelfGreetedThisSession = true;
  return true;
}

// La misma fracción que guarda el lector; posiciones antiguas sin
// «progress» caen al índice de sección, sin mínimos inventados.
const progressOf = (position: SavedBookPosition | undefined, sectionCount: number | undefined) =>
  position && sectionCount
    ? (position.progress ?? Math.min(1, position.sectionIndex / sectionCount))
    : 0;

export default function Shelf({ library, checking, onOpen, onRemove, onAdd, onLibraryChange, activityVersion = 0 }: ShelfProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [wordCounts, setWordCounts] = useState<Map<string, number>>(new Map());
  const [latestHash, setLatestHash] = useState<string | undefined>(undefined);
  const [weekDays, setWeekDays] = useState<{ day: number; read: boolean }[]>([]);
  const [goalProgress, setGoalProgress] = useState<WeeklyGoalProgress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // La preferencia se lee una vez: cambiarla en el Cuaderno se aplica
  // la próxima vez que la estantería se monta.
  const [activityHidden] = useState(() => loadActivityHidden());
  // Compañero del proveedor único: la tarjeta compacta muestra su
  // etapa, ropa equipada, nombre y nivel, y su botón abre la hoja de
  // cuidado compartida — nada se carga aquí.
  const companion = useCompanion();
  const showCompanion = companion.enabled === true && companion.state !== null;
  // Saludo una vez por sesión: la primera vez que la estantería
  // muestra al gato, saluda con la pata unos segundos. Marca en
  // memoria de módulo — abrir/cerrar el panel no lo repite.
  const [greeting, setGreeting] = useState(false);
  // Ajuste durante el render: el primer render que muestra la
  // tarjeta consume el saludo de la sesión.
  if (showCompanion && !greeting && takeShelfGreeting()) {
    setGreeting(true);
  }
  // El temporizador solo lo apaga; la marca ya quedó tomada.
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(
      () => setGreeting(false),
      SHELF_GREET_MS,
    );
    return () => window.clearTimeout(timer);
  }, [greeting]);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void Promise.all([
      listPositions(scope),
      listSavedWords(undefined, scope),
      loadLatestBookHash(scope),
      listReadingDays(scope),
      listIntervals(scope),
      loadSessionValue(READING_GOAL_KEY, scope),
    ]).then(
      ([positionList, words, hash, readDayList, intervalList, rawGoal]) => {
        if (cancelled) return;
        setPositions(positionList);
        const counts = new Map<string, number>();
        for (const word of words) {
          if (!word.bookHash) continue;
          counts.set(word.bookHash, (counts.get(word.bookHash) ?? 0) + 1);
        }
        setWordCounts(counts);
        setLatestHash(hash);
        // Días donde hubo lectura real (registrada al guardar posición),
        // no deducidos de la última posición de cada libro.
        const readDays = new Set(readDayList);
        const today = startOfDay(Date.now());
        setWeekDays(
          Array.from({ length: 7 }, (_, i) => {
            const day = today - (6 - i) * DAY_MS;
            return { day, read: readDays.has(day) };
          }),
        );
        // La meta semanal se deriva de los intervalos (locales + los
        // que llegaron por sync); «readingDays» sigue siendo solo el
        // registro histórico de los puntos de arriba.
        const goal = parseReadingGoal(rawGoal);
        setGoalProgress(
          goal?.daysPerWeek != null
            ? weeklyGoalProgress(
                intervalList,
                Date.now(),
                Intl.DateTimeFormat().resolvedOptions().timeZone,
                goal.daysPerWeek,
              )
            : null,
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [library, activityVersion]);

  // Rellena título, autor y portada de los libros que aún no los tienen.
  // Uno a la vez para no competir con la lectura. Se leen los registros
  // completos del almacén (ShelfItem no carga el archivo); los ítems
  // «solo en la nube» no están guardados aquí y quedan fuera solos —
  // sus metadatos se leen cuando se descargan.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const stored = await listStoredBooks(scope).catch(() => []);
      const pending = stored.filter((book) => !book.metaVersion).slice(0, 5);
      for (const book of pending) {
        const meta = await readBookMeta(book.data);
        if (cancelled) return;
        await updateBookMeta(
          book.hash,
          {
            title: meta?.title,
            author: meta?.author,
            language: meta?.language,
            sectionCount: meta?.sectionCount,
            cover: meta?.cover ?? undefined,
            metaVersion: 1,
          },
          scope,
        );
        onLibraryChange();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library, onLibraryChange]);

  const positionByHash = useMemo(
    () => new Map(positions.map((position) => [position.bookHash, position])),
    [positions],
  );

  const current = useMemo(() => {
    const hero = latestHash ? library.find((book) => book.hash === latestHash) : undefined;
    if (hero) return hero;
    const [freshest] = [...positions].sort((a, b) => b.updatedAt - a.updatedAt);
    return freshest ? library.find((book) => book.hash === freshest.bookHash) : undefined;
  }, [latestHash, library, positions]);

  const pickFile = () => fileInputRef.current?.click();

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".epub") || file.type === "application/epub+zip")) {
      onAdd(file);
    }
  };

  const remove = (hash: string) => {
    if (confirmDelete !== hash) {
      setConfirmDelete(hash);
      return;
    }
    setConfirmDelete(null);
    onRemove(hash);
  };

  if (checking) {
    return <p className="status">Preparando tu estantería…</p>;
  }

  const heroPosition = current ? positionByHash.get(current.hash) : undefined;

  return (
    <div className="shelf" onDragOver={(e) => e.preventDefault()}>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".epub,application/epub+zip"
        aria-label="Elige un libro EPUB"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAdd(file);
          event.currentTarget.value = "";
        }}
      />

      {/* Tarjeta compacta del compañero (fase 5): el gato con su
          etapa y ropa equipada, nombre y nivel breve; el botón abre
          la hoja de cuidado del proveedor. Solo si el juego está
          encendido — nunca desplaza ni rompe la estantería. */}
      {showCompanion && companion.state ? (
        <section
          className="shelf-companion"
          aria-label={`Tu compañero ${companion.name}`}
        >
          <CompanionButton
            stage={companion.stage}
            mood={companion.mood}
            accessories={companion.accessories}
            pose={greeting ? "greet" : undefined}
            label={`Ver a ${companion.name}`}
            onClick={companion.openPanel}
          />
          <div className="shelf-companion-info">
            <p className="shelf-companion-name">{companion.name}</p>
            <p className="meta">
              Nivel {levelProgress(companion.state.xp).level + 1} ·{" "}
              {levelProgress(companion.state.xp).name}
            </p>
          </div>
        </section>
      ) : null}

      {library.length === 0 ? (
        <section className="shelf-empty">
          <p className="shelf-empty-text">
            Tu estantería está vacía. Trae un EPUB y lo abrimos aquí.
          </p>
          <button
            type="button"
            className="add-slot add-slot--large"
            onClick={pickFile}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-dragging={dragging || undefined}
          >
            <span className="add-slot-mark" aria-hidden="true" />
            Añadir libro
          </button>
        </section>
      ) : (
        <>
          {current ? (
            <section className="shelf-hero" aria-label="Seguir leyendo">
              <button
                type="button"
                className="shelf-hero-cover"
                onClick={() => onOpen(current)}
                aria-label={`Continuar ${displayTitle(current.name, current.title)}`}
              >
                <BookCover book={current} />
              </button>
              <div className="shelf-hero-info">
                <p className="eyebrow">Seguir leyendo</p>
                <h2 className="shelf-hero-title">{displayTitle(current.name, current.title)}</h2>
                {current.author ? <p className="meta">{current.author}</p> : null}
                {heroPosition ? (
                  <p className="meta shelf-hero-progress">
                    {current.sectionCount
                      ? `Capítulo ${heroPosition.sectionIndex + 1} de ${current.sectionCount}`
                      : "Lectura en curso"}
                    {" · "}
                    te quedaste aquí {relativeDay(heroPosition.updatedAt)}
                  </p>
                ) : null}
                {current.sectionCount && heroPosition ? (
                  <div
                    className="thread shelf-hero-thread"
                    role="progressbar"
                    aria-valuenow={Math.round(progressOf(heroPosition, current.sectionCount) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="thread-fill"
                      style={
                        {
                          "--thread-value": `${progressOf(heroPosition, current.sectionCount) * 100}%`,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                ) : null}
                <div className="actions">
                  <button type="button" className="btn btn--primary" onClick={() => onOpen(current)}>
                    Continuar
                  </button>
                  {(wordCounts.get(current.hash) ?? 0) > 0 ? (
                    <span className="meta">
                      {wordCounts.get(current.hash) === 1
                        ? "1 palabra de este libro en tu cuaderno"
                        : `${wordCounts.get(current.hash)} palabras de este libro en tu cuaderno`}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section aria-label="Tu estantería">
            <h2 className="eyebrow shelf-eyebrow">Tu estantería</h2>
            <ul className="shelf-row">
              {library.map((book) => {
                const position = positionByHash.get(book.hash);
                const total = book.sectionCount ?? 0;
                const chapter = position ? position.sectionIndex : -1;
                return (
                  <li
                    key={book.hash}
                    className={`shelf-book${book.remoteOnly ? " shelf-item--remote" : ""}`}
                  >
                    <button
                      type="button"
                      className="shelf-book-cover"
                      onClick={() => onOpen(book)}
                      aria-label={`Abrir ${displayTitle(book.name, book.title)}`}
                      title={displayTitle(book.name, book.title)}
                    >
                      <BookCover book={book} />
                    </button>
                    {total > 0 && total <= 40 ? (
                      <span className="dots" aria-hidden="true">
                        {Array.from({ length: total }, (_, i) => (
                          <span
                            key={i}
                            className={`dot${i < chapter ? " dot--done" : i === chapter ? " dot--current" : ""}`}
                          />
                        ))}
                      </span>
                    ) : total > 0 ? (
                      <span className="thread shelf-book-thread" aria-hidden="true">
                        <span
                          className="thread-fill"
                          style={
                            {
                              "--thread-value": `${Math.round(progressOf(position, total) * 100)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </span>
                    ) : null}
                    <span className="shelf-book-meta meta">
                      {book.remoteOnly
                        ? "En la nube"
                        : `${
                            position && total
                              ? `${Math.round(progressOf(position, total) * 100)}% leído`
                              : "Sin empezar"
                          }${book.pendingUpload ? " · Pendiente de subir" : ""}`}
                    </span>
                    <button
                      type="button"
                      className="btn--quiet shelf-book-remove"
                      aria-label={`Quitar ${displayTitle(book.name, book.title)}`}
                      onClick={() => remove(book.hash)}
                    >
                      {confirmDelete === book.hash ? "¿Seguro?" : "Quitar"}
                    </button>
                    {confirmDelete === book.hash ? (
                      <p className="meta">
                        Solo se quita el libro; tus palabras se conservan.
                      </p>
                    ) : null}
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="add-slot"
                  onClick={pickFile}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  data-dragging={dragging || undefined}
                >
                  <span className="add-slot-mark" aria-hidden="true" />
                  Añadir libro
                </button>
              </li>
            </ul>
          </section>

          {activityHidden ? null : (
          <section aria-label="Días con lectura esta semana">
            <h2 className="eyebrow shelf-eyebrow">Días con lectura</h2>
            <div className="dots shelf-week">
              {weekDays.map(({ day, read }) => (
                <span
                  key={day}
                  className={`dot dot--day${read ? " dot--done" : ""}`}
                  title={new Date(day).toLocaleDateString("es-MX", { weekday: "long" })}
                  aria-label={`${new Date(day).toLocaleDateString("es-MX", { weekday: "long" })}: ${read ? "con lectura" : "sin lectura"}`}
                  role="img"
                />
              ))}
            </div>
            {goalProgress ? (
              <p className="meta shelf-goal">
                Meta de la semana: {goalProgress.readDays} de{" "}
                {goalProgress.target} días
                {goalProgress.met ? " · cumplida" : ""}
              </p>
            ) : null}
          </section>
          )}
        </>
      )}
    </div>
  );
}
