// Proveedor único del compañero: carga una vez el estado del juego,
// los registros del perfil (nombre, equipped.*, lastCare) y las
// preferencias del dispositivo, y monta LA hoja CompanionPanel cuando
// se abre. Va en App.tsx envolviendo todo el contenido — así el
// GamePanel de hoy y las superficies futuras (Estantería, Lector)
// abren la misma hoja sin duplicar gatos ni estado.
//
// La cuenta visible la dicta la prop userId — App la fija solo cuando
// la base activa ya cambió (setDbUser), así un contexto capturado en
// medio de la transición jamás publica datos de la cuenta anterior:
// en el cambio el estado se limpia primero y la recarga se descarta
// si el contexto no es el de la cuenta vigente.

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CompanionTab } from "./CompanionPanel";

// La hoja y el festejo son la mitad del peso del proveedor y solo se ven
// cuando el usuario interactúa: entran diferidos para no pagarlos en el
// arranque (Fase 3). La precarga en idle evita el parpadeo en la primera
// apertura.
const CompanionPanel = lazy(() =>
  import("./CompanionPanel").then((m) => ({ default: m.CompanionPanel })),
);
const CompanionCelebration = lazy(() =>
  import("./CompanionCelebration").then((m) => ({ default: m.CompanionCelebration })),
);
import type { SearchSection, SearchTocRow } from "../lib/book-search";
import {
  loadCompanionDevicePrefs,
  loadGame,
  loadGameEnabled,
  loadGameSnapshot,
  markCompanionReceipt,
  subscribeGame,
} from "../lib/game";
import {
  captureDbScope,
  isDbScopeActive,
  readCompanionRegisters,
} from "../lib/idb";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import { modalLayerCount, subscribeModalLayers } from "../lib/modal";
import {
  pendingCelebrations,
  type CelebrationItem,
} from "../lib/companion-inbox";
import {
  getEquippedItems,
  mergeCompanionRegister,
  READING_PRESENCE,
  type CompanionCare,
  type CompanionMotion,
  type CompanionRegister,
  type CompanionReceipt,
  type EquippedItems,
  type LegacyGameBaseline,
  type ReadingPresence,
} from "../../shared/companion-data";
import {
  catMood,
  catStageForLevel,
  levelProgress,
  unlockedAccessories,
  unlockedCoats,
  type CatMood,
  type GameState,
} from "../lib/gamification";
import { startCare, type CareKind } from "../lib/companion-interactions";
import {
  playCompanionSound,
  setSoundEnabled,
  stopCompanionSound,
} from "../lib/companion-audio";

// ---- Resolución pura de ropa y humor (exportada para pruebas) ----

// Prendas que esta copia puede vestir: el chaleco es gratis, el
// resto llega de cofres ya abiertos localmente y los pelajes se
// desbloquean por el nivel proyectado (retroactivo: no dependen de
// un cofre).
export function ownedArticles(state: GameState): Set<string> {
  return new Set([
    "chaleco",
    ...unlockedAccessories(state),
    ...unlockedCoats(state),
  ]);
}

// Lo puesto, resolviendo las dos fuentes del contrato: si existe al
// menos un registro «equipped.*» mandan ellos — null explícito = la
// ranura va vacía a propósito; sin ninguno vale el default de
// importación calculado del inventario local (bufanda si la hay,
// si no collar; moño; anteojos; cuerpo vacío). Los defaults jamás se
// escriben: solo se usan para mostrar.
export function effectiveEquipped(
  registers: CompanionRegister[],
  state: GameState,
): EquippedItems {
  if (registers.some((r) => r.field.startsWith("equipped."))) {
    return getEquippedItems(registers);
  }
  const inv = ownedArticles(state);
  return {
    body: null,
    neck: inv.has("bufanda") ? "bufanda" : inv.has("collar") ? "collar" : null,
    head: inv.has("moño") ? "moño" : null,
    face: inv.has("anteojos") ? "anteojos" : null,
    // El pelaje no se autoequipa: el naranja natural es el default.
    coat: null,
  };
}

// Lo que el gato DIBUJA: lo puesto ∩ el inventario local. Una prenda
// elegida en otro dispositivo se conserva en el registro y en el
// armario (marcada bloqueada) pero no aparece hasta abrir su cofre.
export function drawableAccessories(
  equipped: EquippedItems,
  owned: ReadonlySet<string>,
): string[] {
  return Object.values(equipped).filter(
    (article): article is string => article !== null && owned.has(article),
  );
}

const isCompanionCare = (v: unknown): v is CompanionCare =>
  typeof v === "object" &&
  v !== null &&
  ((v as CompanionCare).kind === "pet" ||
    (v as CompanionCare).kind === "feed" ||
    (v as CompanionCare).kind === "play") &&
  typeof (v as CompanionCare).at === "number";

// Último cuidado desde los registros; combinado con caredAt decide
// si el gato amanece despierto — sin tocar el estado del juego.
export function lastCareOf(
  registers: CompanionRegister[],
): CompanionCare | null {
  const reg = mergeCompanionRegister(registers).find(
    (r) => r.field === "lastCare",
  );
  return isCompanionCare(reg?.value) ? reg.value : null;
}

// Nombre del gato desde los registros ya cargados — la misma regla
// de loadCompanionName (registro válido o «Gato»), sin releer disco.
const nameFrom = (registers: CompanionRegister[]): string => {
  const reg = mergeCompanionRegister(registers).find(
    (r) => r.field === "name",
  );
  return typeof reg?.value === "string" && reg.value ? reg.value : "Gato";
};

// Presencia del gato en el lector desde el registro «readingPresence»
// — la misma regla del selector de Cuenta: valor válido o «visits».
const presenceFrom = (registers: CompanionRegister[]): ReadingPresence => {
  const reg = mergeCompanionRegister(registers).find(
    (r) => r.field === "readingPresence",
  );
  const value = reg?.value;
  return (READING_PRESENCE as readonly unknown[]).includes(value)
    ? (value as ReadingPresence)
    : "visits";
};

// ---- Contexto ----

export type CompanionContextValue = {
  // Estado proyectado del juego; null mientras carga la primera vez
  // o durante un cambio de cuenta (nada de la cuenta previa queda).
  state: GameState | null;
  enabled: boolean | null;
  name: string;
  equipped: EquippedItems;
  accessories: string[];
  mood: CatMood;
  stage: number;
  // Presencia del gato en el lector (registro «readingPresence»):
  // «off» | «visits» (default) | «always» | «playful».
  presence: ReadingPresence;
  // Hay una capa modal abierta (hoja, diálogo, consulta): el lector
  // la usa para su overlay y el proveedor para diferir festejos.
  modalOpen: boolean;
  // Movimiento reducido EFECTIVO: combina la preferencia del
  // dispositivo («system»|«reduced»|«full») con la del sistema —
  // «full» siempre anima, «reduced» siempre reduce.
  reducedMotion: boolean;
  // Acción de cuidado en curso (una a la vez) — las capas la usan
  // para deshabilitar botones y anunciar el estado.
  activeCare: CareKind | null;
  open: boolean;
  openPanel: (tab?: CompanionTab) => void;
  closePanel: () => void;
  // La superficie visible (hoy solo el lector) reporta cuándo los
  // festejos deben quedar pendientes: presencia «off», supresión por
  // libro u overlay encima. Al desmontarse se libera sola.
  setCelebrationBlocked: (blocked: boolean) => void;
  // Arranca un cuidado y resuelve solo cuando la constancia quedó
  // escrita; si ya había una acción en curso resuelve sin hacer nada
  // — los botones deshabilitados hacen ese camino imposible por UI.
  care: (kind: CareKind) => Promise<void>;
  // Track 5: Contexto de lectura para atajos del gato en Reader
  readerContext?: CompanionReaderContext | null;
  setReaderContext?: (ctx: CompanionReaderContext | null) => void;
};

export type CompanionReaderContext = {
  pageText: string;
  currentChapterIndex: number;
  bookId: string;
  sections?: SearchSection[];
  toc?: SearchTocRow[];
  language?: string;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (!ctx) {
    throw new Error("useCompanion requiere estar dentro de CompanionProvider");
  }
  return ctx;
}

export function useCompanionSafe(): CompanionContextValue | null {
  return useContext(CompanionContext);
}

type Loaded = {
  // La cuenta cuyo contexto produjo estos datos — lo que se muestra
  // se filtra por ella, así un cambio de cuenta jamás exhibe lo de
  // la anterior aunque el estado viejo siga un instante en memoria.
  userId: string | null;
  state: GameState;
  enabled: boolean;
  registers: CompanionRegister[];
  // Baselines y recepciones del mismo snapshot: el inbox de festejos
  // distingue lo importado (no celebra) de lo ya visto (no repite).
  baselines: LegacyGameBaseline[];
  receipts: CompanionReceipt[];
  motion: CompanionMotion;
  loadedAt: number;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Resolución pura del modo efectivo: «full» siempre anima (aunque el
// sistema pida reducir), «reduced» siempre reduce y «system» sigue
// al sistema operativo.
export function catReducedMotion(
  motion: CompanionMotion,
  systemPrefers: boolean,
): boolean {
  return motion === "reduced" || (motion === "system" && systemPrefers);
}

// La preferencia en el DOM: <html data-cat-motion> es la llave con la
// que el CSS decide si las animaciones marcadas «cat-anim» viven
// (full), se reducen (reduced) o siguen al sistema (system).
export function applyCatMotion(motion: CompanionMotion) {
  document.documentElement.dataset.catMotion = motion;
}

export function CompanionProvider({
  userId,
  children,
}: {
  // La cuenta cuya base activa está lista (App la fija tras setDbUser;
  // null = anónimo). Un cambio limpia y recarga el compañero entero.
  userId: string | null;
  children: ReactNode;
}) {
  const [raw, setRaw] = useState<Loaded | null>(null);
  const [activeCare, setActiveCare] = useState<CareKind | null>(null);
  const [open, setOpen] = useState(false);
  const [readerContext, setReaderContext] = useState<CompanionReaderContext | null>(null);
  // Capas modales vivas (hojas/diálogos/consultas) y el reporte de la
  // superficie: con cualquiera de ellos el festejo queda pendiente.
  const [modalLayers, setModalLayers] = useState(() => modalLayerCount());
  const [surfaceBlocked, setSurfaceBlocked] = useState(false);
  // La hoja abierta lleva la cuenta que la abrió (null = anónimo):
  // si la cuenta cambia se deja de mostrar al instante y su entrada
  // de historial se suelta abajo — nada de la cuenta anterior queda
  // a la vista.
  const [panelUserId, setPanelUserId] = useState<string | null>(null);
  const overlayRef = useRef<OverlayHandle | null>(null);

  const closePanel = useCallback(() => {
    overlayRef.current?.release();
    overlayRef.current = null;
    setOpen(false);
  }, []);

  const [panelTab, setPanelTab] = useState<CompanionTab>("care");

  const openPanel = useCallback(
    (tab?: CompanionTab | unknown) => {
      if (
        typeof tab === "string" &&
        (tab === "care" || tab === "rewards" || tab === "closet" || tab === "collection")
      ) {
        setPanelTab(tab);
      } else {
        setPanelTab("care");
      }
      // Gesto voluntario (presionar al gato): maúlla si el sonido está
      // activo en este dispositivo; el módulo decide y no hace nada si
      // está apagado.
      playCompanionSound("meow");
      // El overlay integra la hoja con «atrás» del navegador; si ya
      // estaba abierta no se apila otra entrada de historial.
      overlayRef.current ??= pushOverlay(() => {
        overlayRef.current = null;
        setOpen(false);
      });
      setPanelUserId(userId);
      setOpen(true);
    },
    [userId],
  );

  // Al desmontar el provider la hoja se va sin tocar el historial —
  // el entry se libera por flujo normal si la app sigue viva.
  useEffect(
    () => () => {
      overlayRef.current?.swap(() => {
        /* el proveedor se fue: el cierre ya no aplica */
      });
    },
    [],
  );

  // Carga y suscripción: cada commit del juego (eventos, registros,
  // recepciones) relee el estado proyectado.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const bound = captureDbScope();
      // La prop userId es la cuenta cuya base ya cambió; si el
      // contexto capturado aún es de la cuenta anterior no se lee ni
      // se publica nada — la próxima recarga (por prop o notify)
      // ya llegará con la base correcta.
      if (bound.userId !== userId) return;
      // loadGame primero: sella la migración v1 (baseline escrita)
      // antes de leer el snapshot — un premio heredado leído antes de
      // migrar se festejaría en falso una vez.
      const [enabled, state] = await Promise.all([
        loadGameEnabled(bound),
        loadGame(bound),
      ]);
      const [registers, snapshot, prefs] = await Promise.all([
        readCompanionRegisters(bound).catch(() => []),
        loadGameSnapshot(bound).catch(() => null),
        loadCompanionDevicePrefs(bound),
      ]);
      if (!alive || !isDbScopeActive(bound) || bound.userId !== userId) {
        return;
      }
      // El sonido es preferencia del dispositivo: el módulo de audio
      // la guarda en memoria para no releer IndexedDB por gesto.
      setSoundEnabled(prefs.soundEnabled);
      setRaw({
        userId: bound.userId,
        state,
        enabled,
        registers,
        baselines: snapshot?.baselines ?? [],
        receipts: snapshot?.receipts ?? [],
        motion: prefs.motion,
        loadedAt: Date.now(),
      });
    };
    void refresh();
    const unsub = subscribeGame(() => void refresh());
    return () => {
      alive = false;
      unsub();
      // Cambio de cuenta o desmontaje: el clip en curso muere con el
      // contexto que lo pidió.
      stopCompanionSound();
    };
  }, [userId]);

  // Conteo de capas modales en vivo: el inbox de festejos espera a
  // que no haya hojas ni diálogos encima.
  useEffect(
    () =>
      subscribeModalLayers(() => setModalLayers(modalLayerCount())),
    [],
  );

  // La superficie (lector) reporta cuándo el festejo debe esperar;
  // callback estable para que el reporte no re-renderice en vano.
  const setCelebrationBlocked = useCallback((blocked: boolean) => {
    setSurfaceBlocked(blocked);
  }, []);

  // La hoja de la cuenta que se fue: suelta su entrada del historial;
  // el «atrás» resultante corre su cierre (setState allí, no aquí).
  useEffect(() => {
    if (open && panelUserId !== userId) {
      overlayRef.current?.release();
      overlayRef.current = null;
    }
  }, [userId, open, panelUserId]);

  // Al cerrarse la hoja — botón Cerrar, «atrás» del navegador o
  // cambio de cuenta — cualquier clip en curso se corta.
  useEffect(() => {
    if (!open) stopCompanionSound();
  }, [open]);

  // Lo cargado solo vale si pertenece a la cuenta vigente: mientras
  // llega la recarga de la cuenta nueva se ve «cargando», nunca los
  // datos de la que salió. La hoja igual: abierta pero de otra cuenta
  // = no se muestra.
  const loaded = raw !== null && raw.userId === userId ? raw : null;
  const panelOpen = open && panelUserId === userId;

  // El modo de movimiento vive en <html>: el CSS lo lee para dejar
  // animar al compañero (full) o reducirlo (reduced) sin recargar.
  useEffect(() => {
    applyCatMotion(loaded?.motion ?? "system");
  }, [loaded?.motion]);

  const reducedMotion = loaded
    ? catReducedMotion(loaded.motion, prefersReducedMotion())
    : false;
  const care = useCallback(
    (kind: CareKind): Promise<void> => {
      const handle = startCare(kind, {
        scope: captureDbScope(),
        reducedMotion,
      });
      if (!handle) return Promise.resolve();
      setActiveCare(kind);
      // La caricia ronronea mientras dura el gesto (~1.8 s); comida y
      // pelota van en silencio.
      if (kind === "pet") playCompanionSound("purr");
      const release = () => {
        setActiveCare((current) => (current === kind ? null : current));
        if (kind === "pet") stopCompanionSound();
      };
      return handle.promise.then(
        () => release(),
        (err) => {
          release();
          throw err;
        },
      );
    },
    [reducedMotion],
  );

  const registers = loaded?.registers ?? [];
  const state = loaded?.state ?? null;
  const name = nameFrom(registers);
  const equipped = state
    ? effectiveEquipped(registers, state)
    : { body: null, neck: null, head: null, face: null, coat: null };
  const accessories = state
    ? drawableAccessories(equipped, ownedArticles(state))
    : [];
  // El humor combina la última actividad de lectura con el último
  // cuidado — el registro despierta al gato sin tocar el juego.
  const lastCare = lastCareOf(registers);
  const mood: CatMood = state
    ? catMood(
        {
          ...state,
          caredAt: Math.max(state.caredAt, lastCare?.at ?? 0),
        },
        loaded?.loadedAt || state.caredAt || lastCare?.at || 1,
      )
    : "awake";
  const stage = state
    ? catStageForLevel(levelProgress(state.xp).level)
    : 0;
  const presence = presenceFrom(registers);

  // Inbox de festejos: premios ganados (logros nuevos o cambio de
  // etapa) que el baseline no trajo y aún no tienen recibo de visto.
  const celebrationItems: CelebrationItem[] =
    state && loaded?.enabled
      ? pendingCelebrations({
          state,
          baselines: loaded.baselines,
          receipts: loaded.receipts,
        })
      : [];
  // El festejo espera contexto seguro: nada de hojas/modales encima,
  // ni cuidado en curso, ni lectura que lo reportó como bloqueada
  // («off», supresión por libro u overlay). Pendiente, nunca perdido.
  const celebrationBlocked =
    !loaded?.enabled ||
    !state ||
    open ||
    activeCare !== null ||
    modalLayers > 0 ||
    surfaceBlocked;

  // La tarjeta se mostró de verdad: persiste el recibo (monotónico
  // e idempotente) — achievement-seen por cada logro del grupo,
  // level-seen:<n> por cada nivel cruzado (y stage-seen si coincide
  // con evolución) o stage-seen:<etapa> para la evolución suelta.
  const markCelebrationSeen = useCallback((item: CelebrationItem) => {
    const scope = captureDbScope();
    if (item.kind === "achievements") {
      for (const id of item.ids)
        void markCompanionReceipt("achievement-seen", id, scope);
    } else if (item.kind === "level") {
      for (const lvl of item.crossed)
        void markCompanionReceipt("level-seen", String(lvl), scope);
      if (item.stage !== undefined)
        void markCompanionReceipt("stage-seen", String(item.stage), scope);
    } else if (item.kind === "stage") {
      void markCompanionReceipt("stage-seen", String(item.stage), scope);
    }
  }, []);

  // Precarga en tiempo muerto: cuando el usuario abra la hoja, el chunk ya está.
  useEffect(() => {
    const prefetch = () => {
      void import("./CompanionPanel");
      void import("./CompanionCelebration");
    };
    const idle = (
      globalThis as typeof globalThis & {
        requestIdleCallback?: (
          cb: () => void,
          options?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(prefetch, { timeout: 3000 });
      return () => {
        (
          globalThis as typeof globalThis & {
            cancelIdleCallback?: (h: number) => void;
          }
        ).cancelIdleCallback?.(handle);
      };
    }
    const timer = setTimeout(prefetch, 2500);
    return () => clearTimeout(timer);
  }, []);

  const value: CompanionContextValue = {
    state,
    enabled: loaded?.enabled ?? null,
    name,
    equipped,
    accessories,
    mood,
    stage,
    presence,
    modalOpen: modalLayers > 0,
    reducedMotion,
    activeCare,
    open: panelOpen,
    openPanel,
    closePanel,
    setCelebrationBlocked,
    care,
    readerContext,
    setReaderContext,
  };

  return (
    <CompanionContext.Provider value={value}>
      {children}
      {panelOpen ? (
        <Suspense fallback={null}>
          <CompanionPanel
            state={state}
            name={name}
            equipped={equipped}
            accessories={accessories}
            mood={mood}
            activeCare={activeCare}
            onCare={care}
            onClose={closePanel}
            reducedMotion={reducedMotion}
            initialTab={panelTab}
            readerContext={readerContext}
          />
        </Suspense>
      ) : null}
      {/* Inbox de festejos: montado mientras el juego está encendido
          (no por `items.length` — un recibo que aterriza a mitad de
          tarjeta no debe cortarla). La key por cuenta limpia la
          memoria «mostrado» al cambiar A→B: nada se arrastra. */}
      {loaded?.enabled && state ? (
        <Suspense fallback={null}>
          <CompanionCelebration
            key={userId ?? "anon"}
            items={celebrationItems}
            blocked={celebrationBlocked}
            name={name}
            stage={stage}
            accessories={accessories}
            onSeen={markCelebrationSeen}
          />
        </Suspense>
      ) : null}
    </CompanionContext.Provider>
  );
}
