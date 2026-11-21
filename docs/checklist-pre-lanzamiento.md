# Checklist pre-lanzamiento — abrir lectal.app al público

Fecha: 2026-11-19. Objetivo: pasar de «desplegado» a «abierto al público»
(tráfico real de desconocidos, no cuentas conocidas).

Criterio de salida: **todo lo Bloqueante (B) en ✅ antes de invitar gente**;
lo Importante (I) antes de prensa o campañas. Cada ítem dice cómo verificarlo.

## Estado verificado en caliente (2026-11-19)

- ✅ `/api/health` → `{"ok":true,"db":"connected"}`
- ✅ Voz neural EN (Kitten): 200, 24 369 971 bytes, `Cache-Control: immutable`
- ✅ Voz neural ES (Piper `es_MX-claude-high-v1.onnx`): 200, 63 122 309 bytes
  + config JSON → **el 404 de R2 registrado el 2026-11-17 ya está resuelto**
- ✅ Packs de diccionario `dict-es-v7` / `dict-en-v7`: 200, `immutable`
- ✅ DKIM de Resend presente (`resend._domainkey.lectal.app`)
- ❌ **SPF: `lectal.app` no tiene registro TXT** (ver B3)
- ❌ **DMARC: `_dmarc.lectal.app` no existe** (ver B3)
- ⚠️ Sin MX: el dominio es solo-envío; aceptable, pero nada de `@lectal.app`
  puede recibir correo (afecta a B3 y I4)

## Bloqueantes (cerrar antes de invitar a nadie)

### B1. Android real por adb — la audiencia principal lee en celular

Sin probar en dispositivo desde el deploy `0372590a`. Con una cuenta nueva,
contra producción (`lectal.app`), voz neural + «Escuchar en segundo plano»:

- [ ] Bloquear pantalla con audio corriendo → el audio **sigue** sonando.
- [ ] Controles play/pausa/oración en la pantalla de bloqueo (MediaSession).
- [ ] El capítulo avanza solo con la pantalla bloqueada (sin rAF).
- [ ] La notificación muestra libro y capítulo (`bookDisplayName`), no un hash.
- [ ] Al desbloquear, la posición del lector es la correcta (sin salto).

Arnés: `adb forward tcp:9222 localabstract:chrome_devtools_remote` +
`chromium.connectOverCDP`. Contra local: `adb reverse tcp:5188 tcp:5188`
(y tras cada rebuild, reiniciar `vite preview`).

### B2. Kindle e-ink real

Pendiente de dispositivo desde el deploy `7b376502`. Con el Kindle vinculado:

- [ ] Tarjeta del diccionario abre y cierra por hash **sin recargar la página**.
- [ ] «Guardada» aparece tras consultar vocab (y `res.ok` evita el falso
      positivo tras redirect).
- [ ] Modo invertido y elección de fuente **persisten** al pasar página.
- [ ] Enlace interno (nota al pie) aterriza en la sección correcta.
- [ ] El avance de página inserta actividad (verificar en la bitácora).

### B3. Correo: SPF + DMARC — el magic link es la puerta de entrada

Hoy solo hay DKIM. Sin SPF/DMARC, Gmail/Outlook pueden mandar el magic link
y los avisos de cuenta a spam; el registro muere ahí.

- [ ] Añadir TXT en la raíz (valor exacto desde el dashboard de Resend,
      Domains → DNS; el típico de Resend es `v=spf1 include:_spf.resend.com ~all`).
- [ ] Añadir `_dmarc` TXT: empezar en observación,
      `v=DMARC1; p=none; rua=mailto:<buzón real de Luis>` (no usar `@lectal.app`:
      el dominio no recibe correo).
- [ ] Reenviar el magic link a un buzón de cada proveedor (B4) y confirmar
      bandeja de entrada. Con entregabilidad limpia unos días, subir a
      `p=quarantine`.
- [ ] Verificar con `dig +short TXT lectal.app` y `dig +short TXT _dmarc.lectal.app`.

### B4. Entregabilidad manual del magic link

- [ ] Enviar el enlace a Gmail, Outlook/Hotmail y ProtonMail: llega a **bandeja**
      en los tres, abre sesión y `migrateAnonymousToUser` sube lo anónimo.
- [ ] «Olvidé contraseña» y el enlace de borrado de cuenta llegan igual.

## Importantes (antes de prensa / campañas, no del día 0)

### I1. Catálogo léxico: producción lee de `lecta_dev`

`src/worker/lexicon.ts` consulta `lecta_dev.lexicon_*` desde la conexión de
prod, y las pruebas destructivas contra esas tablas **pega a usuarios reales**.

- [ ] Decidir: (a) cerrar con opt-in toda prueba que escriba/borre en
      `lexicon_*` (p. ej. flag de entorno), o (b) duplicar el catálogo en
      `lecta`. Recomendado mínimo: (a) antes del día 0.
- [ ] Criterio: `pnpm test` con el flag apagado no toca ninguna tabla
      `lexicon_*` de `lecta_dev`.

### I2. Compra real de Lecta+ de punta a punta

No consta una suscripción live completa (el webhook solo se probó con firma
inválida y eventos de prueba).

- [ ] Pagar una suscripción real (o tarjeta de prueba en live): fila
      `lecta_plus` en `lecta_user_plan`, evento en `lecta_stripe_events`,
      Carné de Lector en «Tú», trial de 7 días cuando aplique.
- [ ] Cancelar desde Stripe Customer Portal y ver el plan caducar
      (gracia de 3 días).

### I3. Digest semanal a cuenta no dueña (B4 pendiente de growth)

- [ ] Cuenta no dueña con `digest_opt_in`: el digest **no** se le entrega
      (solo al dueño mientras `RESEND_FROM_EMAIL` sea el sandbox) y el opt-in
      no rompe el guardado.

### I4. Canal de soporte visible

- [ ] Una dirección de contacto real (buzón existente, no `@lectal.app`)
      visible en la landing y/o aviso legal. Con prensa llegan preguntas.

### I5. Órdenes del día 0

- [ ] `pnpm smoke:auth` / `pnpm smoke:sync` tras el último deploy (ya son
      automáticos en `deploy-smoke.yml`; anotar cuentas creadas).
- [ ] Vigilar `pnpm landing:stats --days 7` a diario la primera semana.
- [ ] El digest de errores del cron de las 05:00 (`LECTA_OWNER_EMAIL`) es la
      alarma temprana: abrirlo cada mañana.

## Lanzamiento gradual (propuesta)

1. **Semana suave**: comunidades de lectura y de aprendizaje de inglés/español
   (Reddit, Facebook, foros). El posicionamiento «el vocabulario nace del
   libro» es diferencial ahí. Medir registro → primer libro → palabra guardada.
2. **Iterar** sobre el embudo con `landing-events` antes de gastar en prensa.
3. **Prensa** cuando haya una historia con datos reales (p. ej. «lectores que
   guardaron N palabras en su primera semana»).

## Registro de verificaciones

| Fecha | Ítem | Resultado | Nota |
| --- | --- | --- | --- |
| 2026-11-19 | Binarios de voz + packs + health | ✅ | En caliente, este documento |
| 2026-11-19 | SPF / DMARC | ❌ | Solo DKIM de Resend existe |
