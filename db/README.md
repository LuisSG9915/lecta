# db — esquema base, semilla y migraciones

## Overview

Esquema SQL de Lecta para CockroachDB. `schema.sql` + `seed.sql` crean una
base nueva (`pnpm db:setup`); las migraciones incrementales viven en
[migrations/README.md](./migrations/README.md) (`pnpm db:migrate`). Las
tablas de Better Auth (`"user"`, sesiones) las crea `pnpm db:auth`, no estos
archivos.

## Interface

- `schema.sql`: `CREATE TABLE` `lexicon_entries`, `lexicon_forms`,
  `lexicon_senses`, `lecta_user_words`, `lecta_rate_log`,
  `lecta_user_annotations`, `user_books`, `kindle_link_codes`,
  `lecta_ai_quota`; índices `lexicon_forms_lookup`,
  `lecta_user_words_user`, `lecta_rate_log_window`,
  `idx_kindle_link_codes_status`, `idx_user_*_synced_at`; un
  `ALTER TABLE lecta_user_words`.
- `seed.sql`: `INSERT INTO` `lexicon_entries`, `lexicon_forms`,
  `lexicon_senses`.
- `migrations/`: 27 migraciones `001`–`027`.

## Invariants

- `scripts/db-setup.mjs` parte los archivos por `;\s*\n`: cada sentencia
  debe terminar en `;` + salto de línea, y no puede haber `;` + salto
  dentro de una sentencia.
- `schema.sql` no refleja todas las migraciones (p. ej. no crea
  `lecta_user_positions` ni `lecta_kindle_prefs`): una base nueva necesita
  `db:setup` + `db:auth` + `db:migrate`.
- El catálogo `lexicon_*` real vive solo en `lecta_dev`; las copias en
  `lecta` están dormidas.

## Side Effects

- `pnpm db:setup` / `pnpm db:migrate` escriben DDL y datos en
  `DATABASE_URL`.

## Verification

- Run: `pnpm db:setup` / `pnpm db:migrate` contra `lecta_dev`.
- Run: `pnpm test`.
