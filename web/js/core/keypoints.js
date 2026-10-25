// 统一的关键点格式：{ 名称: { x, y, s } }，x/y 为 0–1 归一化画面坐标，s 为置信度 0–1。
// 左右指孩子身体的左右（不是屏幕左右）。

export var CORE = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
];

// MediaPipe BlazePose 33 点 → 名称
var MP_INDEX = {
  nose: 0, left_eye: 2, right_eye: 5, left_ear: 7, right_ear: 8,
  left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_pinky: 17, right_pinky: 18,
  left_index: 19, right_index: 20, left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28,
  left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32
};

function inFrame(x, y) {
  return x > -0.02 && x < 1.02 && y > -0.02 && y < 1.02;
}

export function fromMediaPipe(landmarks) {
  var out = {};
  if (!landmarks) return out;
  for (var name in MP_INDEX) {
    var p = landmarks[MP_INDEX[name]];
    if (!p) continue;
    var s = p.visibility == null ? 0.9 : p.visibility;
    if (!inFrame(p.x, p.y)) s = Math.min(s, 0.1);
    out[name] = { x: p.x, y: p.y, s: s };
  }
  return out;
}

// MoveNet（pose-detection 库）输出像素坐标
export function fromMoveNet(keypoints, w, h) {
  var out = {};
  if (!keypoints) return out;
  for (var i = 0; i < keypoints.length; i++) {
    var k = keypoints[i];
    var name = k.name || CORE[i];
    var x = k.x / w, y = k.y / h;
    var s = k.score == null ? 0.9 : k.score;
    if (!inFrame(x, y)) s = Math.min(s, 0.1);
    out[name] = { x: x, y: y, s: s };
  }
  return out;
}

export function ok(kp, name, thr) {
  var p = kp && kp[name];
  return !!p && p.s >= (thr == null ? 0.35 : thr);
}

export function countVisible(kp, thr) {
  var n = 0;
  for (var i = 0; i < CORE.length; i++) if (ok(kp, CORE[i], thr)) n++;
  return n;
}

// 归一化坐标 → 像素坐标（几何判断必须在像素空间做，否则横纵比例不一致）
export function toPixels(kp, w, h) {
  var out = {};
  for (var k in kp) {
    var p = kp[k];
    out[k] = { x: p.x * w, y: p.y * h, s: p.s };
  }
  return out;
}

// 手的位置：手腕沿小臂方向外推一点，更接近手掌中心
export function handTip(kp, side) {
  var w = kp[side + '_wrist'], e = kp[side + '_elbow'], idx = kp[side + '_index'];
  if (!w) return null;
  if (idx && idx.s > 0.3) {
    return { x: w.x + (idx.x - w.x) * 0.6, y: w.y + (idx.y - w.y) * 0.6, s: Math.min(w.s, idx.s) };
  }
  if (e && e.s > 0.2) {
    return { x: w.x + (w.x - e.x) * 0.28, y: w.y + (w.y - e.y) * 0.28, s: w.s };
  }
  return { x: w.x, y: w.y, s: w.s };
}
