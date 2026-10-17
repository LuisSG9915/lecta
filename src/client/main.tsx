import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initCssGuard } from "./lib/css-guard";
import { applyTheme, loadTheme } from "./lib/settings";
import { registerServiceWorker } from "./lib/sw-register";
import "./styles.css";

initCssGuard();
applyTheme(loadTheme());

// Solo en producción: en dev el SW rompería HMR y enmascararía
// errores. Se registra tras load para no competir con el arranque.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void registerServiceWorker();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
