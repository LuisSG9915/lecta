// Panel de diagnóstico TTS temporal para depurar en dispositivos reales
// sin depuración USB. Se activa con `?ttsdebug=1` en la URL (queda
// persistido en localStorage) y se desactiva con `?ttsdebug=0` o el botón ✕.
// TODO: retirar cuando se cierre el diagnóstico de audio en Android.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  isKittenModelCached,
  kittenTtsEngine,
} from "../lib/kittenTtsEngine";
import { speakWithSystemVoice } from "../lib/ttsSpeech";
import {
  hasKittenConsent,
  loadTtsSettings,
} from "../lib/ttsSettings";
import { isFeatureFlagEnabled } from "../lib/settings";
import type { TtsSnapshot } from "../lib/ttsTypes";

const LS_KEY = "lecta:ttsdebug";
const MAX_LOG = 60;

function ttsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ttsdebug") === "1") {
      localStorage.setItem(LS_KEY, "1");
      return true;
    }
    if (params.get("ttsdebug") === "0") {
      localStorage.removeItem(LS_KEY);
      return false;
    }
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

interface SynthState {
  speaking: boolean;
  pending: boolean;
  paused: boolean;
}

export default function TtsDebugPanel({ ttsSnap }: { ttsSnap: TtsSnapshot }) {
  const [enabled] = useState(ttsDebugEnabled);
  const [log, setLog] = useState<string[]>([]);
  const [modelCached, setModelCached] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const synthRef = useRef<SynthState>({ speaking: false, pending: false, paused: false });
  const prevStatusRef = useRef<string>("");

  const push = (line: string) => {
    const t = new Date().toLocaleTimeString("es-MX", { hour12: false });
    setLog((prev) => [`${t} ${line}`, ...prev].slice(0, MAX_LOG));
  };

  // Pulso de speechSynthesis: detecta estados zombie (speaking/paused pegados).
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (!("speechSynthesis" in window)) return;
      const s = window.speechSynthesis;
      const cur: SynthState = {
        speaking: s.speaking,
        pending: s.pending,
        paused: s.paused,
      };
      const prev = synthRef.current;
      if (
        cur.speaking !== prev.speaking ||
        cur.pending !== prev.pending ||
        cur.paused !== prev.paused
      ) {
        push(
          `synth → speaking:${cur.speaking} pending:${cur.pending} paused:${cur.paused}`,
        );
        synthRef.current = cur;
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (ttsSnap.status !== prevStatusRef.current) {
      push(`tts → ${ttsSnap.status} (engine:${ttsSnap.activeEngine ?? "?"})`);
      prevStatusRef.current = ttsSnap.status;
    }
  }, [enabled, ttsSnap]);

  useEffect(() => {
    if (!enabled) return;
    void isKittenModelCached().then(setModelCached);
  }, [enabled]);

  if (!enabled) return null;

  const settings = loadTtsSettings();
  const voices =
    typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis.getVoices()
      : [];
  const env = [
    `secure:${typeof window !== "undefined" ? window.isSecureContext : "?"}`,
    `coi:${typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : "?"}`,
    `caches:${typeof caches !== "undefined"}`,
    `sab:${typeof SharedArrayBuffer !== "undefined"}`,
    `sw:${typeof navigator !== "undefined" && "serviceWorker" in navigator}`,
    `flag:${isFeatureFlagEnabled("neuralTts")}`,
  ].join(" ");

  const testSystemVoice = async () => {
    setBusy("sys");
    push("prueba voz sistema: speak()");
    try {
      await speakWithSystemVoice(
        "Esta es una prueba de la voz del sistema de tu teléfono.",
        { language: "es" },
      );
      push("voz sistema: terminó (o resolvió sin audio)");
    } catch (err) {
      push(`voz sistema ERROR: ${String(err)}`);
    }
    setBusy(null);
  };

  const testWebAudio = () => {
    setBusy("beep");
    push("prueba WebAudio: beep 440Hz");
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      void ctx.resume().then(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.2;
        osc.frequency.value = 440;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
        osc.onended = () => {
          push(`WebAudio: terminó (ctx.state=${ctx.state})`);
          void ctx.close();
          setBusy(null);
        };
      });
    } catch (err) {
      push(`WebAudio ERROR: ${String(err)}`);
      setBusy(null);
    }
  };

  const testKitten = async () => {
    setBusy("kitten");
    push("prueba Kitten: synthesize EN…");
    const t0 = performance.now();
    try {
      const buf = await kittenTtsEngine.synthesize(
        "This is a short test of the neural voice.",
        "expr-voice-2-f",
        1,
        "high",
      );
      push(`Kitten: audio listo en ${Math.round(performance.now() - t0)}ms, reproduciendo`);
      kittenTtsEngine.play(buf, 1, () => push("Kitten: play terminó"));
    } catch (err) {
      push(`Kitten ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(null);
  };

  const testPiper = async () => {
    setBusy("piper");
    push("prueba Piper: synthesize ES…");
    const t0 = performance.now();
    try {
      const buf = await kittenTtsEngine.synthesize(
        "Esta es una prueba de la voz neuronal en español mexicano, con una pausa, aquí.",
        "es_MX-claude-high",
        1,
        "high",
        "piper",
      );
      push(`Piper: audio listo en ${Math.round(performance.now() - t0)}ms, reproduciendo`);
      kittenTtsEngine.play(buf, 1, () => push("Piper: play terminó"));
    } catch (err) {
      push(`Piper ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(null);
  };

  const copyLog = () => {
    const s = loadTtsSettings();
    const text = [
      `UA: ${navigator.userAgent}`,
      `env: ${env}`,
      `settings: ${JSON.stringify({ enabled: s.enabled, consented: s.consentedAt !== null, engine: s.engine, voiceURI: s.voiceURI })}`,
      `kittenConsent:${hasKittenConsent()} modelCached:${modelCached}`,
      `voces(${voices.length}): ${voices
        .slice(0, 8)
        .map((v) => `${v.lang}/${v.name}`)
        .join(" | ")}`,
      "",
      ...[...log].reverse(),
    ].join("\n");
    void navigator.clipboard
      ?.writeText(text)
      .then(() => push("log copiado"))
      .catch(() => push("clipboard bloqueado — mándame captura"));
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        maxHeight: "45vh",
        overflowY: "auto",
        background: "rgba(10,10,14,0.94)",
        color: "#9fe8a9",
        font: "11px/1.45 ui-monospace, monospace",
        padding: "8px 10px",
        borderBottom: "1px solid #2a4a2e",
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <button onClick={testSystemVoice} disabled={busy !== null} style={btn}>
          🔊 Voz sistema
        </button>
        <button onClick={testWebAudio} disabled={busy !== null} style={btn}>
          🎵 Beep WebAudio
        </button>
        <button
          onClick={testKitten}
          disabled={busy !== null || modelCached !== true}
          style={btn}
          title={modelCached ? "" : "Modelo no descargado"}
        >
          🧠 Kitten EN
        </button>
        <button
          onClick={testPiper}
          disabled={busy !== null}
          style={btn}
          title="Voz neuronal Piper es_MX"
        >
          🐍 Piper ES
        </button>
        <button onClick={copyLog} style={btn}>
          📋 Copiar log
        </button>
        <button
          onClick={() => {
            localStorage.removeItem(LS_KEY);
            location.reload();
          }}
          style={btn}
        >
          ✕ salir debug
        </button>
      </div>
      <div>env: {env}</div>
      <div>
        tts: {ttsSnap.status} · engine:{ttsSnap.engine} active:
        {ttsSnap.activeEngine ?? "-"} · consent:
        {String(settings.consentedAt !== null)} · kittenConsent:
        {String(hasKittenConsent())} · model:
        {modelCached === null ? "?" : String(modelCached)}
      </div>
      {(() => {
        const s = kittenTtsEngine.getLastSynthStats();
        if (!s) return null;
        const rtf = s.audioMs > 0 ? (s.synthMs / s.audioMs).toFixed(2) : "?";
        return (
          <div>
            última síntesis: {s.engine} · {s.synthMs}ms ONNX / {s.audioMs}ms audio · RTF {rtf}
          </div>
        );
      })()}
      <div>
        voces({voices.length}):{" "}
        {voices
          .slice(0, 6)
          .map((v) => `${v.lang}`)
          .join(", ") || "—"}
      </div>
      <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  background: "#1c2f1e",
  color: "#c8f0cf",
  border: "1px solid #3a5a3e",
  borderRadius: 6,
  padding: "5px 9px",
  fontSize: 12,
};
