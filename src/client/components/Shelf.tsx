import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  captureDbScope,
  loadShelfBootstrap,
  loadSessionValue,
  listStoredBooks,
  updateBookMeta,
  type SavedBookPosition,
  type StoredBook,
} from "../lib/idb";
import { CALIBRATION_DONE_KEY } from "../lib/calibration";
import { triggerHaptic } from "../lib/haptics";
import { displayTitle, readBookMeta } from "../lib/cover";
import { languageName } from "../lib/epub";
import {
  entriesByFormOf,
  manifestBookForms,
  type CatalogBook,
} from "../lib/catalog";
import {
  affinityBadgeLabel,
  affinityTierOf,
  coverageOfBook,
  inputsForCoverage,
  type BookCoverage,
} from "../lib/coverage";
import { playCompanionSound } from "../lib/companion-audio";
import { analyzeStoredBook, loadBookVocab } from "../lib/book-vocab";
import { relativeDay } from "../lib/relative-time";
import {
  parseReadingGoal,
  weeklyGoalProgress,
  type WeeklyGoalProgress,
} from "../lib/reading-goal";
import { dayKeyOf } from "../lib/reading-activity";
import { maybeRequestTip, type TipOutcome } from "../lib/tips";
import { trackReadingEvent } from "../lib/reading-events";
import {
  loadActivityHidden,
  loadReaderSettings,
  saveReaderSettings,
  type StrategyPreset,
} from "../lib/settings";
import type { TipAction } from "../../shared/tip";
import { levelProgress } from "../lib/gamification";
import { isDue } from "../lib/fsrs";
import BookCover from "./BookCover";
import DiscoverRail from "./DiscoverRail";
import Icon from "./Icon";
import { CompanionButton } from "./CompanionButton";
import { CompanionStage } from "./CompanionStage";
import { useCompanion } from "./CompanionProvider";
import Sheet from "./Sheet";

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
  // «Obtener» del riel Descubre: el padre baja el EPUB del catálogo y
  // lo pasa al flujo normal de añadir libro.
  onGetCatalogBook?: (item: CatalogBook) => Promise<void> | void;
  // Descarga un libro remoto a IndexedDB sin necesidad de abrirlo
  onDownloadBook?: (item: ShelfItem) => Promise<void> | void;
  // Hash del libro que se está descargando actualmente
  downloadingHash?: string | null;
  // Sube cuando la sincronización trae intervalos nuevos: la meta de
  // la semana relee su progreso sin recargar la estantería.
  activityVersion?: number;
  onOpenJourney?: () => void;
  onOpenPractice?: () => void;
  onRequestCalibration?: () => void;
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

// Libro de muestra incluido con la app (dominio público, ver
// docs/muestra-azul.md): entra por la tubería normal de «Añadir
// libro» — se guarda, se sube y se borra como cualquier otro.
const SAMPLE_BOOK_URL = "/libros/azul-ruben-dario.epub";
const SAMPLE_BOOK_NAME = "Azul… — Rubén Darío.epub";

export function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// La misma fracción que guarda el lector; posiciones antiguas sin
// «progress» caen al índice de sección, sin mínimos inventados.
const progressOf = (position: SavedBookPosition | undefined, sectionCount: number | undefined) =>
  position && sectionCount
    ? (position.progress ?? Math.min(1, position.sectionIndex / sectionCount))
    : 0;

export default function Shelf({
  library,
  checking,
  onOpen,
  onRemove,
  onAdd,
  onLibraryChange,
  onGetCatalogBook,
  onDownloadBook,
  downloadingHash,
  activityVersion = 0,
  onOpenJourney,
  onOpenPractice,
  onRequestCalibration,
}: ShelfProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [positions, setPositions] = useState<SavedBookPosition[]>([]);
  const [wordCounts, setWordCounts] = useState<Map<string, number>>(new Map());
  const [dueWordsCount, setDueWordsCount] = useState(0);
  const [latestHash, setLatestHash] = useState<string | undefined>(undefined);
  const [weekDays, setWeekDays] = useState<{ day: number; read: boolean }[]>([]);
  const [goalProgress, setGoalProgress] = useState<WeeklyGoalProgress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [optionsBook, setOptionsBook] = useState<ShelfItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem("lecta_onboarding_dismissed") === "1";
    } catch {
      return false;
    }
  });
  // La preferencia se lee una vez: cambiarla en el Cuaderno se aplica
  // la próxima vez que la estantería se monta.
  const [activityHidden] = useState(() => loadActivityHidden());
  // Consejo diario con IA: a lo más uno por día y dispositivo (la
  // cadencia vive en tips.ts). Se pide al montar la estantería —
  // breakpoint de inicio de sesión — y queda registrado con
  // tip_shown/tip_accepted para medir si los consejos sirven.
  const [tip, setTip] = useState<TipOutcome | null>(null);
  const [todayKey, setTodayKey] = useState<string>("");
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
    void loadShelfBootstrap(scope).then(
      ({
        positions: positionList,
        savedWords: words,
        latestHash: hash,
        readingDays: readDayList,
        intervals: intervalList,
        rawGoal,
      }) => {
        if (cancelled) return;
        setPositions(positionList);
        const counts = new Map<string, number>();
        let dueTotal = 0;
        for (const word of words) {
          if (word.bookHash) {
            counts.set(word.bookHash, (counts.get(word.bookHash) ?? 0) + 1);
          }
          if (isDue(word.card)) {
            dueTotal += 1;
          }
        }
        setWordCounts(counts);
        setDueWordsCount(dueTotal);
        setLatestHash(hash);
        // Días donde hubo lectura real (registrada al guardar posición),
        // no deducidos de la última posición de cada libro.
        const readDays = new Set(readDayList);
        const now = Date.now();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setTodayKey(dayKeyOf(now, tz));
        const today = startOfDay(now);
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
                now,
                tz,
                goal.daysPerWeek,
              )
            : null,
        );
        void loadSessionValue(CALIBRATION_DONE_KEY, scope)
          .then((val) => {
            if (!cancelled) setCalibrationDone(val === "1");
          })
          .catch(() => null);
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

  // Cobertura de vocabulario por libro propio: mismo manifiesto que el
  // catálogo (bookVocab:v1:{hash}). Primero lo ya analizado; los que
  // falten se analizan de uno en uno y solo con red — nunca compite
  // con abrir un libro.
  const [bookCoverages, setBookCoverages] = useState<
    Map<string, BookCoverage>
  >(new Map());
  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData || navigator.onLine === false) return;
    const hashes = library
      .filter((book) => !book.remoteOnly)
      .map((book) => book.hash);
    if (!hashes.length) return;

    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      // El perfil necesita el catálogo (zipfs de la evidencia): si no
      // hay red no se puede medir nada y el lote entero se omite.
      const inputs = await inputsForCoverage("es", scope).catch(() => null);
      if (!inputs || cancelled) return;
      for (const hash of hashes) {
        if (cancelled) return;
        let manifest = await loadBookVocab(hash, scope);
        if (!manifest) manifest = await analyzeStoredBook(hash, scope);
        if (!manifest || cancelled) continue;
        const coverage = coverageOfBook(
          manifestBookForms(manifest),
          entriesByFormOf(manifest),
          inputs,
        );
        setBookCoverages((prev) => {
          const next = new Map(prev);
          next.set(hash, coverage);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library]);

  // Consejo del día: una sola petición por montaje; las puertas de
  // tips.ts (sesión, «Usar IA», datos mínimos, cadencia) deciden si
  // siquiera sale la llamada. La tarjeta vive hasta aceptar o cerrar.
  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void maybeRequestTip(scope).then((outcome) => {
      if (!outcome || cancelled) return;
      // Si la pestaña quedó oculta mientras respondía la IA, el tip se
      // descarta entero: una tarjeta que nadie vio no cuenta como
      // impresión y reaparecer de la nada al volver confunde.
      if (document.hidden) return;
      setTip(outcome);
      void trackReadingEvent(
        {
          kind: "tip_shown",
          tipDay: outcome.tipDay,
          action: outcome.action,
          promptVersion: outcome.version,
          visitId: null,
          bookHash: null,
        },
        scope,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const acceptTip = () => {
    if (!tip) return;
    // Las acciones del enum aplican el ajuste de verdad: la
    // sugerencia deja de ser texto y se vuelve conducta medible.
    if (tip.action === "focus_ruler" || tip.action === "syntactic") {
      const settings = loadReaderSettings();
      saveReaderSettings({
        ...settings,
        focusMode: tip.action === "focus_ruler" ? "ruler" : "syntactic",
      });
    }
    void trackReadingEvent(
      {
        kind: "tip_accepted",
        tipDay: tip.tipDay,
        action: tip.action,
        visitId: null,
        bookHash: null,
      },
      captureDbScope(),
    );
    setTip(null);
  };

  const tipActionLabel: Record<TipAction, string> = {
    none: "Me sirve",
    focus_ruler: "Activar la regla de foco",
    syntactic: "Activar las líneas sintácticas",
  };

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

  const [heroStrategy, setHeroStrategy] = useState<StrategyPreset | null>(null);
  const [catPetQuote, setCatPetQuote] = useState<string | null>(null);
  type ShelfFilter = "all" | "reading" | "unread" | "finished";
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>("all");

  const activeStrategy: StrategyPreset = useMemo(() => {
    if (heroStrategy) return heroStrategy;
    if (!current) return "focus";
    const s = loadReaderSettings(current.hash);
    return s.strategyPreset ?? "focus";
  }, [heroStrategy, current]);

  const activeModeLabel = useMemo(() => {
    if (activeStrategy === "focus") return "Modo Enfoque";
    if (activeStrategy === "lexical") return "Modo Léxico";
    if (activeStrategy === "audio") return "Modo Audio";
    if (activeStrategy === "immersive") return "Lectura Inmersiva";
    if (!current) return "Modo Estándar";
    const settings = loadReaderSettings(current.hash);
    if (settings.focusMode === "ruler") return "Regla de Foco";
    if (settings.focusMode === "syntactic") return "Líneas Sintácticas";
    return "Modo Estándar";
  }, [activeStrategy, current]);

  const filteredLibrary = useMemo(() => {
    if (shelfFilter === "all") return library;
    return library.filter((book) => {
      const pos = positionByHash.get(book.hash);
      const total = book.sectionCount ?? 0;
      const progress = progressOf(pos, total);
      if (shelfFilter === "reading") {
        return pos && progress > 0 && progress < 0.99;
      }
      if (shelfFilter === "unread") {
        return !pos || progress === 0;
      }
      if (shelfFilter === "finished") {
        return progress >= 0.99;
      }
      return true;
    });
  }, [library, shelfFilter, positionByHash]);

  const pickFile = () => fileInputRef.current?.click();

  const openSample = async () => {
    if (sampleState === "loading") return;
    setSampleState("loading");
    try {
      const response = await fetch(SAMPLE_BOOK_URL);
      if (!response.ok) throw new Error("sample fetch");
      const data = await response.blob();
      setSampleState("idle");
      onAdd(new File([data], SAMPLE_BOOK_NAME, { type: "application/epub+zip" }));
    } catch {
      setSampleState("error");
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".epub") || file.type === "application/epub+zip")) {
      onAdd(file);
    }
  };

  const remove = (hash: string) => {
    setConfirmDelete(null);
    setOptionsBook(null);
    onRemove(hash);
  };

  const changeBookLanguage = async (hash: string, language: string) => {
    const scope = captureDbScope();
    await updateBookMeta(hash, { language }, scope);
    setOptionsBook((prev) => (prev && prev.hash === hash ? { ...prev, language } : prev));
    onLibraryChange();
  };

  if (checking) {
    return <p className="status">Preparando tu estantería…</p>;
  }

  const heroPosition = current ? positionByHash.get(current.hash) : undefined;

  const step1Done = calibrationDone;
  const step2Done = positions.length > 0;
  const step3Done = wordCounts.size > 0 || (companion.state && companion.state.xp > 0);
  const onboardingAllDone = step1Done && step2Done && step3Done;
  const isBrandNew = library.length <= 1 && positions.length === 0 && !calibrationDone;
  const showOnboarding =
    !onboardingDismissed &&
    (isBrandNew || !step1Done || !step2Done || !step3Done || onboardingAllDone);

  const skipOnboarding = () => {
    try {
      localStorage.setItem("lecta_onboarding_dismissed", "1");
    } catch {
      // ignore
    }
    setOnboardingDismissed(true);
  };

  const finishOnboarding = () => {
    try {
      localStorage.setItem("lecta_onboarding_dismissed", "1");
    } catch {
      // ignore
    }
    setOnboardingDismissed(true);
  };

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

      {showOnboarding ? (
        <section className="shelf-onboarding-card" aria-label="Bienvenida a Lecta">
          <div className="onboarding-header">
            <div className="onboarding-title-group">
              <span className="onboarding-badge">Ritual de Bienvenida</span>
              <h2 className="onboarding-title">Comienza en 3 pasos con tu compañero</h2>
            </div>
            <button
              type="button"
              className="btn--quiet onboarding-skip-btn"
              onClick={skipOnboarding}
            >
              Saltar por ahora
            </button>
          </div>

          {onboardingAllDone ? (
            <div className="onboarding-celebration">
              <p className="onboarding-celebration-title">🎉 ¡Ritual de inicio completado!</p>
              <p className="meta">
                Has desbloqueado la <strong>Bufanda de Invierno</strong> (<code>scarf_amber</code>) en el clóset de tu compañero.
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={finishOnboarding}
                style={{ marginTop: "12px" }}
              >
                Comenzar a disfrutar Lecta →
              </button>
            </div>
          ) : (
            <ol className="onboarding-steps">
              <li className={`onboarding-step ${step1Done ? "is-done" : ""}`}>
                <span className="step-icon">{step1Done ? "✓" : "1"}</span>
                <div className="step-content">
                  <strong className="step-title">Afinar mi nivel en 45 seg</strong>
                  <span className="step-desc">Ajusta la dificultad del vocabulario para tus lecturas.</span>
                </div>
                {!step1Done && onRequestCalibration ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={onRequestCalibration}
                  >
                    Afinar nivel
                  </button>
                ) : null}
              </li>

              <li className={`onboarding-step ${step2Done ? "is-done" : ""}`}>
                <span className="step-icon">{step2Done ? "✓" : "2"}</span>
                <div className="step-content">
                  <strong className="step-title">Abrir mi primer capítulo con una Estrategia</strong>
                  <span className="step-desc">Elige Azul... de Rubén Darío o añade un EPUB propio.</span>
                </div>
                {!step2Done ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      if (current) onOpen(current);
                      else if (library[0]) onOpen(library[0]);
                      else if (onGetCatalogBook) {
                        void onGetCatalogBook({
                          id: "azul-ruben-dario",
                          gutenbergId: 0,
                          title: "Azul...",
                          author: "Rubén Darío",
                          cover: true,
                          language: "es",
                        });
                      }
                    }}
                  >
                    Abrir libro
                  </button>
                ) : null}
              </li>

              <li className={`onboarding-step ${step3Done ? "is-done" : ""}`}>
                <span className="step-icon">{step3Done ? "✓" : "3"}</span>
                <div className="step-content">
                  <strong className="step-title">Tocar una palabra nueva y acariciar al gato</strong>
                  <span className="step-desc">Descubre notas léxicas y comparte momentos con tu gato.</span>
                </div>
                {!step3Done && showCompanion ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--quiet"
                    onClick={() => companion.openPanel()}
                  >
                    Acariciar al gato
                  </button>
                ) : null}
              </li>
            </ol>
          )}
        </section>
      ) : null}

      {/* Tarjeta compacta del compañero (fase 5): el gato con su
          etapa y ropa equipada, nombre y nivel breve; el botón abre
          la hoja de cuidado del proveedor. Solo si el juego está
          encendido — nunca desplaza ni rompe la estantería. */}
      {showCompanion && companion.state && !current ? (
        <section
          className="shelf-companion shelf__desk-companion"
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
          <div className="shelf-welcome">
            <h2 className="shelf-welcome-title">{timeOfDayGreeting()}</h2>
            <p className="shelf-welcome-subtitle">
              Un rincón sereno para leer libros en español, descubrir palabras y enriquecer tu vocabulario con repetición espaciada.
            </p>
          </div>

          <div className="shelf-invitation">
            <div className="shelf-invitation-cover">
              <div
                className="cover cover--generated"
                style={
                  {
                    "--cover-paper": "#233342",
                    "--cover-ink": "#f7f9fa",
                    "--cover-accent": "#d4a43a",
                  } as CSSProperties
                }
              >
                <div className="cover-frame">
                  <p className="cover-title">Azul…</p>
                  <span className="cover-ornament" aria-hidden="true" />
                  <p className="cover-author">Rubén Darío</p>
                </div>
              </div>
            </div>
            <div className="shelf-invitation-content">
              <p className="eyebrow">Lectura recomendada de inicio</p>
              <h3 className="shelf-invitation-book-title">Azul…</h3>
              <p className="meta">Rubén Darío · Cuentos y poemas clásicos</p>
              <blockquote className="shelf-invitation-quote">
                «En Chile escribió Rubén Darío los textos que inauguraron el Modernismo. Toca cualquier palabra en el libro para ver su definición y guardarla en tu Cuaderno.»
              </blockquote>
              <div className="shelf-invitation-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    triggerHaptic(12);
                    void openSample();
                  }}
                  disabled={sampleState === "loading"}
                >
                  {sampleState === "loading"
                    ? "Preparando el libro…"
                    : "Comenzar a leer «Azul…»"}
                </button>
              </div>
              {sampleState === "error" ? (
                <p className="meta" role="alert">
                  No pude traer el libro. Revisa tu conexión e inténtalo de nuevo.
                </p>
              ) : null}
            </div>
          </div>

          <div className="shelf-import-zone">
            <p className="shelf-import-label">O añade tus propios libros</p>
            <button
              type="button"
              className="add-slot add-slot--wide"
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
              <span>Arrastra un archivo EPUB o pulsa para elegirlo</span>
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* Consejo del día (IA): tarjeta transitoria de sesión.
              Aceptar aplica la acción si la hay y cierra; × solo
              cierra. Sin consejo la estantería no cambia nada. */}
          {tip ? (
            <section className="shelf-tip" role="status">
              <p className="shelf-tip-text">{tip.tip}</p>
              <div className="shelf-tip-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={acceptTip}
                >
                  {tipActionLabel[tip.action]}
                </button>
                <button
                  type="button"
                  className="reader-return-dismiss"
                  onClick={() => setTip(null)}
                  aria-label="Descartar consejo"
                >
                  ×
                </button>
              </div>
            </section>
          ) : null}
          {current ? (
            <section className="shelf-hero shelf-reading-table shelf__desk-hero" aria-label="Tu Mesa de Lectura">
              <div className="shelf-hero-left">
                <button
                  type="button"
                  className="shelf-hero-cover shelf-book-spine"
                  onClick={() => {
                    triggerHaptic(10);
                    onOpen(current);
                  }}
                  aria-label={`Continuar ${displayTitle(current.name, current.title)}`}
                >
                  <BookCover
                    book={current}
                    progress={progressOf(heroPosition, current.sectionCount)}
                    showRibbon={Boolean(heroPosition)}
                  />
                  <span className="shelf-lang-badge" title={`Idioma: ${languageName(current.language || "es")}`}>
                    {(current.language || "es").toUpperCase()}
                  </span>
                </button>
                <div className="shelf-hero-info">
                  <div className="shelf-hero-summary">
                    <div className="shelf-hero-eyebrow-row">
                      <p className="eyebrow">Tu Mesa de Lectura</p>
                      {bookCoverages.get(current.hash) ? (
                        <span
                          className={`shelf-affinity-badge shelf-affinity-badge--${affinityTierOf(bookCoverages.get(current.hash)!.percent)}`}
                          title={`Afinidad léxica: ${bookCoverages.get(current.hash)!.percent}%`}
                        >
                          {bookCoverages.get(current.hash)!.percent}% vocabulario conocido
                        </span>
                      ) : null}
                    </div>
                    <h2 className="shelf-hero-title">{displayTitle(current.name, current.title)}</h2>
                    {current.author ? <p className="meta">{current.author}</p> : null}
                    {heroPosition ? (
                      <p className="meta shelf-hero-progress">
                        {current.sectionCount
                          ? `Capítulo ${heroPosition.sectionIndex + 1} de ${current.sectionCount} · Quedan ~5 min en este capítulo`
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
                            } as CSSProperties
                          }
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* Selector Rápido de Estrategia en la Tarjeta */}
                  <div className="shelf-strategy-selector shelf-hero-strategies" role="group" aria-label="Estrategia para entrar hoy">
                    {[
                      { id: "focus", label: "Enfoque Profundo" },
                      { id: "lexical", label: "Explorador Léxico" },
                      { id: "audio", label: "Audio-Lectura" },
                      { id: "immersive", label: "Lectura Limpia" },
                    ].map((strat) => (
                      <button
                        key={strat.id}
                        type="button"
                        className={`shelf-strategy-pill${activeStrategy === strat.id ? " shelf-strategy-pill--active" : ""}`}
                        onClick={() => {
                          triggerHaptic(8);
                          setHeroStrategy(strat.id as StrategyPreset);
                          const curSettings = loadReaderSettings(current.hash);
                          saveReaderSettings({ ...curSettings, strategyPreset: strat.id as StrategyPreset }, current.hash);
                        }}
                      >
                        {strat.label}
                      </button>
                    ))}
                  </div>

                  <div className="actions shelf-hero-actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--hero-continue"
                      onClick={() => {
                        triggerHaptic(10);
                        onOpen(current);
                      }}
                    >
                      Continuar leyendo · {activeModeLabel}
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--pre-train"
                      onClick={() => {
                        triggerHaptic(10);
                        if (onOpenPractice) onOpenPractice();
                        else onOpen(current);
                      }}
                    >
                      Pre-entrenar 3 palabras del capítulo
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
              </div>

              <div className="shelf-hero-right">
                <div className="shelf-hero-lamp" aria-hidden="true" title="Rincón cálido con el gato">
                  <span className="shelf-lamp-icon">🛋️ 💡</span>
                </div>
                {showCompanion && companion.state ? (
                  <div
                    className="shelf-hero-companion shelf__desk-companion"
                    onClick={() => {
                      triggerHaptic(12);
                      playCompanionSound("purr");
                      setCatPetQuote("¡Nos quedamos en la mejor parte del capítulo! ¿Leemos 5 minutos?");
                      window.setTimeout(() => setCatPetQuote(null), 6000);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Acariciar a ${companion.name}`}
                  >
                    <CompanionStage
                      name={companion.name}
                      stage={companion.stage}
                      mood={companion.mood}
                      accessories={companion.accessories}
                      activeCare={companion.activeCare}
                      onCare={(k) => void companion.care(k)}
                      reducedMotion={companion.reducedMotion}
                      streakDays={companion.state.stats.streakDays ?? 0}
                      hasReadToday={
                        Boolean(todayKey) &&
                        companion.state.stats.lastDayKey === todayKey
                      }
                      greetingText={catPetQuote ?? (greeting ? timeOfDayGreeting() : null)}
                      careStatusText={null}
                      tryOnArticle={null}
                      tryOnLevel={null}
                      onClearTryOn={() => {}}
                      bookTitle={displayTitle(current.name, current.title)}
                    />
                  </div>
                ) : null}

                {dueWordsCount > 0 ? (
                  <div className="shelf-cat-pending-note" role="status">
                    <span className="cat-note-icon" aria-hidden="true">🐾 💌</span>
                    <span className="cat-note-text">
                      Tienes {dueWordsCount} palabra{dueWordsCount === 1 ? "" : "s"} {dueWordsCount === 1 ? "lista" : "listas"} en tu cuaderno
                    </span>
                  </div>
                ) : null}

                <div className="shelf-hero-activity-bar">
                  {goalProgress ? (
                    <div
                      className="shelf-goal-ring-widget progress-ring"
                      role="progressbar"
                      aria-label="Meta de lectura semanal"
                      aria-valuenow={Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      title={`Meta semanal: ${goalProgress.readDays} de ${goalProgress.target} días cumplidos`}
                    >
                      <svg className="shelf-goal-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
                        <path
                          className="goal-ring-bg"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="goal-ring-fill"
                          strokeDasharray={`${Math.min(100, Math.round((goalProgress.readDays / Math.max(1, goalProgress.target)) * 100))}, 100`}
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="shelf-goal-ring-info">
                        <div className="shelf-goal-ring-counts">
                          <strong>{goalProgress.readDays}/{goalProgress.target}</strong>
                          <span>días</span>
                        </div>
                        <span className="meta">{goalProgress.met ? "Meta cumplida 🎉" : "Meta semanal"}</span>
                      </div>
                    </div>
                  ) : null}

                  {dueWordsCount > 0 ? (
                    <button
                      type="button"
                      className="btn btn--quick-practice"
                      onClick={() => {
                        triggerHaptic(12);
                        if (onOpenPractice) onOpenPractice();
                        else if (onOpenJourney) onOpenJourney();
                      }}
                    >
                      <Icon name="sparkles" size={16} />
                      <span>Practicar {dueWordsCount} palabra{dueWordsCount === 1 ? "" : "s"} pendiente{dueWordsCount === 1 ? "" : "s"}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section aria-label="Tu estantería">
            <div className="shelf-header-row">
              <h2 className="eyebrow shelf-eyebrow">Tu estantería</h2>
              <div className="shelf-filters" role="tablist" aria-label="Filtrar libros">
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "all" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("all")}
                  role="tab"
                  aria-selected={shelfFilter === "all"}
                >
                  Todos ({library.length})
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "reading" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("reading")}
                  role="tab"
                  aria-selected={shelfFilter === "reading"}
                >
                  Leyendo ahora
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "unread" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("unread")}
                  role="tab"
                  aria-selected={shelfFilter === "unread"}
                >
                  Por empezar
                </button>
                <button
                  type="button"
                  className={`shelf-filter-pill${shelfFilter === "finished" ? " shelf-filter-pill--active" : ""}`}
                  onClick={() => setShelfFilter("finished")}
                  role="tab"
                  aria-selected={shelfFilter === "finished"}
                >
                  Terminados
                </button>
                <button
                  type="button"
                  className="shelf-filter-pill shelf-filter-pill--import"
                  onClick={pickFile}
                >
                  + Importar EPUB
                </button>
              </div>
            </div>

            <ul className="shelf-row">
              {filteredLibrary.map((book) => {
                const position = positionByHash.get(book.hash);
                const total = book.sectionCount ?? 0;
                const chapter = position ? position.sectionIndex : -1;
                const isDownloading = downloadingHash === book.hash;
                const cov = bookCoverages.get(book.hash);
                return (
                  <li
                    key={book.hash}
                    className={`shelf-book${book.remoteOnly ? " shelf-item--remote" : ""}`}
                    data-downloading={isDownloading || undefined}
                  >
                    <button
                      type="button"
                      className="shelf-book-cover"
                      disabled={isDownloading}
                      onClick={() => onOpen(book)}
                      aria-label={`Abrir ${displayTitle(book.name, book.title)}`}
                      title={displayTitle(book.name, book.title)}
                    >
                      <BookCover
                        book={book}
                        progress={progressOf(position, total)}
                        showRibbon={Boolean(position && progressOf(position, total) > 0)}
                      />
                      <span className="shelf-lang-badge" title={`Idioma: ${languageName(book.language || "es")}`}>
                        {(book.language || "es").toUpperCase()}
                      </span>
                      {book.remoteOnly ? (
                        <span
                          className={`shelf-cloud-badge${isDownloading ? " shelf-cloud-badge--loading" : ""}`}
                          title={isDownloading ? "Descargando libro…" : "Disponible en la nube · Toca para descargar"}
                          aria-label={isDownloading ? "Descargando" : "En la nube"}
                        >
                          <Icon name={isDownloading ? "clock" : "cloud"} size={13} />
                        </span>
                      ) : null}
                      {cov ? (
                        <span
                          className={`shelf-affinity-badge shelf-affinity-badge--${affinityTierOf(cov.percent)}`}
                          title={`Afinidad léxica: ~${cov.percent}%`}
                        >
                          {affinityBadgeLabel(cov.percent)}
                        </span>
                      ) : null}
                    </button>
                    {total > 0 && total <= 8 ? (
                      <span className="dots shelf-book-dots" aria-hidden="true">
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
                    <div className="shelf-book-footer">
                      <span className={`shelf-book-meta meta${isDownloading ? " shelf-book-meta--downloading" : ""}`}>
                        {isDownloading
                          ? "Descargando…"
                          : book.remoteOnly
                            ? "Toca para descargar"
                            : `${
                                position && total
                                  ? `${Math.round(progressOf(position, total) * 100)}% leído`
                                  : "Sin empezar"
                              }${book.pendingUpload ? " · Subiendo…" : ""}`}
                      </span>
                      <button
                        type="button"
                        className="btn--quiet shelf-book-more"
                        disabled={isDownloading}
                        aria-label={`Opciones de ${displayTitle(book.name, book.title)}`}
                        title="Opciones del libro"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOptionsBook(book);
                        }}
                      >
                        ⋯
                      </button>
                    </div>
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

          {optionsBook ? (
            <Sheet
              label={`Opciones de ${displayTitle(optionsBook.name, optionsBook.title)}`}
              onClose={() => {
                setOptionsBook(null);
                setConfirmDelete(null);
              }}
            >
              <div className="sheet-head">
                <strong className="sheet-title">Opciones del libro</strong>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    setOptionsBook(null);
                    setConfirmDelete(null);
                  }}
                  aria-label="Cerrar opciones"
                >
                  Cerrar
                </button>
              </div>

              <div className="shelf-options-body">
                <div className="shelf-options-summary">
                  <div className="shelf-options-cover">
                    <BookCover book={optionsBook} />
                  </div>
                  <div className="shelf-options-details">
                    <h3 className="shelf-options-title">
                      {displayTitle(optionsBook.name, optionsBook.title)}
                    </h3>
                    {optionsBook.author ? (
                      <p className="meta shelf-options-author">{optionsBook.author}</p>
                    ) : null}
                    <p className="meta shelf-options-progress">
                      {optionsBook.remoteOnly
                        ? "Disponible en tu cuenta · Listo para descargar"
                        : (() => {
                            const pos = positionByHash.get(optionsBook.hash);
                            const tot = optionsBook.sectionCount ?? 0;
                            return pos && tot
                              ? `Capítulo ${pos.sectionIndex + 1} de ${tot} · ${Math.round(progressOf(pos, tot) * 100)}% leído`
                              : "Sin empezar";
                          })()}
                    </p>
                  </div>
                </div>

                {optionsBook.remoteOnly ? (
                  <div className="shelf-options-section">
                    <button
                      type="button"
                      className="btn btn--primary shelf-options-download-btn"
                      disabled={downloadingHash === optionsBook.hash}
                      onClick={() => {
                        if (onDownloadBook) {
                          void onDownloadBook(optionsBook);
                        } else {
                          onOpen(optionsBook);
                        }
                      }}
                    >
                      {downloadingHash === optionsBook.hash
                        ? "Descargando libro…"
                        : "Descargar libro a este dispositivo"}
                    </button>
                  </div>
                ) : null}

                <div className="shelf-options-section">
                  <label htmlFor="shelf-book-lang-picker" className="shelf-options-label">
                    Idioma del libro
                  </label>
                  <p className="meta shelf-options-hint">
                    Determina el diccionario, lemas de palabras y enriquecimiento.
                  </p>
                  <select
                    id="shelf-book-lang-picker"
                    className="shelf-options-select"
                    value={optionsBook.language || "es"}
                    onChange={(event) => void changeBookLanguage(optionsBook.hash, event.target.value)}
                  >
                    <option value="es">Español (ES)</option>
                    <option value="en">Inglés (EN)</option>
                    <option value="fr">Francés (FR)</option>
                    <option value="de">Alemán (DE)</option>
                    <option value="it">Italiano (IT)</option>
                    <option value="pt">Portugués (PT)</option>
                  </select>
                </div>

                <div className="shelf-options-danger-zone">
                  {confirmDelete === optionsBook.hash ? (
                    <div className="shelf-options-confirm" role="alert">
                      <p className="meta">
                        ¿Seguro que quieres quitar «{displayTitle(optionsBook.name, optionsBook.title)}»? Tus palabras guardadas en el Cuaderno se conservan.
                      </p>
                      <div className="shelf-options-confirm-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => remove(optionsBook.hash)}
                        >
                          Sí, quitar libro
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn--quiet shelf-book-remove"
                      onClick={() => setConfirmDelete(optionsBook.hash)}
                    >
                      Quitar de la estantería…
                    </button>
                  )}
                </div>
              </div>
            </Sheet>
          ) : null}

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
            {onOpenJourney ? (
              <div className="shelf-journey-access" style={{ marginTop: "var(--s-2)" }}>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={onOpenJourney}
                >
                  Tu recorrido completo…
                </button>
              </div>
            ) : null}
          </section>
          )}
        </>
      )}

      {/* Riel del catálogo público: bajo la retícula y también con la
          estantería vacía — Descubre es justamente la respuesta a
          «no sé qué leer». Se oculta solo si no hay índice. */}
      {onGetCatalogBook ? (
        <DiscoverRail
          library={library}
          onOpen={onOpen}
          onGet={onGetCatalogBook}
        />
      ) : null}
    </div>
  );
}
