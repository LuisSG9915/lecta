import type { Page } from "@playwright/test";

// Eventos táctiles sintéticos: el puntero decide el gesto — en
// `pointer: coarse` real es la misma ruta que toma un dedo. No crean
// selección nativa ni tiradores del sistema.
export const touch = async (page: Page, type: string, x: number, y: number) =>
  page.evaluate(
    ({ type, x, y }) => {
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerType: "touch",
          pointerId: 1,
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, x, y },
  );

export const clickAt = async (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x, y },
  );
