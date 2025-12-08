import MapViewer from "./MapViewer";

export default function RightPaneSplit({ layout, topProps, bottomProps }) {
  const hideTop = layout === "bottom-fullscreen";
  const hideBottom = layout === "top-fullscreen";

  return (
    <div className={`dual-map dual-map--${layout}`}>
      <div className={`dual-map__pane dual-map__pane--top ${hideTop ? "dual-map__pane--hidden" : ""}`}>
        <MapViewer {...topProps} />
      </div>
      <div className={`dual-map__pane dual-map__pane--bottom ${hideBottom ? "dual-map__pane--hidden" : ""}`}>
        <MapViewer {...bottomProps} />
      </div>
    </div>
  );
}
