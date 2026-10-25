// 举起双手：两只手腕都高过头顶并保持一会儿，用来「再来一局」，孩子不用跑回去拿遥控器。
import { ok } from './keypoints.js';

export function HandsUp(holdMs) {
  this.holdMs = holdMs || 1500;
  this.since = null;
  this.fired = false;
}

HandsUp.prototype.update = function (kp, t) {
  var up = false;
  if (ok(kp, 'left_wrist', 0.4) && ok(kp, 'right_wrist', 0.4) && ok(kp, 'nose', 0.4)) {
    var margin = 0.03;
    up = kp.left_wrist.y < kp.nose.y - margin && kp.right_wrist.y < kp.nose.y - margin;
  }
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
};
