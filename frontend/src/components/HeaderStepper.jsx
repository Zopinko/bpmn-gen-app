import { useMemo } from "react";
import { useHeaderStepper } from "./HeaderStepperContext";
import { computeHeaderStepperSteps } from "./headerStepperState";

export default function HeaderStepper() {
  const { state } = useHeaderStepper();
  const steps = useMemo(() => computeHeaderStepperSteps(state), [state]);

  return (
    <div className="header-stepper" aria-label="Postup spracovania">
      {steps.map((step, index) => {
        const itemClassName = [
          "header-stepper__item",
          step.isDone ? "is-done" : "is-todo",
          step.isActive ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={step.id} className={itemClassName}>
            <div className="header-stepper__top">
              <span className="header-stepper__dot" title={step.tooltip} aria-hidden="true" />
              {index < steps.length - 1 ? (
                <span className={`header-stepper__line is-${step.lineStatus}`} aria-hidden="true" />
              ) : null}
            </div>
            <span className="header-stepper__label" title={step.tooltip}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
