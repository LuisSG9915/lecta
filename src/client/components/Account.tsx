import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import { PENDING_DELETE_KEY } from "../lib/account-cleanup";
import {
  captureDbScope,
  listKnowledge,
  listSavedWords,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "../lib/idb";
import { loadUseAi, saveUseAi } from "../lib/ai-pref";
import { clearLastUserId } from "../lib/last-user";
import { loadHistoryEnabled, saveHistoryEnabled } from "../lib/reading-events";
import {
  loadCompanionDevicePrefs,
  loadGameEnabled,
  readCompanionField,
  saveCompanionDevicePrefs,
  saveGameEnabled,
  writeCompanionField,
} from "../lib/game";
import { setSoundEnabled } from "../lib/companion-audio";
import { applyCatMotion } from "./CompanionProvider";
import {
  COMPANION_MOTION,
  READING_PRESENCE,
  type CompanionDevicePrefs,
  type CompanionMotion,
  type ReadingPresence,
} from "../../shared/companion-data";
import {
  DEFAULT_THRESHOLD_LEARNER,
  DEFAULT_THRESHOLD_NATIVE,
  estimateStoredProfile,
  isCredibleKnowledge,
  vocabLevelLabel,
} from "../lib/knowledge";
import { fetchCalibrationSample, type CalibrationWord } from "../lib/calibration";
import {
  parseReadingGoal,
  READING_GOAL_KEY,
  serializeReadingGoal,
} from "../lib/reading-goal";
import { downloadBackup } from "../lib/export";
import { timeAgo } from "../lib/relative-time";
import { getDictionaryCacheWordCount, emptyDictionaryCache } from "../lib/offline-dictionary";
import {
  loadNativeLanguage,
  readerProfileFor,
  saveNativeLanguage,
  type ThemeChoice,
} from "../lib/settings";
import { levelProgress } from "../lib/gamification";
import Dialog from "./Dialog";
import Toggle from "./Toggle";
import Icon from "./Icon";
import ThemeMenu from "./ThemeMenu";
import { useCompanionSafe } from "./CompanionProvider";

export { PENDING_DELETE_KEY };

type AccountProps = {
  onClose: () => void;
  resetToken?: string;
  onResetDone?: () => void;
  // «Ajustar mi vocabulario»: la muestra se descarga aquí para poder
  // avisar si falla; la hoja la monta App porque el diálogo de Cuenta
  // la taparía.
  onOpenCalibration: (words: CalibrationWord[], language?: string) => void;
  presentation?: "overlay" | "page";
  onOpenJourney?: () => void;
  theme?: ThemeChoice;
  onThemeChange?: (theme: ThemeChoice) => void;
};

async function loadVocabSummary(
  language: string,
  scope: DbScope,
  nativeLang = loadNativeLanguage(),
): Promise<string> {
  const [allRows, savedWords] = await Promise.all([
    listKnowledge(language, scope).catch(() => []),
    listSavedWords(language, scope).catch(() => []),
  ]);
  const savedLemmas = new Set<string>();
  for (const word of savedWords)
    for (const term of [word.form, word.lemma])
      if (term) savedLemmas.add(term.toLowerCase());
  const rows = allRows.filter((row) =>
    isCredibleKnowledge(row, savedLemmas),
  );
  if (!rows.length) {
    return "Aún sin medición; se ofrece una prueba breve al terminar tu primer capítulo.";
  }
  const knownCount = rows.filter((row) => row.known).length;
  const readerProf = readerProfileFor(nativeLang, language);
  const baseThreshold =
    readerProf === "native"
      ? DEFAULT_THRESHOLD_NATIVE
      : DEFAULT_THRESHOLD_LEARNER;
  const profile = await estimateStoredProfile(rows, language, 0, baseThreshold);
  return profile
    ? `${knownCount} palabras que ya conoces · nivel estimado: ${vocabLevelLabel(profile.threshold, readerProf)}`
    : `${knownCount} palabras que ya conoces · sin conexión no se puede estimar el nivel`;
}

function translateAuthError(message?: string): string {
  if (!message) return "No se pudo completar la acción.";
  const lower = message.toLowerCase();
  if (lower.includes("invalid email or password") || lower.includes("invalid_email_or_password")) {
    return "Correo o contraseña incorrectos.";
  }
  if (lower.includes("invalid email") || lower.includes("invalid_email")) {
    return "El correo electrónico no tiene un formato válido.";
  }
  if (lower.includes("user not found") || lower.includes("user_not_found")) {
    return "No se encontró ningún usuario con este correo.";
  }
  if (lower.includes("password is too short") || lower.includes("password_too_short")) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }
  if (lower.includes("password is too long") || lower.includes("password_too_long")) {
    return "La contraseña es demasiado larga.";
  }
  if (lower.includes("invalid token") || lower.includes("invalid_token")) {
    return "El enlace ya venció o no es válido. Pide uno nuevo.";
  }
  if (lower.includes("user already exists") || lower.includes("user_already_exists")) {
    return "Ya existe una cuenta con este correo. Inicia sesión o pide un enlace.";
  }
  return message;
}

export default function Account({
  onClose,
  resetToken,
  onResetDone,
  onOpenCalibration,
  presentation = "overlay",
  onOpenJourney,
  theme,
  onThemeChange,
}: AccountProps) {
  const isPage = presentation === "page";
  const companion = useCompanionSafe();
  const progress = companion?.state ? levelProgress(companion.state.xp) : null;
  const journeySummary =
    progress?.level != null
      ? `Nivel ${progress.level} · ${companion?.state?.stats.streakDays ?? 0} días en racha`
      : "Hitos, ritmo y progreso de lectura";

  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showChange, setShowChange] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(Boolean(resetToken));
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "magic" | "forgot" | "reset">(
    resetToken ? "reset" : "signin",
  );

  const [prevResetToken, setPrevResetToken] = useState(resetToken);
  if (prevResetToken !== resetToken) {
    setPrevResetToken(resetToken);
    if (resetToken) {
      setAuthMode("reset");
      setShowAuthModal(true);
    }
  }

  const [credentialInfo, setCredentialInfo] = useState<{
    userId: string;
    has: boolean;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  // Preferencia «Usar IA»: se lee una vez al abrir el panel y el
  // interruptor la persiste; los demás componentes la releen al montar.
  const [useAi, setUseAi] = useState(true);
  // Preferencia «historial de lectura» (trayecto local): misma mecánica.
  const [historyOn, setHistoryOn] = useState(true);
  // Preferencia «compañero y logros» (el gato del Cuaderno): igual.
  const [gameOn, setGameOn] = useState(true);
  // Presencia del gato al leer — registro del perfil del compañero:
  // con sesión sincroniza por la cuenta, sin ella queda en el dispositivo.
  const [presence, setPresence] = useState<ReadingPresence>("visits");
  // Preferencias del dispositivo (companionDevicePrefs): el sonido
  // nace apagado y no viaja a otros dispositivos. null = cargando.
  const [devicePrefs, setDevicePrefs] = useState<CompanionDevicePrefs | null>(
    null,
  );
  // Meta semanal de lectura (días 1–7, null = sin meta): local por
  // dispositivo; viaja anónimo→cuenta pero no al servidor.
  const [goalDays, setGoalDays] = useState<number | null>(null);
  // Resumen del modelo de conocimiento para «Tu vocabulario»: qué
  // tanto sabe el lector según la evidencia guardada en cada idioma.
  const [vocabInfoEs, setVocabInfoEs] = useState<string | null>(null);
  const [vocabInfoEn, setVocabInfoEn] = useState<string | null>(null);
  const [loadingSampleLang, setLoadingSampleLang] = useState<string | null>(null);
  const [cachedDictWords, setCachedDictWords] = useState<number | null>(null);
  const [nativeLanguage, setNativeLanguage] = useState<string>(() => loadNativeLanguage());

  const changeNativeLanguage = (val: string) => {
    setNativeLanguage(val);
    saveNativeLanguage(val);
  };

  const userId = session?.user?.id;

  // Última sincronización del cuaderno y estado de conexión, para
  // decirle a la persona dónde están sus palabras sin adivinar.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadSessionValue("vocabLastSyncAt", captureDbScope()).then((raw) => {
      if (!cancelled) setLastSync(raw ? Number(raw) : null);
    });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      cancelled = true;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [userId]);
  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void loadUseAi(scope).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    void loadHistoryEnabled(scope).then((on) => {
      if (!cancelled) setHistoryOn(on);
    });
    void loadGameEnabled(scope).then((on) => {
      if (!cancelled) setGameOn(on);
    });
    void loadCompanionDevicePrefs(scope).then((prefs) => {
      if (!cancelled) setDevicePrefs(prefs);
    });
    void getDictionaryCacheWordCount(scope).then((count) => {
      if (!cancelled) setCachedDictWords(count);
    });
    void readCompanionField("readingPresence", scope).then((reg) => {
      if (cancelled) return;
      const value = reg?.value;
      setPresence(
        (READING_PRESENCE as readonly unknown[]).includes(value)
          ? (value as ReadingPresence)
          : "visits",
      );
    });
    void loadSessionValue(READING_GOAL_KEY, scope).then((raw) => {
      if (!cancelled) setGoalDays(parseReadingGoal(raw)?.daysPerWeek ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // La estimación consulta el catálogo para el zipf de cada lema con
  // evidencia; sin conexión se muestra solo el conteo, sin inventar
  // un nivel.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = captureDbScope();
      const [esText, enText] = await Promise.all([
        loadVocabSummary("es", scope, nativeLanguage),
        loadVocabSummary("en", scope, nativeLanguage),
      ]);
      if (!cancelled) {
        setVocabInfoEs(esText);
        setVocabInfoEn(enText);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nativeLanguage]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetch("/api/auth/list-accounts", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : []))
      .then((list: unknown) => {
        if (cancelled) return;
        const accounts = Array.isArray(list) ? list : [];
        setCredentialInfo({
          userId,
          has: accounts.some(
            (account) => (account as { providerId?: string }).providerId === "credential",
          ),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const hasCredential =
    credentialInfo && credentialInfo.userId === userId ? credentialInfo.has : null;

  const run = async (
    action: () => Promise<{ error?: { message?: string } | null } | undefined>,
  ) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.error) setError(translateAuthError(result.error.message));
      return result;
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo.");
      return;
    }
    if (!password) {
      setError("Por favor, introduce tu contraseña.");
      return;
    }
    void run(async () => {
      const result = await authClient.signIn.email({ email: cleanEmail, password });
      if (!result?.error) {
        setShowAuthModal(false);
        if (!isPage) onClose();
      }
      return result;
    });
  };

  const signUp = (event?: FormEvent) => {
    event?.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para registrarte.");
      return;
    }
    if (!password || password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const name = cleanEmail.split("@")[0] || "Lector";
    void run(async () => {
      const result = await authClient.signUp.email({ email: cleanEmail, password, name });
      if (!result?.error) {
        setShowAuthModal(false);
        if (!isPage) onClose();
      }
      return result;
    });
  };

  const sendMagicLink = () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para enviarte el enlace.");
      return;
    }
    void run(async () => {
      const result = await authClient.signIn.magicLink({ email: cleanEmail, callbackURL: "/" });
      if (!result?.error) setMessage("Si el correo está registrado, enviamos un enlace de acceso.");
      return result;
    });
  };

  const sendResetLink = () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Por favor, introduce tu correo para enviarte el enlace de restablecimiento.");
      return;
    }
    void run(async () => {
      const result = await authClient.requestPasswordReset({ email: cleanEmail, redirectTo: "/" });
      if (!result?.error)
        setMessage("Si el correo está registrado, enviamos un enlace para restablecer la contraseña.");
      return result;
    });
  };

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    void run(async () => {
      const result = await authClient.resetPassword({ newPassword, token: resetToken ?? "" });
      if (!result?.error) {
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail) {
          const loginResult = await authClient.signIn.email({
            email: cleanEmail,
            password: newPassword,
          });
          if (!loginResult?.error) {
            setShowAuthModal(false);
            if (!isPage) onClose();
            return loginResult;
          }
        }
        setMessage("Contraseña actualizada. Ya puedes entrar con ella.");
        setPassword(newPassword);
        setNewPassword("");
        onResetDone?.();
        setShowAuthModal(false);
        if (!isPage) onClose();
      }
      return result;
    });
  };

  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (!result?.error) {
        setMessage("Contraseña actualizada. Las demás sesiones se cerraron.");
        setCurrentPassword("");
        setNewPassword("");
        setShowChange(false);
      }
      return result;
    });
  };

  const sendSetPasswordLink = () => {
    void run(async () => {
      const result = await authClient.requestPasswordReset({
        email: session?.user?.email ?? "",
        redirectTo: "/",
      });
      if (!result?.error)
        setMessage("Te enviamos un correo para definir tu contraseña.");
      return result;
    });
  };

  const requestDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void run(async () => {
      // El correo confirma el borrado y redirige aquí: esa marca es la
      // única evidencia de que la cuenta se eliminó (la sesión se revoca).
      const result = await authClient.deleteUser({ callbackURL: "/?cuenta=eliminada" });
      if (!result?.error) {
        if (session?.user?.id) localStorage.setItem(PENDING_DELETE_KEY, session.user.id);
        setConfirmDelete(false);
        setMessage(
          "Te enviamos un correo para confirmar el borrado. Tu cuenta se elimina al abrir ese enlace.",
        );
      }
      return result;
    });
  };

  const signOut = () => {
    void run(async () => {
      const result = await authClient.signOut();
      if (result?.error) return result;
      // El marcador de arranque optimista solo apunta a sesiones
      // vigentes: cerrar sesión aquí lo limpia de inmediato.
      clearLastUserId();
      onClose();
      return {};
    });
  };

  // Si el guardado falla se revierte el interruptor: mostrarla encendida
  // cuando no quedó escrita fingiría una preferencia que no existe.
  const toggleUseAi = () => {
    const next = !useAi;
    setUseAi(next);
    void saveUseAi(next, captureDbScope()).catch(() => {
      setUseAi(!next);
      setError("No se pudo guardar la preferencia. Intenta de nuevo.");
    });
  };

  const toggleHistory = () => {
    const next = !historyOn;
    setHistoryOn(next);
    void saveHistoryEnabled(next, captureDbScope()).catch(() => {
      setHistoryOn(!next);
      setError("No se pudo guardar la preferencia. Intenta de nuevo.");
    });
  };

  const toggleGame = () => {
    const next = !gameOn;
    setGameOn(next);
    void saveGameEnabled(next, captureDbScope()).catch(() => {
      setGameOn(!next);
      setError("No se pudo guardar la preferencia. Intenta de nuevo.");
    });
  };

  // El sonido del gato es de este dispositivo: se guarda en
  // companionDevicePrefs y se empuja al módulo de audio al instante —
  // no hay notify que haga releer al proveedor.
  const toggleSound = () => {
    const prev: CompanionDevicePrefs = devicePrefs ?? {
      version: 1,
      soundEnabled: false,
      motion: "system",
    };
    const next: CompanionDevicePrefs = {
      ...prev,
      soundEnabled: !prev.soundEnabled,
    };
    setDevicePrefs(next);
    setSoundEnabled(next.soundEnabled);
    void saveCompanionDevicePrefs(next, captureDbScope()).then(
      // Reafirma tras escribir: una recarga del proveedor que leyó la
      // preferencia vieja en la ventana del guardado queda corregida.
      () => setSoundEnabled(next.soundEnabled),
      () => {
        setDevicePrefs(prev);
        setSoundEnabled(prev.soundEnabled);
        setError("No se pudo guardar la preferencia. Intenta de nuevo.");
      },
    );
  };

  // Las animaciones del compañero también son de este dispositivo:
  // viven en companionDevicePrefs con el sonido. El atributo de
  // <html> se aplica al instante y el proveedor lo reafirma cuando
  // el guardado dispara la recarga (saveCompanionDevicePrefs avisa).
  const changeMotion = (raw: string) => {
    if (!(COMPANION_MOTION as readonly string[]).includes(raw)) return;
    const prev: CompanionDevicePrefs = devicePrefs ?? {
      version: 1,
      soundEnabled: false,
      motion: "system",
    };
    const next: CompanionDevicePrefs = {
      ...prev,
      motion: raw as CompanionMotion,
    };
    setDevicePrefs(next);
    applyCatMotion(next.motion);
    void saveCompanionDevicePrefs(next, captureDbScope()).then(
      () => applyCatMotion(next.motion),
      () => {
        setDevicePrefs(prev);
        applyCatMotion(prev.motion);
        setError("No se pudo guardar la preferencia. Intenta de nuevo.");
      },
    );
  };

  const changePresence = (raw: string) => {
    if (!(READING_PRESENCE as readonly string[]).includes(raw)) return;
    const prev = presence;
    const next = raw as ReadingPresence;
    setPresence(next);
    void writeCompanionField("readingPresence", next, captureDbScope()).catch(
      () => {
        setPresence(prev);
        setError("No se pudo guardar la preferencia. Intenta de nuevo.");
      },
    );
  };

  const changeGoal = (raw: string) => {
    const prev = goalDays;
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 7)) return;
    setGoalDays(next);
    void saveSessionValue(
      READING_GOAL_KEY,
      serializeReadingGoal(next),
      captureDbScope(),
    ).catch(() => {
      setGoalDays(prev);
      setError("No se pudo guardar la preferencia. Intenta de nuevo.");
    });
  };

  const handleClearDict = async () => {
    try {
      await emptyDictionaryCache(captureDbScope());
      setCachedDictWords(0);
      setMessage("Se limpió la memoria local del diccionario.");
    } catch {
      setError("No se pudo limpiar la memoria del diccionario.");
    }
  };

  // «Ajustar mi vocabulario»: descarga la muestra aquí (para avisar
  // si falla) y la hoja la abre App. Al terminar allá solo se guarda
  // y se cierra.
  const adjustVocabulary = async (lang = "es") => {
    if (loadingSampleLang) return;
    setLoadingSampleLang(lang);
    setError("");
    try {
      const profile = readerProfileFor(nativeLanguage, lang);
      const sample = await fetchCalibrationSample(lang, profile);
      if (sample.ok && sample.words.length) {
        onOpenCalibration(sample.words, lang);
      } else {
        setError("No se pudo cargar la lista de palabras. Intenta de nuevo con conexión.");
      }
    } finally {
      setLoadingSampleLang(null);
    }
  };

  const authModalNode = (
    <Dialog
      label="Tu cuenta"
      onClose={() => {
        setShowAuthModal(false);
        if (resetToken) onResetDone?.();
        if (!isPage) onClose();
      }}
    >
      <div className="sheet-head">
        <strong className="sheet-title">
          {authMode === "reset"
            ? "Restablecer contraseña"
            : authMode === "forgot"
              ? "Recuperar acceso"
              : authMode === "magic"
                ? "Enlace por correo"
                : authMode === "signup"
                  ? "Crear cuenta"
                  : "Iniciar sesión"}
        </strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={() => {
            setShowAuthModal(false);
            if (resetToken) onResetDone?.();
            if (!isPage) onClose();
          }}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {authMode === "signin" || authMode === "signup" ? (
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="auth-tab-btn"
            aria-selected={authMode === "signin"}
            onClick={() => {
              setError("");
              setMessage("");
              setAuthMode("signin");
            }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            className="auth-tab-btn"
            aria-selected={authMode === "signup"}
            onClick={() => {
              setError("");
              setMessage("");
              setAuthMode("signup");
            }}
          >
            Crear cuenta
          </button>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}

      {authMode === "signin" ? (
        <form className="field" onSubmit={signInWithPassword}>
          <label htmlFor="modal-email">Correo</label>
          <input
            id="modal-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="modal-password">Contraseña</label>
          <input
            id="modal-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Entrar
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("forgot");
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("magic");
              }}
            >
              Entrar con enlace por correo
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "signup" ? (
        <form className="field" onSubmit={signUp}>
          <label htmlFor="modal-signup-email">Correo</label>
          <input
            id="modal-signup-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="modal-signup-password">Contraseña</label>
          <input
            id="modal-signup-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="meta">Mínimo 8 caracteres.</span>
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Crear cuenta
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
              }}
            >
              ¿Ya tienes cuenta? Inicia sesión
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "magic" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            sendMagicLink();
          }}
        >
          <p className="meta">
            Acceso sin contraseña. Te enviaremos un enlace a tu correo para entrar directamente.
          </p>
          <label htmlFor="modal-magic-email">Correo</label>
          <input
            id="modal-magic-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.trim()}
              style={{ width: "100%" }}
            >
              Enviar enlace de acceso
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
              }}
            >
              Volver a entrar con contraseña
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "forgot" ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            sendResetLink();
          }}
        >
          <p className="meta">
            Escribe tu correo y te enviaremos las instrucciones para restablecer tu contraseña.
          </p>
          <label htmlFor="modal-forgot-email">Correo</label>
          <input
            id="modal-forgot-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.trim()}
              style={{ width: "100%" }}
            >
              Enviar instrucciones
            </button>
          </div>
          <div className="auth-aux-actions">
            <button
              type="button"
              className="btn--quiet"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
              }}
            >
              Volver a iniciar sesión
            </button>
          </div>
        </form>
      ) : null}

      {authMode === "reset" ? (
        <form className="field" onSubmit={resetPassword}>
          <p className="meta">Introduce tu nueva contraseña (mínimo 8 caracteres).</p>
          <label htmlFor="modal-reset-password">Nueva contraseña</label>
          <input
            id="modal-reset-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="actions" style={{ marginTop: "var(--s-2)" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ width: "100%" }}
            >
              Guardar contraseña
            </button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );

  if (!isPage) {
    if (!session?.user) {
      return authModalNode;
    }
    return (
      <Dialog label="Tu cuenta" onClose={onClose}>
        <div className="sheet-head">
          <strong className="sheet-title">Cuenta</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar cuenta"
            data-autofocus
          >
            Cerrar
          </button>
        </div>
        {message ? (
          <p role="status" className="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="status">
            {error}
          </p>
        ) : null}
        <p>
          Sesión iniciada como <strong>{session.user.email}</strong>
        </p>
        <p className="meta">
          {!online
            ? "Sin conexión: el cuaderno se sincroniza al volver."
            : lastSync
              ? `Cuaderno sincronizado ${timeAgo(lastSync)}.`
              : "Este dispositivo aún no sincroniza tu cuaderno."}
        </p>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={signOut}>
            Cerrar sesión
          </button>
          {hasCredential ? (
            <button
              type="button"
              className="btn--quiet"
              disabled={busy}
              onClick={() => setShowChange(!showChange)}
            >
              {showChange ? "Cancelar" : "Cambiar contraseña"}
            </button>
          ) : hasCredential === false ? (
            <button
              type="button"
              className="btn--quiet"
              disabled={busy}
              onClick={sendSetPasswordLink}
            >
              Definir contraseña por correo
            </button>
          ) : null}
          <button
            type="button"
            className="btn--quiet btn--danger"
            disabled={busy}
            onClick={requestDelete}
          >
            {confirmDelete ? "¿Seguro? Borra cuenta, libros y vocabulario" : "Eliminar cuenta"}
          </button>
        </div>
        {showChange ? (
          <form className="field" onSubmit={changePassword} style={{ marginTop: "var(--s-3)" }}>
            <label htmlFor="current-password">Contraseña actual</label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <label htmlFor="new-password">Nueva contraseña</label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <div className="actions">
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Guardar
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setShowChange(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    );
  }

  return (
    <section className="account-page" aria-label="Tú">
      <header className="account-page-header">
        <h1 className="account-page-title">Tú</h1>
      </header>

      {onOpenJourney ? (
        <section className="account-journey-row">
          <button
            type="button"
            className="account-journey-btn"
            onClick={onOpenJourney}
          >
            <div className="account-journey-btn-icon">
              <Icon name="journey" size={24} />
            </div>
            <div className="account-journey-btn-info">
              <strong className="account-journey-btn-title">Tu recorrido</strong>
              <span className="account-journey-btn-sub">{journeySummary}</span>
            </div>
            <span className="account-journey-btn-arrow" aria-hidden="true">›</span>
          </button>
        </section>
      ) : null}

      {isPending ? <p className="meta">Cargando…</p> : null}

      {message && !showAuthModal ? (
        <p role="status" className="status">
          {message}
        </p>
      ) : null}
      {error && !showAuthModal ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}

      {/* Tarjeta 1: Sincronización y Modo Kindle */}
      {!isPending && session?.user ? (
        <section className="account-card" aria-label="Tu cuenta">
          <div className="account-card-header">
            <strong className="account-card-email">{session.user.email}</strong>
            <span className="meta">
              {!online
                ? "Sin conexión: el cuaderno se sincroniza al volver."
                : lastSync
                  ? `Cuaderno sincronizado ${timeAgo(lastSync)}.`
                  : "Sincronización activa en este dispositivo."}
            </span>
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={signOut}>
              Cerrar sesión
            </button>
            {hasCredential ? (
              <button
                type="button"
                className="btn--quiet"
                disabled={busy}
                onClick={() => setShowChange(!showChange)}
              >
                {showChange ? "Cancelar cambio" : "Cambiar contraseña"}
              </button>
            ) : hasCredential === false ? (
              <button
                type="button"
                className="btn--quiet"
                disabled={busy}
                onClick={sendSetPasswordLink}
              >
                Definir contraseña por correo
              </button>
            ) : null}
            <button
              type="button"
              className="btn--quiet btn--danger"
              disabled={busy}
              onClick={requestDelete}
            >
              {confirmDelete ? "¿Seguro? Borra cuenta, libros y vocabulario" : "Eliminar cuenta"}
            </button>
          </div>
          <div className="account-kindle-guide" style={{ marginTop: "var(--s-3)", borderTop: "1px solid var(--border-color, #e5e5e5)", paddingTop: "var(--s-3)" }}>
            <strong style={{ display: "block", marginBottom: "var(--s-1)" }}>Modo Kindle y Tinta Electrónica</strong>
            <p className="meta" style={{ marginBottom: "var(--s-2)" }}>Guía visual de 2 pasos para sincronizar con tu Kindle:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                <span style={{ fontWeight: "bold" }}>1.</span>
                <span className="meta">Abre el navegador experimental de tu Kindle e ingresa a <strong>/k</strong> (o lecta.app/k).</span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                <span style={{ fontWeight: "bold" }}>2.</span>
                <span className="meta">Inicia sesión con tu correo ({session.user.email}) para sincronizar libros, posición y notas al instante.</span>
              </div>
            </div>
          </div>
          {showChange ? (
            <form className="field" onSubmit={changePassword} style={{ marginTop: "var(--s-3)" }}>
              <label htmlFor="current-password">Contraseña actual</label>
              <input
                id="current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <label htmlFor="new-password">Nueva contraseña</label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <div className="actions">
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => setShowChange(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : !isPending ? (
        <section className="account-card" aria-label="Tu cuenta">
          <div className="account-card-header">
            <strong className="account-card-title">Sincronización en la nube</strong>
            <p className="account-card-desc">
              Guarda tus libros, tu avance y tu cuaderno para leer en cualquier dispositivo.
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setError("");
                setMessage("");
                setAuthMode("signin");
                setShowAuthModal(true);
              }}
            >
              Iniciar sesión o crear cuenta
            </button>
          </div>
          <div className="account-kindle-guide" style={{ marginTop: "var(--s-3)", borderTop: "1px solid var(--border-color, #e5e5e5)", paddingTop: "var(--s-3)" }}>
            <strong style={{ display: "block", marginBottom: "var(--s-1)" }}>Modo Kindle y Tinta Electrónica</strong>
            <p className="meta" style={{ marginBottom: "var(--s-2)" }}>Guía visual de 2 pasos para sincronizar con tu Kindle:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                <span style={{ fontWeight: "bold" }}>1.</span>
                <span className="meta">Abre el navegador experimental de tu Kindle e ingresa a <strong>/k</strong> (o lecta.app/k).</span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                <span style={{ fontWeight: "bold" }}>2.</span>
                <span className="meta">Inicia sesión con tu cuenta para sincronizar libros, avances y notas al instante.</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Tarjeta 2: Tu Nivel y Calibración */}
      <section className="account-card account-card--level" aria-label="Tu nivel y calibración">
        <div className="account-card-header">
          <strong className="account-card-title">Tu nivel y calibración</strong>
          <p className="account-card-desc">
            {vocabInfoEs ? vocabInfoEs : "Aún sin calibrar. Afina tu nivel para que Lecta adapte las ayudas léxicas a tus lecturas."}
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={loadingSampleLang !== null}
            onClick={() => void adjustVocabulary("es")}
          >
            {loadingSampleLang === "es" ? "Cargando…" : "Recalibrar mi vocabulario"}
          </button>
        </div>
      </section>

      {/* Tarjeta 3: Preferencias de Inteligencia Artificial y Datos Offline */}
      <section className="account-card" aria-label="Preferencias de IA y Datos Offline">
        <div className="account-card-header">
          <strong className="account-card-title">Preferencias de Inteligencia Artificial y Datos Offline</strong>
        </div>
        <div className="setting-row">
          <span className="setting-label">Usar IA para definir y corregir</span>
          <Toggle
            label="Usar IA para definir y corregir"
            checked={useAi}
            onChange={toggleUseAi}
          />
        </div>
        <p className="meta">
          {useAi
            ? "Activo: explicaciones contextuales de pasajes y ayuda adaptativa."
            : "Desactivado: solo definiciones del catálogo local y Wikcionario."}
        </p>
        <div className="setting-row" style={{ marginTop: "var(--s-2)" }}>
          <span className="setting-label">Memoria del diccionario offline</span>
          <span className="meta">
            {cachedDictWords && cachedDictWords > 0
              ? `${cachedDictWords} palabras cacheadas`
              : "Sin palabras cacheadas"}
          </span>
        </div>
      </section>

      <section className="account-section" aria-label="Lectura y vocabulario">
        <h2 className="eyebrow">Lectura y vocabulario</h2>

        {theme && onThemeChange ? (
          <div className="setting-block">
            <span className="setting-label">Apariencia</span>
            <p className="meta">
              Elige el fondo y el contraste que mejor se adapte a tu entorno de lectura.
            </p>
            <div style={{ marginTop: "var(--s-2)" }}>
              <ThemeMenu value={theme} onChange={onThemeChange} variant="swatches" />
            </div>
          </div>
        ) : null}

        <div className="setting-row">
          <span className="setting-label">Lengua materna</span>
          <select
            aria-label="Lengua materna"
            value={nativeLanguage}
            onChange={(event) => changeNativeLanguage(event.target.value)}
          >
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="fr">Francés</option>
            <option value="de">Alemán</option>
            <option value="pt">Portugués</option>
            <option value="it">Italiano</option>
          </select>
        </div>
        <p className="meta">
          Se usa para calibrar tu nivel de vocabulario, evitar falsas alarmas en palabras comunes y adaptar las explicaciones.
        </p>

        <div className="setting-block">
          <span className="setting-label">Calibración de vocabulario</span>
          <div className="setting-vocab-row">
            <div className="setting-vocab-info">
              <strong>Español</strong>
              <span className="meta">
                {vocabInfoEs === null ? "Revisando lo que conoces…" : vocabInfoEs}
              </span>
            </div>
            <button
              type="button"
              className="btn--quiet"
              disabled={loadingSampleLang !== null}
              onClick={() => void adjustVocabulary("es")}
            >
              {loadingSampleLang === "es" ? "Cargando…" : "Ajustar"}
            </button>
          </div>
          <div className="setting-vocab-row">
            <div className="setting-vocab-info">
              <strong>Inglés</strong>
              <span className="meta">
                {vocabInfoEn === null ? "Revisando lo que conoces…" : vocabInfoEn}
              </span>
            </div>
            <button
              type="button"
              className="btn--quiet"
              disabled={loadingSampleLang !== null}
              onClick={() => void adjustVocabulary("en")}
            >
              {loadingSampleLang === "en" ? "Cargando…" : "Ajustar"}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <span className="setting-label">Meta semanal de lectura</span>
          <select
            aria-label="Días de lectura por semana"
            value={goalDays ?? ""}
            onChange={(event) => changeGoal(event.target.value)}
          >
            <option value="">Sin meta</option>
            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
              <option key={days} value={days}>
                {days === 1 ? "1 día" : `${days} días`}
              </option>
            ))}
          </select>
        </div>
        <p className="meta">
          De lunes a domingo; un día cuenta cuando lees al menos un minuto. La meta se guarda en este dispositivo.
        </p>
      </section>

      <section className="account-section" aria-label="Compañero y logros">
        <h2 className="eyebrow">Compañero y logros</h2>
        <div className="setting-row">
          <span className="setting-label">El gato del cuaderno</span>
          <Toggle
            label="El gato del cuaderno"
            checked={gameOn}
            onChange={toggleGame}
          />
        </div>
        {gameOn ? (
          <>
            <div className="setting-row setting-row--stack">
              <span className="setting-label">El gato mientras lees</span>
              <div
                className="segmented segmented--wrap"
                role="group"
                aria-label="Presencia del gato al leer"
              >
                {(
                  [
                    ["off", "No mostrar"],
                    ["visits", "Visitas discretas"],
                    ["always", "Siempre cerca"],
                    ["playful", "Más juguetón"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    data-active={presence === val || undefined}
                    aria-pressed={presence === val}
                    onClick={() => void changePresence(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row setting-row--stack">
              <span className="setting-label">Animaciones del gato</span>
              <div
                className="segmented segmented--wrap"
                role="group"
                aria-label="Animaciones del gato"
              >
                {(
                  [
                    ["system", "Según el sistema"],
                    ["reduced", "Reducidas"],
                    ["full", "Completas"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    data-active={
                      (devicePrefs?.motion ?? "system") === val || undefined
                    }
                    aria-pressed={(devicePrefs?.motion ?? "system") === val}
                    onClick={() => void changeMotion(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="meta">
              Solo mueve al gato, sus festejos y sus cofres — el resto de Lecta sigue la regla de tu sistema.
            </p>
            <div className="setting-row">
              <span className="setting-label">Sonido del gato</span>
              <Toggle
                label="Sonido del gato"
                checked={devicePrefs?.soundEnabled ?? false}
                onChange={toggleSound}
              />
            </div>
            <p className="meta">
              Suena solo al abrir su hoja o mientras lo acaricias, y solo en este dispositivo.
            </p>
          </>
        ) : null}
        <p className="meta">
          Un gato de biblioteca crece contigo en el Cuaderno: niveles, logros y cofres por leer y repasar.{" "}
          {session?.user
            ? "Con sesión se guarda en tu cuenta y te acompaña en tus dispositivos."
            : "Todo queda en este dispositivo."}{" "}
          Apágalo y Lecta se ve igual que siempre.
        </p>
      </section>

      <details className="account-advanced-details">
        <summary className="account-advanced-summary">
          Avanzado y privacidad
        </summary>
        <div className="account-advanced-content">
          <div className="setting-block">
            <h3 className="eyebrow">Privacidad y datos</h3>
            <div className="setting-row">
              <span className="setting-label">Usar IA para definir y corregir</span>
              <Toggle
                label="Usar IA para definir y corregir"
                checked={useAi}
                onChange={toggleUseAi}
              />
            </div>
            <p className="meta">
              Solo viaja la palabra y su oración (≤ 500 caracteres). Nunca el libro, tu
              cuenta ni tu actividad.
            </p>
            <div className="setting-row">
              <span className="setting-label">Guardar el recorrido de lectura</span>
              <Toggle
                label="Guardar el recorrido de lectura"
                checked={historyOn}
                onChange={toggleHistory}
              />
            </div>
            <p className="meta">
              Anota en este dispositivo qué secciones abriste y qué palabras se sugirieron,
              para revisar y mejorar las sugerencias. No se sube a tu cuenta; sale en la
              copia de tus datos y se borra solo con el tiempo.
            </p>
            <div className="setting-row">
              <span className="setting-label">Copia de tus datos</span>
              <button
                type="button"
                className="btn--quiet"
                onClick={() =>
                  void downloadBackup().catch(() =>
                    setError("No se pudo preparar el respaldo. Intenta de nuevo."),
                  )
                }
              >
                Descargar mis datos (JSON)
              </button>
            </div>
            <p className="meta">
              Palabras, repasos, marcadores, posiciones y preferencias de este dispositivo.
              Los libros se re-suben solos si tienes cuenta.
            </p>
            <div className="setting-row">
              <span className="setting-label">Memoria del diccionario</span>
              {cachedDictWords && cachedDictWords > 0 ? (
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => void handleClearDict()}
                >
                  Liberar memoria ({cachedDictWords} palabras)
                </button>
              ) : (
                <span className="meta">Sin palabras cacheadas</span>
              )}
            </div>
            <p className="meta">
              {cachedDictWords && cachedDictWords > 0
                ? `${cachedDictWords} definiciones guardadas en este dispositivo para consulta sin conexión.`
                : "Las definiciones consultadas o descargadas se conservan aquí para que puedas leer sin conexión."}
            </p>
          </div>

          <div className="setting-block">
            <h3 className="eyebrow">Lectura en Kindle y Tinta Electrónica</h3>
            <p className="meta">
              ¿Tienes un Kindle o lector de tinta electrónica? Abre{" "}
              <a href="/k" target="_blank" rel="noreferrer">
                /k
              </a>{" "}
              desde su navegador para leer tus libros en una interfaz ultra-ligera, sin JavaScript y sincronizada con tu cuenta.
            </p>
          </div>

          <div className="setting-block">
            <h3 className="eyebrow">Acerca de</h3>
            <p className="meta">
              Diccionario base: simplemma (MIT; datos bajo ODbL 1.0 y licencias derivadas) y
              wordfreq (CC BY-SA 4.0 y fuentes con atribución). Definiciones del Wikcionario
              en español vía kaikki.org (CC BY-SA 4.0 / GFDL). Contiene información de
              «Lemmatization Lists» disponible bajo ODbL 1.0.{" "}
              <a
                href="https://github.com/LuisSG9915/lecta-lexicon-data"
                target="_blank"
                rel="noreferrer"
              >
                Tablas derivadas y licencias
              </a>
              .
            </p>
          </div>
        </div>
      </details>

      {showAuthModal ? authModalNode : null}
    </section>
  );
}
