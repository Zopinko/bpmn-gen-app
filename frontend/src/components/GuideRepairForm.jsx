import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function GuideRepairForm({ decision, source, lanes, targets, busy, onApply }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(targets.length ? "connect" : "step");
  const [targetId, setTargetId] = useState(targets[0]?.id || "");
  const [laneId, setLaneId] = useState(source.laneId || "");
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState("");
  const action = decision ? "step" : mode;
  const canSubmit = action === "end" ||
    (action === "connect" && targets.some((target) => target.id === targetId)) ||
    (action === "step" && text.trim() && lanes.some((lane) => lane.id === laneId) &&
      (!decision || decision.opposite || outcome.trim()));

  return (
    <form className="guide-bubble__composer" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && canSubmit) void onApply({ action, targetId, laneId, text: text.trim(), outcome: outcome.trim() });
    }}>
      <fieldset className="guide-handoff-options" disabled={busy}>
        <legend className="guide-bubble__title">
          {!decision ? <span className="guide-repair-indicator" aria-hidden="true">!</span> : null}
          {decision
            ? t(decision.opposite ? "workspace.guide_branch_question" : "workspace.guide_branch_other", {
                step: source.name || source.label || source.id,
                outcome: decision.opposite ? t(`workspace.guide_branch_${decision.opposite}`) : "",
              })
            : t("workspace.guide_repair_question", { step: source.name || source.label || source.id })}
        </legend>
        {!decision ? (
          <select className="guide-bubble__input" aria-label={t("workspace.guide_repair_action")}
            value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="connect" disabled={!targets.length}>{t("workspace.guide_repair_connect")}</option>
            <option value="step">{t("workspace.guide_repair_step")}</option>
            <option value="end">{t("workspace.guide_handoff_end")}</option>
          </select>
        ) : null}
        {action === "connect" ? (
          <select className="guide-bubble__input" aria-label={t("workspace.guide_repair_target")}
            value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {targets.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name || node.label || node.id} · {lanes.find((lane) => lane.id === node.laneId)?.name || node.laneId}
              </option>
            ))}
          </select>
        ) : null}
        {action === "step" ? (
          <>
            {decision && !decision.opposite ? (
              <input className="guide-bubble__input" aria-label={t("workspace.guide_branch_outcome")}
                placeholder={t("workspace.guide_branch_outcome")} value={outcome} onChange={(event) => setOutcome(event.target.value)} />
            ) : null}
            <input className="guide-bubble__input" aria-label={t("workspace.guide_repair_step_name")}
              placeholder={t("workspace.guide_repair_step_name")} value={text} onChange={(event) => setText(event.target.value)} />
            <select className="guide-bubble__input" aria-label={t("workspace.guide_repair_lane")}
              value={laneId} onChange={(event) => setLaneId(event.target.value)}>
              <option value="" disabled>{t("workspace.guide_repair_lane")}</option>
              {lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name || lane.id}</option>)}
            </select>
          </>
        ) : null}
      </fieldset>
      <button type="submit" className="guide-bubble__btn guide-bubble__btn--go" disabled={busy || !canSubmit}>
        {t("workspace.guide_handoff_confirm")}
      </button>
    </form>
  );
}
