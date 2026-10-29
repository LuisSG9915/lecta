// Hoja del compañero: gato protagonista en su rincón interactivo (escenario
// arrastrable y con paseo sereno), cabecera compacta con edición de nombre
// en línea, pestañas navegables con transición lateral suave, acciones de
// cuidado directo, armario con miniaturas reales en bandeja deslizable y
// vitrina de logros.

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import "../styles/game.css";
import Sheet from "./Sheet";
import { Companion } from "./Companion";
import { CompanionStage } from "./CompanionStage";
import {
  CompanionCloset,
  ARTICLE_LABELS,
} from "./CompanionCloset";
import { ProgressInk } from "./ProgressInk";
import { Seal, toRoman } from "./Seal";
import {
  loadCompanionDevicePrefs,
  openGameChest,
  saveCompanionBookMood,
  writeCompanionField,
} from "../lib/game";
import { captureDbScope, listStoredBooks } from "../lib/idb";
import { listRemoteBooks } from "../lib/books";
import { coverUrlFor } from "../lib/cover";
import {
  COMPANION_ARTICLES,
  type BookMood,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  ACCESSORY_LABELS,
  ACHIEVEMENTS,
  COAT_LEVELS,
  LEVELS,
  catStageForLevel,
  dayKeyOf,
  levelProgress,
  listFamilyProgress,
  pendingChests,
  rewardForLevel,
  unlockedAccessories,
  unlockedCoats,
  type CatMood,
  type GameChest,
  type GameState,
} from "../lib/gamification";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import {
  CARE_POSES,
  CARE_STATUS,
  cleanCompanionName,
  companionGreeting,
  type CareKind,
} from "../lib/companion-interactions";
import { closetComment, lookForMood, lookStatus } from "../lib/companion-closet";
import {
  buildPortraitPng,
  downloadBlob,
  portraitFigures,
  portraitFilename,
  portraitShareText,
  sharePortrait,
  themeColor,
} from "../lib/companion-portrait";
import {
  getCharactersOnPageWithoutSpoilers,
  type CharacterCardInfo,
} from "../lib/character-helper";
import type { CompanionReaderContext } from "./CompanionProvider";

export type CatCornerTab = "progress" | "customize";
export type CompanionTab = CatCornerTab | "care" | "rewards" | "closet" | "collection";

export const COMPANION_TABS: { id: CompanionTab; label: string }[] = [
  { id: "care", label: "Cuidado" },
  { id: "rewards", label: "Recompensas" },
  { id: "closet", label: "Armario" },
  { id: "collection", label: "Vitrina" },
];

export interface UnifiedCompanionPanelProps {
  catName?: string;
  catMoodMessage?: string;
  streakDays?: number;
  minutesReadToday?: number;
  dailyGoalMinutes?: number;
  wordsLearnedCount?: number;
  isInsideReader?: boolean;

  // Componentes hijos existentes que se montan limpiamente dentro de las 2 pestañas
  renderStagePreview?: () => React.ReactNode; // CompanionStage.tsx
  renderClosetGrid?: () => React.ReactNode; // CompanionCloset.tsx
  renderJourneyMilestones?: () => React.ReactNode; // Resumen compacto de Journey.tsx

  // Acciones mágicas de 1 toque cuando se abre desde Reader.tsx
  onTriggerWhereWasI?: () => void;
  onTriggerWhoIsOnPage?: () => void;
  onClose: () => void;
}

export type CompanionPanelProps = Partial<UnifiedCompanionPanelProps> & {
  state?: GameState | null;
  name?: string;
  equipped?: EquippedItems;
  accessories?: string[];
  mood?: CatMood;
  activeCare?: CareKind | null;
  onCare?: (kind: CareKind) => Promise<void>;
  onClose: () => void;
  reducedMotion?: boolean;
  initialTab?: CompanionTab;
  readerContext?: CompanionReaderContext | null;
};

export function CatCornerSheet({
  catName = "Miso",
  catMoodMessage,
  streakDays = 0,
  minutesReadToday = 0,
  dailyGoalMinutes = 20,
  wordsLearnedCount = 0,
  isInsideReader = false,
  renderStagePreview,
  renderClosetGrid,
  renderJourneyMilestones,
  onTriggerWhereWasI,
  onTriggerWhoIsOnPage,
  onClose,
}: UnifiedCompanionPanelProps & { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<CatCornerTab>("progress");
  const goalPercent = Math.min(
    100,
    Math.round((minutesReadToday / Math.max(1, dailyGoalMinutes)) * 100),
  );

  return (
    <div
      className="cat-corner-sheet"
      role="dialog"
      aria-label="El Rincón de tu Gato"
    >
      {/* Cabecera con el Escenario del Gato siempre visible arriba */}
      <header className="cat-corner-header">
        <div className="cat-corner-title-bar">
          <h2 className="cat-corner-title">🐱 El Rincón de {catName}</h2>
          <button
            type="button"
            className="cat-corner-close-btn"
            onClick={onClose}
            aria-label="Cerrar rincón del gato"
          >
            ✕
          </button>
        </div>

        <div className="cat-corner-stage-box">
          {renderStagePreview ? renderStagePreview() : null}
          {catMoodMessage ? (
            <p className="cat-corner-speech-bubble">“{catMoodMessage}”</p>
          ) : null}
        </div>

        {/* Atajos Mágicos de 1 toque si el lector tiene un libro abierto */}
        {isInsideReader && (
          <div className="cat-corner-magic-actions">
            {onTriggerWhereWasI && (
              <button
                type="button"
                className="cat-magic-pill-btn"
                onClick={onTriggerWhereWasI}
              >
                ✨ ¿En qué me quedé? (15s)
              </button>
            )}
            {onTriggerWhoIsOnPage && (
              <button
                type="button"
                className="cat-magic-pill-btn"
                onClick={onTriggerWhoIsOnPage}
              >
                👥 Personajes en esta página
              </button>
            )}
          </div>
        )}

        {/* Selector simple de 2 Pestañas */}
        <div className="cat-corner-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "progress"}
            className={`cat-corner-tab-btn ${activeTab === "progress" ? "is-active" : ""}`}
            onClick={() => setActiveTab("progress")}
          >
            🌱 Mi Progreso
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "customize"}
            className={`cat-corner-tab-btn ${activeTab === "customize" ? "is-active" : ""}`}
            onClick={() => setActiveTab("customize")}
          >
            🎀 Personalizar Gato
          </button>
        </div>
      </header>

      {/* Contenido de la pestaña activa */}
      <div className="cat-corner-body">
        {activeTab === "progress" ? (
          <div className="cat-progress-view">
            <div className="cat-stats-grid">
              <div className="cat-stat-card">
                <span className="cat-stat-value">🔥 {streakDays} d</span>
                <span className="cat-stat-label">Racha de lectura</span>
              </div>
              <div className="cat-stat-card">
                <span className="cat-stat-value">
                  ⏱️ {minutesReadToday}/{dailyGoalMinutes} m
                </span>
                <span className="cat-stat-label">
                  Meta de hoy ({goalPercent}%)
                </span>
              </div>
              <div className="cat-stat-card">
                <span className="cat-stat-value">✨ {wordsLearnedCount}</span>
                <span className="cat-stat-label">Palabras tuyas</span>
              </div>
            </div>

            {renderJourneyMilestones && (
              <div className="cat-journey-compact">
                {renderJourneyMilestones()}
              </div>
            )}
          </div>
        ) : (
          <div className="cat-customize-view">
            {renderClosetGrid ? renderClosetGrid() : null}
          </div>
        )}
      </div>
    </div>
  );
}

function withTryOn(
  accessories: string[],
  tryOn: CompanionArticle | null,
): string[] {
  if (!tryOn) return accessories;
  const slot = COMPANION_ARTICLES[tryOn];
  if (!slot) return accessories;
  const filtered = accessories.filter(
    (a) => COMPANION_ARTICLES[a as CompanionArticle] !== slot,
  );
  return [...filtered, tryOn];
}

export function CompanionPanel(props: CompanionPanelProps) {
  if (props.renderStagePreview) {
    return (
      <CatCornerSheet
        catName={props.catName ?? props.name ?? "Miso"}
        catMoodMessage={props.catMoodMessage ?? "¡Listo para seguir leyendo!"}
        streakDays={props.streakDays ?? props.state?.stats?.streakDays ?? 0}
        minutesReadToday={
          props.minutesReadToday ??
          (props.state ? Math.round(props.state.stats.minutes) : 0)
        }
        dailyGoalMinutes={props.dailyGoalMinutes ?? 20}
        wordsLearnedCount={
          props.wordsLearnedCount ?? props.state?.stats?.saved ?? 0
        }
        isInsideReader={props.isInsideReader ?? false}
        renderStagePreview={props.renderStagePreview}
        renderClosetGrid={props.renderClosetGrid ?? (() => null)}
        renderJourneyMilestones={props.renderJourneyMilestones}
        onTriggerWhereWasI={props.onTriggerWhereWasI}
        onTriggerWhoIsOnPage={props.onTriggerWhoIsOnPage}
        onClose={props.onClose}
      />
    );
  }
  return <FullCompanionPanel {...props} />;
}

function FullCompanionPanel(props: CompanionPanelProps) {
  const {
    state,
    name = "Michi",
    equipped = { head: null, neck: null, face: null, body: null, coat: null },
    accessories = [],
    mood = "awake",
    activeCare = null,
    onCare = async () => {},
    onClose,
    reducedMotion = false,
    initialTab = "care",
    readerContext,
    onTriggerWhereWasI,
    onTriggerWhoIsOnPage,
  } = props;
  const [characterCards, setCharacterCards] = useState<CharacterCardInfo[] | null>(null);
  const [charactersLoading, setCharactersLoading] = useState(false);

  const handleScanCharacters = async () => {
    if (onTriggerWhoIsOnPage) {
      onTriggerWhoIsOnPage();
      return;
    }
    if (!readerContext) return;
    setCharactersLoading(true);
    try {
      const results = await getCharactersOnPageWithoutSpoilers({
        pageText: readerContext.pageText,
        currentChapterIndex: readerContext.currentChapterIndex,
        bookId: readerContext.bookId,
        sections: readerContext.sections,
        toc: readerContext.toc,
        lang: readerContext.language ?? "es",
      });
      setCharacterCards(results);
    } catch {
      setCharacterCards([]);
    } finally {
      setCharactersLoading(false);
    }
  };

  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  const [tab, setTab] = useState<CompanionTab>(initialTab);
  if (prevInitialTab !== initialTab) {
    setPrevInitialTab(initialTab);
    setTab(initialTab);
  }
  const [equipBusy, setEquipBusy] = useState(false);
  const [closetError, setClosetError] = useState("");
  const [careError, setCareError] = useState("");

  // Edición del nombre del gato en la cabecera
  const [isEditingName, setIsEditingName] = useState(false);
  const [draft, setDraft] = useState(name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const renameBtnRef = useRef<HTMLButtonElement>(null);

  // Apertura de cofres y revelación de recompensas
  const [chestBusy, setChestBusy] = useState<string | null>(null);
  const [chestError, setChestError] = useState("");
  const [revealedChest, setRevealedChest] = useState<GameChest | null>(null);

  // Prueba temporal de prendas en el armario
  const [tryOnArticle, setTryOnArticle] = useState<CompanionArticle | null>(
    null,
  );
  const [tryOnLevel, setTryOnLevel] = useState<number | null>(null);

  // Reacción local de ojos felices tras equipar + la frase que dice el gato
  const [happyReaction, setHappyReaction] = useState(false);
  const [justWorn, setJustWorn] = useState<CompanionArticle | null>(null);
  // Retrato de lectura: se genera en el cliente y no se sube a ningún sitio.
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [portraitError, setPortraitError] = useState("");
  const [portraitNote, setPortraitNote] = useState("");
  const portraitRef = useRef<HTMLDivElement>(null);
  // Ambiente que el lector asignó a cada libro (preferencia del
  // dispositivo): con él el armario propone un look sin inventar géneros.
  // Se guarda por hash para que cambiar de libro no arrastre la elección.
  const [moodByBook, setMoodByBook] = useState<Record<string, BookMood>>({});

  // Metadatos de libros para los exlibris de libros completados
  const [booksMap, setBooksMap] = useState<
    Map<string, { title?: string; author?: string; cover?: string }>
  >(new Map());

  useEffect(() => {
    if (!state?.finishedBooks.length) return;
    const scope = captureDbScope();
    let cancelled = false;
    void (async () => {
      const [local, remote] = await Promise.all([
        listStoredBooks(scope).catch(() => []),
        listRemoteBooks(scope).catch(() => []),
      ]);
      if (cancelled) return;
      const map = new Map<
        string,
        { title?: string; author?: string; cover?: string }
      >();
      for (const b of local) {
        map.set(b.hash, {
          title: b.title || b.name,
          author: b.author,
          cover: b.cover ? coverUrlFor(b.cover) : undefined,
        });
      }
      for (const r of remote) {
        if (!map.has(r.hash)) {
          map.set(r.hash, {
            title: r.title || r.name,
            author: r.author,
          });
        }
      }
      setBooksMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [state?.finishedBooks]);

  // Saludo de llegada inicial (~2.4s)
  const [arrival, setArrival] = useState<{ mood: CatMood; at: Date } | null>(
    null,
  );
  if (state && arrival === null) setArrival({ mood, at: new Date() });
  const [waving, setWaving] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setWaving(false), 2400);
    return () => clearTimeout(timer);
  }, []);
  const greeting = arrival
    ? companionGreeting(name, arrival.mood, arrival.at)
    : null;

  // Sincronización del borrador del nombre cuando cambia la prop
  const [draftFor, setDraftFor] = useState(name);
  if (draftFor !== name) {
    setDraftFor(name);
    setDraft(name);
  }

  const cleaned = cleanCompanionName(draft);
  const nameInvalid = cleaned === null && draft !== name;
  const canSave = cleaned !== null && cleaned !== name;

  const doCare = (kind: CareKind) => {
    if (activeCare) return;
    if (kind === "pet") triggerPurrHaptic();
    setCareError("");
    void onCare(kind).catch(() => {
      setCareError("No se pudo registrar el cuidado. Intenta de nuevo.");
    });
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const value = cleanCompanionName(draft);
    if (value === null || value === name || nameBusy) return;
    setNameBusy(true);
    setNameError("");
    try {
      await writeCompanionField("name", value, captureDbScope());
      setIsEditingName(false);
      renameBtnRef.current?.focus();
    } catch {
      setNameError("No se pudo guardar el nombre. Intenta de nuevo.");
    } finally {
      setNameBusy(false);
    }
  };

  const cancelEditName = () => {
    setDraft(name);
    setNameError("");
    setIsEditingName(false);
    renameBtnRef.current?.focus();
  };

  // Elegir prenda disponible (o null = sin prenda)
  const choose = async (slot: EquippedSlot, article: string | null) => {
    if (equipBusy) return;
    setEquipBusy(true);
    setClosetError("");
    setTryOnArticle(null);
    setTryOnLevel(null);
    try {
      await writeCompanionField(`equipped.${slot}`, article, captureDbScope());
      triggerHaptic("selection");
      setJustWorn((article as CompanionArticle | null) ?? null);
      setHappyReaction(true);
      setTimeout(() => setHappyReaction(false), 1000);
    } catch {
      setClosetError("No se pudo guardar la prenda. Intenta de nuevo.");
    } finally {
      setEquipBusy(false);
    }
  };

  // Varias ranuras de una vez (looks del armario y «quitar prendas»): cada
  // campo se escribe con su propio sello monótono, igual que un toque
  // individual, para que el sync no vea saltos de sello entre ranuras.
  const chooseMany = async (items: Partial<EquippedItems>) => {
    if (equipBusy) return;
    const entries = Object.entries(items) as [
      EquippedSlot,
      string | null | undefined,
    ][];
    if (entries.length === 0) return;
    setEquipBusy(true);
    setClosetError("");
    setTryOnArticle(null);
    setTryOnLevel(null);
    try {
      const scope = captureDbScope();
      for (const [slot, article] of entries) {
        if (article === undefined) continue;
        await writeCompanionField(`equipped.${slot}`, article, scope);
      }
      triggerHaptic("success");
      const head = entries.find(([slot]) => slot === "head")?.[1];
      const body = entries.find(([slot]) => slot === "body")?.[1];
      const worn = (head ?? body ?? null) as CompanionArticle | null;
      setJustWorn(worn);
      setHappyReaction(true);
      setTimeout(() => setHappyReaction(false), 1000);
    } catch {
      setClosetError("No se pudo guardar la prenda. Intenta de nuevo.");
    } finally {
      setEquipBusy(false);
    }
  };

  const handleTryOn = (
    article: CompanionArticle,
    reqLevel: number | null,
  ) => {
    setTryOnArticle(article);
    setTryOnLevel(reqLevel);
    triggerPurrHaptic();
  };

  const clearTryOn = () => {
    setTryOnArticle(null);
    setTryOnLevel(null);
  };

  const bookId = readerContext?.bookId ?? null;
  // El ambiente se lee de disco cuando hay libro abierto. Sin libro no hay
  // nada que leer: la fila no se pinta (ni se resetea estado en el efecto).
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    const scope = captureDbScope();
    void loadCompanionDevicePrefs(scope)
      .then((prefs) => {
        if (!alive) return;
        const moods: Record<string, BookMood> = {};
        for (const [key, value] of Object.entries(prefs.bookMoods ?? {})) {
          if (value) moods[key] = value;
        }
        setMoodByBook((prev) => ({ ...prev, ...moods }));
      })
      .catch(() => {
        /* preferencia local: si no se puede leer, el armario no la ofrece */
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const bookMood: BookMood | null = bookId ? (moodByBook[bookId] ?? null) : null;

  // Elegir ambiente guarda la etiqueta y viste al gato con lo que tenga de
  // ese look. Repetir el ambiente elegido lo quita (sin desvestir).
  const chooseMood = (mood: BookMood | null) => {
    if (!bookId) return;
    setMoodByBook((prev) => {
      const next: Record<string, BookMood> = { ...prev };
      if (mood) next[bookId] = mood;
      else delete next[bookId];
      return next;
    });
    void saveCompanionBookMood(bookId, mood, captureDbScope()).catch(() => {
      /* preferencia local: si falla, la próxima vez vuelve a preguntar */
    });
    const look = lookForMood(mood);
    if (!look) return;
    const status = lookStatus(look, owned);
    if (Object.keys(status.available).length === 0) return;
    triggerHaptic("selection");
    void chooseMany(status.available);
  };

  const portrait = portraitFigures(state ?? null, name);

  const portraitBlob = async (): Promise<Blob> => {
    const cat = portraitRef.current?.querySelector("svg.cat");
    if (!(cat instanceof SVGSVGElement)) throw new Error("sin gato que retratar");
    return buildPortraitPng({
      cat,
      figures: portrait,
      paper: themeColor("--paper", "#f6efe3"),
      ink: themeColor("--ink", "#2b2520"),
      inkSoft: themeColor("--ink-soft", "#6b5f52"),
      accent: themeColor("--vermilion", "#b23a2b"),
    });
  };

  const makePortrait = async (mode: "share" | "download") => {
    if (portraitBusy) return;
    setPortraitBusy(true);
    setPortraitError("");
    setPortraitNote("");
    try {
      const blob = await portraitBlob();
      const filename = portraitFilename(name);
      if (mode === "download") {
        downloadBlob(blob, filename);
        setPortraitNote("Retrato descargado.");
      } else {
        const how = await sharePortrait(blob, filename, portraitShareText(portrait));
        setPortraitNote(
          how === "shared" ? "Retrato compartido." : "Retrato descargado.",
        );
      }
    } catch {
      // Sin canvas o sin gato: se avisa y no se promete una imagen que no va.
      setPortraitError("No se pudo preparar el retrato. Intenta de nuevo.");
    } finally {
      setPortraitBusy(false);
    }
  };

  const prog = state ? levelProgress(state.xp) : null;
  const owned = state
    ? new Set<string>([
        "chaleco",
        ...unlockedAccessories(state),
        ...unlockedCoats(state),
      ])
    : new Set<string>();

  const chests = state ? pendingChests(state) : [];

  // Abrir cofre con ceremonia de sonido y háptica
  const doOpenChest = async (chest: GameChest) => {
    if (chestBusy) return;
    setChestBusy(chest.id);
    setChestError("");
    setRevealedChest(null);
    try {
      const scope = captureDbScope();
      await openGameChest(chest.id, scope);
      triggerPurrHaptic();
      playCompanionSound("purr");
      setRevealedChest(chest);
    } catch {
      setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
    } finally {
      setChestBusy(null);
    }
  };

  // Ponerse directamente la recompensa recién abierta
  const wearRevealed = async (article: string) => {
    if (equipBusy) return;
    const slot = COMPANION_ARTICLES[article as CompanionArticle];
    if (!slot) return;
    await choose(slot, article);
    setRevealedChest(null);
  };

  // Navegación con teclado entre pestañas
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const total = COMPANION_TABS.length;
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextIndex = (index + 1) % total;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextIndex = (index - 1 + total) % total;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = total - 1;
    }
    if (nextIndex !== index) {
      const nextTab = COMPANION_TABS[nextIndex].id;
      setTab(nextTab);
      clearTryOn();
      const el = document.getElementById(`companion-tab-${nextTab}`);
      el?.focus();
    }
  };

  // Datos para la ruta de recompensas y próximo botín
  const nextLevelIdx = prog ? prog.level + 1 : 0;
  const nextLevel = nextLevelIdx < LEVELS.length ? LEVELS[nextLevelIdx] : null;
  const nextRewardArticle = nextLevel
    ? (rewardForLevel(nextLevelIdx) as CompanionArticle)
    : null;
  const nextRewardCoat = nextLevel
    ? (Object.keys(COAT_LEVELS).find(
        (coat) => COAT_LEVELS[coat] === nextLevelIdx,
      ) as CompanionArticle | undefined)
    : undefined;
  const pointsRemaining =
    nextLevel && state
      ? Math.max(0, nextLevel.xp - Math.floor(state.xp))
      : 0;

  const earnedAchievements = state
    ? ACHIEVEMENTS.filter((a) => Boolean(state.achievements[a.id]))
    : [];

  const stageAccessories = withTryOn(accessories, tryOnArticle);

  return (
    <Sheet label={name} onClose={onClose} variant="stage">
      {/* Cabecera compacta: modo normal o modo edición */}
      {isEditingName ? (
        <form
          className="companion-head-edit"
          data-escape="local"
          onSubmit={saveName}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEditName();
            }
          }}
        >
          <div className="companion-head-edit-row">
            <input
              id="companion-name"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
              autoFocus
              aria-invalid={nameInvalid || undefined}
              aria-describedby={
                nameInvalid ? "companion-name-error" : undefined
              }
              aria-label="Nombre del gato"
              className="companion-name-input"
            />
            <div className="companion-head-edit-actions">
              <button
                type="submit"
                className="btn"
                disabled={!canSave || nameBusy}
              >
                {nameBusy ? "Guardando…" : "Guardar nombre"}
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={cancelEditName}
              >
                Cancelar
              </button>
            </div>
          </div>
          {nameInvalid ? (
            <p className="status" role="alert" id="companion-name-error">
              El nombre puede tener de 1 a 24 caracteres.
            </p>
          ) : null}
          {nameError ? (
            <p className="status" role="alert">
              {nameError}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="sheet-head companion-head">
          <div className="companion-head-name">
            <strong className="sheet-title companion-title">{name}</strong>
            <button
              ref={renameBtnRef}
              type="button"
              className="btn--quiet companion-rename-btn"
              onClick={() => {
                setDraft(name);
                setIsEditingName(true);
              }}
              aria-label="Cambiar nombre"
              title="Cambiar nombre"
            >
              ✎
            </button>
          </div>
          <div className="companion-head-meta">
            {prog ? (
              <span className="companion-head-level">
                Nivel {prog.level + 1} · {prog.name}
              </span>
            ) : null}
            <button
              type="button"
              className="btn--quiet"
              onClick={onClose}
              aria-label="Cerrar"
              data-autofocus
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Barra de progreso de XP fina anclada a la cabecera */}
      {prog && state ? (
        <div
          className="game-xpbar game-xpbar--fine"
          role="progressbar"
          aria-valuenow={Math.floor(state.xp)}
          aria-valuemin={prog.floor}
          aria-valuemax={prog.ceil ?? Math.floor(state.xp)}
          aria-label="Progreso de lectura"
          aria-valuetext={`Nivel ${prog.level + 1}, ${Math.floor(state.xp)} de ${prog.ceil ?? Math.floor(state.xp)} XP`}
        >
          <span style={{ width: `${prog.ratio * 100}%` }} />
        </div>
      ) : null}

      {!state || !prog ? (
        <p className="meta" style={{ padding: "var(--s-4)" }}>
          Llegando…
        </p>
      ) : (
        <div className="companion-stage-layout">
          {/* Rincón del gato: protagonista fijo con físicas de arrastre */}
          <CompanionStage
            name={name}
            stage={catStageForLevel(prog.level)}
            mood={mood}
            accessories={stageAccessories}
            focus={
              !activeCare &&
              !waving &&
              arrival &&
              state.stats.lastDayKey === dayKeyOf(arrival.at.getTime())
                ? "reading"
                : undefined
            }
            pose={
              happyReaction
                ? "pet"
                : activeCare
                  ? CARE_POSES[activeCare]
                  : waving
                    ? "greet"
                    : undefined
            }
            activeCare={activeCare}
            onCare={doCare}
            reducedMotion={reducedMotion}
            streakDays={state.stats.streakDays}
            hasReadToday={
              Boolean(arrival) &&
              state.stats.lastDayKey === dayKeyOf(arrival!.at.getTime())
            }
            greetingText={
              // Prioridad: la frase del armario justo después de vestirse
              // (es la respuesta del gato), si no el saludo de llegada.
              (tab === "closet" && happyReaction && !tryOnArticle
                ? closetComment(justWorn)
                : null) ??
              (waving ? greeting : null)
            }
            careStatusText={activeCare ? CARE_STATUS[activeCare](name) : null}
            tryOnArticle={tryOnArticle}
            tryOnLevel={tryOnLevel}
            onClearTryOn={clearTryOn}
            inCloset={tab === "closet"}
          />

          {/* Navegación por pestañas */}
          <div
            className="companion-sheet-tabs"
            role="tablist"
            aria-label="Secciones del compañero"
          >
            {COMPANION_TABS.map((t, idx) => {
              const isSelected = tab === t.id;
              return (
                <button
                  key={t.id}
                  id={`companion-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={`companion-panel-${t.id}`}
                  className="companion-tab-btn"
                  data-active={isSelected || undefined}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => {
                    setTab(t.id);
                    clearTryOn();
                  }}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                >
                  {t.label}
                  {t.id === "rewards" && chests.length > 0 ? (
                    <span
                      className="companion-badge-dot"
                      aria-label={`${chests.length} cofres por abrir`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Zona de contenido desplazable (solo la activa se monta) */}
          <div className="companion-sections-container">
            {/* TAB 1: CUIDADO */}
            {tab === "care" ? (
              <div
                id="companion-panel-care"
                role="tabpanel"
                aria-labelledby="companion-tab-care"
                className="companion-tabpanel"
              >
                {careError ? (
                  <p className="status" role="alert">
                    {careError}
                  </p>
                ) : null}

                <div
                  className="companion-actions"
                  role="group"
                  aria-label="Cuidar al gato"
                >
                  <button
                    type="button"
                    className="btn companion-action-btn"
                    disabled={activeCare !== null}
                    onClick={() => doCare("pet")}
                  >
                    <svg
                      aria-hidden="true"
                      className="companion-action-icon"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                    >
                      <path
                        fill="currentColor"
                        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                      />
                    </svg>
                    Acariciar
                  </button>
                  <button
                    type="button"
                    className="btn companion-action-btn"
                    disabled={activeCare !== null}
                    onClick={() => doCare("feed")}
                  >
                    <svg
                      aria-hidden="true"
                      className="companion-action-icon"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                    >
                      <path
                        fill="currentColor"
                        d="M3 13c0 4.4 3.6 8 8 8h2c4.4 0 8-3.6 8-8H3zm2-3c0-.6.4-1 1-1h12c.6 0 1 .4 1 1H5z"
                      />
                    </svg>
                    Dar de comer
                  </button>
                  <button
                    type="button"
                    className="btn companion-action-btn"
                    disabled={activeCare !== null}
                    onClick={() => doCare("play")}
                  >
                    <svg
                      aria-hidden="true"
                      className="companion-action-icon"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                    >
                      <circle cx="12" cy="12" r="7" fill="currentColor" />
                    </svg>
                    Jugar con la pelota
                  </button>
                </div>

                {/* Track 5: Atajo mágico para escanear personajes de la página actual sin spoilers */}
                {readerContext || onTriggerWhoIsOnPage || onTriggerWhereWasI ? (
                  <div
                    className="companion-reader-quick-actions"
                    style={{ margin: "var(--s-3) 0", textAlign: "center" }}
                  >
                    {onTriggerWhereWasI && (
                      <button
                        type="button"
                        className="btn companion-action-btn"
                        onClick={onTriggerWhereWasI}
                        aria-label="¿En qué me quedé?"
                        style={{ width: "100%", justifyContent: "center", marginBottom: "var(--s-2)" }}
                      >
                        ✨ ¿En qué me quedé? (15s)
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn companion-action-btn"
                      onClick={handleScanCharacters}
                      disabled={charactersLoading}
                      aria-label="¿Quién está en esta página?"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      👥 {charactersLoading ? "Buscando personajes…" : "¿Quién está en esta página?"}
                    </button>
                    {characterCards !== null && (
                      <div
                        className="companion-character-cards"
                        style={{ marginTop: "var(--s-3)", textAlign: "left" }}
                      >
                        {characterCards.length === 0 ? (
                          <p className="meta" style={{ margin: "var(--s-2) 0", fontSize: "0.85rem" }}>
                            No se detectaron personajes con menciones previas en esta página.
                          </p>
                        ) : (
                          <div
                            className="character-cards-list"
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "var(--s-2)",
                            }}
                          >
                            {characterCards.map((c, i) => (
                              <div
                                key={i}
                                className="character-card-item"
                                style={{
                                  padding: "var(--s-2) var(--s-3)",
                                  borderRadius: "var(--r-md)",
                                  background: "var(--card-bg, rgba(0, 0, 0, 0.04))",
                                  border: "1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))",
                                }}
                              >
                                <strong
                                  style={{
                                    display: "block",
                                    color: "var(--color-primary, #b45309)",
                                  }}
                                >
                                  {c.name}
                                </strong>
                                <span
                                  className="meta"
                                  style={{
                                    fontSize: "0.85rem",
                                    display: "block",
                                    marginTop: "2px",
                                  }}
                                >
                                  {c.oneLiner}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Estadísticas de lectura en fila compacta */}
                <div
                  className="companion-stats-summary"
                  aria-label="Resumen de lectura"
                >
                  <div className="companion-stat-item">
                    <span className="companion-stat-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                      </svg>
                    </span>
                    <div>
                      <span className="companion-stat-val">
                        {Math.round(state.stats.minutes)} min
                      </span>
                      <span className="companion-stat-label">Tiempo leído</span>
                    </div>
                  </div>
                  <div className="companion-stat-item">
                    <span className="companion-stat-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                        <path d="M6 6h10M6 10h10" />
                      </svg>
                    </span>
                    <div>
                      <span className="companion-stat-val">
                        {state.stats.booksFinished}
                      </span>
                      <span className="companion-stat-label">Libros leídos</span>
                    </div>
                  </div>
                  <div className="companion-stat-item">
                    <span className="companion-stat-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </span>
                    <div>
                      <span className="companion-stat-val">
                        {state.stats.saved}
                      </span>
                      <span className="companion-stat-label">
                        Palabras en Cuaderno
                      </span>
                    </div>
                  </div>
                  <div className="companion-stat-item">
                    <span className="companion-stat-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </span>
                    <div>
                      <span className="companion-stat-val">
                        {state.stats.streakDays}{" "}
                        {state.stats.streakDays === 1 ? "día" : "días"}
                      </span>
                      <span className="companion-stat-label">Racha actual</span>
                    </div>
                  </div>
                </div>

                {chests.length > 0 ? (
                  <div
                    className="companion-chest-card"
                    style={{ marginBlock: "var(--s-3)" }}
                  >
                    <div className="companion-chest-info">
                      <span className="companion-chest-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="8" width="18" height="13" rx="1.5" />
                          <path d="M2 8h20" />
                          <path d="M12 8v13" />
                          <path d="M7.5 8a2.5 2.5 0 0 1 0-5c2.5 0 4.5 5 4.5 5s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
                        </svg>
                      </span>
                      <div>
                        <p className="companion-chest-title">
                          ¡Tienes {chests.length} cofre
                          {chests.length === 1 ? "" : "s"} por abrir!
                        </p>
                        <p className="companion-chest-sub">
                          Descubre nuevos atuendos y estampas para tu compañero.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setTab("rewards");
                        clearTryOn();
                      }}
                    >
                      Ver premios
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* TAB 2: RECOMPENSAS Y COFRES */}
            {tab === "rewards" ? (
              <div
                id="companion-panel-rewards"
                role="tabpanel"
                className="companion-tabpanel companion-rewards-view"
                aria-labelledby="companion-tab-rewards"
              >
                {revealedChest ? (
                  <div className="companion-reveal-box" role="status">
                    <div className="companion-reveal-sparkle" aria-hidden="true">
                      ✨🎁✨
                    </div>
                    <h3 className="companion-reveal-title">¡Tesoro abierto!</h3>
                    <p className="companion-reveal-desc">
                      Has descubierto:{" "}
                      <strong>
                        {ACCESSORY_LABELS[revealedChest.reward] ??
                          revealedChest.reward}
                      </strong>
                      .
                    </p>
                    {Object.hasOwn(COMPANION_ARTICLES, revealedChest.reward) ? (
                      <div
                        className="actions"
                        style={{ justifyContent: "center" }}
                      >
                        <button
                          type="button"
                          className="btn"
                          disabled={equipBusy}
                          onClick={() => void wearRevealed(revealedChest.reward)}
                        >
                          Vestir a {name} ahora
                        </button>
                        <button
                          type="button"
                          className="btn--quiet"
                          disabled={equipBusy}
                          onClick={() => setRevealedChest(null)}
                        >
                          Guardar en el armario
                        </button>
                      </div>
                    ) : (
                      <div
                        className="actions"
                        style={{ justifyContent: "center" }}
                      >
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setRevealedChest(null);
                            setTab("collection");
                          }}
                        >
                          Ver en mi vitrina
                        </button>
                        <button
                          type="button"
                          className="btn--quiet"
                          onClick={() => setRevealedChest(null)}
                        >
                          Aceptar
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {chestError ? (
                  <p className="status" role="alert">
                    {chestError}
                  </p>
                ) : null}

                {chests.length > 0 ? (
                  <div className="companion-chests-list">
                    <h3 className="settings-group-title">
                      Tesoros por abrir ({chests.length})
                    </h3>
                    {chests.map((c) => (
                      <div key={c.id} className="companion-chest-card">
                        <div className="companion-chest-info">
                          <span
                            className="companion-chest-icon"
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="8" width="18" height="13" rx="1.5" />
                              <path d="M2 8h20" />
                              <path d="M12 8v13" />
                              <path d="M7.5 8a2.5 2.5 0 0 1 0-5c2.5 0 4.5 5 4.5 5s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
                            </svg>
                          </span>
                          <div>
                            <p className="companion-chest-title">{c.label}</p>
                            <p className="companion-chest-sub">
                              Toca para descubrir tu recompensa
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          disabled={chestBusy !== null}
                          onClick={() => void doOpenChest(c)}
                        >
                          {chestBusy === c.id ? "Abriendo…" : "Abrir cofre"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="companion-next-reward-card">
                    <div className="companion-next-reward-head">
                      <span className="setting-label">Estado de tesoros</span>
                      <span className="companion-item-badge">Al día</span>
                    </div>
                    <p className="meta" style={{ margin: 0 }}>
                      ¡Todos tus cofres están abiertos! Sigue leyendo y
                      subiendo de nivel para encontrar nuevos tesoros.
                    </p>
                  </div>
                )}

                {/* Próximo botín (Goal gradient) */}
                {nextLevel && (nextRewardArticle || nextRewardCoat) ? (
                  <div className="companion-next-reward-card">
                    <div className="companion-next-reward-head">
                      <span className="setting-label">Próximo botín en camino</span>
                      <span className="companion-item-badge">
                        Faltan {pointsRemaining} puntos
                      </span>
                    </div>
                    <p style={{ margin: "0 0 var(--s-2)", fontWeight: 600 }}>
                      Nivel {nextLevelIdx + 1} · {nextLevel.name}
                    </p>
                    <p className="meta" style={{ margin: 0 }}>
                      Desbloqueará:{" "}
                      {nextRewardArticle ? (
                        <strong>{ARTICLE_LABELS[nextRewardArticle]}</strong>
                      ) : null}
                      {nextRewardArticle && nextRewardCoat ? " y " : ""}
                      {nextRewardCoat ? (
                        <strong>Pelaje {ARTICLE_LABELS[nextRewardCoat]}</strong>
                      ) : null}
                      .
                    </p>
                  </div>
                ) : null}

                {/* Ruta de niveles y recompensas */}
                <div>
                  <h3 className="settings-group-title">
                    Ruta de Niveles de Biblioteca
                  </h3>
                  <div className="companion-roadmap">
                    {LEVELS.map((lvl, idx) => {
                      const isAchieved = prog.level >= idx;
                      const isNext = prog.level + 1 === idx;
                      const rawReward = rewardForLevel(idx);
                      const reward = Object.hasOwn(COMPANION_ARTICLES, rawReward)
                        ? (rawReward as CompanionArticle)
                        : null;
                      const coat = Object.keys(COAT_LEVELS).find(
                        (c) => COAT_LEVELS[c] === idx,
                      ) as CompanionArticle | undefined;

                      return (
                        <div
                          key={idx}
                          className="companion-roadmap-item"
                          data-status={
                            isAchieved
                              ? "achieved"
                              : isNext
                                ? "next"
                                : "locked"
                          }
                        >
                          <div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.4rem",
                              }}
                            >
                              <span aria-hidden="true">{isAchieved ? "✓" : isNext ? "→" : "—"}</span>
                              <strong>
                                Nivel {idx + 1} · {lvl.name}
                              </strong>
                            </div>
                            <span
                              className="meta"
                              style={{ fontSize: "var(--fs-xs)" }}
                            >
                              {lvl.xp} puntos{" "}
                              {reward ? `· ${ARTICLE_LABELS[reward]}` : ""}
                              {coat ? ` · ${ARTICLE_LABELS[coat]}` : ""}
                            </span>
                          </div>
                          <span className="companion-item-badge">
                            {isAchieved
                              ? "Conseguido"
                              : isNext
                                ? "Siguiente"
                                : "Bloqueado"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {/* TAB 3: ARMARIO */}
            {tab === "closet" ? (
              <div
                id="companion-panel-closet"
                role="tabpanel"
                className="companion-tabpanel"
                aria-labelledby="companion-tab-closet"
              >
                <CompanionCloset
                  equipped={equipped}
                  stage={catStageForLevel(prog.level)}
                  owned={owned}
                  equipBusy={equipBusy}
                  closetError={closetError}
                  state={state}
                  bookId={bookId}
                  bookMood={bookMood}
                  onBookMood={chooseMood}
                  onChoose={choose}
                  onChooseMany={chooseMany}
                  onTryOn={handleTryOn}
                  onClearTryOn={clearTryOn}
                  tryOnArticle={tryOnArticle}
                />
              </div>
            ) : null}

            {/* TAB 4: VITRINA */}
            {tab === "collection" ? (
              <div
                id="companion-panel-collection"
                role="tabpanel"
                className="companion-tabpanel"
                aria-labelledby="companion-tab-collection"
              >
                {/* Retrato: el gato con su look y las cifras de la casa,
                    listo para descargar o compartir. */}
                <div className="portrait-card">
                  <div className="portrait-card__frame" ref={portraitRef}>
                    <Companion
                      stage={catStageForLevel(prog.level)}
                      mood={mood}
                      accessories={stageAccessories}
                      decorative
                    />
                    <p className="portrait-card__name">{name}</p>
                    <p className="portrait-card__level">{portrait.level}</p>
                    {portrait.lines.length ? (
                      <ul className="portrait-card__figures">
                        {portrait.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="portrait-card__empty">
                        Aún sin cifras: en cuanto leas, aparecerán aquí.
                      </p>
                    )}
                  </div>
                  <div className="portrait-card__actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={portraitBusy}
                      onClick={() => void makePortrait("share")}
                    >
                      {portraitBusy ? "Preparando…" : "Compartir retrato"}
                    </button>
                    <button
                      type="button"
                      className="btn--quiet portrait-card__download"
                      disabled={portraitBusy}
                      onClick={() => void makePortrait("download")}
                    >
                      Descargar
                    </button>
                  </div>
                  {portraitError ? (
                    <p className="status" role="alert">
                      {portraitError}
                    </p>
                  ) : null}
                  {portraitNote ? (
                    <p className="meta" role="status">
                      {portraitNote}
                    </p>
                  ) : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBlockEnd: "var(--s-3)",
                  }}
                >
                  <h3 className="settings-group-title" style={{ margin: 0 }}>
                    Álbum de Estampas de Lectura
                  </h3>
                  <span className="companion-item-badge">
                    {earnedAchievements.length} de {ACHIEVEMENTS.length} conseguidas
                  </span>
                </div>

                <div className="vitrina-families">
                  {listFamilyProgress(state).map((famProg) => {
                    const isMax = famProg.nextAchievement === null;
                    const rankText = isMax
                      ? "Rango máximo"
                      : famProg.ranksEarned === 0
                        ? "Sin iniciar"
                        : `Rango ${toRoman(famProg.ranksEarned)} de ${toRoman(famProg.ranksTotal)}`;
                    const hintText = isMax
                      ? `${Math.floor(famProg.current)} ${Math.floor(famProg.current) === 1 ? famProg.info.unit.singular : famProg.info.unit.plural} en total`
                      : `${Math.floor(famProg.current)} de ${famProg.goal} ${famProg.goal === 1 ? famProg.info.unit.singular : famProg.info.unit.plural}`;

                    return (
                      <div key={famProg.family} className="family-card">
                        <div className="family-card-head">
                          <Seal
                            family={famProg.family}
                            rank={famProg.ranksEarned}
                            maxRank={famProg.ranksTotal}
                            size={48}
                          />
                          <div className="family-card-info">
                            <div className="family-card-title-row">
                              <h4 className="family-card-name">{famProg.info.name}</h4>
                              <span className="family-card-rank-text">
                                {rankText}
                              </span>
                            </div>
                            <ProgressInk
                              value={famProg.current}
                              max={famProg.goal}
                              variant={isMax ? "ink" : "ochre"}
                              reducedMotion={reducedMotion}
                            />
                            <p className="family-card-hint">{hintText}</p>
                          </div>
                        </div>

                        <details className="family-ranks-details">
                          <summary>
                            {isMax
                              ? "Ver todos los rangos (completada)"
                              : "Ver rangos de esta familia"}
                          </summary>
                          <ul className="family-ranks-list">
                            {famProg.achievements.map((ach, idx) => {
                              const earnedAt = state.achievements[ach.id];
                              const isEarned = Boolean(earnedAt);
                              const isNew = Boolean(
                                earnedAt && Date.now() - earnedAt <= 7 * 86_400_000,
                              );
                              return (
                                <li
                                  key={ach.id}
                                  className="family-rank-item"
                                  data-earned={isEarned}
                                >
                                  <div className="family-rank-item-meta">
                                    <span className="family-rank-roman">
                                      {toRoman(idx + 1)}
                                    </span>
                                    <span className="family-rank-title">
                                      {ach.title}
                                    </span>
                                    {isNew ? (
                                      <span className="family-badge-new">
                                        Nuevo
                                      </span>
                                    ) : null}
                                  </div>
                                  <span className="family-rank-points">
                                    +{ach.xp} puntos
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      </div>
                    );
                  })}
                </div>

                {state.finishedBooks.length > 0 ? (
                  <div style={{ marginBlockStart: "var(--s-5)" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBlockEnd: "var(--s-3)",
                      }}
                    >
                      <h3 className="settings-group-title" style={{ margin: 0 }}>
                        Exlibris de Libros Completados
                      </h3>
                      <span className="companion-item-badge">
                        {state.finishedBooks.length} libro{state.finishedBooks.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="exlibris-grid">
                      {state.finishedBooks.map((hash) => {
                        const meta = booksMap.get(hash);
                        if (meta && meta.title) {
                          return (
                            <div key={hash} className="exlibris-card">
                              <div className="exlibris-frame">
                                {meta.cover ? (
                                  <img
                                    src={meta.cover}
                                    alt={`Portada de ${meta.title}`}
                                    className="exlibris-cover"
                                  />
                                ) : (
                                  <div className="exlibris-seal-icon">
                                    <Seal
                                      family="libros"
                                      rank={1}
                                      maxRank={1}
                                      size={40}
                                    />
                                  </div>
                                )}
                                <p className="exlibris-title">{meta.title}</p>
                                {meta.author ? (
                                  <p className="exlibris-author">{meta.author}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={hash} className="exlibris-card">
                            <div className="exlibris-frame">
                              <div className="exlibris-seal-icon">
                                <Seal
                                  family="libros"
                                  rank={1}
                                  maxRank={1}
                                  size={40}
                                />
                              </div>
                              <p className="exlibris-title">Libro terminado</p>
                              <p className="exlibris-author">Biblioteca de Lecta</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}
