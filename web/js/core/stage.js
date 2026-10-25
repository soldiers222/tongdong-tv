// 游戏画布：逻辑坐标固定 1280×720，背后分辨率可调。
// 负责把摄像头画面（可镜像）铺进画布，并把关键点映射到画布坐标。

export var W = 1280;
export var H = 720;
export var DISPLAY_FONT = '"TD Display", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export var BODY_FONT = '"HarmonyOS Sans SC", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

export function Stage(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d', { alpha: false });
  this.W = W;
  this.H = H;
  this.vw = W;
  this.vh = H;
  this.mirror = true;
  this.fit = 'cover';
  this.setResolution(1);
  this._layout();
}

Stage.prototype.setResolution = function (res) {
  this.res = res;
  this.canvas.width = Math.round(W * res);
  this.canvas.height = Math.round(H * res);
  this.ctx.setTransform(res, 0, 0, res, 0, 0);
};

Stage.prototype.setVideoSize = function (vw, vh) {
  if (!vw || !vh) return;
  if (vw === this.vw && vh === this.vh) return;
  this.vw = vw;
  this.vh = vh;
  this._layout();
};

Stage.prototype.setFit = function (fit) {
  this.fit = fit;
  this._layout();
};

Stage.prototype._layout = function () {
  var s = this.fit === 'cover'
    ? Math.max(W / this.vw, H / this.vh)
    : Math.min(W / this.vw, H / this.vh);
  this.scale = s;
  this.dw = this.vw * s;
  this.dh = this.vh * s;
  this.ox = (W - this.dw) / 2;
  this.oy = (H - this.dh) / 2;
};

// 归一化画面坐标 → 画布坐标
Stage.prototype.map = function (nx, ny) {
  return {
    x: this.ox + (this.mirror ? 1 - nx : nx) * this.dw,
    y: this.oy + ny * this.dh
  };
};

Stage.prototype.mapKp = function (kp) {
  var out = {};
  for (var k in kp) {
    var p = kp[k];
    var m = this.map(p.x, p.y);
    out[k] = { x: m.x, y: m.y, s: p.s };
  }
  return out;
};

Stage.prototype.drawVideo = function (video, dim) {
  var c = this.ctx;
  c.fillStyle = '#0B1426';
  c.fillRect(0, 0, W, H);
  if (video && video.videoWidth) {
    c.save();
    if (this.mirror) {
      c.translate(W, 0);
      c.scale(-1, 1);
    }
    c.drawImage(video, this.ox, this.oy, this.dw, this.dh);
    c.restore();
  }
  if (dim) {
    c.fillStyle = 'rgba(8, 14, 28, ' + dim + ')';
    c.fillRect(0, 0, W, H);
  }
};

// 模拟模式没有摄像头：画一块操场草坪当背景
Stage.prototype.drawMockBackground = function () {
  var c = this.ctx;
  c.fillStyle = '#23633E';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(247,245,239,0.18)';
  c.lineWidth = 4;
  for (var x = 80; x < W; x += 160) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H);
    c.stroke();
  }
  c.fillStyle = 'rgba(247,245,239,0.35)';
  c.font = '22px ' + BODY_FONT;
  c.textAlign = 'right';
  c.fillText('模拟模式（不使用摄像头）', W - 24, H - 20);
  c.textAlign = 'left';
};

export function roundRect(c, x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.arcTo(x + w, y, x + w, y + rr, rr);
  c.lineTo(x + w, y + h - rr);
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  c.lineTo(x + rr, y + h);
  c.arcTo(x, y + h, x, y + h - rr, rr);
  c.lineTo(x, y + rr);
  c.arcTo(x, y, x + rr, y, rr);
  c.closePath();
}

// 带描边的大字（压在摄像头画面上也看得清）
export function outlinedText(c, text, x, y, size, fill, align, font) {
  c.font = size + 'px ' + (font || DISPLAY_FONT);
  c.textAlign = align || 'left';
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(4, size * 0.14);
  c.strokeStyle = 'rgba(10, 18, 36, 0.85)';
  c.strokeText(text, x, y);
  c.fillStyle = fill || '#F7F5EF';
  c.fillText(text, x, y);
  c.textAlign = 'left';
}
