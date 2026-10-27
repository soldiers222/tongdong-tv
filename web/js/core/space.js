// 开局站位检测：全身入镜、离电视远近、左右是否居中。
// kp 为归一化关键点；mirror 为画面是否镜像（决定「往左/往右」的说法）；
// region 为这个人该站的屏幕区域 {x0, x1}（0–1，双人时一人一半），不给就是整个屏幕。
import { ok } from './keypoints.js';

var T = 0.4;

function headY(kp) {
  if (ok(kp, 'nose', T)) return kp.nose.y;
  if (ok(kp, 'left_eye', T) && ok(kp, 'right_eye', T)) return (kp.left_eye.y + kp.right_eye.y) / 2;
  return null;
}

export function checkSpace(kp, mode, mirror, region) {
  var hy = headY(kp);
  var sh = ok(kp, 'left_shoulder', T) && ok(kp, 'right_shoulder', T);
  var hips = ok(kp, 'left_hip', T) && ok(kp, 'right_hip', T);
  if (!kp || (!sh && !hips && hy === null)) {
    return { ok: false, code: 'none', msg: '请站到电视正前方，让摄像头看到你' };
  }

  var cx;
  if (hips) cx = (kp.left_hip.x + kp.right_hip.x) / 2;
  else if (sh) cx = (kp.left_shoulder.x + kp.right_shoulder.x) / 2;
  else cx = kp.nose.x;
  var screenX = mirror ? 1 - cx : cx;
  var lo = region ? region.x0 + 0.06 : 0.25, hi = region ? region.x1 - 0.06 : 0.75;
  // 镜像画面里，人在屏幕左边 → 让他往自己的右边走
  if (screenX < lo) return { ok: false, code: 'left', msg: mirror ? '往右边走一点' : '往左边走一点' };
  if (screenX > hi) return { ok: false, code: 'right', msg: mirror ? '往左边走一点' : '往右边走一点' };

  if (mode === 'full') {
    if (hy === null) return { ok: false, code: 'head', msg: '头要在画面里，往后退一点' };
    var ankles = ok(kp, 'left_ankle', 0.3) && ok(kp, 'right_ankle', 0.3);
    if (!ankles) return { ok: false, code: 'feet', msg: '看不到脚了，往后退一点' };
    var shY = sh ? (kp.left_shoulder.y + kp.right_shoulder.y) / 2 : hy + 0.1;
    var top = hy - 0.6 * Math.max(0.02, shY - hy);
    var bottom = Math.max(kp.left_ankle.y, kp.right_ankle.y) + 0.02;
    var frac = bottom - top;
    if (top < 0.005 || bottom > 0.995) return { ok: false, code: 'edge', msg: '往后退一点，头和脚都要在画面里', frac: frac };
    if (frac > 0.93) return { ok: false, code: 'near', msg: '太近了，往后退一点', frac: frac };
    if (frac < 0.4) return { ok: false, code: 'far', msg: '离得有点远，往前走一点', frac: frac };
    return { ok: true, code: 'ok', msg: '很好，就站在这里', frac: frac };
  }

  // upper：上半身入镜即可（切水果用）
  if (!sh) return { ok: false, code: 'shoulder', msg: '让肩膀和双手出现在画面里' };
  var shoulderW = Math.abs(kp.left_shoulder.x - kp.right_shoulder.x);
  if (shoulderW > 0.42) return { ok: false, code: 'near', msg: '太近了，往后退一点' };
  if (shoulderW < 0.05) return { ok: false, code: 'far', msg: '离得有点远，往前走一点' };
  if (hy !== null && hy < 0.03) return { ok: false, code: 'head', msg: '头要在画面里，往后退一点' };
  return { ok: true, code: 'ok', msg: '很好，就站在这里' };
}

// 连续合格一段时间才算通过，避免一闪而过
export function SpaceGate(holdMs) {
  this.holdMs = holdMs || 900;
  this.since = null;
  this.last = null;
}

SpaceGate.prototype.update = function (kp, mode, mirror, t, region) {
  var r = checkSpace(kp, mode, mirror, region);
  this.last = r;
  if (r.ok) {
    if (this.since === null) this.since = t;
  } else {
    this.since = null;
  }
  r.progress = this.since === null ? 0 : Math.min(1, (t - this.since) / this.holdMs);
  r.passed = r.progress >= 1;
  return r;
};

SpaceGate.prototype.reset = function () {
  this.since = null;
};
