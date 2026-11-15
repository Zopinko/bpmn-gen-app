import { useTranslation } from "react-i18next";

/**
 * Slim strip above the map: where the guide is in the process
 * (one chip per role, then the final "connect and check" stage).
 */
export default function GuideProgress({ steps = [], onSelect }) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return (
    <div className="guide-progress" aria-label={t("workspace.guide_label")}>
      <span className="guide-progress__label">{t("workspace.guide_label")}</span>
      <ol className="guide-progress__steps">
        {steps.map((step, index) => {
          const content = (
            <>
              <span className="guide-progress__num">{index + 1}</span>
              <span className="guide-progress__name">{step.label}</span>
              <span className="guide-progress__state">{t(`workspace.guide_state_${step.state}`)}</span>
            </>
          );
          return (
            <li key={step.id}>
              {step.laneId && onSelect ? (
                <button
                  type="button"
                  className={`guide-progress__step is-${step.state}`}
                  aria-current={step.state === "now" ? "step" : undefined}
                  onClick={() => onSelect(step)}
                >
                  {content}
                </button>
              ) : (
                <span
                  className={`guide-progress__step is-${step.state}`}
                  aria-current={step.state === "now" ? "step" : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
