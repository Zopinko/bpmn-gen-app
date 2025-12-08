const MODES = [
  { id: "shadow", label: "Konzervatívny" },
  { id: "preview", label: "Kreatívny náhľad" },
];

export default function AiModeSwitch({ value, onChange, disabled = false }) {
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
          {mode.label}
        </button>
      ))}
    </div>
  );
}
