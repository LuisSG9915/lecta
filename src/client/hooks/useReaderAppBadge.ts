// Limpieza del badge de la app al montar el lector y programación del
// recordatorio de hábito al desmontar. Extraído de Reader.tsx (B7).
import { useEffect } from "react";
import { updateAppBadge, scheduleHabitReminder } from "../lib/localNotificationScheduler";

export function useReaderAppBadge(): void {
  useEffect(() => {
    void updateAppBadge(false);
    return () => {
      void scheduleHabitReminder();
    };
  }, []);
}