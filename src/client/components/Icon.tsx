export type IconName =
  | "shelf"
  | "book"
  | "notebook"
  | "bookmark"
  | "you"
  | "journey"
  | "index"
  | "more"
  | "search"
  | "headphones"
  | "stop"
  | "fullscreen"
  | "fullscreen-exit"
  | "retreat"
  | "cloud"
  | "clock"
  | "speaker"
  | "back"
  | "close"
  | "strategy"
  | "sparkles"
  | "sparkle"
  | "quote"
  | "download"
  | "focus"
  | "lock"
  | "highlight";

export interface IconProps {
  name: IconName;
  size?: number | string;
  className?: string;
}

export default function Icon({ name, size = 20, className }: IconProps) {
  const s = typeof size === "number" ? `${size}px` : size;

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `icon icon--${name} ${className}` : `icon icon--${name}`}
    >
      {renderIconPath(name)}
    </svg>
  );
}

function renderIconPath(name: IconName) {
  switch (name) {
    case "shelf":
    case "book":
      return (
        <>
          <path d="M4 19h16" />
          <path d="M6 19V7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12" />
          <path d="M10 19V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14" />
          <path d="M15 19l3-13" />
        </>
      );
    case "notebook":
      return (
        <>
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 2v20" />
          <path d="M10 7h6" />
          <path d="M10 11h6" />
          <path d="M10 15h4" />
        </>
      );
    case "bookmark":
      return (
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      );
    case "you":
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M6 20v-1a6 6 0 0 1 12 0v1" />
        </>
      );
    case "journey":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </>
      );
    case "index":
      return (
        <>
          <line x1="8" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="20" y2="12" />
          <line x1="8" y1="18" x2="20" y2="18" />
          <line x1="4" y1="6" x2="4.01" y2="6" />
          <line x1="4" y1="12" x2="4.01" y2="12" />
          <line x1="4" y1="18" x2="4.01" y2="18" />
        </>
      );
    case "more":
      return (
        <>
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="19" cy="12" r="1" fill="currentColor" />
          <circle cx="5" cy="12" r="1" fill="currentColor" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      );
    case "headphones":
      return (
        <>
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </>
      );
    case "stop":
      return <rect x="6" y="6" width="12" height="12" rx="2" />;
    case "fullscreen":
      return (
        <>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </>
      );
    case "fullscreen-exit":
      return (
        <>
          <path d="M4 14h6v6" />
          <path d="M20 10h-6V4" />
          <path d="M14 10l7-7" />
          <path d="M10 14l-7 7" />
        </>
      );
    case "retreat":
      return (
        <>
          <path d="M12 2c.5 2 2 3.5 2 5a2 2 0 1 1-4 0c0-1.5 1.5-3 2-5Z" />
          <path d="M7 11h10v10H7z" />
          <path d="M5 21h14" />
        </>
      );
    case "cloud":
      return (
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </>
      );
    case "speaker":
      return (
        <>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      );
    case "back":
      return (
        <>
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </>
      );
    case "close":
      return (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      );
    case "strategy":
    case "sparkles":
    case "sparkle":
      return (
        <>
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
        </>
      );
    case "quote":
      return (
        <>
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2-1 4-2 7" />
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2-1 4-2 7" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </>
      );
    case "focus":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
        </>
      );
    case "lock":
      return (
        <>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
      );
    case "highlight":
      return (
        <>
          <path d="m9 11-6 6v3h3l6-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </>
      );
  }
}
