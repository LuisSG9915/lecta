// Aplica las tablas de Better Auth a la base configurada en DATABASE_URL.
// Usa getMigrations del paquete instalado para que el esquema coincida con la
// versión exacta de better-auth del proyecto (introspecciona y solo crea lo
// que falte).
import { getMigrations } from "../node_modules/better-auth/dist/db/get-migration.mjs";
import { magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL no está definida. Usa `pnpm db:auth` (lee .env).");
  process.exit(1);
}

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }),
  }),
});

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations({
  database: { db, type: "postgres" },
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret",
  emailAndPassword: { enabled: true },
  plugins: [magicLink({ sendMagicLink: async () => {} })],
});

console.log(
  `Tablas por crear: ${toBeCreated.length ? toBeCreated.map((t) => t.table).join(", ") : "ninguna"}`,
);
console.log(`Columnas por agregar: ${toBeAdded.length}`);
await runMigrations();
console.log("Esquema de autenticación aplicado.");
await db.destroy();
