import { useEffect, useState } from "react";
import { KITTEN_VOICES, type KittenVoiceId, type TtsSnapshot } from "../lib/ttsTypes";
import { PIPER_VOICE_ID } from "../lib/piperModel";
import { ensureVoices, normalizeLang } from "../lib/ttsSpeech";
import { kittenTtsEngine } from "../lib/kittenTtsEngine";
import { isFeatureFlagEnabled } from "../lib/settings";
import type { TtsEngineKind } from "../workers/kitten-tts.worker";

export type NeuralVoiceChoice = KittenVoiceId | typeof PIPER_VOICE_ID;

export interface TtsVoiceSelectorProps {
  bookLanguage?: string;
  snap: Pick<TtsSnapshot, "engine" | "activeEngine" | "kittenVoice" | "voiceURI">;
  /** null = automática. */
  onSelectSystem: (voiceURI: string | null) => void;
  onSelectNeural: (voice: NeuralVoiceChoice) => void;
  onDismiss: () => void;
}

// Hoja de voces del libro: voces del sistema en su idioma y, si el
// dispositivo lo permite, las neurales con su estado de descarga.
export default function TtsVoiceSelector({
  bookLanguage,
  snap,
  onSelectSystem,
  onSelectNeural,
  onDismiss,
}: TtsVoiceSelectorProps) {
  const isEs = bookLanguage?.toLowerCase().startsWith("es") ?? false;
  const lang2 = (bookLanguage ?? "es").toLowerCase().slice(0, 2);
  const neuralKind: TtsEngineKind = isEs ? "piper" : "kitten";
  const neuralSize = isEs ? "~63 MB" : "~24 MB";
  const neuralEnabled = isFeatureFlagEnabled("neuralTts");
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [pending, setPending] = useState<NeuralVoiceChoice | null>(null);
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ensureVoices().then((voices) => {
      if (!alive) return;
      setSystemVoices(voices.filter((v) => normalizeLang(v.lang).startsWith(lang2)));
    });
    return () => {
      alive = false;
    };
  }, [lang2]);

  useEffect(() => {
    if (!neuralEnabled) return;
    let alive = true;
    void kittenTtsEngine
      .isEngineModelDownloaded(neuralKind)
      .then((ok) => alive && setDownloaded(ok))
      .catch(() => alive && setDownloaded(false));
    return () => {
      alive = false;
    };
  }, [neuralEnabled, neuralKind]);

  const busy = pending !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, busy]);

  const neuralActive = snap.activeEngine !== "browser";
  const systemActive = (uri: string | null) =>
    !neuralActive && (snap.voiceURI ?? null) === uri;

  const chooseNeural = async (voice: NeuralVoiceChoice) => {
    setErrorMsg(null);
    if (downloaded !== true) {
      setPending(voice);
      setPercent(0);
      try {
        await kittenTtsEngine.downloadEngineModel(neuralKind, (p) => setPercent(p.percent));
        await kittenTtsEngine.init(undefined, neuralKind);
        setDownloaded(true);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "No se pudo descargar la voz.");
        setPending(null);
        return;
      }
      setPending(null);
    }
    onSelectNeural(voice);
    onDismiss();
  };

  const neuralVoices: { id: NeuralVoiceChoice; name: string }[] = isEs
    ? [{ id: PIPER_VOICE_ID, name: "Voz natural en español" }]
    : KITTEN_VOICES.map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="tts-consent-backdrop" onClick={() => (busy ? undefined : onDismiss())}>
      <div
        className="tts-consent tts-voice-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Elegir voz"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="tts-consent-title">Voz de lectura</h3>

        <div className="tts-voice-group" role="group" aria-label="Voces del dispositivo">
          <p className="tts-voice-group-title">En tu dispositivo</p>
          <button
            type="button"
            className="tts-voice-option"
            aria-pressed={systemActive(null)}
            disabled={busy}
            onClick={() => {
              onSelectSystem(null);
              onDismiss();
            }}
          >
            Automática
          </button>
          {systemVoices.map((v) => (
            <button
              key={v.voiceURI}
              type="button"
              className="tts-voice-option"
              aria-pressed={systemActive(v.voiceURI)}
              disabled={busy}
              onClick={() => {
                onSelectSystem(v.voiceURI);
                onDismiss();
              }}
            >
              {v.name}
            </button>
          ))}
        </div>

        {neuralEnabled ? (
          <div className="tts-voice-group" role="group" aria-label="Voces naturales">
            <p className="tts-voice-group-title">
              Voces naturales ·{" "}
              {downloaded ? "descargadas" : `descarga única ${neuralSize}`}
            </p>
            {neuralVoices.map((v) => (
              <button
                key={v.id}
                type="button"
                className="tts-voice-option"
                aria-pressed={
                  neuralActive && (isEs || snap.kittenVoice === v.id)
                }
                disabled={busy}
                onClick={() => void chooseNeural(v.id)}
              >
                {v.name}
              </button>
            ))}
          </div>
        ) : null}

        {busy ? (
          <div className="tts-consent-progress">
            <div
              className="tts-progress-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="tts-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="tts-progress-text">Descargando voz… {percent}%</p>
          </div>
        ) : null}
        {errorMsg ? <p className="tts-consent-error">{errorMsg}</p> : null}

        <div className="tts-consent-actions">
          <button type="button" className="btn--quiet" disabled={busy} onClick={onDismiss}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
