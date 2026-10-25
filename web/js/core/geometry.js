// 平面几何：关节角、点到线段距离。所有输入都应是像素坐标（横纵同一尺度）。
import { clamp } from './util.js';

export function dist(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s: Math.min(a.s == null ? 1 : a.s, b.s == null ? 1 : b.s) };
}

// 以 b 为顶点的夹角（度）。腿伸直约 180°
export function angleAt(a, b, c) {
  var abx = a.x - b.x, aby = a.y - b.y, cbx = c.x - b.x, cby = c.y - b.y;
  var d = Math.sqrt((abx * abx + aby * aby) * (cbx * cbx + cby * cby));
  if (d === 0) return 180;
  var cos = clamp((abx * cbx + aby * cby) / d, -1, 1);
  return Math.acos(cos) * 180 / Math.PI;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var l2 = dx * dx + dy * dy;
  var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  var cx = ax + t * dx, cy = ay + t * dy;
  var ex = px - cx, ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

export function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  return distToSegment(cx, cy, ax, ay, bx, by) <= r;
}
