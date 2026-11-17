// Aviso de estado (toast) a partir del statusText del lector. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";

type Deps = {
  statusText: string;
  setToastMessage: (msg: string) => void;
};

export function useReaderToast(deps: Deps): void {
  const { statusText, setToastMessage } = deps;

  useEffect(() => {
    if (!statusText) {
      const clearTimer = setTimeout(() => setToastMessage(""), 0);
      return () => clearTimeout(clearTimer);
    }
    const showTimer = setTimeout(() => {
      setToastMessage(statusText);
    }, 0);
    const hideTimer = setTimeout(() => {
      setToastMessage("");
    }, 3000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [statusText, setToastMessage]);
}