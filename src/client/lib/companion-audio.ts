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
  if (on) stopCompanionSound();
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

// Un sonido que sigue con la pestaña oculta se siente como un bug.
// El listener vive en el módulo para que cualquier superficie que
// use el audio quede cubierta sin repetir el wiring.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stopCompanionSound();
  });
}
