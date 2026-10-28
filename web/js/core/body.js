// 身体测量（像素坐标的关键点，横纵同一尺度）：关节角、身体中心、各段长度、站立基准。
// 摄像头在正前方时，大腿朝镜头的动作（下蹲、抬膝）在画面上表现为「大腿变短」，
// 所以下蹲深度用「髋比站立时降了多少」和「大腿在画面上的长度 ÷ 小腿」来判断，比膝角可靠。
import { angleAt, dist, mid } from './geometry.js';

export var T = 0.3; // 关键点可信度门槛

export function has(kp, names, thr) {
  if (!kp) return false;
  var t = thr == null ? T : thr;
  for (var i = 0; i < names.length; i++) {
    var p = kp[names[i]];
    if (!p || p.s < t) return false;
  }
  return true;
}

export var UPPER = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'];
export var LOWER = ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
export var FULL = UPPER.concat(LOWER);

export function other(side) { return side === 'left' ? 'right' : 'left'; }

export function knee(kp, s) { return angleAt(kp[s + '_hip'], kp[s + '_knee'], kp[s + '_ankle']); }
export function elbow(kp, s) { return angleAt(kp[s + '_shoulder'], kp[s + '_elbow'], kp[s + '_wrist']); }
export function hips(kp) { return mid(kp.left_hip, kp.right_hip); }
export function shoulders(kp) { return mid(kp.left_shoulder, kp.right_shoulder); }
export function torso(kp) { return Math.max(1, dist(shoulders(kp), hips(kp))); }
export function shoulderW(kp) { return Math.max(1, dist(kp.left_shoulder, kp.right_shoulder)); }
export function hipW(kp) { return Math.max(1, dist(kp.left_hip, kp.right_hip)); }
export function shin(kp, s) { return Math.max(1, dist(kp[s + '_knee'], kp[s + '_ankle'])); }
export function thigh(kp, s) { return Math.max(1, dist(kp[s + '_hip'], kp[s + '_knee'])); }
export function legLen(kp, s) { return thigh(kp, s) + shin(kp, s); }
export function feetApart(kp) { return Math.abs(kp.left_ankle.x - kp.right_ankle.x); }
export function wristsApart(kp) { return Math.abs(kp.left_wrist.x - kp.right_wrist.x); }

// 大腿在画面上竖直方向的长度 ÷ 小腿：站直约 1，下蹲越深越小（大腿朝镜头）
export function thighRatio(kp, s) {
  return (kp[s + '_knee'].y - kp[s + '_hip'].y) / shin(kp, s);
}

// 手腕高于鼻子
export function wristUp(kp, s, margin) {
  var nose = kp.nose && kp.nose.s >= T ? kp.nose.y : shoulders(kp).y - 0.35 * torso(kp);
  return kp[s + '_wrist'].y < nose - (margin || 0) * torso(kp);
}

// 手腕大约在肩高（上下不超过 tol 个躯干长）
export function wristAtShoulder(kp, s, tol) {
  return Math.abs(kp[s + '_wrist'].y - kp[s + '_shoulder'].y) < (tol || 0.35) * torso(kp);
}

// 抬起的脚：踝比另一只高出 frac 个腿长
export function footUp(kp, s, frac) {
  var o = other(s);
  return kp[s + '_ankle'].y < kp[o + '_ankle'].y - (frac || 0.1) * legLen(kp, o);
}

// 站立基准：站直时「髋到脚踝的高度 ÷ 肩宽」，以及髋的高度和腿长（取最近一段的中位数）。
// 用「髋到脚踝」而不是髋的绝对高度：孩子往前走一步、往后退一步，人在画面里变大变小、上下移动，比值不变。
// 比站立矮一截的帧不收（半蹲时膝盖朝镜头，画面上腿看起来还是直的）。
function standH(kp) {
  var ank = (kp.left_ankle.y + kp.right_ankle.y) / 2;
  return (ank - hips(kp).y) / shoulderW(kp);
}

export function Baseline() {
  this.h = [];
  this.hipY = [];
  this.leg = [];
}

var BASE_NEED = LOWER.concat(['left_shoulder', 'right_shoulder']);

Baseline.prototype.add = function (kp) {
  if (!has(kp, BASE_NEED)) return;
  // 两条腿都直才算站直
  if (knee(kp, 'left') < 160 || knee(kp, 'right') < 160) return;
  if (thighRatio(kp, 'left') < 0.8 || thighRatio(kp, 'right') < 0.8) return;
  var h = standH(kp);
  if (this.ready() && h < 0.94 * median(this.h)) return;
  this.h.push(h);
  this.hipY.push(hips(kp).y);
  this.leg.push((legLen(kp, 'left') + legLen(kp, 'right')) / 2);
  if (this.h.length > 60) { this.h.shift(); this.hipY.shift(); this.leg.shift(); }
};

function median(a) {
  if (!a.length) return null;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.floor(s.length / 2)];
}

Baseline.prototype.ready = function () { return this.h.length >= 5; };

// 髋相对脚踝降了多少（占站立时髋高的比例）：站着约 0，半蹲约 0.2，深蹲约 0.35–0.45
Baseline.prototype.drop = function (kp) {
  if (!this.ready() || !has(kp, BASE_NEED)) return null;
  return 1 - standH(kp) / median(this.h);
};

// 髋比站立时高了多少（单位：腿长）：跳起来是正的，蹲下是负的。
// 用髋的绝对高度（跳起来脚也离地，相对脚踝看不出来），所以只适合原地不前后走动的游戏
Baseline.prototype.rise = function (kp) {
  if (!this.ready() || !has(kp, ['left_hip', 'right_hip'])) return null;
  return (median(this.hipY) - hips(kp).y) / median(this.leg);
};

Baseline.prototype.reset = function () {
  this.h = [];
  this.hipY = [];
  this.leg = [];
};

export function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
export { angleAt, dist, mid };
