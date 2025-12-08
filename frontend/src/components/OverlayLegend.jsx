const LEGEND_ITEMS = [
  { icon: "🟢", label: "Nízke riziko / v poriadku" },
  { icon: "🟡", label: "Stredné riziko / skontrolovať" },
  { icon: "🔴", label: "Vysoké riziko / problém" },
  { icon: "🏷️", label: "Pravidlo popisiek" },
  { icon: "👥", label: "Alias" },
  { icon: "🔀", label: "Pomôcka pre join" },
];

export default function OverlayLegend() {
  return (
    <div className="overlay-legend">
      <div className="overlay-legend__title">Legenda</div>
      <ul className="overlay-legend__list">
        {LEGEND_ITEMS.map((item) => (
          <li key={item.label} className="overlay-legend__item">
            <span className="overlay-legend__icon" aria-hidden>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
