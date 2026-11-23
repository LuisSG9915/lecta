// Configuración del modelo de Kitten TTS, compartida por el motor (hilo principal),
// el worker de inferencia y el service worker.
//
// El nombre lleva versión a propósito: la ruta se sirve con `Cache-Control: immutable`
// durante un año, así que sin versión un binario nuevo nunca llegaría al navegador.
// La caché también lleva versión: subir el modelo sin cambiarla dejaría a los usuarios
// con el binario viejo aunque la URL fuese nueva.
export const KITTEN_CACHE_NAME = "lecta-kitten-tts-v2";
/** Cachés de versiones anteriores que hay que purgar (24 MB cada una). */
export const LEGACY_KITTEN_CACHE_NAMES: readonly string[] = ["lecta-kitten-tts-v1"];
export const KITTEN_MODEL_URL = "/models/kitten-tts-nano-0.8-int8-v1.onnx";
/** SHA-256 del binario publicado (KittenML/kitten-tts-nano-0.8-int8). */
export const KITTEN_MODEL_SHA256 =
  "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc";
export const KITTEN_MODEL_BYTES = 24_369_971;

// Tabla de voces oficial de Kitten 0.8 (voices.npz de KittenML/kitten-tts-nano-0.8-int8).
// Los vectores de la 0.1 que vivían en el código NO sirven con este modelo: la voz sale
// como estática. Cada voz trae 400 filas de estilo; se usa su promedio (ver voiceStyle).
// Archivo estático (public/tts/), no R2: `scripts/kitten-voices-pack.mjs` lo genera.
// Se guarda en la misma caché que el modelo (con su propio `x-model-sha256`), así quien
// ya bajó los 24 MB solo baja estos 3,2 MB. Si cambia el contenido, sube la versión del
// nombre (-v2): la ruta se sirve con `Cache-Control: immutable`.
export const KITTEN_VOICES_URL = "/tts/kitten-voices-v1.bin";
export const KITTEN_VOICES_SHA256 =
  "9b416b8dea5b4ff098339c04856509b21b42a4274d12af3265f99c5fc06e6392";
export const KITTEN_VOICES_BYTES = 3_276_800;
export const KITTEN_VOICE_ROWS = 400;
export const KITTEN_VOICE_DIMS = 256;
/** Orden de las voces dentro del binario (el mismo del script de empaquetado). */
export const KITTEN_VOICE_ORDER = [
  "expr-voice-2-f",
  "expr-voice-2-m",
  "expr-voice-3-f",
  "expr-voice-3-m",
  "expr-voice-4-f",
  "expr-voice-4-m",
  "expr-voice-5-f",
  "expr-voice-5-m",
] as const;
// Los `speed_priors` del config.json oficial (0.8 casi siempre) NO se aplican: con ellos la
// voz sale a ~88 palabras/min, demasiado lenta; la velocidad la decide el ajuste del usuario.
