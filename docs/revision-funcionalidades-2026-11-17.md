# Revisión de funcionalidades Lecta — 2026-11-17

Ocho subagentes en paralelo, uno por área funcional. Cada uno leyó el código real
(componentes, hooks, libs, worker, CSS, tests, e2e) y verificó con grep de
consumidores en producción antes de afirmar que algo falta. Nada de checklists
genéricos: cada idea cita `file:línea`. Este documento consolida los hallazgos.

Áreas: Lector · Ficha/Diccionario/IA · Cuaderno/FSRS · TTS/Audio · Kindle e-ink ·
Explora/Catálogo/Comunidad · Journey/Gato · Cuenta/Planes/Sync/Growth.

---

## 1. El patrón transversal: maquinaria construida que está dormida o rota

El hallazgo más repetido en las 8 áreas no es «faltan funciones»: es que **hay
funciones ya escritas y probadas que nadie cableó, o promesas de UI que el código
no cumple**. Esto es lo más barato de arreglar y lo que más confianza devuelve.

| Área | Pieza dormida / promesa rota | Evidencia |
|---|---|---|
| TTS | «Voz» reabre el diálogo de descarga en vez de un selector. `setKittenVoice()`/`setEngine()` sin llamadores; `voiceURI` persistido pero ignorado; `TtsNowPlaying` (con `<select>` de 8 voces) solo vive en un test | `ReaderDockHost.tsx:225`, `ttsController.ts:750,766`, `ttsSpeech.ts:255-258` |
| TTS | Sleep timer existe (`setSleepTimer`, corte suave por párrafo) pero solo se dispara desde la píldora de fatiga; `sleepTimerActive` sin consumidor en el dock | `useReaderTts.ts:536-575`, `ttsController.ts:794-800` |
| Journey | `grantStreakShield` sin llamadores: el Escudo de Ronroneo siempre 0/2, nunca protege. La protección real es otra (implícita, hueco de 1 día) | `reading-goal.ts:115-137`, `gamification.ts:539-541` |
| Journey | Recompensas del Sendero (`bufanda_roja`, `gafas_lector`…) no existen en el armario ni en `WEAR_LAYERS`; `strategiesCount` es constante inventada (3 o 1) | `journey.ts:372-380`, `Journey.tsx:395-398` |
| Journey | Afinidad del gato (`incrementCompanionBondLevel`) se escribe y nunca se lee; saludo contextual existe pero Journey no le pasa `bookTitle`; Buzón genera siempre la misma carta stub | `companion-interactions.ts:186-203`, `Journey.tsx:267-272,577` |
| Growth | `Notification.requestPermission()` = 0 ocurrencias; el SW envía `CHECK_HABIT_NOTIFICATION` que nadie escucha; `notificationclick` abre «/» ignorando `bookHash`; opt-in diario sin UI | `sw.js:518-548`, `sw-register.ts:115-131`, `companionNotification.ts:86-94` |
| Growth | `beforeinstallprompt` = 0 ocurrencias: la instalación PWA queda al mini-banner del navegador | grep en `src/`, `public/`, `marketing/` |
| Ficha | `reportSense` + `/api/lexicon/report` implementados, ningún componente los usa (solo mock en tests). El plan de inglés dice «botón ya existente»: premisa falsa | `lexicon.ts:700-722`, `app.ts:669-675`, `WordPanel.test.ts:31` |
| Lector | `completedNaturally: true` se escribe pero nadie lo lee: el cierre natural de capítulo abre el modal «Retiro completado» con texto de retiro | `useReaderNavigation.ts:258-273`, `DeepReadingSummaryModal.tsx:276-323` |
| Lector | `data-hide-indicators` se pinta pero ninguna regla CSS lo consume: el ajuste no hace nada | `ReaderContent.tsx:266-268`, grep CSS = 0 |
| Kindle | «Modo invertido» pone clase `inverted` y cookie, pero no hay ninguna regla `.inverted` en `KINDLE_CSS`: el botón no hace nada | `views.ts:1511,1577`, `routes.ts:1727-1732` |
| Catálogo | El buscador devuelve `pg-98`, `pg-1342`… pero `/api/catalog/pg-*/epub` → 404 (fetch apagado). «Obtener» falla para siempre | `catalog.ts:547-549`, verificado en prod |
| Billing | `PlanNote` es `<a href="/?carne=1">` duro: desde la ficha recarga la PWA entera y saca del libro en el pico de intención de compra | `PlanNote.tsx:10`, `WordPanel.tsx:1119-1123` |

---

## 2. Bugs verificados (no especulación)

### Kindle e-ink
- **Tipografía se pierde al pasar página**: `querySuffix` de Ant./Sig. incluye mode/size/layout/margin pero **no `font`**. Sin fila guardada, la siguiente página vuelve a Literata. `views.ts:1430`, `routes.ts:1736`.
- **Doble evento de actividad por paso de página**: cada GET `/k/read` inserta dos filas en `lecta_user_activity` (una con `synced_at`, otra con `randomUUID()` sin él). Bitácora ×2 y la segunda nunca viaja por el pull. `routes.ts:2064-2104`.
- **`rel="prefetch"` con efectos secundarios**: apunta a un GET que guarda posición y actividad; si el navegador e-ink lo honra, la posición salta a una página no leída. `views.ts:1508`.
- **Notas al pie destruyen la posición**: el salto a `?section=N#frag` aterriza en página 0 (fragmento sin resolver) y **sobrescribe la posición de lectura** con la sección de notas, que se sincroniza al celular. La app móvil sí tiene puntos de retorno; el portal no. `epub-reader.ts:122-145`, `routes.ts:2044-2060`.
- **`/k/practice` viola la regla del Cuaderno**: puede examinar palabras guardadas pero nunca presentadas (`KINDLE_DUE_SQL` solo ordena, no filtra); el pool se re-consulta por pregunta y una palabra puede repetirse; con <3 usa `FALLBACK_WORDS` genéricas en español aunque el libro sea inglés. `routes.ts:2412-2432`.

### Journey / metas
- **Consumir escudo resetea la meta diaria a 1 min**: `ReadingActivity` serializa la meta sin `dailyGoalMs`. `ReadingActivity.tsx:120-128`, `reading-goal.ts:100`.
- **Meta semanal cuenta días con ≥1 min** aunque la diaria elegida sea 15/30; el relleno de gotas usa 15 min fijos; guardar la diaria fuerza `daysPerWeek ?? 5` (meta semanal que el usuario no eligió). `ReadingActivity.tsx:224-227,295`.

### Ficha de palabra
- **Familia léxica inventa palabras**: «oso»→«idad», «rojo»→«rojar/rojoso», «casa»→«casoso». Se pintan como píldoras no tocables y se duplican en nivel 3. En una app de vocabulario, mostrar palabras falsas es el peor fallo de confianza. `word-form.ts:242-266`, `WordPanel.tsx:1101-1109,1185-1194`.
- **Carrera del guardado**: ★ durante la carga IA guarda `meaning: ""`; el resultado IA que llega después solo actualiza el panel, nunca la fila guardada (el backfill solo rellena desde catálogo). La palabra queda vacía para repasos. `WordPanel.tsx:579-581,331-352`, `word-meanings.ts:118-165`.

### Lector
- **Tab secuestrado**: `if (event.key === "Tab") onCenterTap()` corre antes del guard de inputs y sin `preventDefault`: tabular entre botones alterna las barras en cada pulsación. `useReaderShortcutsAndGestures.ts:151`.
- **Dock cuenta secciones EPUB, no capítulos**: «Cap. 23 de 40» cuando el libro tiene 20 capítulos partidos en 40 XHTML; los preliminares cuentan. El catálogo de capítulos reales ya existe y se usa en el título. `ReaderDockHost.tsx:131-135`, `Reader.tsx:2086,3285-3300`.

### TTS
- **Soundscape se reactiva en las pausas de TTS**: la condición solo excluye `"speaking"`; pausar para consultar una palabra arranca lluvia/ronroneo de golpe. Debe excluir también `"paused"`/`"preparing"`. `useAmbientSoundscape.ts:40`.
- **Pausa/reanudar neural repite la oración**: el `safetyTimer` en tiempo real dispara `onDone` si la pausa dura más que el resto de la oración; al reanudar se re-sintetiza desde el inicio. Conviene congelar el timer durante `suspend()`. `kittenTtsEngine.ts:1121-1123`, `ttsController.ts:652-658`.

### Growth / catálogo
- **Correos de auth no llegan a usuarios reales**: `RESEND_FROM_EMAIL` cae a `onboarding@resend.dev` (sandbox): Resend solo entrega al dueño. Magic link, «olvidé contraseña» y borrado **no funcionan** para usuarios reales; solo correo+contraseña es viable. Es prerequisito del digest semanal en curso. `auth.ts:84`.
- **Landing desactualizada tras los retiros**: promete «más de 70 clásicos» (hay 61) y exhibe *Pride and Prejudice* y *Treasure Island* (retirados el 2026-11-16 por copyright). `marketing/landing/index.html:467,485,488,646`.
- **Libros gratis del catálogo exigen re-adjuntar en otro dispositivo**: un clásico obtenido gratis sincroniza solo metadatos; al abrirlo en otro dispositivo pide «Adjunta tu archivo o pasa a Lecta+» aunque Lecta sirve ese EPUB gratis. El comentario del código dice «los vuelve a obtener del catálogo» pero el flujo no lo ofrece. `App.tsx:1417-1427,1635-1639`, `AttachBookSheet.tsx:85-112`.

---

## 3. TOP 3 por área

### Lector
1. **Cierre natural de capítulo ligero** (M): hoy abre modal «Retiro completado» con examen opcional. → tarjeta inline al pie (ya existe `chapterEndCard`) + chip de 1 toque «Fijar 3 palabras (≈25 s)» que abre directo el runner. El modal completo queda solo para Retiro real. No toca FSRS ni consolidación.
2. **Menú táctil compacto para una palabra** (S-M): la presión larga abre 9 objetivos en fila scrollable que no cabe en 390 px. → para 1 palabra: «Significado» ancho + «Tinta» + «Copiar» (≥44 px). Reflexión/Postal/Preguntar ya viven dentro de la ficha. Para ≥2 palabras, barra actual sin cambios. Tiradores intactos.
3. **Progreso del dock por capítulos reales** (S): derivar de `catalog.ranges`/`currentChapterTarget` (igual que el título): «Cap. 7 de 20 · ~12 min» con minutos del rango del capítulo.

Otras: cinta de 1 toque y visible (M), TOC abre en el capítulo actual (S), conmutador scroll/páginas en el popover del dock (S), sleep timer visible (S-M), doble-toque-traducción con feedback honesto + descubribilidad (S-M), dock audio con iconos del sistema + 44 px (S), Tab reasignado + ajuste muerto resuelto (S).

### Ficha / Diccionario / IA
1. **Mostrar 2–3 acepciones del pack + ejemplos que el servidor ya devuelve** (S-M): hoy solo `senses[0]`. Disclosure «2 acepciones más ›», reordenar con `inferContextualPos` (ya existe) para que el sentido compatible con la frase vaya primero — inteligencia invisible que WordReference no puede hacer. Pintar `sense.example`. «…» al truncar.
2. **Validar la familia léxica contra el pack y hacerla navegable** (S): verificar cada candidato con un `db.get` antes de pintarlo; conservar solo lemas reales; renombrar «Familia léxica» (no sinónimos); botón con `onSelectWord` (patrón de personajes ya existe).
3. **Pronunciación IPA + audio lento, offline** (M): extraer IPA del dump kaikki (`sounds`) en el pipeline existente, publicar en el pack limitado a lemas frecuentes (zipf≥3) para no inflar 4.8 MB. Pulsación larga del altavoz = rate 0.6. La señal de confianza bilingüe que falta, 100% offline y gratis.

Otras: cerrar carrera del guardado ★ (S), «Traducir citas» con PlanNote + texto paralelo (S), caché compartida persistente en R2 para explain-in-passage (M, hit rate alto en clásicos), diferir escaneo de personaje hasta que se pide (S-M), botón «Esta acepción no corresponde» (S), formas/conjugación bajo demanda (M), ergonomía de una mano + consolidar CSS duplicado de la ficha (S-M).

### Cuaderno / FSRS
1. **Sesión continua cuando hay cola acumulada** (S): con 15 vencidas, cada tanda de 5 termina en «Terminado por hoy» + «Volver a mi lectura». → si `pendingCount>0`, botón primario «Seguir repasando (N restantes)» que llama `startAdaptiveFlow()`; título «Tanda lista.» Vaciar la cola pasa de 3 decisiones a 1.
2. **Distractores y orden que rotan entre repasos** (S): hoy `seedFor(word.key)` → las mismas 4 opciones en el mismo orden para siempre; al 2º repaso se acierta por memoria del ítem («la segunda»). → sembrar con `word.key + card.reps`: estable en la sesión, distinto en cada repaso. La corrección más barata con mayor efecto sobre aprendizaje real.
3. **Contextos alternativos nacidos del reencuentro** (M): el cloze usa siempre la misma oración capturada. → cuando una palabra guardada reaparece sin ser consultada (el reencuentro pasivo ya se detecta con el análisis a mano), guardar la nueva oración como contexto alternativo (máx 2–3, viaja por sync). El cloze alterna contextos con semilla por repaso. «El vocabulario nace del libro» llevado al repaso, sin IA ni paywall.

Otras: audio en la corrección de «Elegir palabra» + preferencia «pronunciar al revelar» (S-M), chequeo 30 días que mide sin reprogramar (S), agenda «Se enfrían» sin examinar antes de tiempo (M), «Escribir» con verificación local honesta (M), cifras/etiquetas coherentes en el héroe + fuera jerga FSRS del tooltip (S), gato no celebra dos veces (S), menos controles duplicados en la portada móvil (S-M).

### TTS / Audio
1. **Audio en segundo plano + MediaSession** (L): al ocultar la pestaña la sesión se pausa y a los 90 s se cierra; el worker WASM se libera; no hay MediaSession en todo el repo. → modo opt-in «escuchar en segundo plano»: no pausar por visibilidad, `navigator.mediaSession` con metadata + handlers play/pause/prev/next, mantener AudioContext y worker vivos. Lanzar primero Android Chrome con neural; degradar con aviso honesto en iOS. Convierte Lecta en reproductor de audiolibros real.
2. **Continuar al siguiente capítulo (modo audiolibro)** (M): la sesión termina en seco en `chapter_end`. → opción «Seguir al siguiente capítulo» (default en sesiones del dock): resolver el siguiente target del catálogo y extender el ctx en vez de `finish`. Respetar final del libro y sleep timer. La navegación programática entre secciones ya existe.
3. **Selector de voz real** (M): cablear lo que ya está escrito y probado (`setKittenVoice`, `setEngine`, `voiceURI`, el `<select>` de `TtsNowPlaying`): voces del sistema filtradas por idioma + neurales con estado de descarga. La voz es la decisión más personal del audio; hoy el usuario ES solo tiene 1 voz elegida por heurística.

Otras: sleep timer visible en el dock (S), velocidades hasta 2× (S, el motor neural ya soporta), «Joya» que captura la palabra que el usuario eligió y no la que la app decide (M), karaoke palabra a palabra con `onboundary`/estimación neural (M), estrategia de descarga móvil para Piper ES de 63 MB (S/M/L), dock audio con progreso + estado de pausa + 44 px (M), «Continuar escuchando» desde la estantería + oír primero con voz del sistema (M).

### Kindle e-ink
1. **Diccionario embebido por capítulo: consultar sin recargar** (M): hoy consultar cuesta 2–3 navegaciones completas (refresco de tinta + latencia). → al parsear el capítulo, guardar glosario por capítulo en `kcache/ch` (dato de catálogo compartido, cacheable; subir `KINDLE_CHAPTER_CACHE_V`); inyectar tarjetas ocultas `id="dict-<palabra>"` y mostrar con `:target` (CSS puro, WebKit e-ink). El JS fija `location.hash` en vez de navegar; cerrar = limpiar hash → **cero red, cero refresco completo**. Fallback al `?lookup=` actual.
2. **Paso de página más rápido** (M): ~4 rondas secuenciales a DB + 1–2 HEAD a R2 por página. → fusionar resaltados+palabras en un `Promise.all`, memoizar `kindleUserOwnsBook` por (userId,hash) con TTL corto, precachear en `waitUntil` la sección siguiente al servir la penúltima página, retirar el prefetch con efectos.
3. **Notas al pie con destino exacto y posición protegida** (M): resolver el fragmento contra la paginación (`?section=N&page=P#frag`), tratar el salto como excursión (no persistir posición, llevar `from=section:page`), enlace fijo «← Volver a la lectura». Protege el dato más valioso del producto.

Otras: fuente que persiste + modo invertido real + doble actividad + prefetch (S, bugs), `/k/practice` que examina solo lo presentado y sin repetición ni fallback genérico (M), vinculación con código caducado visible y sin bucle noscript (S), marcadores sincronizados con la app (M, la tabla ya existe), captura automática de consultas estilo Vocabulary Builder con reglas de Lecta (M), presets + vista previa real en `/k/ajustes` y estado del dispositivo en el panel del celular (M), modo «Subrayar» simétrico al de «Consultar» + % del libro (S-M).

### Explora / Catálogo / Comunidad
1. **«Más clásicos» deja de ser un callejón sin salida** (S/M): anotar cada resultado con disponibilidad real (objeto R2) y mapear `gutenbergId`→id curado cuando exista (dedup por SHA-256); los no disponibles muestran «Aún no disponible en Lecta» sin botón que falla. **Legal crítico**: el índice contiene `pg-1342` (edición retirada por prefacio de Saintsbury †1933); `rightsCheck` no ve prologuistas y `admitRdf` (M8) no está implementado. Nunca sembrar `pg-` sin auditoría manual de primeras páginas.
2. **«Probar con un clásico» para TODO el catálogo, sin cuenta** (S-M): hoy solo 6. Los EPUB curados son PD desmarcado y se sirven sin sesión. → ampliar la excepción a cualquier id del índice; los lomos de la landing se vuelven enlaces `/?probar=<id>`. El flujo trial existente no cambia. **La decisión de ampliar la excepción es de Luis.**
3. **Crecer el catálogo legalmente** (L): recuperar retirados con ediciones limpias (P&P #1342 sin prefacio, Treasure Island #120 sin ilustraciones, Clavo `.noimages`); buscar traducciones con traductor †≤1924 para las 18 rechazadas (Ilíada, Odisea, Los Miserables, Crimen y Castigo…); incorporar **Standard Ebooks (CC0 sobre el archivo completo, verificado)** para subir EN de 7 a ~25. Aplicar el mismo corte vida+100 y revisión de front matter. No Global Grey (prohíbe venta).

Otras: estadísticas por libro en `index.json` (wordCount, dificultad proxy, año) para tarjetas informativas sin descargar manifiestos de 0.4–1.8 MB (M), `firstPublicationYear` real + landing coherente (S), SubtitleShelf que parsea el nombre del archivo y acepta varios episodios (M), «Siguiente libro» al terminar + colecciones curadas con `compareBookCoverages` (M), guías oficiales de papel para sembrar Comunidad (M), sinopsis propias para los 54 ES (M editorial), Explora móvil con menos píldoras y filtros con contador (S-M).

### Journey / Gato
1. **Sendero honesto + una sola escalera** (M): conectar cada hito a una prenda real del armario (o quitar la promesa); sustituir `strategiesCount` inventado por dato real; fundir las tres escaleras (XP «Inicio→Bibliotecario», tinta «Caminante→Maestro», «Nivel léxico /100») en una: XP del gato como moneda única, Sendero como visualización. El guardián `companion-art.test.ts` debe cubrir las recompensas.
2. **Racha sin culpa coherente** (S-M): unificar en el protector que ya funciona (marcapáginas implícito) y hacerlo visible, o convertir los escudos en versión tangible otorgada por logros `racha_3`/`racha_7`. Corregir los 3 bugs de metas (serialización sin `dailyGoalMs`, umbral semanal, `daysPerWeek` inventado).
3. **Gato testigo de la lectura real** (M): cartas en hitos reales (libro terminado con palabras cosechadas, subida de rango, palabra dominada, regreso) reutilizando las funciones puras existentes; exlibris con fecha + minutos + «N palabras de este libro ya son tuyas»; saludo contextual con el libro activo; afinidad visible o eliminada.

Otras: telemetría honesta y en el idioma del lector (M, pasar idioma+perfil al resumen, marcar estimados, curva real de theta), modo zen completo que apague rango/Sendero/racha (S), recordatorio de hábito a tu hora de siempre con opt-in alcanzable (M), ficha de lectura compartible (S texto / M imagen), **purga de emojis → iconografía editorial** (S-M, quick win de alto impacto), tokenizar los 9 hex de `CompanionStage` (S), «Hoy» primero en móvil + fuera jerga FSRS (S-M).

### Cuenta / Planes / Sync / Growth
1. **Correo con dominio propio + magic link como puerta principal** (S): verificar dominio en Resend (`correo.lectal.app`) y actualizar `RESEND_FROM_EMAIL` — prerequisito del digest en curso. Ofrecer «Entrar con enlace mágico» de primera clase (un campo, sin contraseña) con copy correcto (el plugin crea la cuenta si no existe). Avisar en el borrado «abre el enlace en este mismo navegador». Contar `signup` también sin `src`.
2. **Despertar el bucle de hábito dormido** (M): pedir permiso con gesto del usuario en momento amable; escuchar `CHECK_HABIT_NOTIFICATION` en `sw-register.ts`; `notificationclick` → abrir el libro concreto; exponer el toggle diario en «Tú». El mensaje ya está diseñado sin culpa ni spoilers.
3. **Completar el viaje de ida y vuelta del pago** (S): `success_url=?carne=gracias` / `cancel_url=?carne=cancelado` con nota tipográfica diferenciada; hacer visible la subida automática a la nube; `PlanNote` con navegación in-app a «Tú» en vez de recarga. Todo en notas de 2 líneas, cero modales.

Otras: libros del catálogo gratis → «Volver a descargar gratis» en vez de re-adjuntar (S-M), «Prueba de Imprenta» 7 días de Lecta+ sin tarjeta (S-M, **non-goal explícito del diseño: requiere decisión de Luis**), instalar PWA en el momento justo (S-M), cada cita compartida con `lectal.app` + «Léelo gratis» (S), Welcome también ofrece probar sin cuenta (S), landing coherente con el catálogo real (S), Carné con contraste Gratis/Plus + «cancela cuando quieras» + 3 días de gracia (S).

---

## 4. Apuestas grandes (nuevas implementaciones, esfuerzo L)

| Apuesta | Valor | Riesgo |
|---|---|---|
| **Audiolibro real** (TTS B1+B2: segundo plano + MediaSession + continuar capítulo) | Convierte el TTS gratis en la función más diferenciadora frente a Kindle/Audible para quien camina/conduce | iOS hostil (speechSynthesis muere en background); batería del WASM vivo; opt-in y degradación honesta |
| **Catálogo legal ~80–90 títulos** (Explora B2: Standard Ebooks CC0 + recuperados + traducciones †≤1924) | El inglés sube de 7 a ~25; entran los clásicos más buscados | Legal si se salta la auditoría de front matter; `rightsCheck` no ve prologuistas/ilustradores |
| **IPA + pronunciación offline** (Ficha B7: pipeline kaikki → pack → UI) | La señal de confianza bilingüe que falta, gratis y offline | Tamaño del pack (mitigado por banda de frecuencia); cobertura IPA parcial |
| **Diccionario e-ink sin recarga** (Kindle B1: glosario por capítulo + `:target`) | La acción central de Lecta pasa de 2–3 refrescos a 0 en el dispositivo más lento | `:target` en navegadores viejos (fallback); +10–15 kB/página |

---

## 5. Quick wins priorizados (esfuerzo S, alto impacto)

Orden sugerido por retorno/esfuerzo. Todos verificados en código.

1. **Correos funcionales** (Growth A1): desbloquea magic link, recuperación, borrado y digest. Ops DNS/Resend + copy.
2. **Bugs Kindle de confianza** (A2): fuente que persiste + modo invertido real + doble actividad + prefetch con efectos.
3. **Distractores que rotan** (Cuaderno A2): convierte el repaso en recuperación real, no memoria del ítem.
4. **Sesión continua con cola** (Cuaderno A1): protege el hábito diario cuando hay cola acumulada.
5. **Familia léxica validada** (Ficha A2): deja de mostrar palabras falsas.
6. **Carrera del guardado ★** (Ficha A3): palabras guardadas con significado vacío.
7. **Progreso del dock por capítulos reales** (Lector A3).
8. **Sleep timer visible + velocidades hasta 2×** (TTS A2/A3).
9. **Purga de emojis → Icon** (Journey C1) + **tokenizar hex de CompanionStage** (C2).
10. **Landing coherente** (Explora A3 / Growth C2): «más de 60», fuera lomos retirados.
11. **PlanNote in-app + viaje de pago completo** (Growth A3).
12. **Tab reasignado + ajuste muerto resuelto** (Lector C10).
13. **Fuera jerga FSRS** de tooltips y Journey (Cuaderno C1 / Journey C3).
14. **Cita compartida con URL** (Growth B3).
15. **Welcome ofrece probar sin cuenta** (Growth C1).

---

## 6. Decisiones que requieren a Luis

1. **¿Ampliar el trial sin cuenta a todo el catálogo?** Hoy son 6 clásicos; la excepción ya está aprobada para 6. Ampliarla a los 61 (PD desmarcado, servidos sin sesión) multiplica las puertas de entrada al gesto diferenciador. (Explora B1)
2. **¿Prueba gratuita de 7 días de Lecta+?** Fue **non-goal explícito** en `docs/designs/2026-11-12-planes-y-landing.md`. Stripe ya soporta `trial_period_days` + `payment_method_collection=if_required` y el webhook ya maneja `trialing`. Sin tarjeta la conversión prueba→pago baja y exige flujo «añadir método». (Growth B1)
3. **Mecánica de racha**: ¿escudos tangibles otorgados por logros, o freeze implícito estilo Duolingo/Finch hecho visible? Hoy hay dos mecanismos contradictorios y uno nunca dispara. (Journey A2)
4. **`data-hide-indicators`**: ¿darle reglas CSS (ocultar punteado de predichas/relieve de guardadas) o retirar el ajuste muerto? (Lector C10)
5. **Atajo Tab**: ¿reasignar «Mostrar/ocultar controles» a otra tecla (`.`/`Escape`) y dejar Tab para foco nativo? (Lector C10)
6. **Economía del Journey**: ¿fundir las tres escaleras en una (XP del gato como moneda única)? Cambiar la economía puede reordenar prendas ganadas; mitigar con proyección retroactiva. (Journey A1)

---

## 7. Hilo conductor

Lecta ya tiene una cantidad inusual de inteligencia invisible bien construida:
posición exacta intra-párrafo, presupuesto de atención, recap sin spoilers,
diccionario offline con SHA-256, FSRS honesto que enseña antes de examinar,
paginación e-ink calibrada, sync por cursores. **Las fricciones restantes no son
de falta de funciones sino de presentación, peso y cableado**: el cierre de
capítulo celebra donde debería dejar pasar, el menú de consulta muestra 9
acciones donde el usuario quiere 1, el progreso cuenta archivos donde debería
contar capítulos, la familia léxica inventa palabras, el repaso mide memoria del
ítem, y decenas de funciones ya escritas (selector de voz, sleep timer, escudos,
notificaciones, instalación PWA, botón de reporte) están dormidas o rotas en
producción.

Las tres palancas de mayor retorno:
1. **Cablear lo dormido y arreglar las promesas rotas** (quick wins §5) — confianza inmediata, esfuerzo S.
2. **Hacer el audio un audiolibro de verdad** (segundo plano + continuar capítulo) — la función gratis más diferenciadora.
3. **Cerrar el bucle multi-dispositivo** (diccionario e-ink sin recarga, notas al pie que no destruyen la posición, libros gratis que se re-descargan, consultas Kindle que alimentan el Cuaderno) — el argumento central de Lecta+.

Todo respeta las reglas inquebrantables: apertura inmediata, un solo dock,
significado primero, enseña antes de examinar, ≤215 kB JS / ≤55 kB CSS, bermellón
a una acción primaria, geometría de imprenta, temas papel/noche, cero jerga,
derechos de autor. Las ideas de datos (IPA, formas, estadísticas) van al pack o al
índice, no al bundle.

---

## Método y límites

- 8 subagentes `general-purpose` en paralelo, uno por área. Solo lectura: ningún
  archivo modificado durante la revisión.
- Cada afirmación de «falta» se verificó con grep de consumidores en producción
  (no solo tests): `grantStreakShield`, `getCompanionBondLevel`,
  `setOptInDailyReminders`, `setKittenVoice`, `reportSense`, ids de recompensa del
  Sendero, `requestPermission`, `beforeinstallprompt`, `MediaSession` no tienen
  llamadores fuera de sus módulos/tests.
- El agente de Explora verificó el catálogo en producción (`https://lectal.app`,
  2026-11-17): 61 libros (54 ES / 7 EN), 7 con sinopsis, 0 con difficulty,
  búsqueda con índice cargado pero `pg-*/epub` → 404.
- No se cubrió el digest semanal por correo (en curso: `src/worker/weekly-digest.ts`
  + migración `031_user_digest.sql` sin commit). Su prerequisito es Growth A1
  (dominio de correo verificado).
- Código muerto detectado y **mencionado, no borrado** (regla del repo):
  `modeForWord` (`practice.ts:232`), `TtsNowPlaying.tsx`, `TtsAudioController`/
  `playSentencesLoop` (`ttsController.ts:902-1182`, camino standalone solo de tests).