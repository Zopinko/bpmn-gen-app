// Two arrows should not share a side of a step while another side is free.
// Same rule as the server layout (_spread_to_free_sides in backend/services/bpmn_svc.py).

const sideOf = (shape, point) => {
  const { x, y, width: w, height: h } = shape;
  if (Math.abs(point.x - x) < 0.5 && point.y >= y - 0.5 && point.y <= y + h + 0.5) return "L";
  if (Math.abs(point.x - (x + w)) < 0.5 && point.y >= y - 0.5 && point.y <= y + h + 0.5) return "R";
  if (Math.abs(point.y - y) < 0.5) return "T";
  if (Math.abs(point.y - (y + h)) < 0.5) return "B";
  return null;
};

const segmentHitsShape = (a, b, shape, pad = 4) => {
  const left = shape.x - pad;
  const right = shape.x + shape.width + pad;
  const top = shape.y - pad;
  const bottom = shape.y + shape.height + pad;
  if (a.x === b.x) {
    const [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
    return a.x > left && a.x < right && y2 > top && y1 < bottom;
  }
  if (a.y === b.y) {
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    return a.y > top && a.y < bottom && x2 > left && x1 < right;
  }
  return false;
};

/**
 * @param connections [{ id, source, target, waypoints }] where source/target are
 *   shapes { id, x, y, width, height } and waypoints [{ x, y }]
 * @param shapes every step on the map (for the "does not cross anything" check)
 * @returns Map of connection id -> new waypoints (only the ones that moved)
 */
export function spreadToFreeSides(connections, shapes) {
  const use = new Map();
  const key = (shapeId, side) => `${shapeId}|${side}`;
  const add = (shapeId, side, entry) => {
    const k = key(shapeId, side);
    if (!use.has(k)) use.set(k, []);
    use.get(k).push(entry);
  };
  const paths = new Map();
  connections.forEach((conn) => {
    const points = conn.waypoints || [];
    if (!conn.source || !conn.target || conn.source.id === conn.target.id || points.length < 2) return;
    paths.set(conn.id, points);
    const outSide = sideOf(conn.source, points[0]);
    const inSide = sideOf(conn.target, points[points.length - 1]);
    if (outSide) add(conn.source.id, outSide, { conn, end: "out" });
    if (inSide) add(conn.target.id, inSide, { conn, end: "in" });
  });
  const free = (shapeId, side) => !(use.get(key(shapeId, side)) || []).length;
  const straightness = (conn) => {
    const points = paths.get(conn.id);
    return [points.length === 2 ? 0 : 1, Math.abs(points[0].y - points[points.length - 1].y)];
  };
  const collides = (points, conn) =>
    points.slice(1).some((point, i) =>
      shapes.some((shape) =>
        shape.id !== conn.source.id && shape.id !== conn.target.id && segmentHitsShape(points[i], point, shape),
      ),
    );

  const moved = new Map();
  [...use.entries()].forEach(([k, entries]) => {
    if (entries.length < 2) return;
    const side = k.slice(k.lastIndexOf("|") + 1);
    const ordered = [...entries].sort((a, b) => {
      const [a1, a2] = straightness(a.conn);
      const [b1, b2] = straightness(b.conn);
      return a1 - b1 || a2 - b2;
    });
    ordered.slice(1).forEach(({ conn, end }) => {
      const shape = end === "in" ? conn.target : conn.source;
      const { x, y, width: w, height: h } = shape;
      const cx = x + w / 2;
      const points = paths.get(conn.id);
      const start = points[0];
      const last = points[points.length - 1];
      let candidate = null;
      let newSide = null;
      if (end === "in" && side === "L" && sideOf(conn.source, start) === "R" && cx > start.x) {
        // arrive through the top/bottom instead of squeezing in from the left
        if (start.y > y + h && free(shape.id, "B")) {
          candidate = [start, { x: cx, y: start.y }, { x: cx, y: y + h }];
          newSide = "B";
        } else if (start.y < y && free(shape.id, "T")) {
          candidate = [start, { x: cx, y: start.y }, { x: cx, y }];
          newSide = "T";
        }
      } else if (end === "out" && side === "R" && sideOf(conn.target, last) === "L" && last.x > cx) {
        // leave through the bottom/top towards a step lower/higher up
        if (last.y > y + h && free(shape.id, "B")) {
          candidate = [{ x: cx, y: y + h }, { x: cx, y: last.y }, last];
          newSide = "B";
        } else if (last.y < y && free(shape.id, "T")) {
          candidate = [{ x: cx, y }, { x: cx, y: last.y }, last];
          newSide = "T";
        }
      } else if (end === "out" && (side === "B" || side === "T") && conn.target.x > x + w && free(shape.id, "R")) {
        // two arrows down (up) from one step: the one further right leaves on the right
        const t = conn.target;
        const tcx = t.x + t.width / 2;
        const edgeY = side === "B" ? t.y : t.y + t.height;
        candidate = [{ x: x + w, y: y + h / 2 }, { x: tcx, y: y + h / 2 }, { x: tcx, y: edgeY }];
        newSide = "R";
      }
      if (!candidate || collides(candidate, conn)) return;
      paths.set(conn.id, candidate);
      moved.set(conn.id, candidate);
      use.set(k, (use.get(k) || []).filter((entry) => entry.conn.id !== conn.id));
      add(shape.id, newSide, { conn, end });
    });
  });
  return moved;
}
