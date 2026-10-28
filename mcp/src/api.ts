import type { LectaConfig } from "./config.js";

export class LectaApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "LectaApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class LectaAuthError extends LectaApiError {
  constructor(message: string, status = 401, payload?: unknown) {
    super(message, status, payload);
    this.name = "LectaAuthError";
  }
}

export type LectaSession = {
  user?: {
    id?: string;
    name?: string;
    email?: string;
    emailVerified?: boolean;
  };
  session?: {
    expiresAt?: string;
    createdAt?: string;
    updatedAt?: string;
  };
};

type RequestOptions = {
  anonymous?: boolean;
  allowStatus?: number[];
};

const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";

export function parseCookieHeader(
  raw: string,
  sessionCookieName: string,
): Map<string, string> {
  const jar = new Map<string, string>();
  const value = raw.replace(/^cookie:\s*/i, "").trim();
  if (!value) return jar;
  if (!value.includes("=")) {
    jar.set(sessionCookieName, value);
    return jar;
  }
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return jar;
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function ingestSetCookies(jar: Map<string, string>, headers: Headers) {
  for (const setCookie of headers.getSetCookie()) {
    const first = setCookie.split(";")[0]?.trim();
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq);
    const value = first.slice(eq + 1);
    // Una cookie vacía o vencida se elimina del tarro.
    if (!value || /max-age=0/i.test(setCookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function parsePayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload.slice(0, 500);
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Cliente HTTP de la API de Lecta.
 *
 * - Las herramientas públicas usan `anonymous` y no tocan credenciales.
 * - Las privadas usan la cookie de sesión (LECTA_COOKIE) o inician
 *   sesión con correo+contraseña (LECTA_EMAIL / LECTA_PASSWORD).
 * - El tarro de cookies vive solo en memoria: al reiniciar el proceso
 *   se vuelve a autenticar, sin secretos persistidos en disco.
 */
export class LectaApi {
  private readonly config: LectaConfig;
  private readonly jar = new Map<string, string>();
  private loginPromise: Promise<void> | null = null;

  constructor(config: LectaConfig) {
    this.config = config;
    if (config.cookie) {
      const sessionCookieName = config.baseUrl.startsWith("https:")
        ? SECURE_SESSION_COOKIE
        : SESSION_COOKIE;
      for (const [name, value] of parseCookieHeader(config.cookie, sessionCookieName)) {
        this.jar.set(name, value);
      }
    }
  }

  get baseUrl() {
    return this.config.baseUrl;
  }

  get hasCredentials() {
    return Boolean(this.config.cookie || (this.config.email && this.config.password));
  }

  get canSignIn() {
    return Boolean(this.config.email && this.config.password);
  }

  private async send(
    url: string,
    init: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new LectaApiError(
          `Lecta no respondió en ${this.config.timeoutMs} ms (${this.config.baseUrl}).`,
          0,
        );
      }
      throw new LectaApiError(
        `No se pudo conectar con Lecta en ${this.config.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      );
    }
  }

  private async signIn(): Promise<void> {
    if (!this.canSignIn) {
      throw new LectaAuthError(
        "Esta herramienta necesita una cuenta de Lecta. Configura LECTA_COOKIE o LECTA_EMAIL + LECTA_PASSWORD.",
      );
    }
    const response = await this.send(`${this.config.baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this.config.baseUrl,
        "user-agent": "lecta-mcp/0.2.3",
      },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });
    const text = await response.text();
    const payload = parsePayload(text);
    if (!response.ok) {
      throw new LectaAuthError(
        `No se pudo iniciar sesión en Lecta: ${
          apiMessage(payload) ?? `HTTP ${response.status}`
        }`,
        response.status,
        payload,
      );
    }
    ingestSetCookies(this.jar, response.headers);
    if (!this.jar.size) {
      throw new LectaAuthError(
        "Lecta aceptó el inicio de sesión pero no devolvió una cookie de sesión.",
        502,
        payload,
      );
    }
  }

  private async ensureAuth(force = false): Promise<void> {
    if (force) this.jar.clear();
    if (this.jar.size) return;
    if (!this.canSignIn) {
      throw new LectaAuthError(
        "Esta herramienta necesita una cuenta de Lecta. Configura LECTA_COOKIE (cookie better-auth.session_token) o LECTA_EMAIL + LECTA_PASSWORD.",
      );
    }
    this.loginPromise ??= this.signIn().finally(() => {
      this.loginPromise = null;
    });
    await this.loginPromise;
  }

  async request<T = unknown>(
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "lecta-mcp/0.2.3",
      ...(init.headers ?? {}),
    };

    if (!options.anonymous) {
      await this.ensureAuth();
      headers.cookie = cookieHeader(this.jar);
    }

    let response = await this.send(url, { ...init, headers });

    if (response.status === 401 && !options.anonymous) {
      if (!this.canSignIn) {
        throw new LectaAuthError(
          "La sesión de Lecta venció o no es válida. Renueva LECTA_COOKIE.",
          401,
        );
      }
      await this.ensureAuth(true);
      headers.cookie = cookieHeader(this.jar);
      response = await this.send(url, { ...init, headers });
    }

    const text = await response.text();
    const payload = parsePayload(text);

    if (!response.ok && !options.allowStatus?.includes(response.status)) {
      const message =
        apiMessage(payload) ??
        `La API de Lecta respondió ${response.status} ${response.statusText}.`;
      if (response.status === 401) {
        throw new LectaAuthError(message, response.status, payload);
      }
      throw new LectaApiError(message, response.status, payload);
    }

    return payload as T;
  }

  async getJson<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>(path, {}, options);
  }

  async postJson<T = unknown>(
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      options,
    );
  }

  async getSession(): Promise<LectaSession | null> {
    if (!this.hasCredentials) return null;
    return this.request<LectaSession | null>("/api/auth/get-session");
  }
}
