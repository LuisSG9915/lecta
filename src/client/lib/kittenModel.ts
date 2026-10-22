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
