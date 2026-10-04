import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { getConnectionString, type WorkerEnv } from "./db";

export function createAuth(env: WorkerEnv, baseURL: string) {
  const pool = new pg.Pool({ connectionString: getConnectionString(env), max: 1 });
  return betterAuth({
    database: {
      db: new Kysely({ dialect: new PostgresDialect({ pool }) }),
      type: "postgres",
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    emailAndPassword: { enabled: true },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          console.log(`[magic-link] para ${email}: ${url}`);
        },
      }),
    ],
  });
}
