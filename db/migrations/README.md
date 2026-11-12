# db/migrations — migraciones SQL (CockroachDB)

## Overview

Migraciones numeradas que `pnpm db:migrate` (`scripts/db-migrate.mjs`)
aplica en orden lexicográfico a la base de `DATABASE_URL`, registrando cada
archivo en `lecta_schema_migrations`. Todas usan `IF NOT EXISTS` y son
idempotentes. Prod es `lecta`; dev es `lecta_dev` (que además aloja el
catálogo léxico compartido `lexicon_*`).

## Interface

Tablas tocadas por cada archivo (DDL exacto).

| Archivo | DDL |
| --- | --- |
| `001_user_annotations.sql` | `CREATE TABLE lecta_user_annotations`; índice `lecta_user_annotations_user` |
| `002_user_activity.sql` | `CREATE TABLE lecta_user_activity`; índice `lecta_user_activity_user` |
| `003_lexicon_catalog.sql` | `CREATE TABLE lexicon_sources`; `ALTER TABLE lexicon_entries` (+`zipf`, `source`, `status`, `model_version`, `prompt_version`), `lexicon_senses` (+`status`, `reports`), `lexicon_forms` (+`source`, `ambiguous`) |
| `004_user_reviews.sql` | `CREATE TABLE lecta_user_reviews` + índice `lecta_user_reviews_user`; `ALTER TABLE lecta_user_words` (+`sense_entry_id`, `sense_order`) |
| `005_user_positions.sql` | `CREATE TABLE lecta_user_positions` (PK `user_id, book_hash`) |
| `006_lexicon_items.sql` | `CREATE TABLE lexicon_items`; `ALTER TABLE lecta_rate_log` (+`scope` default `'enrich'`) |
| `007_user_knowledge.sql` | `CREATE TABLE lecta_user_knowledge` |
| `008_lexicon_senses_source.sql` | `ALTER TABLE lexicon_senses` (+`source`); `UPDATE lexicon_senses` |
| `009_user_companion.sql` | `CREATE TABLE lecta_user_companion_baselines`, `lecta_user_companion_events`, `lecta_user_companion_fields`, `lecta_user_companion_receipts` |
| `010_kindle_link_codes.sql` | `CREATE TABLE kindle_link_codes`; índice `idx_kindle_link_codes_status` |
| `011_user_books.sql` | `CREATE TABLE user_books` (PK `user_id, book_id`); índice `idx_user_books_user` |
| `012_sync_incremental_indexes.sql` | Índices `idx_user_words_user_lang_updated` (`lecta_user_words`), `idx_user_knowledge_user_lang_updated` (`lecta_user_knowledge`), `idx_user_annotations_user_updated` (`lecta_user_annotations`), `idx_user_activity_user_ended_id` (`lecta_user_activity`), `idx_user_reviews_user_created_id` (`lecta_user_reviews`) |
| `013_knowledge_sync_order_index.sql` | Índice `idx_user_knowledge_user_updated_lang_lemma` (`lecta_user_knowledge`) |
| `014_ai_quota.sql` | `CREATE TABLE lecta_ai_quota` (PK `user_id, scope, bucket_hour`) |
| `015_server_synced_at.sql` | `ALTER TABLE` +`synced_at` en `lecta_user_activity`, `lecta_user_annotations`, `lecta_user_knowledge`, `lecta_user_positions`, `lecta_user_reviews`, `lecta_user_words`; índices `idx_user_*_synced_at` |
| `016_user_words_presented_at.sql` | `ALTER TABLE lecta_user_words` (+`presented_at BIGINT`) |
| `017_book_covers.sql` | `ALTER TABLE user_books` (+`has_cover`) |
| `018_error_signatures.sql` | `CREATE TABLE lecta_error_signatures` (PK `bucket_day, signature`) |
| `019_positions_anchor_offset.sql` | `ALTER TABLE lecta_user_positions` (+`anchor_offset FLOAT8`) |
| `020_kindle_prefs.sql` | `CREATE TABLE lecta_kindle_prefs` (PK `user_id`) |
| `021_daily_summaries.sql` | `CREATE TABLE lecta_daily_summaries` (PK `user_id, day, device`); índice `idx_daily_summaries_user_synced` |
| `022_book_language.sql` | `ALTER TABLE user_books` (+`language`) |
| `023_account_reset_marker.sql` | `CREATE TABLE lecta_account_state` (PK `user_id`) |
| `024_user_books_community.sql` | `ALTER TABLE user_books` (+`shared`, `shared_at`, `paper_only`); índice `idx_user_books_shared` |
| `025_user_books_genre.sql` | `ALTER TABLE user_books` (+`genre`) |
| `026_user_highlights.sql` | `CREATE TABLE lecta_user_highlights` + índice `idx_user_highlights_user_book_section`; `ALTER TABLE lecta_user_highlights ENABLE ROW LEVEL SECURITY` |
| `027_user_plan.sql` | `CREATE TABLE lecta_user_plan` (PK `user_id`, `CHECK plan`) + índice `idx_user_plan_stripe_customer`; `CREATE TABLE lecta_stripe_events` (PK `event_id`); `ALTER TABLE user_books` (+`has_file`); `INSERT … SELECT` de fundadores (`"createdAt" < to_timestamp(1794528000)`, 2026-11-13T00:00Z) |

## Invariants

- Las migraciones solo se agregan; nunca se reescribe un archivo aplicado
  (el registro es por nombre en `lecta_schema_migrations`).
- Migraciones nuevas van a `lecta_dev`; `lecta` solo con autorización
  expresa (`LECTA_MIGRATE_TARGET=lecta`, ver AGENTS.md §Verificación).
- Tablas con `schema_locked=true` deben desbloquearse solo para la
  migración y volver a bloquearse; el migrador falla rápido si no.
- Un `CREATE INDEX` cuyas columnas clave incluyan la PK completa se cuelga
  en el cluster: en prod `012`/`013` se crearon sin las columnas que
  completan la PK (AGENTS.md).
- `015` y `016` van juntas con el deploy del worker que lee
  `synced_at`/`presented_at`.
- `027` va **después** del deploy del worker (sin la tabla, el plan se lee
  como `founder_lifetime` degradado y las escrituras de plan responden 503)
  y **no** se aplica en `lecta` antes de 2026-11-13T00:00:00Z: el INSERT de
  fundadores corre una sola vez.
- Las tablas de usuario referencian `"user"(id) ON DELETE CASCADE`.

## Side Effects

- DDL sobre la base apuntada; cada `ALTER`/`CREATE INDEX` dispara un job
  `SCHEMA CHANGE` que CockroachDB serializa (un `SCHEMA CHANGE GC` puede
  bloquear la cola hasta 75 min).

## Verification

- Run: `pnpm db:migrate` (contra `lecta_dev`).
- Run: `pnpm test` (`scripts/db-migrate.test.mjs`).
