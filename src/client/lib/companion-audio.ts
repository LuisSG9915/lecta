// Sonido del compañero: HTMLAudio nativo, un clip a la vez y volumen
// bajo. La preferencia es de ESTE dispositivo (companionDevicePrefs.
// soundEnabled, apagada de inicio) y el proveedor la empuja aquí con
// setSoundEnabled — así el gesto que dispara un sonido no relee
// IndexedDB cada vez.
//
// Solo suena en gestos voluntarios de la persona: maullido al abrir
// la hoja del gato y ronroneo mientras dura la caricia. Visitas del
// lector, sync, logros y celebraciones jamás pasan por aquí. play()
// puede ser rechazado por la política de autoplay del navegador: el
// rechazo se traga porque el audio es adorno, nunca parte de la
// acción. Reduced-motion no se consulta aquí — movimiento y sonido
// son preferencias distintas.

export type CompanionSoundKind = "meow" | "purr";

// Clips aprobados, servidos desde /public. El ronroneo es un loop de
// ~11 s (CC0, OpenGameArt/Kerzoven) que se recorta a la duración de
// la caricia con stopCompanionSound — no se deja sonando hasta el
// final del archivo.
const SOURCES: Record<CompanionSoundKind, string> = {
  meow: "/audio/cat-softmew.wav",
  purr: "/audio/cat-purr.wav",
};

// Bajo a propósito: el ronroneo es continuo y ambos deben quedar muy
// por debajo de la voz o la música del sistema.
const VOLUME = 0.4;

let enabled = false;
// La voz del lector («Leer en voz alta») manda: mientras habla, el
// gato no inicia sonidos nuevos ni deja sonando el que corría. Es
// supresión temporal — no toca la preferencia `enabled` del usuario.
let suppressed = false;
// Un elemento por clip, creado al primer uso; `current` es el único
// que puede estar sonando — un sonido nuevo siempre corta al que
// corre.
const clips = new Map<CompanionSoundKind, HTMLAudioElement>();
let current: HTMLAudioElement | null = null;

const clipFor = (kind: CompanionSoundKind): HTMLAudioElement | null => {
  // Sin Audio (SSR o navegador muy viejo) el gesto sigue funcionando
  // igual de silencioso.
  if (typeof Audio !== "function") return null;
  let el = clips.get(kind);
  if (!el) {
    el = new Audio(SOURCES[kind]);
    el.preload = "auto";
    el.volume = VOLUME;
    clips.set(kind, el);
  }
  return el;
};

// La preferencia del dispositivo, en memoria. Al apagarla se corta
// lo que esté sonando: nada debe seguir después de «No».
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopCompanionSound();
}

// Supresión temporal por TTS activo. Al entrar también corta el clip
// en curso: dos voces a la vez (gato + lectura) no tienen sentido.
export function setCompanionAudioSuppressed(on: boolean): void {
  suppressed = on;
  if (on) {
    stopCompanionSound();
    stopAmbientPurr();
    stopSoundscape();
  }
}

// Suena un clip si la preferencia lo permite, desde el inicio. El
// nuevo corta al anterior — jamás hay dos sonidos del gato a la vez.
export function playCompanionSound(kind: CompanionSoundKind): void {
  if (!enabled || suppressed) return;
  const el = clipFor(kind);
  if (!el) return;
  stopCompanionSound();
  el.currentTime = 0;
  current = el;
  // En navegadores viejos play() no devuelve promesa; Promise.resolve
  // unifica ambos caminos y el catch traga el rechazo de autoplay.
  void Promise.resolve(el.play()).catch(() => undefined);
}

// Corta el clip en curso y lo rebobina. Se llama al terminar la
// caricia, al cerrar la hoja, al ocultar la pestaña y al cambiar de
// cuenta — el sonido nunca sobrevive al contexto que lo pidió.
export function stopCompanionSound(): void {
  const el = current;
  current = null;
  if (!el) return;
  el.pause();
  try {
    el.currentTime = 0;
  } catch {
    // Algunos motores lanzan si el clip aún no tiene metadatos.
  }
}

// ---------- Ronroneo Ambiental Suave (Body Doubling / Concentración TDAH) ----------
let ambientContext: AudioContext | null = null;
let ambientGain: GainNode | null = null;
let ambientSource: AudioNode | null = null;
let ambientLfo: OscillatorNode | null = null;
let isPurring = false;

export function isAmbientPurrActive(): boolean {
  return isPurring;
}

export function startAmbientPurr(volume = 0.08): void {
  if (isPurring || suppressed) return;
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    if (!ambientContext || ambientContext.state === "closed") {
      ambientContext = new AudioCtx();
    }
    if (ambientContext.state === "suspended") {
      void ambientContext.resume();
    }
    const ctx = ambientContext;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 5;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      output[i] = lastOut * 3.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(80, now);

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.4, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(25, now);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, volume),
      now + 0.8,
    );

    noise.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    noise.start();
    lfo.start();

    ambientGain = masterGain;
    ambientSource = noise;
    ambientLfo = lfo;
    isPurring = true;
  } catch {
    // Web Audio no soportado o bloqueado por navegador
  }
}

export function stopAmbientPurr(): void {
  if (!isPurring) return;
  isPurring = false;
  if (!ambientGain || !ambientContext) return;

  try {
    const ctx = ambientContext;
    const now = ctx.currentTime;
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, now);
    ambientGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    const oldSource = ambientSource;
    const oldLfo = ambientLfo;
    const oldGain = ambientGain;
    setTimeout(() => {
      try {
        (oldSource as AudioScheduledSourceNode)?.stop();
        oldLfo?.stop();
        oldGain?.disconnect();
      } catch {
        // Nodos de audio ya detenidos o desconectados se ignoran.
      }
    }, 850);
  } catch {
    // Falla si el contexto ya fue cerrado.
  }
  ambientSource = null;
  ambientLfo = null;
  ambientGain = null;
}

// ---------- Paisajes Sonoros Procedurales (Innovación 3: TDAH & Flujo) ----------
export type SoundscapeKind = "rain" | "hearth" | "night_library";

let currentSoundscape: SoundscapeKind | null = null;
let soundscapeGain: GainNode | null = null;
let soundscapeSource: AudioNode | null = null;
let soundscapeLfo: OscillatorNode | null = null;

export function isSoundscapeActive(): boolean {
  return currentSoundscape !== null;
}

export function getCurrentSoundscape(): SoundscapeKind | null {
  return currentSoundscape;
}

export function startSoundscape(kind: SoundscapeKind, volume = 0.12): void {
  if (suppressed) return;
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  if (currentSoundscape === kind && soundscapeGain) return;
  stopSoundscape();

  try {
    if (!ambientContext || ambientContext.state === "closed") {
      ambientContext = new AudioCtx();
    }
    if (ambientContext.state === "suspended") {
      void ambientContext.resume();
    }
    const ctx = ambientContext;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 4;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let lfo: OscillatorNode | null = null;
    const filter = ctx.createBiquadFilter();

    if (kind === "rain") {
      // Lluvia suave: Ruido rosa con filtrado lowpass a 900Hz y modulación lenta
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.12;
        b6 = white * 0.115926;
      }
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(900, now);

      lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.2, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(150, now);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
    } else if (kind === "hearth") {
      // Chimenea cálida: Ruido marrón profundo a 240Hz con micro-impulsos suaves
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        const pop = Math.random() < 0.0006 ? Math.random() * 1.8 - 0.9 : 0;
        output[i] = lastOut * 3.2 + pop;
      }
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(240, now);
    } else {
      // Biblioteca nocturna: Ruido marrón atenuado para enmascaramiento acústico TDAH
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.015 * white) / 1.015;
        output[i] = lastOut * 2.5;
      }
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(320, now);
      filter.Q.setValueAtTime(0.7, now);
    }

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, volume),
      now + 0.8,
    );

    source.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    source.start();

    soundscapeSource = source;
    soundscapeLfo = lfo;
    soundscapeGain = masterGain;
    currentSoundscape = kind;
  } catch {
    // Web Audio no soportado
  }
}

export function stopSoundscape(): void {
  if (!currentSoundscape) return;
  currentSoundscape = null;
  if (!soundscapeGain || !ambientContext) return;

  try {
    const ctx = ambientContext;
    const now = ctx.currentTime;
    soundscapeGain.gain.setValueAtTime(soundscapeGain.gain.value, now);
    soundscapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    const oldSource = soundscapeSource;
    const oldLfo = soundscapeLfo;
    const oldGain = soundscapeGain;
    setTimeout(() => {
      try {
        (oldSource as AudioScheduledSourceNode)?.stop();
        oldLfo?.stop();
        oldGain?.disconnect();
      } catch {
        // Nodos ya cerrados
      }
    }, 650);
  } catch {
    // Error al cerrar
  }
  soundscapeSource = null;
  soundscapeLfo = null;
  soundscapeGain = null;
}

// Un sonido que sigue con la pestaña oculta se siente como un bug.
// El listener vive en el módulo para que cualquier superficie que
// use el audio quede cubierta sin repetir el wiring.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      stopCompanionSound();
      stopAmbientPurr();
      stopSoundscape();
    }
  });
}


