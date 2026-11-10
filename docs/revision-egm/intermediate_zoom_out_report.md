# Etapa 8: Zoom Out intermedio de `docs/concentracion-y-lectura.md`

- **Revisor:** `egm-zoom-out`, con contexto limpio. Leyó el documento completo y los informes de las Etapas 5, 6 y 7.
- **Qué revisa:** si las correcciones que proponen las Etapas 6 y 7 agregan más alcance del necesario, y si el rumbo general del documento se sostiene con esas correcciones aplicadas.
- **Estado del documento:** sin cambios desde la Etapa 5.

## Veredicto

**Como documento de evidencia, el rumbo se sostiene.** El cruce entre la evidencia y el producto y los principios de §4 siguen siendo útiles. Lo que piden las Etapas 6 y 7 es ordenar, corregir y etiquetar.

**El `tip` con IA ya no se sostiene una vez que se aplican esas correcciones.** Sumadas, añaden siete piezas a una sola función, y la evidencia del propio documento juega en su contra. **Antes de aplicar cualquier corrección hay que decidir qué pasa con el `tip`.**

Comprobé contra el código las dos afirmaciones nuevas que pesan más:
- `ReaderNotices.tsx:238` dice «Notamos fatiga en la lectura. Elige cómo continuar:».
- `TIP_SYSTEM_PROMPT` (`ai.ts:727`) ya avisa que un retroceso «puede ser relectura sana».

---

## 🔴 ZO8-1. Decidir qué pasa con el `tip` antes de aplicar C1, C2a, C3, C6, C7, C12 y C16
**Líneas:** 324–336, 361–377

La Etapa 7 pide, solo para el tip:
- una especificación propia;
- una tabla de alternativas;
- una tabla de riesgos con privacidad;
- una marca diaria guardada en la base;
- calcular el hallazgo en el cliente;
- un grupo de control con días retenidos al azar y el registro de la reversión;
- un criterio de retiro;
- las hipótesis A/B dentro del prompt.

Todo eso se construiría sobre una función que el documento mismo debilita:
- Sus dos acciones son las de evidencia «preliminar» (Z6).
- Incumple la regla de no interpretar series temporales con IA (C7).
- El documento ya dice que «las reglas locales bastan» (línea 374).

Además, la corrección de C7 lleva sola a la respuesta. Si el cliente calcula la media y el disparador, el LLM solo redacta. Eso lo hace una plantilla local sin red, sin cuota, sin la caché de cadencia y sin mandar datos a DeepSeek.

Y ya existe un canal local para esto: `ReaderNotices.tsx:231-260` ofrece «Activar regla de foco», que es la misma acción `focus_ruler`, en el Reader y sin IA.

**Opciones:**

| | Qué es | Qué arrastra |
|---|---|---|
| **A** | Retirar el tip con LLM y quedarse con el aviso local, corregido según ZO8-2 | C1, C3, C6, C7, C12 y C16 desaparecen; C2a queda en un párrafo |
| **B** | Tip determinista en el cliente: calcular el hallazgo sobre `focusByDay` y escribirlo con unas pocas plantillas que nombren la señal observable | Lo mismo que A. Además se eliminan el endpoint, `tipCache`, la cuota y la cuestión de privacidad |
| **C** | Mantener el LLM | Hay que hacer todo lo de la Etapa 7, en la versión reducida de ZO8-3, ZO8-4 y ZO8-5 |

**El revisor recomienda B**, o A si el tip no aporta nada más que el aviso local.

## 🟡 ZO8-2. El aviso de fatiga en producción contradice §4, y el arreglo de C9 es más caro de lo necesario
**Líneas:** 87–90, 304, 349–350 · **Ítems:** C9, Z5

**El problema.** El documento describe un «aviso 20-20-20». El código muestra otra cosa: «**Notamos fatiga en la lectura.** Elige cómo continuar:», con dos botones, regla de foco y 5 minutos de audio. Ese texto afirma un estado del lector, y eso incumple dos reglas del documento:
- la tabla, que dice «NO concluir: está cansado» (línea 304);
- el principio 4, que pide nombrar la señal observable.

Ninguna etapa anterior lo vio. Los comentarios de `idb.ts:277`, `Reader.tsx:2037` y `ReaderNotices.tsx:2` siguen hablando de 20-20-20.

**Por qué C9 sobra.** C9 propone un umbral relativo a la mediana personal. Eso trae el problema del arranque en frío y lógica nueva, para afinar una heurística que nadie ha validado.

**Cambio, en orden:**
1. Reescribir el aviso para que nombre la señal observable. Por ejemplo: «Llevas un buen rato y volviste atrás varias veces. ¿Probar…?».
2. Añadir un interruptor para apagar el aviso. Hoy no existe: la × solo lo cierra esa vez.
3. Corregir la línea 90 del documento.

El umbral por percentil queda para después, y solo si se valida la heurística.

## 🟡 ZO8-3. El grupo de control de C12 es infraestructura de experimento que hoy no se necesita
**Líneas:** 324–331 · **Ítems:** C12, Z7

Montar `tip_withheld`, la asignación al azar, la retención a 7 días y los umbrales X/Y es mucho para una función que se muestra una vez al día como máximo y solo a quien leyó 5 minutos o más en al menos 2 días (`tips.ts:33-34, 94-99`). Con el volumen actual no daría para concluir nada.

Una corrección a Z7(c): el tip no se dispara por un umbral local, lo decide el LLM. El sesgo de selección sigue existiendo, pero el mecanismo es otro.

**Cambio:**
- Con A o B, este punto desaparece.
- Con C, basta con:
  - un evento de reversión;
  - medir el éxito como «el ajuste sigue activo a los 7 días»;
  - un criterio de retiro simple;
  - dejar el grupo de control para cuando haya volumen.

## 🟡 ZO8-4. La marca diaria guardada en la base (Z8) cuesta más de lo que resuelve
**Líneas:** 333–336, 366 · **Ítems:** Z8, C6

`lecta_ai_quota` cuenta por hora (`ON CONFLICT (user_id, scope, bucket_hour)`). Una marca diaria obliga a cambiar el esquema o a crear un mecanismo nuevo. El peor caso hoy es un tip de más por dispositivo y día, y el cliente ya limita a uno por día (`tips.ts:111, 151`).

**Cambio:** quedarse con la redacción de C6 («un esfuerzo razonable, no una garantía») y no construir la marca.

## 🟡 ZO8-5. Parte de C3 y C16 ya está resuelta en el código
**Ítems:** C3, C16

- **Salida inválida del modelo.**
  - `parseTip` (`ai.ts:750-769`) convierte una acción fuera del conjunto en `"none"`.
  - Si el formato no es válido, el worker responde 502 (`app.ts:1146-1147`).
  - El cliente devuelve `null` ante cualquier error.
- **Minimización de datos.** `sanitizeTipContext` (`ai.ts:771-790`) solo deja pasar enteros acotados.
- **C16.** El prompt ya dice que un retroceso «puede ser relectura sana».

**Cambio:** en la tabla de riesgos, marcar estas filas como «mitigado» y citar el archivo.

La única decisión de privacidad que queda es si una llamada que el usuario no pidió se cubre con `useAi`, que está activado por defecto. Se acepta o se cambia; no hace falta un flujo de consentimiento.

## 🟡 ZO8-6. La lista de ocho canales de C10 mezcla cosas distintas y exagera la necesidad de un árbitro
**Líneas:** 340–345 · **Ítems:** C10, Z9

Tres de los ocho no son interrupciones durante la lectura:
- «Antes de leer» es parte del flujo y se puede saltar.
- Las notificaciones de hábito ocurren fuera de la app.
- El tip vive en la estantería.

Dentro del Reader, sin que el usuario lo pida, aparecen cuatro:
- el aviso de fatiga;
- `react()` del gato;
- `MidChapterRecallCard`;
- la tarjeta de retomar.

Estos cuatro ya comparten compuertas:
- El aviso de fatiga se oculta con `!resumeCard && !isDeepReading` (`ReaderNotices.tsx:231`).
- `deep_focus` silencia al gato.

**Cambio:**
1. Definir «intervención» como la interfaz que el usuario no pidió y que aparece durante la sesión de lectura.
2. Documentar los canales del Reader en una tabla con sus compuertas y prioridades actuales.
3. No construir un árbitro hasta que se vea una colisión real.

Esto **cierra Z9 a favor de la postura zoom-out**.

## 🟢 Nit

| # | Ítems | Problema | Cambio |
|---|---|---|---|
| ZO8-7 | C11 | Listar canales exentos de una regla de «menos de 5 min» que no existe es bajar al detalle antes de tiempo | Dejarla en una línea: «hipótesis, `heurística propia`, sin implementar» |
| ZO8-8 | Etapa 6: hallazgos 6, 7, 9 | Definir en prosa sesión, tramo, movimiento, % de retrocesos y `DayFocus` copia `focus-telemetry.ts` y `reading-activity.ts`, y esa copia se desactualiza (el mismo problema de Z2) | Una frase por término y un enlace al archivo |
| ZO8-9 | C2a | Partir el documento rompe las referencias de `ai.ts:717` y `tips.ts:2-3` a «§4» | Actualizarlas en el mismo cambio; con A o B basta un párrafo |
| ZO8-10 | Z4, C5 | Unificar los dos mecanismos de retomar (48 h y 3 días) es una tarea de código, no del documento | En §3 marcarlo como implementado y dejar la unificación como pendiente fuera del documento |

---

## Orden de trabajo recomendado

1. **Decidir qué pasa con el `tip`** (ZO8-1: A, B o C). Esa decisión define si C1, C3, C6, C7, C12 y C16 siguen en pie.
2. **Corregir el aviso de fatiga** (ZO8-2): el texto con la señal observable, el interruptor y la línea 90. Es barato y quita una contradicción que ya está en producción.
3. **Corregir el inventario y el estado del sistema** (Z2/C4, Z4/C5 junto con ZO8-10, Z3/C8). Enlazar a los archivos en lugar de copiar valores (N3, ZO8-8).
4. **Separar en el documento lo implementado, lo decidido y lo sugerido** (C2, en la versión reducida). Actualizar las referencias del código (ZO8-9) y escribir la tabla de canales del Reader (ZO8-6).
5. **Solo si eliges C:** la cadencia con la redacción de C6, los riesgos marcados como «mitigado» y la evaluación mínima.
6. **Etiquetas y estilo:** C13, C14, C17–C24, y la regla de menos de 5 min como hipótesis.

## Cómo cambia lo anterior

| Ítem anterior | Qué pasa tras la Etapa 8 |
|---|---|
| C1, C3, C6, C7, C12, C16 | Dependen de ZO8-1; con A o B desaparecen |
| C2 (bloqueante) | Se reduce a separar lo implementado, lo decidido y lo sugerido, más un párrafo del tip |
| C9 / Z5 | Se reemplaza por ZO8-2 (texto e interruptor, sin percentiles) |
| C10 / Z9 | Se cierra con ZO8-6: tabla de canales, sin árbitro |
| C11 | Se reduce a una línea (ZO8-7) |
| Z7 | Se corrige la premisa (c); se reduce según ZO8-3 |
| Z8 | Se descarta la marca en la base (ZO8-4) |
