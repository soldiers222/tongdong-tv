// 举起双手：两只手腕都高过头顶并保持一会儿，用来「再来一局」，孩子不用跑回去拿遥控器。
import { ok } from './keypoints.js';

// 要先看到手放下来过一次才开始认（跳舞、瑜伽结束时手正举着，不能一结束就自动再来一局）
export function HandsUp(holdMs) {
  this.holdMs = holdMs || 1500;
  this.since = null;
  this.fired = false;
  this.armed = false;
}

HandsUp.prototype.update = function (kp, t) {
  var up = false;
  if (ok(kp, 'left_wrist', 0.4) && ok(kp, 'right_wrist', 0.4) && ok(kp, 'nose', 0.4)) {
    var margin = 0.03;
    up = kp.left_wrist.y < kp.nose.y - margin && kp.right_wrist.y < kp.nose.y - margin;
    if (kp.left_wrist.y > kp.nose.y + margin && kp.right_wrist.y > kp.nose.y + margin) this.armed = true;
  }
  if (!this.armed) up = false;
  if (up) {
    if (this.since === null) this.since = t;
  } else {
    this.since = null;
  }
  var progress = this.since === null ? 0 : Math.min(1, (t - this.since) / this.holdMs);
  var fire = progress >= 1 && !this.fired;
  if (fire) this.fired = true;
  return { up: up, progress: progress, fire: fire };
};

HandsUp.prototype.reset = function () {
  this.since = null;
  this.fired = false;
  this.armed = false;
};
