import { useTranslation } from "react-i18next";

export default function OverlayLegend() {
  const { t } = useTranslation();

  const LEGEND_ITEMS = [
    { icon: "🟢", labelKey: "overlay_legend.low_risk" },
    { icon: "🟡", labelKey: "overlay_legend.medium_risk" },
    { icon: "🔴", labelKey: "overlay_legend.high_risk" },
    { icon: "🏷️", labelKey: "overlay_legend.label_rule" },
    { icon: "👥", labelKey: "overlay_legend.alias" },
    { icon: "🔀", labelKey: "overlay_legend.join_helper" },
  ];

  return (
    <div className="overlay-legend">
      <div className="overlay-legend__title">{t("overlay_legend.title")}</div>
      <ul className="overlay-legend__list">
        {LEGEND_ITEMS.map((item) => (
          <li key={item.labelKey} className="overlay-legend__item">
            <span className="overlay-legend__icon" aria-hidden>
              {item.icon}
            </span>
            <span>{t(item.labelKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
