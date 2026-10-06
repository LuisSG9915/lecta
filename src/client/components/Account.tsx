import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth";
import { PENDING_DELETE_KEY } from "../lib/account-cleanup";
import {
  captureDbScope,
  listKnowledge,
  listSavedWords,
  loadSessionValue,
  saveSessionValue,
} from "../lib/idb";
import { loadUseAi, saveUseAi } from "../lib/ai-pref";
import { loadHistoryEnabled, saveHistoryEnabled } from "../lib/reading-events";
import { loadGameEnabled, saveGameEnabled } from "../lib/game";
import {
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
import Dialog from "./Dialog";

export { PENDING_DELETE_KEY };

type AccountProps = {
  onClose: () => void;
  resetToken?: string;
  onResetDone?: () => void;
  // «Ajustar mi vocabulario»: la muestra se descarga aquí para poder
  // avisar si falla; la hoja la monta App porque el diálogo de Cuenta
  // la taparía.
  onOpenCalibration: (words: CalibrationWord[]) => void;
};

export default function Account({
  onClose,
  resetToken,
  onResetDone,
  onOpenCalibration,
}: AccountProps) {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showChange, setShowChange] = useState(false);
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
  // Meta semanal de lectura (días 1–7, null = sin meta): local por
  // dispositivo; viaja anónimo→cuenta pero no al servidor.
  const [goalDays, setGoalDays] = useState<number | null>(null);
  // Resumen del modelo de conocimiento para «Tu vocabulario»: qué
  // tanto sabe el lector según la evidencia guardada (calibración,
  // «ya la conocía» y consultas).
  const [vocabInfo, setVocabInfo] = useState<{ text: string } | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);

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
      const [allRows, savedWords] = await Promise.all([
        listKnowledge("es", scope).catch(() => []),
        listSavedWords("es", scope).catch(() => []),
      ]);
      // Mismo criterio que el lector: un «inferida como desconocida»
      // sin palabra guardada que la respalde es rastro de una consulta,
      // no una declaración — no entra al conteo ni a la estimación.
      const savedLemmas = new Set<string>();
      for (const word of savedWords)
        for (const term of [word.form, word.lemma])
          if (term) savedLemmas.add(term.toLowerCase());
      const rows = allRows.filter((row) =>
        isCredibleKnowledge(row, savedLemmas),
      );
      if (!rows.length) {
        if (!cancelled)
          setVocabInfo({
            text: "Aún sin medición; se ofrece una prueba breve al terminar tu primer capítulo.",
          });
        return;
      }
      const knownCount = rows.filter((row) => row.known).length;
      const profile = await estimateStoredProfile(rows, "es");
      const text = profile
        ? `${knownCount} palabras que ya conoces · nivel estimado: ${vocabLevelLabel(profile.threshold)}`
        : `${knownCount} palabras que ya conoces · sin conexión no se puede estimar el nivel`;
      if (!cancelled) setVocabInfo({ text });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
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

  const run = async (action: () => Promise<{ error?: { message?: string } | null }>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.error) setError(result.error.message ?? "No se pudo completar la acción.");
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(() => authClient.signIn.email({ email, password }));
  };

  const signUp = () => {
    const name = email.split("@")[0] || "Lector";
    void run(() => authClient.signUp.email({ email, password, name }));
  };

  const sendMagicLink = () => {
    void run(async () => {
      const result = await authClient.signIn.magicLink({ email, callbackURL: "/" });
      if (!result?.error) setMessage("Si el correo está registrado, enviamos un enlace de acceso.");
      return result;
    });
  };

  const sendResetLink = () => {
    void run(async () => {
      const result = await authClient.requestPasswordReset({ email, redirectTo: "/" });
      if (!result?.error)
        setMessage("Si el correo está registrado, enviamos un enlace para restablecer la contraseña.");
      return result;
    });
  };

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await authClient.resetPassword({ newPassword, token: resetToken ?? "" });
      if (!result?.error) {
        setMessage("Contraseña actualizada. Ya puedes entrar con ella.");
        setNewPassword("");
        onResetDone?.();
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

  // «Ajustar mi vocabulario»: descarga la muestra aquí (para avisar
  // si falla) y la hoja la abre App. Al terminar allá solo se guarda
  // y se cierra.
  const adjustVocabulary = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    setError("");
    try {
      const sample = await fetchCalibrationSample();
      if (sample.ok && sample.words.length) {
        onOpenCalibration(sample.words);
      } else {
        setError("No se pudo cargar la lista de palabras. Intenta de nuevo con conexión.");
      }
    } finally {
      setLoadingSample(false);
    }
  };

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

      {isPending ? <p className="meta">Cargando…</p> : null}

      {!isPending && session?.user ? (
        <>
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
          </div>
          {hasCredential ? (
            showChange ? (
              <form className="field" onSubmit={changePassword}>
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
                  <button type="submit" className="btn" disabled={busy}>
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
            ) : (
              <div className="actions">
                <button
                  type="button"
                  className="btn--quiet"
                  disabled={busy}
                  onClick={() => setShowChange(true)}
                >
                  Cambiar contraseña
                </button>
              </div>
            )
          ) : hasCredential === false ? (
            <div className="actions">
              <button
                type="button"
                className="btn--quiet"
                disabled={busy}
                onClick={sendSetPasswordLink}
              >
                Definir contraseña por correo
              </button>
            </div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn--quiet"
              disabled={busy}
              onClick={requestDelete}
            >
              {confirmDelete ? "¿Seguro? Borra cuenta, libros y vocabulario" : "Eliminar cuenta"}
            </button>
          </div>
        </>
      ) : null}

      {resetToken && !session?.user ? (
        <form className="field" onSubmit={resetPassword}>
          <label htmlFor="reset-password">Nueva contraseña</label>
          <input
            id="reset-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Guardar contraseña
            </button>
          </div>
        </form>
      ) : null}

      {!resetToken && !isPending && !session?.user ? (
        <form className="field" onSubmit={signInWithPassword}>
          <label htmlFor="account-email">Correo</label>
          <input
            id="account-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="account-password">Contraseña</label>
          <input
            id="account-password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Entrar
            </button>
            <button type="button" className="btn" disabled={busy || !password} onClick={signUp}>
              Crear cuenta
            </button>
            <button
              type="button"
              className="btn--quiet"
              disabled={busy || !email}
              onClick={sendMagicLink}
            >
              Enlace por correo
            </button>
          </div>
          <button
            type="button"
            className="btn--quiet"
            disabled={busy || !email}
            onClick={sendResetLink}
          >
            Olvidé mi contraseña
          </button>
        </form>
      ) : null}

      <section className="account-privacy" aria-label="Tu vocabulario">
        <h2 className="eyebrow">Tu vocabulario</h2>
        <p className="meta">
          {vocabInfo === null ? "Revisando lo que conoces…" : vocabInfo.text}
        </p>
        <div className="setting-row">
          <span className="setting-label">Qué palabras te muestra Lecta</span>
          <button
            type="button"
            className="btn--quiet"
            disabled={loadingSample}
            onClick={() => void adjustVocabulary()}
          >
            {loadingSample ? "Cargando…" : "Ajustar mi vocabulario"}
          </button>
        </div>
      </section>

      <section className="account-privacy" aria-label="Meta de lectura">
        <h2 className="eyebrow">Meta de lectura</h2>
        <div className="setting-row">
          <span className="setting-label">Días de lectura por semana</span>
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
          De lunes a domingo; un día cuenta cuando lees al menos un minuto.
          La meta se guarda en este dispositivo.
        </p>
      </section>

      <section className="account-privacy" aria-label="Compañero y logros">
        <h2 className="eyebrow">Compañero y logros</h2>
        <div className="setting-row">
          <span className="setting-label">El gato del cuaderno</span>
          <button
            type="button"
            className="theme-option"
            role="switch"
            aria-checked={gameOn}
            data-active={gameOn || undefined}
            onClick={toggleGame}
          >
            {gameOn ? "Sí" : "No"}
          </button>
        </div>
        <p className="meta">
          Un gato de biblioteca crece contigo en el Cuaderno: niveles, logros
          y cofres por leer y repasar. Todo queda en este dispositivo; apágalo
          y Lecta se ve igual que siempre.
        </p>
      </section>

      <section className="account-privacy" aria-label="Privacidad y datos">
        <h2 className="eyebrow">Privacidad y datos</h2>
        <div className="setting-row">
          <span className="setting-label">Usar IA para definir y corregir</span>
          <button
            type="button"
            className="theme-option"
            role="switch"
            aria-checked={useAi}
            data-active={useAi || undefined}
            onClick={toggleUseAi}
          >
            {useAi ? "Sí" : "No"}
          </button>
        </div>
        <p className="meta">
          Solo viaja la palabra y su oración (≤ 500 caracteres). Nunca el libro, tu
          cuenta ni tu actividad.
        </p>
        <div className="setting-row">
          <span className="setting-label">Guardar el recorrido de lectura</span>
          <button
            type="button"
            className="theme-option"
            role="switch"
            aria-checked={historyOn}
            data-active={historyOn || undefined}
            onClick={toggleHistory}
          >
            {historyOn ? "Sí" : "No"}
          </button>
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
        <h2 className="eyebrow">Acerca de</h2>
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
      </section>

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
    </Dialog>
  );
}
