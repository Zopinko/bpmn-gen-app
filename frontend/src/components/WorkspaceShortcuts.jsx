import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const GROUPS = [
  {
    title: "workspace.sc_group_workspace",
    items: [
      { keys: ["F"], label: "workspace.sc_focus" },
      { keys: ["T"], label: "workspace.sc_tree" },
      { keys: ["?"], label: "workspace.sc_help" },
      { keys: ["Esc"], label: "workspace.sc_escape" },
    ],
  },
  {
    title: "workspace.sc_group_map",
    items: [
      { keys: ["↑", "↓", "←", "→"], label: "workspace.sc_pan" },
      { keys: ["Shift", "+", "↑↓←→"], label: "workspace.sc_pan_fast" },
      { keys: ["workspace.sc_key_wheel"], label: "workspace.sc_zoom", translateKeys: true },
      { keys: ["Ctrl", "+", "F"], label: "workspace.sc_search" },
      { keys: ["Delete"], label: "workspace.sc_delete" },
    ],
  },
];

export default function WorkspaceShortcuts({ open, onClose }) {
  const { t } = useTranslation();
  const closeRef = useRef(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="ws-shortcuts__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="ws-shortcuts" role="dialog" aria-modal="false" aria-labelledby="ws-shortcuts-title">
        <div className="ws-shortcuts__head">
          <h2 id="ws-shortcuts-title" className="ws-shortcuts__title">
            {t("workspace.shortcuts_title")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="ws-icon-btn"
            aria-label={t("workspace.close")}
            onClick={onClose}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {GROUPS.map((group) => (
          <section key={group.title} className="ws-shortcuts__group">
            <h3 className="ws-section-label ws-section-label--flush">{t(group.title)}</h3>
            <dl className="ws-shortcuts__list">
              {group.items.map((item) => (
                <div key={item.label} className="ws-shortcuts__row">
                  <dt>{t(item.label)}</dt>
                  <dd>
                    {item.keys.map((key, index) =>
                      key === "+" ? (
                        <span key={index} className="ws-shortcuts__plus">+</span>
                      ) : (
                        <kbd key={index}>{item.translateKeys ? t(key) : key}</kbd>
                      ),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
