// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Welcome from "./Welcome";
import AuthForms, { translateAuthError } from "./AuthForms";
import { authClient } from "../lib/auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/auth", () => ({
  authClient: {
    signIn: { email: vi.fn(), magicLink: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("Welcome", () => {
  it("muestra el pelaje elegido en el landing", () => {
    localStorage.setItem("lecta:gato", "calico");
    act(() => root.render(h(Welcome, { offline: false })));
    expect(host.textContent).toContain("Calicó Literario");
    expect(host.querySelector("#modal-magic-email")).toBeTruthy();
  });

  it("sin pelaje pendiente usa el naranja", () => {
    act(() => root.render(h(Welcome, { offline: false })));
    expect(host.textContent).toContain("Naranja Miel");
  });

  it("sin red muestra el aviso y no los formularios", () => {
    act(() => root.render(h(Welcome, { offline: true })));
    expect(host.querySelector("[data-testid='welcome-offline']")).toBeTruthy();
    expect(host.querySelector("form")).toBeNull();
  });

  it("con token abre el formulario de restablecer", () => {
    act(() => root.render(h(Welcome, { offline: false, resetToken: "t1" })));
    expect(host.querySelector("#modal-reset-password")).toBeTruthy();
  });
});

describe("AuthForms", () => {
  it("entrar con correo llama onSuccess cuando no hay error", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null } as never);
    const onSuccess = vi.fn();
    act(() => root.render(h(AuthForms, { onSuccess })));
    const email = host.querySelector<HTMLInputElement>("#modal-email")!;
    const password = host.querySelector<HTMLInputElement>("#modal-password")!;
    const setValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue(email, "Lectora@Ejemplo.com");
      setValue(password, "secreta123");
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(authClient.signIn.email).toHaveBeenCalledWith({
      email: "lectora@ejemplo.com",
      password: "secreta123",
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("sin onClose no pinta el botón Cerrar", () => {
    act(() => root.render(h(AuthForms, { onSuccess: () => undefined })));
    expect(host.querySelector("[aria-label='Cerrar']")).toBeNull();
  });

  it("traduce los errores de Better Auth", () => {
    expect(translateAuthError("Invalid email or password")).toBe("Correo o contraseña incorrectos.");
    expect(translateAuthError(undefined)).toBe("No se pudo completar la acción.");
  });

  it("ofrece probar un clásico (?probar=<id>) salvo sin red o al restablecer", () => {
    act(() => root.render(h(Welcome, { offline: false })));
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".welcome-trial-link")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/?probar=marianela",
      "/?probar=lazarillo",
      "/?probar=alice-wonderland",
      "/?probar=christmas-carol",
    ]);
    act(() => root.render(h(Welcome, { offline: true })));
    expect(host.querySelector(".welcome-trial")).toBeNull();
    act(() => root.render(h(Welcome, { offline: false, resetToken: "t1" })));
    expect(host.querySelector(".welcome-trial")).toBeNull();
  });
});
