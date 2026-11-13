import { useTranslation } from "react-i18next";

const MODES = [
  { id: "shadow" },
  { id: "preview" },
];

export default function AiModeSwitch({ value, onChange, disabled = false }) {
  const { t } = useTranslation("ai_mode");
  return (
    <div className={`ai-mode-switch ${disabled ? "ai-mode-switch--disabled" : ""}`}>
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`ai-mode-switch__btn ${value === mode.id ? "is-active" : ""}`}
          onClick={() => onChange(mode.id)}
          disabled={disabled || value === mode.id}
        >
          {t(mode.id)}
        </button>
      ))}
    </div>
  );
}
