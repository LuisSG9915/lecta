import { describe, expect, it } from "vitest";
import { decidePendingDelete } from "./account-cleanup";

describe("decidePendingDelete", () => {
  it("sin marcador no hace nada", () => {
    expect(
      decidePendingDelete({ confirmed: true, pendingUserId: null }),
    ).toEqual({ clearMarker: false });
  });

  it("con marcador y sin sesión, pero sin confirmación, no borra nada", () => {
    // Regresión: un cierre de sesión normal no debe limpiar la base local.
    expect(
      decidePendingDelete({ confirmed: false, pendingUserId: "u1" }),
    ).toEqual({ clearMarker: false });
  });

  it("con marcador, confirmación y sin sesión limpia la base local", () => {
    expect(
      decidePendingDelete({ confirmed: true, pendingUserId: "u1" }),
    ).toEqual({ cleanupUserId: "u1", clearMarker: true });
  });

  it("con confirmación pero sesión todavía válida no borra", () => {
    // Si la sesión sigue activa el borrado no se consumó; conservar datos.
    expect(
      decidePendingDelete({ confirmed: true, pendingUserId: "u1", sessionUserId: "u1" }),
    ).toEqual({ clearMarker: false });
  });

  it("un enlace con error descarta el marcador sin tocar datos", () => {
    expect(
      decidePendingDelete({
        confirmed: false,
        urlError: "INVALID_TOKEN",
        pendingUserId: "u1",
      }),
    ).toEqual({ clearMarker: true });
  });

  it("la sesión de otra cuenta tampoco autoriza el borrado", () => {
    expect(
      decidePendingDelete({ confirmed: true, pendingUserId: "u1", sessionUserId: "u2" }),
    ).toEqual({ clearMarker: false });
  });
});
