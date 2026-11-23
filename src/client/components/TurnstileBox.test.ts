// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthForms, { translateAuthError } from "./AuthForms";
import { turnstileSiteKey } from "./TurnstileBox";
import { authClient } from "../lib/auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/auth", () => ({
  authClient: {
    signIn: { email: vi.fn(), magicLink: vi.fn(async () => ({})) },
    signUp: { email: vi.fn(async () => ({})) },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

let host: HTMLDivElement;
let root: Root;
let issueToken: ((token: string) => void) | null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  issueToken = null;
  window.turnstile = {
    render: vi.fn((_el, options) => {
      issueToken = options.callback;
      return "w1";
    }),
    remove: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.turnstile;
  vi.clearAllMocks();
});

async function openMagic(email = "ana@correo.mx") {
  await act(async () => root.render(h(AuthForms, { initialMode: "magic", onSuccess: () => {} })));
  const input = host.querySelector<HTMLInputElement>("#modal-magic-email")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Turnstile en el acceso", () => {
  it("sitekey real solo en lectal.app; de prueba en local; nada en otros hosts", () => {
    expect(turnstileSiteKey("lectal.app")).toMatch(/^0x/);
    expect(turnstileSiteKey("localhost")).toBe("1x00000000000000000000AA");
    expect(turnstileSiteKey("lecta.luis-sg9915.workers.dev")).toBeNull();
  });

  it("sin token no envía el enlace y avisa", async () => {
    await openMagic();
    await submit();
    expect(authClient.signIn.magicLink).not.toHaveBeenCalled();
    expect(host.textContent).toContain("comprobando que eres una persona");
  });

  it("con token lo manda en x-captcha-response y pide uno nuevo", async () => {
    await openMagic();
    await act(async () => issueToken?.("tok-1"));
    await submit();
    expect(authClient.signIn.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ana@correo.mx",
        fetchOptions: { headers: { "x-captcha-response": "tok-1" } },
      }),
    );
    // El token es de un solo uso: el widget se vuelve a pintar.
    expect(window.turnstile!.remove).toHaveBeenCalledWith("w1");
    expect(window.turnstile!.render).toHaveBeenCalledTimes(2);
  });

  it("traduce los errores del captcha", () => {
    expect(translateAuthError("Missing CAPTCHA response")).toContain(
      "comprobar que eres una persona",
    );
    expect(translateAuthError("Captcha verification failed")).toContain(
      "comprobar que eres una persona",
    );
  });
});
