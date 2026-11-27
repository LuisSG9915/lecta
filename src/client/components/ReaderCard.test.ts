// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReaderCard from "./ReaderCard";
import * as accountFetchModule from "../lib/account-fetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (plan: Parameters<typeof ReaderCard>[0]["plan"], navigate = vi.fn()) =>
  act(() => root.render(h(ReaderCard, { plan, navigate })));

describe("ReaderCard (Carné de Lector)", () => {
  it("fundador ve el sello sin selector de pago", () => {
    render({ plan: "founder_lifetime", starterCoat: null, expiresAt: null });
    expect(host.textContent).toContain("Mecenas de Primera Imprenta · Acceso Vitalicio");
    expect(host.querySelector(".reader-card__periods")).toBeNull();
  });

  it("suscriptor ve la renovación y abre el portal", async () => {
    const navigate = vi.fn();
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(json({ url: "https://billing.stripe.com/p" }));
    render({ plan: "lecta_plus", starterCoat: null, expiresAt: Date.UTC(2026, 11, 12) }, navigate);
    expect(host.textContent).toContain("Suscriptor Lecta+");
    expect(host.textContent).toContain("Se renueva");
    await act(async () => host.querySelector<HTMLButtonElement>(".btn")!.click());
    expect(accountFetchModule.accountFetch).toHaveBeenCalledWith("/api/billing/portal", expect.anything(), expect.anything());
    expect(navigate).toHaveBeenCalledWith("https://billing.stripe.com/p");
  });

  it("free elige periodo y el checkout solo manda el periodo", async () => {
    const navigate = vi.fn();
    const fetchSpy = vi
      .spyOn(accountFetchModule, "accountFetch")
      .mockResolvedValue(json({ url: "https://checkout.stripe.com/c" }));
    render({ plan: "free", starterCoat: null, expiresAt: null }, navigate);
    expect(host.textContent).toContain("Lector de Cuaderno Abierto");
    const monthly = Array.from(host.querySelectorAll<HTMLButtonElement>(".reader-card__period")).find((b) =>
      b.textContent?.includes("Mensual"),
    )!;
    await act(async () => monthly.click());
    expect(monthly.getAttribute("aria-pressed")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>(".btn--primary")!.click());
    const [path, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/billing/checkout");
    expect(JSON.parse(String(init.body))).toEqual({ period: "monthly" });
    expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c");
  });

  it("un 409 avisa que la cuenta ya tiene Lecta+", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(json({ error: "x" }, 409));
    render({ plan: "free", starterCoat: null, expiresAt: null });
    await act(async () => host.querySelector<HTMLButtonElement>(".btn--primary")!.click());
    expect(host.querySelector("[role='alert']")?.textContent).toContain("ya tiene Lecta+");
  });

  it("free tras la prueba: plan Gratis con la cortesía, no «Cuaderno Abierto»", () => {
    render({ plan: "free", starterCoat: null, expiresAt: null, trialEndedAt: Date.UTC(2026, 11, 9) });
    expect(host.textContent).toContain("Plan Gratis · 3 explicaciones con IA al día");
    expect(host.textContent).not.toContain("Lector de Cuaderno Abierto");
  });

  it("plan desconocido no pinta nada", () => {
    render(null);
    expect(host.querySelector(".reader-card")).toBeNull();
  });

  it("anual aparece primero y muestra el ahorro de $209", () => {
    render({ plan: "free", starterCoat: null, expiresAt: null });
    const periods = Array.from(host.querySelectorAll<HTMLButtonElement>(".reader-card__period"));
    expect(periods[0]?.textContent).toContain("Anual");
    expect(periods[1]?.textContent).toContain("Mensual");
    expect(host.textContent).toContain("$209");
  });

  it("en prueba inversa: con >48 h avisa $0 hoy y cobro diferido; con <48 h botón normal", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 11, 1, 12) });
    try {
      render({ plan: "lecta_plus", starterCoat: null, expiresAt: null, trialEndsAt: Date.now() + 3 * 86_400_000 });
      expect(host.textContent).toContain("Prueba de Lecta+ · quedan 3 días");
      expect(host.textContent).toContain("estarás en Gratis: 3 explicaciones con IA al día, sin nube ni Kindle. Tus palabras y tu gato se quedan.");
      expect(host.querySelector(".reader-card__periods")).not.toBeNull();
      expect(host.textContent).toContain("Hacerme Lecta+ ($0 hoy)");
      expect(host.textContent).toContain("Conservas tus días gratis: hoy pagas $0");
      expect(host.textContent).not.toContain("Administrar suscripción");
      expect(host.textContent).not.toContain("7 días gratis");

      render({ plan: "lecta_plus", starterCoat: null, expiresAt: null, trialEndsAt: Date.now() + 24 * 3_600_000 });
      expect(host.textContent).toContain("Hacerme Lecta+");
      expect(host.textContent).not.toContain("$0 hoy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("vuelta de Checkout: aviso de éxito con badge de prueba y aviso sin cargos", () => {
    act(() =>
      root.render(
        h(ReaderCard, {
          plan: { plan: "lecta_plus", starterCoat: null, expiresAt: 1 },
          notice: "gracias",
        }),
      ),
    );
    expect(host.textContent).toContain("Lecta+ ya está activo");
    act(() =>
      root.render(
        h(ReaderCard, { plan: { plan: "free", starterCoat: null, expiresAt: null }, notice: "cancelado" }),
      ),
    );
    expect(host.textContent).toContain("ningún cargo");
  });
});
