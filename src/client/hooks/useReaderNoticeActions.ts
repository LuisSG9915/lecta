// Acciones de los avisos del lector (calibración y ayuda de vocabulario).
//
// Extraído de Reader.tsx (R1/F5). Solo lo que el usuario pulsa: la decisión de
// cuándo ofrecer cada aviso sigue en useReaderCalibrationOffer / useReaderHelpNotice.
import { useCallback } from "react";
import { bookHelpKey, saveBookMicroHighlightsEnabled } from "../lib/attention-budget";
import { calibrationDoneKey } from "../lib/calibration";
import { captureDbScope, saveSessionValue } from "../lib/idb";

export interface UseReaderNoticeActionsOptions {
  language: string;
  bookHash: string;
  onRequestCalibration: (language: string) => Promise<boolean>;
  setCalNotice: (value: boolean) => void;
  setHelpNotice: (value: boolean) => void;
}

export function useReaderNoticeActions({
  language,
  bookHash,
  onRequestCalibration,
  setCalNotice,
  setHelpNotice,
}: UseReaderNoticeActionsOptions) {
  // «Ajustar mi vocabulario»: la descarga corre por App; si la hoja no
  // llegó a abrirse (sin conexión o muestra vacía) el aviso se conserva
  // para reintentar.
  const acceptCalibrationNotice = useCallback(async () => {
    if (await onRequestCalibration(language)) setCalNotice(false);
  }, [onRequestCalibration, language, setCalNotice]);

  // «Ahora no»: cierra la oferta automática — la prueba queda a mano
  // desde Cuenta, con el borrador si se empezó.
  const dismissCalibrationNotice = useCallback(() => {
    setCalNotice(false);
    void saveSessionValue(calibrationDoneKey(language), "1", captureDbScope()).catch(
      () => undefined,
    );
  }, [language, setCalNotice]);

  const saveHelpDecision = useCallback((value: "on" | "off" | "dismissed") => {
    void saveSessionValue(bookHelpKey(bookHash), value, captureDbScope()).catch(
      () => undefined,
    );
  }, [bookHash]);

  // «Sí, prepárame» / «Activar ayudas»: enciende la ayuda del libro.
  const acceptHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveBookMicroHighlightsEnabled(bookHash, true);
    saveHelpDecision("on");
  }, [bookHash, saveHelpDecision, setHelpNotice]);

  // «Medir mi nivel en 15 s»: abre la prueba; al aceptar la ayuda
  // queda encendida y la franja se cierra. Si la hoja no abrió, el
  // aviso se conserva para reintentar, igual que el de calibración.
  const calibrateHelpNotice = useCallback(async () => {
    if (await onRequestCalibration(language)) {
      setHelpNotice(false);
      saveBookMicroHighlightsEnabled(bookHash, true);
      saveHelpDecision("on");
    }
  }, [onRequestCalibration, language, bookHash, saveHelpDecision, setHelpNotice]);

  // «No, gracias»: apaga los micro-destacados de este libro y no
  // vuelve a preguntar.
  const declineHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveBookMicroHighlightsEnabled(bookHash, false);
    saveHelpDecision("off");
  }, [bookHash, saveHelpDecision, setHelpNotice]);

  // «Ahora no» (×): cierra sin apagar nada — la preferencia queda
  // registrada para no insistir en cada apertura.
  const dismissHelpNotice = useCallback(() => {
    setHelpNotice(false);
    saveHelpDecision("dismissed");
  }, [saveHelpDecision, setHelpNotice]);

  return {
    acceptCalibrationNotice,
    dismissCalibrationNotice,
    acceptHelpNotice,
    calibrateHelpNotice,
    declineHelpNotice,
    dismissHelpNotice,
  };
}
