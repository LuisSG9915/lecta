import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from "../lib/settings";

type ThemeMenuProps = {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
};

// Selector de tema como opciones de texto, con la activa subrayada.
export default function ThemeMenu({ value, onChange }: ThemeMenuProps) {
  return (
    <div className="theme-menu" role="group" aria-label="Tema">
      {THEME_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          className="theme-option"
          data-active={choice === value || undefined}
          aria-pressed={choice === value}
          onClick={() => onChange(choice)}
        >
          {THEME_LABELS[choice]}
        </button>
      ))}
    </div>
  );
}
