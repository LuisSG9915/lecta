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
  | "moon"
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
  | "highlight"
  | "sliders"
  | "chevron-right"
  | "paw"
  | "cat"
  | "bulb"
  | "trophy"
  | "target"
  | "users"
  | "sprout"
  | "trash"
  | "pin"
  | "droplet"
  | "glasses"
  | "gift"
  | "zap"
  | "wave"
  | "edit"
  | "shuffle"
  | "shield"
  | "compass"
  | "star"
  | "check"
  | "pause"
  | "play"
  | "skip-back"
  | "skip-forward"
  | "retry"
  | "scroll"
  | "chart"
  | "shirt"
  | "bowl"
  | "text"
  | "ban"
  | "mail"
  | "heart"
  | "flame";

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
    case "moon":
      return <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />;
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
    case "sliders":
      return (
        <>
          <line x1="4" y1="6" x2="12" y2="6" />
          <line x1="16" y1="6" x2="20" y2="6" />
          <circle cx="14" cy="6" r="2" />
          <line x1="4" y1="12" x2="8" y2="12" />
          <line x1="12" y1="12" x2="20" y2="12" />
          <circle cx="10" cy="12" r="2" />
          <line x1="4" y1="18" x2="14" y2="18" />
          <line x1="18" y1="18" x2="20" y2="18" />
          <circle cx="16" cy="18" r="2" />
        </>
      );
    case "chevron-right":
      return <polyline points="9 6 15 12 9 18" />;
    case "paw":
      return (
        <>
          <circle cx="11" cy="4" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="20" cy="16" r="2" />
          <path d="M9 11a5 5 0 0 0-5 5c0 2.5 2 4.5 4.5 4.5 1.5 0 2.5-.5 3.5-1.5l2-2 2 2c1 1 2 1.5 3.5 1.5 2.5 0 4.5-2 4.5-4.5a5 5 0 0 0-5-5c-1.5 0-2.5.5-3.5 1.5l-2 2-2-2C11.5 11.5 10.5 11 9 11Z" />
        </>
      );
    case "cat":
      return (
        <>
          <path d="M4 10l1.5-5L10 7" />
          <path d="M20 10l-1.5-5L14 7" />
          <circle cx="12" cy="13" r="7" />
          <path d="M9.5 12.5h.01M14.5 12.5h.01" strokeWidth="2.4" />
          <path d="M11 15.5h2l-1 1.5z" fill="currentColor" stroke="none" />
          <path d="M6.5 15.5h.01M17.5 15.5h.01" strokeWidth="2.4" />
        </>
      );
    case "bulb":
      return (
        <>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2Z" />
        </>
      );
    case "trophy":
      return (
        <>
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
        </>
      );
    case "target":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
          <path d="M17.5 14.5a6.5 6.5 0 0 1 4 5.5v1" />
        </>
      );
    case "sprout":
      return (
        <>
          <path d="M7 20h10" />
          <path d="M12 20v-8" />
          <path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7Z" />
          <path d="M12 12c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M6 7l1 14h10l1-14" />
          <path d="M10 11v6M14 11v6" />
        </>
      );
    case "pin":
      return (
        <>
          <path d="M12 17v5" />
          <path d="M9 3h6l-1 7 3 3H7l3-3-1-7Z" />
        </>
      );
    case "droplet":
      return <path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7Z" />;
    case "glasses":
      return (
        <>
          <circle cx="6" cy="15" r="4" />
          <circle cx="18" cy="15" r="4" />
          <path d="M10 15h4" />
          <path d="M2 13l-1-3M22 13l1-3" />
        </>
      );
    case "gift":
      return (
        <>
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13" />
          <path d="M5 12v9h14v-9" />
          <path d="M12 8c-2 0-4.5-1-4.5-3S10 2 12 8Zm0 0c2 0 4.5-1 4.5-3S14 2 12 8Z" />
        </>
      );
    case "zap":
      return <polygon points="13 2 4 14 11 14 9 22 20 10 13 10 13 2" />;
    case "wave":
      return (
        <>
          <path d="M2 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
          <path d="M2 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
        </>
      );
    case "edit":
      return (
        <>
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="M15 5l4 4" />
        </>
      );
    case "shuffle":
      return (
        <>
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </>
      );
    case "shield":
      return <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" />;
    case "compass":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <polygon points="15.5 8.5 13 13 8.5 15.5 11 11 15.5 8.5" />
        </>
      );
    case "star":
      return (
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      );
    case "check":
      return <polyline points="20 6 9 17 4 12" />;
    case "pause":
      return (
        <>
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </>
      );
    case "play":
      return <polygon points="6 4 20 12 6 20 6 4" />;
    case "skip-back":
      return (
        <>
          <polygon points="19 20 9 12 19 4 19 20" />
          <line x1="5" y1="19" x2="5" y2="5" />
        </>
      );
    case "skip-forward":
      return (
        <>
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </>
      );
    case "retry":
      return (
        <>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </>
      );
    case "scroll":
      return (
        <>
          <path d="M19 17V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2Z" transform="rotate(90 12 12)" />
          <path d="M8 9h8M8 13h5" />
        </>
      );
    case "chart":
      return (
        <>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="3" y1="20" x2="21" y2="20" />
        </>
      );
    case "shirt":
      return (
        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z" />
      );
    case "bowl":
      return (
        <>
          <path d="M2 12h20a10 10 0 0 1-20 0Z" />
          <path d="M7 8c0-2 2-3 2-5M12 8c0-2 2-3 2-5M17 8c0-2 2-3 2-5" />
        </>
      );
    case "text":
      return (
        <>
          <path d="M4 7V4h16v3" />
          <path d="M9 20h6" />
          <path d="M12 4v16" />
        </>
      );
    case "ban":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
        </>
      );
    case "mail":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polyline points="3 7 12 13 21 7" />
        </>
      );
    case "heart":
      return (
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      );
    case "flame":
      return (
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      );
  }
}
