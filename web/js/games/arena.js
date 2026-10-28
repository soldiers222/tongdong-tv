// 新游戏共用的场地：一个人用整屏，两个人一人一半（左右各一个「槽」）。
// 站位提示、倒计时、举手再来一局的进度条、双人分界线都在这里。
import { W, H, roundRect, outlinedText, BODY_FONT } from '../core/stage.js';
import { DUO, HALF, screenPlayers } from './duo.js';
import { SpaceGate } from '../core/space.js';
import { HandsUp } from '../core/gestures.js';
import { sfx } from '../core/sfx.js';
import { speak } from '../core/voice.js';

export var COUNT_MS = 800;

export function makeSlots(n) {
  var list = n === 2 ? DUO : [{ side: 'solo', name: '', color: '#FFC928', x0: 0, region: null }];
  return list.map(function (d, i) {
    return {
      i: i,
      name: d.name,
      color: d.color,
      x: d.x0,
      w: n === 2 ? HALF : W,
      region: d.region,
      gate: new SpaceGate(900),
      handsUp: new HandsUp(1500),
      space: null,
      pose: null,
      kp: null,
      handsProgress: 0
    };
  });
}

// 这一帧每个槽的人（摄像头原始坐标），按屏幕从左到右
export function framePlayers(frame, mirror, n) {
  if (n === 2) return screenPlayers(frame, mirror);
  return [frame.kp || null];
}

// 站位：每个槽一条提示，全部通过返回 true
export function drawSpace(c, slots, footer) {
  var all = true;
  for (var i = 0; i < slots.length; i++) {
    var P = slots[i], sp = P.space;
    var okNow = sp && sp.ok;
    var x = P.x + 28, w = P.w - 56, cx = P.x + P.w / 2;
    roundRect(c, x, 30, w, 96, 40);
    c.fillStyle = 'rgba(10,18,36,0.8)';
    c.fill();
    var msg = sp && sp.passed ? '准备好了' : (sp ? sp.msg : (slots.length > 1 ? '站到这半边来' : '请站到电视正前方，让摄像头看到你'));
    outlinedText(c, msg, cx, slots.length > 1 ? 82 : 94, slots.length > 1 ? 34 : 46, okNow ? '#FFC928' : '#F7F5EF', 'center');
    if (slots.length > 1) outlinedText(c, P.name, cx, 118, 24, P.color, 'center', BODY_FONT);
    if (okNow) {
      roundRect(c, x + 80, 128, (w - 160) * sp.progress, 8, 4);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
    if (!(sp && sp.passed)) all = false;
  }
  if (footer) outlinedText(c, footer, W / 2, 690, 27, '#F7F5EF', 'center', BODY_FONT);
  return all;
}

// 3、2、1、开始！ 返回 true 表示倒计时结束
export function drawCount(c, el, state) {
  var idx = Math.floor(el / COUNT_MS);
  if (idx !== state.lastCount) {
    state.lastCount = idx;
    if (idx < 3) sfx.tick();
    else if (idx === 3) { sfx.go(); speak('开始'); }
  }
  if (idx >= 4) return true;
  var f = (el % COUNT_MS) / COUNT_MS;
  var text = idx < 3 ? String(3 - idx) : '开始！';
  var size = (idx < 3 ? 260 : 170) * (1.15 - 0.15 * f);
  c.globalAlpha = idx < 3 ? 1 - f * 0.5 : 1;
  outlinedText(c, text, W / 2, H / 2 + size * 0.35, Math.round(size), '#FFC928', 'center');
  c.globalAlpha = 1;
  return false;
}

export function drawDivider(c) {
  c.save();
  c.strokeStyle = 'rgba(247,245,239,0.55)';
  c.lineWidth = 4;
  if (c.setLineDash) c.setLineDash([18, 14]);
  c.beginPath();
  c.moveTo(HALF, 150);
  c.lineTo(HALF, H);
  c.stroke();
  c.restore();
}

// 结算时：举起双手的进度
export function drawHandsUp(c, slots) {
  for (var i = 0; i < slots.length; i++) {
    var P = slots[i];
    var w = Math.min(400, P.w - 120), x = P.x + (P.w - w) / 2;
    roundRect(c, x, 662, w, 16, 8);
    c.fillStyle = 'rgba(10,18,36,0.7)';
    c.fill();
    if (P.handsProgress > 0) {
      roundRect(c, x, 662, w * P.handsProgress, 16, 8);
      c.fillStyle = '#3FBF6A';
      c.fill();
    }
  }
}

// 顶部计时条
export function drawTimer(c, leftMs, totalMs) {
  var frac = Math.max(0, leftMs) / totalMs;
  roundRect(c, 440, 26, 400, 26, 13);
  c.fillStyle = 'rgba(10,18,36,0.65)';
  c.fill();
  if (frac > 0) {
    roundRect(c, 444, 30, Math.max(18, 392 * frac), 18, 9);
    c.fillStyle = frac < 0.2 ? '#E5484D' : '#FFC928';
    c.fill();
  }
  outlinedText(c, Math.ceil(Math.max(0, leftMs) / 1000) + ' 秒', W / 2, 96, 40, '#F7F5EF', 'center');
}

// 飘字
export function Pops() { this.list = []; }
Pops.prototype.add = function (text, x, y, color, size, t) {
  this.list.push({ text: text, x: x, y: y, color: color || '#F7F5EF', size: size || 44, born: t });
};
Pops.prototype.draw = function (c, t) {
  var keep = [];
  for (var i = 0; i < this.list.length; i++) {
    var p = this.list[i];
    var age = (t - p.born) / 900;
    if (age >= 1) continue;
    keep.push(p);
    c.globalAlpha = 1 - age * age;
    outlinedText(c, p.text, p.x, p.y - age * 60, p.size, p.color, 'center');
  }
  c.globalAlpha = 1;
  this.list = keep;
};

export function starText(n) {
  var s = '';
  for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}
