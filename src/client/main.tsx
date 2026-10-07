import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, loadTheme } from "./lib/settings";
import "./styles.css";

applyTheme(loadTheme());

// Solo en producción: en dev el SW rompería HMR y enmascararía
// errores. Se registra tras load para no competir con el arranque.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
