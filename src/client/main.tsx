import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { initCssGuard } from "./lib/css-guard";
import { installClientErrorReporting } from "./lib/client-errors";
import { applyTheme, loadTheme } from "./lib/settings";
import {
  clearForeignServiceWorker,
  registerServiceWorker,
} from "./lib/sw-register";
import "./styles.css";

initCssGuard();
installClientErrorReporting();
applyTheme(loadTheme());

// Solo en producción: en dev el SW rompería HMR y enmascararía
// errores. Se registra tras load para no competir con el arranque.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  if (document.readyState === "complete") {
    void registerServiceWorker();
  } else {
    window.addEventListener("load", () => {
      void registerServiceWorker();
    });
  }
} else {
  // En dev, un SW viejo del mismo origen (preview de producción)
  // seguiría controlando la página con assets que ya no existen.
  void clearForeignServiceWorker();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
