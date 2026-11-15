export default function GuideHandoffArrow({ source, target }) {
  const sourceCenter = { x: source.width / 2, y: source.height / 2 };
  const targetCenter = {
    x: target.x - source.x + target.width / 2,
    y: target.y - source.y + target.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sign = Math.sign(horizontal ? dx : dy);
  const start = horizontal
    ? { x: sourceCenter.x + sign * source.width / 2, y: sourceCenter.y }
    : { x: sourceCenter.x, y: sourceCenter.y + sign * source.height / 2 };
  const end = horizontal
    ? { x: targetCenter.x - sign * target.width / 2, y: targetCenter.y }
    : { x: targetCenter.x, y: targetCenter.y - sign * target.height / 2 };

  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 1) return null;
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const tipBase = { x: end.x - ux * 9, y: end.y - uy * 9 };
  const arrowhead = [
    [end.x, end.y],
    [tipBase.x - uy * 4, tipBase.y + ux * 4],
    [tipBase.x + uy * 4, tipBase.y - ux * 4],
  ].map((point) => point.join(",")).join(" ");

  return (
    <svg
      className="guide-handoff-preview"
      aria-hidden="true"
      width="1"
      height="1"
      style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
    >
      <line
        x1={start.x} y1={start.y} x2={tipBase.x} y2={tipBase.y}
        stroke="var(--guide)" strokeWidth="2" strokeDasharray="6 4"
      />
      <polygon points={arrowhead} fill="var(--guide)" />
    </svg>
  );
}
