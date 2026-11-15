import { useCallback } from "react";
import { useTranslation } from "react-i18next";

// The bubble is re-created on the canvas after every diagram change, so its
// input would lose the caret after each added step. Remember that the user was
// typing in it and give the caret back to the new input.
let composerHadFocus = false;
// when the person last clicked or tabbed: a blur right after that is their choice,
// any other blur comes from the map being redrawn around the bubble
let lastUserMove = 0;
if (typeof document !== "undefined") {
  const noteUserMove = (event) => {
    // clicks into the composer itself (its input or the add button) keep the person typing
    if (event.target?.closest?.(".guide-bubble__composer")) return;
    if (event.type === "pointerdown" || event.key === "Tab" || event.key === "Escape") lastUserMove = Date.now();
  };
  document.addEventListener("pointerdown", noteUserMove, true);
  document.addEventListener("keydown", noteUserMove, true);
}

// The input may not be on the page (or visible) yet: try again for about a second.
function giveCaret(input, framesLeft = 30) {
  if (!composerHadFocus || !input) return;
  if (input.isConnected) {
    input.focus({ preventScroll: true });
    if (document.activeElement === input) return;
  }
  if (framesLeft > 0) window.setTimeout(() => giveCaret(input, framesLeft - 1), 30);
}

function useComposerFocus() {
  const inputRef = useCallback((input) => {
    if (input && composerHadFocus) giveCaret(input);
  }, []);
  const onFocus = () => {
    composerHadFocus = true;
  };
  const onBlur = (event) => {
    const input = event.currentTarget;
    if (event.relatedTarget || Date.now() - lastUserMove < 400) {
      composerHadFocus = false; // the person moved on
      return;
    }
    // removing or redrawing the bubble also blurs it: keep typing in the bubble
    window.setTimeout(() => giveCaret(input), 0);
  };
  return { inputRef, onFocus, onBlur };
}

/**
 * The guide's speech bubble. Rendered on the map canvas, anchored to the
 * element the guide is talking about (or floating at the top when there is none).
 */
export default function GuideBubble({ title, message, actions = [], collapsed = false, floating = false, complete = false, onToggle, composer, children }) {
  const { t } = useTranslation();
  const composerFocus = useComposerFocus();

  if (collapsed) {
    return (
      <button
        type="button"
        className="guide-bubble-dot"
        aria-label={t("workspace.guide_show")}
        title={t("workspace.guide_show")}
        onClick={onToggle}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
      </button>
    );
  }

  const canSubmit = composer && !composer.busy && Boolean(composer.value.trim());

  return (
    <div className={`guide-bubble ${floating ? "guide-bubble--floating" : ""} ${complete ? "guide-bubble--complete" : ""}`}>
      {floating ? null : <span className="guide-bubble__tip" aria-hidden="true" />}
      <div className="guide-bubble__head">
        <span className="guide-bubble__eyebrow">{t("workspace.guide_label")}</span>
        <button
          type="button"
          className="guide-bubble__close"
          aria-label={t("workspace.guide_hide")}
          title={t("workspace.guide_hide")}
          onClick={onToggle}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {composer ? (
        <form
          className="guide-bubble__composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void composer.onSubmit();
          }}
        >
          <label className="guide-bubble__label">
            <span className="guide-bubble__title">{t("workspace.guide_step_question", { lane: composer.laneName })}</span>
            <input
              ref={composerFocus.inputRef}
              onFocus={composerFocus.onFocus}
              onBlur={composerFocus.onBlur}
              type="text"
              className="guide-bubble__input"
              value={composer.value}
              onChange={(event) => composer.onChange(event.target.value)}
              readOnly={composer.busy}
            />
          </label>
          <button type="submit" className="guide-bubble__btn guide-bubble__btn--go" disabled={!canSubmit}>
            {t("workspace.guide_step_add")}
          </button>
        </form>
      ) : children || (
        <div className="guide-bubble__advice" role="status">
          {title ? <div className="guide-bubble__title">{title}</div> : null}
          <div className="guide-bubble__message">{message}</div>
        </div>
      )}
      {actions.length ? (
        <div className="guide-bubble__actions">
          {actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              type="button"
              className={`guide-bubble__btn ${!composer && index === 0 ? "guide-bubble__btn--go" : ""}`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
