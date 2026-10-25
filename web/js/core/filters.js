// One Euro 滤波：静止时去抖，快速挥手时几乎不拖尾。
// 参考 Casiez 等人 2012 年的 1€ Filter。时间单位：秒；坐标单位随调用方。

function alpha(dt, cutoff) {
  var tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export function OneEuro(minCutoff, beta, dCutoff) {
  this.minCutoff = minCutoff == null ? 1.0 : minCutoff;
  this.beta = beta == null ? 0.0 : beta;
  this.dCutoff = dCutoff == null ? 1.0 : dCutoff;
  this.reset();
}

OneEuro.prototype.reset = function () {
  this.x = null;
  this.dx = 0;
  this.t = null;
};

OneEuro.prototype.filter = function (x, tSec) {
  if (this.t === null) {
    this.t = tSec;
    this.x = x;
    this.dx = 0;
    return x;
  }
  var dt = tSec - this.t;
  if (dt <= 0) return this.x;
  if (dt > 1) { // 断档超过 1 秒，重新开始
    this.t = tSec;
    this.x = x;
    this.dx = 0;
    return x;
  }
  this.t = tSec;
  var dx = (x - this.x) / dt;
  var ad = alpha(dt, this.dCutoff);
  this.dx = ad * dx + (1 - ad) * this.dx;
  var cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
  var a = alpha(dt, cutoff);
  this.x = a * x + (1 - a) * this.x;
  return this.x;
};

// 二维点滤波
export function PointFilter(minCutoff, beta) {
  this.fx = new OneEuro(minCutoff, beta);
  this.fy = new OneEuro(minCutoff, beta);
}

PointFilter.prototype.filter = function (x, y, tSec) {
  return { x: this.fx.filter(x, tSec), y: this.fy.filter(y, tSec) };
};

PointFilter.prototype.reset = function () {
  this.fx.reset();
  this.fy.reset();
};
