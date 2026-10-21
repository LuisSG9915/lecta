// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Account from "./Account";
import { authClient } from "../lib/auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/auth", () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    signIn: { email: vi.fn(), magicLink: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    deleteUser: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("../lib/idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...actual,
    captureDbScope: vi.fn(() => "lecta"),
    listKnowledge: vi.fn(async () => []),
    listSavedWords: vi.fn(async () => []),
    loadSessionValue: vi.fn(async () => null),
    saveSessionValue: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/ai-pref", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ai-pref")>();
  return {
    ...actual,
    loadUseAi: vi.fn(async () => true),
    saveUseAi: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/reading-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reading-events")>();
  return {
    ...actual,
    loadHistoryEnabled: vi.fn(async () => true),
    saveHistoryEnabled: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/game")>();
  return {
    ...actual,
    loadGameEnabled: vi.fn(async () => true),
    saveGameEnabled: vi.fn(async () => undefined),
    loadCompanionDevicePrefs: vi.fn(async () => null),
    saveCompanionDevicePrefs: vi.fn(async () => undefined),
    readCompanionField: vi.fn(async () => null),
    writeCompanionField: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/offline-dictionary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/offline-dictionary")>();
  return {
    ...actual,
    getDictionaryCacheWordCount: vi.fn(async () => 0),
    emptyDictionaryCache: vi.fn(async () => undefined),
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(authClient.useSession).mockReturnValue({ data: null, isPending: false } as never);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = (node: Parameters<Root["render"]>[0]) => act(() => root.render(node));
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("Account componente Tú y Login", () => {
  it("renderiza la vista «Tú» compacta con 3 bloques y sección avanzada plegada", async () => {
    const onOpenJourney = vi.fn();
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
        onOpenJourney,
      }),
    );
    await flush();

    expect(host.querySelector(".account-page")).toBeTruthy();
    expect(host.querySelector(".account-page-title")?.textContent).toBe("Tú");

    // Bloque 1: Recorrido y tarjeta de cuenta
    expect(host.querySelector(".account-journey-btn")).toBeTruthy();
    const accountCard = host.querySelector(".account-card");
    expect(accountCard).toBeTruthy();
    expect(accountCard?.textContent).toContain("Sincronización en la nube");
    expect(accountCard?.querySelector("button")?.textContent).toBe("Iniciar sesión o crear cuenta");

    // No hay campos de contraseña abiertos en la vista principal
    expect(host.querySelector('input[type="password"]')).toBeNull();

    // Bloque 2: Lectura y vocabulario
    const sections = host.querySelectorAll(".account-section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain("Lectura y vocabulario");
    expect(host.textContent).toContain("Lengua materna");
    expect(host.textContent).toContain("Calibración de vocabulario");
    expect(host.textContent).toContain("Meta semanal de lectura");

    // Bloque 3: Compañero y logros
    expect(host.textContent).toContain("Compañero y logros");
    expect(host.textContent).toContain("El gato del cuaderno");

    // Bloque 4: Avanzado y privacidad (plegable)
    const details = host.querySelector("details.account-advanced-details");
    expect(details).toBeTruthy();
    expect(details?.querySelector("summary")?.textContent).toContain("Avanzado y privacidad");
  });

  it("pulsar «Iniciar sesión o crear cuenta» abre el diálogo modal con pestañas", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    const openBtn = host.querySelector<HTMLButtonElement>(".account-card button");
    expect(openBtn).toBeTruthy();

    await act(async () => openBtn!.click());
    await flush();

    // Modal abierto
    const modal = document.querySelector(".dialog");
    expect(modal).toBeTruthy();
    expect(modal?.getAttribute("aria-label")).toBe("Tu cuenta");

    // Pestañas Iniciar sesión / Crear cuenta
    const tabs = modal?.querySelectorAll(".auth-tab-btn");
    expect(tabs?.length).toBe(2);
    expect(tabs?.[0].textContent).toBe("Iniciar sesión");
    expect(tabs?.[1].textContent).toBe("Crear cuenta");
    expect(tabs?.[0].getAttribute("aria-selected")).toBe("true");

    // Formulario de entrar
    expect(modal?.querySelector('input[type="email"]')).toBeTruthy();
    expect(modal?.querySelector('input[type="password"]')).toBeTruthy();
    const submitBtn = modal?.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitBtn?.textContent).toBe("Entrar");

    // Enlaces auxiliares
    expect(modal?.textContent).toContain("¿Olvidaste tu contraseña?");
    expect(modal?.textContent).toContain("Entrar con enlace por correo");
  });

  it("permite alternar entre pestañas y modos de acceso en el modal", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".account-card button")!.click();
    });
    await flush();

    const modal = document.querySelector(".dialog")!;

    // Cambiar a Crear cuenta
    const signupTab = modal.querySelectorAll<HTMLButtonElement>(".auth-tab-btn")[1];
    await act(async () => signupTab.click());
    await flush();

    expect(signupTab.getAttribute("aria-selected")).toBe("true");
    expect(modal.querySelector('button[type="submit"]')?.textContent).toBe("Crear cuenta");
    expect(modal.textContent).toContain("Mínimo 8 caracteres");

    // Cambiar a Enlace por correo (magic link)
    const signinTab = modal.querySelectorAll<HTMLButtonElement>(".auth-tab-btn")[0];
    await act(async () => signinTab.click());
    await flush();

    const magicBtn = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("enlace por correo"),
    );
    expect(magicBtn).toBeTruthy();
    await act(async () => magicBtn!.click());
    await flush();

    expect(modal.querySelector('button[type="submit"]')?.textContent).toBe("Enviar enlace de acceso");
    // En enlace mágico NO hay campo de contraseña
    expect(modal.querySelector('input[type="password"]')).toBeNull();

    // Volver a contraseña
    const backBtn = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("contraseña"),
    );
    await act(async () => backBtn!.click());
    await flush();

    expect(modal.querySelector('button[type="submit"]')?.textContent).toBe("Entrar");
  });

  it("con sesión iniciada muestra correo, sincronización y opciones de cuenta", async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: {
        user: {
          id: "u_123",
          email: "lector@lecta.app",
          name: "Lector",
          createdAt: new Date(),
          updatedAt: new Date(),
          emailVerified: true,
        },
        session: {
          id: "s_123",
          userId: "u_123",
          token: "tok",
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      isPending: false,
    } as never);

    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    const accountCard = host.querySelector(".account-card");
    expect(accountCard).toBeTruthy();
    expect(accountCard?.querySelector(".account-card-email")?.textContent).toBe("lector@lecta.app");
    expect(accountCard?.textContent).toContain("Cerrar sesión");
    expect(accountCard?.textContent).toContain("Eliminar cuenta");
    expect(accountCard?.textContent).not.toContain("Iniciar sesión o crear cuenta");
  });

  it("con resetToken abre el diálogo directamente en modo Restablecer contraseña", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
        resetToken: "test_token_456",
      }),
    );
    await flush();

    const modal = document.querySelector(".dialog");
    expect(modal).toBeTruthy();
    expect(modal?.querySelector(".sheet-title")?.textContent).toBe("Restablecer contraseña");
    expect(modal?.querySelector('label[for="modal-reset-password"]')?.textContent).toBe("Nueva contraseña");
    expect(modal?.querySelector('button[type="submit"]')?.textContent).toBe("Guardar contraseña");
  });

  it("muestra el bloque de enlace con Kindle y el estado de calibración con botón de recalibrar", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    // Bloque Kindle
    const kindleGuide = host.querySelector(".account-kindle-guide");
    expect(kindleGuide).toBeTruthy();
    expect(kindleGuide?.textContent).toContain("Modo Kindle");
    expect(kindleGuide?.textContent).toContain("/k");

    // Tarjeta de Nivel y Calibración
    const levelCard = host.querySelector(".account-card--level");
    expect(levelCard).toBeTruthy();
    expect(levelCard?.textContent).toContain("Tu nivel y calibración");
    const recalibrateBtn = Array.from(levelCard?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Recalibrar mi vocabulario"),
    );
    expect(recalibrateBtn).toBeTruthy();
  });

  it("renderiza la sección para vincular Kindle por código de 4 letras e input en mayúsculas", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    const connectKindleBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Conectar mi Kindle"),
    );
    expect(connectKindleBtn).toBeTruthy();

    await act(async () => connectKindleBtn!.click());
    await flush();

    const input = host.querySelector<HTMLInputElement>("#kindle-code-input");
    expect(input).toBeTruthy();
    expect(input?.maxLength).toBe(4);

    const submitBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Vincular Kindle"),
    );
    expect(submitBtn).toBeTruthy();
  });

  it("oculta la sección de Kindle si featureFlags.kindleSync está desactivado", async () => {
    const { saveFeatureFlags } = await import("../lib/settings");
    saveFeatureFlags({ kindleSync: false });
    try {
      render(
        h(Account, {
          presentation: "page",
          onClose: vi.fn(),
          onOpenCalibration: vi.fn(),
        }),
      );
      await flush();
      expect(host.querySelector(".account-kindle-guide")).toBeNull();
      const connectKindleBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Conectar mi Kindle"),
      );
      expect(connectKindleBtn).toBeUndefined();
    } finally {
      saveFeatureFlags({ kindleSync: true });
    }
  });

  it("renderiza botón para restaurar respaldo y selector de archivo", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    const restoreBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Restaurar respaldo (JSON)"),
    );
    expect(restoreBtn).toBeTruthy();

    const fileInput = host.querySelector<HTMLInputElement>(
      'input[type="file"][accept*=".json"]',
    );
    expect(fileInput).toBeTruthy();
  });

  it("renderiza botones de Centro de diagnóstico y Aviso de Privacidad en Acerca de", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    const diagBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Centro de diagnóstico"),
    );
    expect(diagBtn).toBeTruthy();

    const privacyBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Aviso de Privacidad"),
    );
    expect(privacyBtn).toBeTruthy();

    const termsBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Términos de Uso"),
    );
    expect(termsBtn).toBeTruthy();

    // Abrir modal de diagnóstico
    await act(async () => diagBtn!.click());
    await flush();
    expect(host.querySelector('[aria-label="Acerca de y Diagnóstico"]')).toBeTruthy();
  });
});

