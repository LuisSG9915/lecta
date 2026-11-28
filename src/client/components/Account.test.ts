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

let mockUserPlan: { plan: "free" | "lecta_plus"; starterCoat: null; expiresAt: null } | null = null;
vi.mock("../lib/account-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/account-plan")>();
  return {
    ...actual,
    useUserPlan: vi.fn(() => mockUserPlan),
  };
});

vi.mock("../lib/idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...actual,
    captureDbScope: vi.fn(() => "lecta"),
    isDbScopeActive: vi.fn(() => true),
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
  mockUserPlan = null;
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
  it("renderiza la vista «Tú» en 2 capas con 3 cajones plegados por defecto", async () => {
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

    // Capa 1 (primer plano): Camino, cuenta sin sesión y Tu Kindle
    const primaryLayer = host.querySelector('[data-layer="primary"]');
    expect(primaryLayer).toBeTruthy();
    expect(primaryLayer?.querySelector(".account-journey-btn")).toBeTruthy();
    const accountCard = primaryLayer?.querySelector('section[aria-label="Tu cuenta"]');
    expect(accountCard).toBeTruthy();
    expect(accountCard?.textContent).toContain("Sincronización en la nube");
    expect(accountCard?.querySelector("button")?.textContent).toBe("Iniciar sesión o crear cuenta");
    expect(primaryLayer?.querySelector('section[aria-label="Tu Kindle y otros lectores de tinta"]')).toBeTruthy();

    // No hay campos de contraseña abiertos en la vista principal
    expect(host.querySelector('input[type="password"]')).toBeNull();

    // Capa 2 (cajón plegable): 3 pliegues cerrados por defecto
    const foldsLayer = host.querySelector('[data-layer="folds"]');
    expect(foldsLayer).toBeTruthy();
    const folds = Array.from(foldsLayer?.querySelectorAll("details.account-fold") ?? []);
    expect(folds.length).toBe(3);
    folds.forEach((f) => expect(f.hasAttribute("open")).toBe(false));
    expect(folds.map((f) => f.querySelector("summary")?.textContent?.trim())).toEqual([
      "Lectura y apariencia",
      "Correos y avisos",
      "Cuenta, respaldos y datos",
    ]);

    // Contenido sigue presente dentro de sus tarjetas
    expect(host.textContent).toContain("Lectura y vocabulario");
    expect(host.textContent).toContain("Lengua materna");
    expect(host.textContent).toContain("Tu nivel y calibración");
    expect(host.textContent).toContain("Meta semanal de lectura");
    expect(host.textContent).toContain("Inteligencia artificial y diccionario");
    expect(host.textContent).toContain("Compañero y logros");
    expect(host.textContent).toContain("El gato del Herbario");
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
    expect(tabs?.length).toBe(3);
    expect(tabs?.[0].textContent).toBe("Iniciar sesión");
    expect(tabs?.[1].textContent).toBe("Crear cuenta");
    expect(tabs?.[2].textContent).toBe("Enlace por correo");
    expect(tabs?.[0].getAttribute("aria-selected")).toBe("true");

    // Formulario de entrar
    expect(modal?.querySelector('input[type="email"]')).toBeTruthy();
    expect(modal?.querySelector('input[type="password"]')).toBeTruthy();
    const submitBtn = modal?.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitBtn?.textContent).toBe("Entrar");

    // Enlaces auxiliares
    expect(modal?.textContent).toContain("¿Olvidaste tu contraseña?");
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
    const magicTab = modal.querySelectorAll<HTMLButtonElement>(".auth-tab-btn")[2];
    await act(async () => magicTab.click());
    await flush();

    expect(modal.querySelector('button[type="submit"]')?.textContent).toBe("Enviar enlace de acceso");
    // En enlace mágico NO hay campo de contraseña
    expect(modal.querySelector('input[type="password"]')).toBeNull();

    // Volver a contraseña
    const backBtn = modal.querySelectorAll<HTMLButtonElement>(".auth-tab-btn")[0];
    await act(async () => backBtn.click());
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

    const accountCard = host.querySelector('section[aria-label="Tu cuenta"]');
    expect(accountCard).toBeTruthy();
    expect(accountCard?.querySelector(".account-card-email")?.textContent).toBe("lector@lecta.app");
    expect(accountCard?.textContent).toContain("Cerrar sesión");
    expect(accountCard?.textContent).toContain("Eliminar cuenta");
    expect(accountCard?.textContent).toContain("Empezar de cero");
    expect(accountCard?.textContent).not.toContain("Iniciar sesión o crear cuenta");
  });

  it("la casilla del correo de regreso lee la preferencia y guarda el cambio", async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: {
        user: { id: "u_123", email: "lector@lecta.app", name: "Lector", createdAt: new Date(), updatedAt: new Date(), emailVerified: true },
        session: { id: "s_123", userId: "u_123", token: "tok", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      },
      isPending: false,
    } as never);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/reengage/preferences")) {
        return init?.method === "POST"
          ? new Response(JSON.stringify({ enabled: true }), { status: 200 })
          : new Response(JSON.stringify({ enabled: false }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(h(Account, { presentation: "page", onClose: vi.fn(), onOpenCalibration: vi.fn() }));
      await flush();
      await flush();
      const toggle = host.querySelector('[role="switch"][aria-label="Recibir el correo de regreso"]');
      expect(toggle).toBeTruthy();
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
      await act(async () => {
        (toggle as HTMLElement).click();
      });
      await flush();
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).startsWith("/api/reengage/preferences") && init?.method === "POST",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ enabled: true });
      expect(toggle?.getAttribute("aria-checked")).toBe("true");
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("muestra el bloque de enlace con Kindle y la tarjeta de nivel con un renglón por idioma", async () => {
    render(
      h(Account, {
        presentation: "page",
        onClose: vi.fn(),
        onOpenCalibration: vi.fn(),
      }),
    );
    await flush();

    // Tarjeta Kindle dedicada con la ruta corta del e-reader
    const kindleCard = host.querySelector(
      'section[aria-label="Tu Kindle y otros lectores de tinta"]',
    );
    expect(kindleCard).toBeTruthy();
    expect(kindleCard?.textContent).toContain("/k");

    // Tarjeta de Nivel y Calibración: un renglón por idioma con su
    // estado real — sin calibrar ofrece «Calibrar», nunca un
    // porcentaje ni el mensaje viejo de «Aún sin medición».
    const levelCard = host.querySelector(".account-card--level");
    expect(levelCard).toBeTruthy();
    expect(levelCard?.textContent).toContain("Tu nivel y calibración");
    expect(levelCard?.textContent).toContain("Español");
    expect(levelCard?.textContent).toContain("Inglés");
    expect(levelCard?.textContent).toContain("Sin calibrar");
    expect(levelCard?.textContent).not.toContain("Aún sin medición");
    const calibrateBtns = Array.from(levelCard?.querySelectorAll("button") ?? []).filter(
      (b) => b.textContent?.includes("Calibrar"),
    );
    expect(calibrateBtns.length).toBe(2);
  });

  it("renderiza la sección para vincular Kindle por código de 4 letras e input en mayúsculas", async () => {
    // La vinculación del dispositivo solo aparece con sesión iniciada.
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
      expect(
        host.querySelector('section[aria-label="Tu Kindle y otros lectores de tinta"]'),
      ).toBeNull();
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

    // Con la zona «Series y películas» apagada no se usa Trakt y no se
    // le acredita (docs/designs/2026-11-15-explora-derechos.md, M0).
    expect(host.textContent).not.toContain("Trakt");

    // Abrir modal de diagnóstico
    await act(async () => diagBtn!.click());
    await flush();
    expect(host.querySelector('[aria-label="Acerca de y Diagnóstico"]')).toBeTruthy();
  });

  it("con sesión iniciada eleva Carné y Kindle sobre los cajones y abre Cuenta automáticamente ante error o resetToken", async () => {
    mockUserPlan = { plan: "free", starterCoat: null, expiresAt: null };
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
    vi.mocked(authClient.changePassword).mockResolvedValueOnce({
      error: { message: "Invalid password" },
    } as never);

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/auth/list-accounts")) {
        return new Response(JSON.stringify([{ providerId: "credential" }]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(
        h(Account, {
          presentation: "page",
          onClose: vi.fn(),
          onOpenCalibration: vi.fn(),
          onOpenJourney: vi.fn(),
        }),
      );
      await flush();
      await flush();

      const primary = host.querySelector('[data-layer="primary"]');
      const drawer = host.querySelector('[data-layer="folds"]');
      const journeyRow = primary?.querySelector(".account-journey-row");
      const readerCard = primary?.querySelector(".reader-card");
      const kindleCard = primary?.querySelector(
        'section[aria-label="Tu Kindle y otros lectores de tinta"]',
      );

      expect(primary).toBeTruthy();
      expect(drawer).toBeTruthy();
      expect(journeyRow).toBeTruthy();
      expect(readerCard).toBeTruthy();
      expect(kindleCard).toBeTruthy();
      expect(
        journeyRow!.compareDocumentPosition(readerCard!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        readerCard!.compareDocumentPosition(kindleCard!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        primary!.compareDocumentPosition(drawer!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const accountFold = host.querySelector<HTMLDetailsElement>('details.account-fold[data-fold="account"]');
      expect(accountFold?.hasAttribute("open")).toBe(false);

      // Abrir cambio de contraseña y provocar error -> el pliegue permanece abierto con alerta visible
      const changeBtn = Array.from(accountFold?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("Cambiar contraseña"),
      );
      expect(changeBtn).toBeTruthy();
      await act(async () => changeBtn!.click());
      await flush();
      expect(accountFold?.hasAttribute("open")).toBe(true);

      const curInput = accountFold?.querySelector<HTMLInputElement>("#current-password");
      const newInput = accountFold?.querySelector<HTMLInputElement>("#new-password");
      expect(curInput).toBeTruthy();
      expect(newInput).toBeTruthy();
      await act(async () => {
        curInput!.value = "wrongpass";
        curInput!.dispatchEvent(new Event("input", { bubbles: true }));
        newInput!.value = "newpass123";
        newInput!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const form = accountFold?.querySelector("form");
      await act(async () => {
        form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush();
      expect(accountFold?.hasAttribute("open")).toBe(true);
      expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();

      // Con resetToken el pliegue también se abre automáticamente aunque el estado previo no estaba forzado
      render(
        h(Account, {
          presentation: "page",
          onClose: vi.fn(),
          onOpenCalibration: vi.fn(),
          resetToken: "tok_reset",
        }),
      );
      await flush();
      expect(
        host.querySelector('details.account-fold[data-fold="account"]')?.hasAttribute("open"),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

