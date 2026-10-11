import type { AchievementFamily } from "../../shared/gamification";

export interface SealProps {
  family: AchievementFamily;
  rank: number; // 0 = bloqueado, 1..maxRank = rango conseguido
  maxRank: number;
  size?: number;
  label?: string;
  className?: string;
}

const ROMAN_NUMERALS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function toRoman(n: number): string {
  if (n <= 0) return "";
  return ROMAN_NUMERALS[n] ?? String(n);
}

// Glifos vectoriales estilo grabado/tinta clásica (viewBox 0 0 32 32)
function FamilyGlyph({ family }: { family: AchievementFamily }) {
  switch (family) {
    case "palabras": // Pluma
      return (
        <path
          d="M24 4 C22 4, 15 9, 11 16 C9 19, 8 23, 7 27 C11 26, 15 25, 18 23 C25 19, 30 12, 28 6 Z M11 21 L16 16 M8 26 L12 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "raras": // Gema / Prisma
      return (
        <path
          d="M10 6 L22 6 L27 12 L16 26 L5 12 Z M5 12 L27 12 M10 6 L16 26 M22 6 L16 26 M10 6 L13 12 M22 6 L19 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "consultas": // Lupa
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="14" cy="14" r="7.5" />
          <path d="M19.5 19.5 L26 26" strokeWidth="2.2" />
          <path d="M12 11 A3.5 3.5 0 0 1 15.5 14.5" strokeWidth="1.2" />
        </g>
      );
    case "lectura": // Reloj
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="16" cy="16" r="10" />
          <path d="M16 10 L16 16 L20 18" strokeWidth="1.8" />
          <circle cx="16" cy="16" r="1" fill="currentColor" />
        </g>
      );
    case "sesion": // Reloj de arena
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6 L24 6 M8 26 L24 26" />
          <path d="M10 6 C10 13, 14 16, 16 16 C18 16, 22 13, 22 6" />
          <path d="M10 26 C10 19, 14 16, 16 16 C18 16, 22 19, 22 26" />
          <line x1="16" y1="18" x2="16" y2="23" strokeDasharray="1 2" strokeWidth="1.2" />
        </g>
      );
    case "racha": // Calendario
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="8" width="18" height="18" rx="2" />
          <line x1="7" y1="14" x2="25" y2="14" />
          <line x1="11" y1="5" x2="11" y2="9" />
          <line x1="21" y1="5" x2="21" y2="9" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
          <circle cx="16" cy="19" r="1" fill="currentColor" />
          <circle cx="20" cy="19" r="1" fill="currentColor" />
        </g>
      );
    case "repasos": // Ficha de archivo / Tarjeta
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="8" width="20" height="16" rx="1.5" />
          <line x1="10" y1="12" x2="22" y2="12" strokeWidth="1.2" />
          <line x1="10" y1="16" x2="19" y2="16" strokeWidth="1.2" />
          <line x1="10" y1="20" x2="16" y2="20" strokeWidth="1.2" />
          <line x1="9" y1="8" x2="9" y2="24" stroke="var(--vermilion, #9e3a23)" strokeWidth="1" />
        </g>
      );
    case "libros": // Libro abierto
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 10 C13 7, 8 7, 5 9 L5 23 C8 21, 13 21, 16 24 C19 21, 24 21, 27 23 L27 9 C24 7, 19 7, 16 10 Z" />
          <line x1="16" y1="10" x2="16" y2="24" />
        </g>
      );
  }
}

export function Seal({
  family,
  rank,
  maxRank,
  size = 56,
  label,
  className = "",
}: SealProps) {
  const isEarned = rank > 0;
  const isMax = rank >= maxRank;
  const status = !isEarned ? "locked" : isMax ? "max" : "earned";

  const accessibleLabel =
    label ??
    (!isEarned
      ? `Sello ${family}: Bloqueado`
      : isMax
        ? `Sello ${family}: Rango máximo (${toRoman(rank)} de ${toRoman(maxRank)})`
        : `Sello ${family}: Rango ${toRoman(rank)} de ${toRoman(maxRank)}`);

  return (
    <div
      className={`seal seal--${status} seal--${family} ${className}`.trim()}
      role="img"
      aria-label={accessibleLabel}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="seal-svg"
        aria-hidden="true"
      >
        {/* Anillo exterior decorativo */}
        <circle
          cx="32"
          cy="32"
          r="29"
          className="seal-ring seal-ring--outer"
          fill="none"
        />

        {/* Anillo interior: continuo si está ganado, punteado si está bloqueado */}
        <circle
          cx="32"
          cy="32"
          r="25.5"
          className="seal-ring seal-ring--inner"
          fill="none"
        />

        {/* Área central con el glifo de la familia */}
        <g transform="translate(16, 12)">
          <FamilyGlyph family={family} />
        </g>

        {/* Indicador de rango en números romanos al pie del sello */}
        {isEarned ? (
          <text
            x="32"
            y="54"
            textAnchor="middle"
            className="seal-roman"
          >
            {toRoman(rank)}
          </text>
        ) : (
          <circle cx="32" cy="51" r="2" className="seal-dot-locked" />
        )}
      </svg>
    </div>
  );
}
