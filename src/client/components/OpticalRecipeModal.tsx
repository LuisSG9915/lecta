import { useState, type CSSProperties } from "react";
import Dialog from "./Dialog";
import {
  OPTICAL_RECIPE_STEPS,
  buildOpticalRecipePatch,
  defaultOpticalChoicesFromSettings,
  extractSamplePassage,
  summarizeOpticalRecipe,
  type OpticalRecipeChoices,
  type OpticalRecipeOption,
} from "../lib/optical-recipe";
import type { ReaderSettings } from "../lib/settings";

export interface OpticalRecipeModalProps {
  sampleText: string;
  language?: string;
  initialSettings: ReaderSettings;
  onApply: (patch: Partial<ReaderSettings>, opts: { alsoGlobal: boolean }) => void;
  onClose: () => void;
}

function buildAccumulatedStyle(
  choices: OpticalRecipeChoices,
  stepIndex: number,
  extra?: OpticalRecipeOption["previewStyle"],
): CSSProperties {
  const style: CSSProperties = {
    fontFamily: "var(--font-book)",
    letterSpacing: "0em",
    wordSpacing: "0em",
    maxWidth: "34ch",
  };

  if (stepIndex > 0) {
    style.letterSpacing = choices.spacing === "relaxed" ? "0.025em" : "0em";
    style.wordSpacing = choices.spacing === "relaxed" ? "0.08em" : "0em";
  }
  if (stepIndex > 1) {
    style.maxWidth = choices.measure === "compact" ? "26ch" : "34ch";
  }
  if (stepIndex > 2) {
    style.fontFamily =
      choices.font === "atkinson" ? "var(--font-atkinson)" : "var(--font-book)";
  }

  if (extra) {
    if (extra.fontFamily !== undefined) style.fontFamily = extra.fontFamily;
    if (extra.letterSpacing !== undefined) style.letterSpacing = extra.letterSpacing;
    if (extra.wordSpacing !== undefined) style.wordSpacing = extra.wordSpacing;
    if (extra.maxWidth !== undefined) style.maxWidth = extra.maxWidth;
    if (extra.lineHeight !== undefined) style.lineHeight = extra.lineHeight;
  }

  return style;
}

export default function OpticalRecipeModal({
  sampleText,
  language,
  initialSettings,
  onApply,
  onClose,
}: OpticalRecipeModalProps) {
  const [step, setStep] = useState(0);
  const [baseline] = useState<OpticalRecipeChoices>(() =>
    defaultOpticalChoicesFromSettings(initialSettings),
  );
  const [choices, setChoices] = useState<OpticalRecipeChoices>(baseline);

  const totalSteps = OPTICAL_RECIPE_STEPS.length;
  const isSummary = step >= totalSteps;
  const currentStep = !isSummary ? OPTICAL_RECIPE_STEPS[step] : null;
  const passage = extractSamplePassage(sampleText, language);

  const handleChoose = (opt: OpticalRecipeOption) => {
    if (!currentStep) return;
    setChoices((prev) => ({
      ...prev,
      [currentStep.id]: opt.value,
    }));
    setStep((prev) => prev + 1);
  };

  const applyWithScope = (alsoGlobal: boolean) => {
    onApply(buildOpticalRecipePatch(choices, baseline), { alsoGlobal });
    onClose();
  };

  return (
    <Dialog
      label="Receta óptica de lectura"
      onClose={onClose}
      className="optical-recipe-dialog"
    >
      <div className="optical-recipe-header">
        <div>
          <span className="eyebrow">Receta óptica</span>
          <h2 className="sheet-title">
            {isSummary ? "Tu receta visual está lista" : currentStep?.title}
          </h2>
        </div>
        <div className="optical-recipe-header-actions">
          {!isSummary ? (
            <span className="optical-recipe-step-count">
              Paso {step + 1} de {totalSteps}
            </span>
          ) : null}
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar receta óptica"
          >
            Cerrar
          </button>
        </div>
      </div>

      <div className="optical-recipe-progress" aria-hidden="true">
        <div
          className="optical-recipe-progress-bar"
          style={{
            width: `${Math.min(100, ((isSummary ? totalSteps : step + 1) / totalSteps) * 100)}%`,
          }}
        />
      </div>

      {!isSummary && currentStep ? (
        <div className="optical-recipe-step">
          <h3 className="optical-recipe-question">{currentStep.question}</h3>
          <p className="optical-recipe-note">{currentStep.scienceNote}</p>

          <div className="optical-recipe-grid">
            {currentStep.options.map((opt) => {
              const isSelected = choices[currentStep.id] === opt.value;
              const previewStyle = buildAccumulatedStyle(
                choices,
                step,
                opt.previewStyle,
              );
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-option={opt.id}
                  aria-pressed={isSelected}
                  className={`optical-recipe-card${isSelected ? " is-selected" : ""}`}
                  onClick={() => handleChoose(opt)}
                >
                  <div className="optical-recipe-card-head">
                    <strong className="optical-recipe-card-title">{opt.label}</strong>
                    <span className="optical-recipe-card-tag">{opt.tag}</span>
                  </div>
                  <p className="optical-recipe-sample" style={previewStyle}>
                    {passage}
                  </p>
                  {opt.previewHint ? (
                    <span className="optical-recipe-card-hint">{opt.previewHint}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="optical-recipe-footer">
            {step > 0 ? (
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                ← Anterior
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      ) : (
        <div className="optical-recipe-summary">
          <p className="optical-recipe-note">
            Ajustada en {totalSteps} comparaciones con este libro.
          </p>

          <div className="optical-recipe-summary-preview">
            <p
              className="optical-recipe-sample"
              style={buildAccumulatedStyle(choices, totalSteps)}
            >
              {passage}
            </p>
          </div>

          <dl className="optical-recipe-summary-list">
            {summarizeOpticalRecipe(choices).map((item) => (
              <div key={item.label} className="optical-recipe-summary-row">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="optical-recipe-actions">
            <button
              type="button"
              className="btn btn--primary"
              data-autofocus
              onClick={() => applyWithScope(true)}
            >
              Aplicar a todos mis libros
            </button>
            <button
              type="button"
              className="btn--quiet"
              onClick={() => applyWithScope(false)}
            >
              Solo a este libro
            </button>
            <button
              type="button"
              className="optical-recipe-retry"
              onClick={() => setStep(0)}
            >
              Repetir
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
