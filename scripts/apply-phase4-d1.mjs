#!/usr/bin/env node
/**
 * Script idempotente para aplicar la Migración 010 (Kindle 4-letter codes en D1)
 * y sincronizar db/schema.sql sin errores.
 * Uso: node scripts/apply-phase4-d1.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'db/migrations/010_kindle_link_codes.sql');
const schemaPath = path.join(root, 'db/schema.sql');

const KINDLE_SQL_BLOCK = `
-- 010_kindle_link_codes.sql: Vinculacion instantanea de Kindle mediante codigo de 4 caracteres
CREATE TABLE IF NOT EXISTS kindle_link_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  session_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 600)
);

CREATE INDEX IF NOT EXISTS idx_kindle_link_codes_status
  ON kindle_link_codes(status, expires_at);
`.trim();

// 1. Crear o actualizar db/migrations/010_kindle_link_codes.sql
fs.writeFileSync(migrationPath, KINDLE_SQL_BLOCK + '\n', 'utf8');
console.log('✅ Creado: db/migrations/010_kindle_link_codes.sql');

// 2. Sincronizar db/schema.sql de forma idempotente
if (fs.existsSync(schemaPath)) {
  const currentSchema = fs.readFileSync(schemaPath, 'utf8');
  if (!currentSchema.includes('CREATE TABLE IF NOT EXISTS kindle_link_codes') &&
      !currentSchema.includes('CREATE TABLE kindle_link_codes')) {
    const updatedSchema = currentSchema.trimEnd() + '\n\n' + KINDLE_SQL_BLOCK + '\n';
    fs.writeFileSync(schemaPath, updatedSchema, 'utf8');
    console.log('✅ Actualizado: db/schema.sql con tabla kindle_link_codes');
  } else {
    console.log('ℹ️ db/schema.sql ya contiene kindle_link_codes (sin duplicados).');
  }
} else {
  console.error('❌ No se encontró db/schema.sql');
  process.exit(1);
}
