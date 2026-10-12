import { useEffect, useRef } from "react";
import Icon from "./Icon";

export interface NoticeProps {
  message?: string | null;
  error?: string | null;
  onDismissMessage?: () => void;
  onDismissError?: () => void;
}

export default function Notice({
  message,
  error,
  onDismissMessage,
  onDismissError,
}: NoticeProps) {
  const dismissMessageRef = useRef(onDismissMessage);
  useEffect(() => {
    dismissMessageRef.current = onDismissMessage;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);

  useEffect(() => {
    if (!message) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const startTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!isPausedRef.current) {
          dismissMessageRef.current?.();
        }
      }, 5000);
    };

    startTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message]);

  const handlePause = () => {
    isPausedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleResume = () => {
    isPausedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dismissMessageRef.current?.();
    }, 5000);
  };

  if (!message && !error) return null;

  return (
    <div className="app-notices">
      {error ? (
        <div className="app-notice app-notice--alert" role="alert">
          <span className="app-notice-text">{error}</span>
          {onDismissError ? (
            <button
              type="button"
              className="app-notice-close"
              aria-label="Cerrar aviso"
              onClick={onDismissError}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          className="app-notice app-notice--status"
          role="status"
          tabIndex={0}
          onMouseEnter={handlePause}
          onMouseLeave={handleResume}
          onFocus={handlePause}
          onBlur={handleResume}
        >
          <span className="app-notice-text">{message}</span>
        </div>
      ) : null}
    </div>
  );
}
