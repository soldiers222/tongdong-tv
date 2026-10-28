// 游戏画布：逻辑坐标固定 1280×720，背后分辨率可调。
// 负责把摄像头画面（可镜像）铺进画布，并把关键点映射到画布坐标。

export var W = 1280;
export var H = 720;
export var DISPLAY_FONT = '"TD Display", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export var BODY_FONT = '"HarmonyOS Sans SC", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

// alpha：电视版 APK 有原生识别时画布要能透明（摄像头画面在网页下层）
export function Stage(canvas, opts) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d', { alpha: !!(opts && opts.alpha) });
  this.transparentVideo = false; // true：不画摄像头画面，留透明给下层的原生预览
  this.W = W;
  this.H = H;
  this.vw = W;
  this.vh = H;
  this.mirror = true;
  this.fit = 'cover';
  this.view = null;    // 摄像头画面只铺在画布的这一块（{x, y, w, h}，逻辑坐标），null = 整个画布
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

// 摄像头画面只放在画布的一块里（跟着视频跳：左边是视频，右边一小块是孩子自己）；null 恢复成整个画布
Stage.prototype.setViewport = function (r) {
  this.view = r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  this._layout();
};

// 摄像头画面所在的那块占画布的比例（给原生预览层定位用），整个画布时返回 null
Stage.prototype.viewFrac = function () {
  var v = this.view;
  return v ? { x: v.x / W, y: v.y / H, w: v.w / W, h: v.h / H } : null;
};

Stage.prototype._layout = function () {
  var v = this.view || { x: 0, y: 0, w: W, h: H };
  var s = this.fit === 'cover'
    ? Math.max(v.w / this.vw, v.h / this.vh)
    : Math.min(v.w / this.vw, v.h / this.vh);
  this.scale = s;
  this.dw = this.vw * s;
  this.dh = this.vh * s;
  this.ox = v.x + (v.w - this.dw) / 2;
  this.oy = v.y + (v.h - this.dh) / 2;
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
  var v = this.view || { x: 0, y: 0, w: W, h: H };
  if (this.transparentVideo) {
    // 画面区域留透明给下层的原生预览；留边（contain 时的黑边）照常涂底色
    c.fillStyle = '#0B1426';
    c.fillRect(0, 0, W, H);
    var x0 = Math.max(v.x, Math.ceil(this.ox)), y0 = Math.max(v.y, Math.ceil(this.oy));
    var x1 = Math.min(v.x + v.w, Math.floor(this.ox + this.dw)), y1 = Math.min(v.y + v.h, Math.floor(this.oy + this.dh));
    c.clearRect(x0, y0, x1 - x0, y1 - y0);
    if (dim) {
      c.fillStyle = 'rgba(8, 14, 28, ' + dim + ')';
      if (this.view) c.fillRect(x0, y0, x1 - x0, y1 - y0);
      else c.fillRect(0, 0, W, H);
    }
    return;
  }
  c.fillStyle = '#0B1426';
  c.fillRect(0, 0, W, H);
  if (video && video.videoWidth) {
    c.save();
    if (this.view) {
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
    }
    if (this.mirror) {
      // 镜像：以这一块的中线翻过来
      c.translate(2 * v.x + v.w, 0);
      c.scale(-1, 1);
    }
    c.drawImage(video, this.ox, this.oy, this.dw, this.dh);
    c.restore();
  }
  if (dim) {
    c.fillStyle = 'rgba(8, 14, 28, ' + dim + ')';
    c.fillRect(v.x, v.y, v.w, v.h);
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
