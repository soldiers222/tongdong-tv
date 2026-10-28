// 合成骨架：模拟模式（?mock=fruit 等）和自动化测试用，不需要摄像头。
// 坐标按摄像头原始画面给出（未镜像）：人面对镜头，身体左侧出现在画面右边。
import { lerp, clamp } from '../core/util.js';
import { figure } from '../core/figure.js';
import { EXERCISES } from '../training/exercises.js';

var FW = 1280, FH = 720;

function pt(x, y, s) { return { x: x / FW, y: y / FH, s: s == null ? 0.92 : s }; }

// o: cx 身体中线(0–1)，height 头顶到脚底占画面比例，foot 脚底位置(0–1)，sway 左右偏移(0–1)，
//    liftLeft/liftRight 抬腿程度 0–1，leftHand/rightHand 手腕位置 {x,y}(0–1)，handsUp 双手举过头
export function skeleton(o) {
  o = o || {};
  var H = (o.height || 0.78) * FH;
  var cx = (o.cx == null ? 0.5 : o.cx) * FW + (o.sway || 0) * FW;
  var foot = (o.foot == null ? 0.95 : o.foot) * FH;
  var top = foot - H;
  function y(f) { return top + f * H; }
  var shHalf = 0.11 * H, hipHalf = 0.075 * H;
  var shY = y(0.19), hipY = y(0.52), kneeY = y(0.74), ankY = y(0.965);
  var p = {};
  p.nose = pt(cx, y(0.07));
  p.left_eye = pt(cx + 0.022 * H, y(0.055));
  p.right_eye = pt(cx - 0.022 * H, y(0.055));
  p.left_ear = pt(cx + 0.05 * H, y(0.065));
  p.right_ear = pt(cx - 0.05 * H, y(0.065));
  p.left_shoulder = pt(cx + shHalf, shY);
  p.right_shoulder = pt(cx - shHalf, shY);
  p.left_hip = pt(cx + hipHalf, hipY);
  p.right_hip = pt(cx - hipHalf, hipY);

  function arm(side, hand) {
    var sx = cx + side * shHalf;
    var wx, wy;
    if (o.handsUp) { wx = sx + side * 0.04 * H; wy = y(-0.04); }
    else if (hand) { wx = hand.x * FW; wy = hand.y * FH; }
    else { wx = sx + side * 0.04 * H; wy = y(0.47); }
    var ex = (sx + wx) / 2 + side * 0.05 * H, ey = (shY + wy) / 2 + 0.02 * H;
    var name = side > 0 ? 'left' : 'right';
    p[name + '_elbow'] = pt(ex, ey);
    p[name + '_wrist'] = pt(wx, wy);
  }
  arm(1, o.leftHand);
  arm(-1, o.rightHand);

  function leg(side, lift) {
    var hx = cx + side * hipHalf;
    var l = clamp(lift || 0, 0, 1);
    var ky = lerp(kneeY, hipY - 0.03 * H, l);
    var kx = hx - side * 0.02 * H * l;
    var ay = lerp(ankY, ky + 0.2 * H, l);
    var ax = kx - side * 0.01 * H * l;
    var name = side > 0 ? 'left' : 'right';
    p[name + '_knee'] = pt(kx, ky);
    p[name + '_ankle'] = pt(ax, ay);
  }
  leg(1, o.liftLeft);
  leg(-1, o.liftRight);
  return p;
}

function sweep(t) {
  var period = 1400;
  var ph = (t % period) / period;
  var x = ph < 0.3 ? lerp(0.22, 0.78, ph / 0.3) : lerp(0.78, 0.22, (ph - 0.3) / 0.7);
  var yv = 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(t / 900));
  return { x: x, y: yv };
}

export var MOCK_SCRIPTS = {
  still: function (t) {
    return skeleton({ sway: 0.003 * Math.sin(t / 700) });
  },
  fruit: function (t) {
    return skeleton({
      rightHand: sweep(t),
      leftHand: { x: 0.5 + 0.18 * Math.sin(t / 520), y: 0.3 + 0.08 * Math.cos(t / 610) }
    });
  },
  // 0–3 秒双脚站；3–9 秒左脚站抬右腿；9 秒落脚；14–20 秒右脚站抬左腿；20 秒落脚；
  // 结算页出来（约 23 秒）后先垂手，26 秒举双手（要先看到手放下，才认举手再来一局）
  balance: function (t) {
    var s = t / 1000;
    var sway = 0.005 * Math.sin(t / 320);
    if (s >= 3 && s < 9) return skeleton({ liftRight: 1, sway: sway });
    if (s >= 14 && s < 20) return skeleton({ liftLeft: 1, sway: sway });
    if (s >= 26) return skeleton({ handsUp: true });
    return skeleton({ sway: sway * 0.5 });
  },
  handsup: function () {
    return skeleton({ handsUp: true });
  },

  // 双人（返回 [画面左半边的人, 右半边的人]，摄像头原始画面坐标）
  still2: function (t) {
    return [
      skeleton({ cx: 0.27, height: 0.72, sway: 0.003 * Math.sin(t / 700) }),
      skeleton({ cx: 0.73, height: 0.7, sway: 0.003 * Math.sin(t / 650) })
    ];
  },
  fruit2: function (t) {
    function half(cx, tt) {
      var sw = sweep(tt);
      return skeleton({
        cx: cx,
        height: 0.72,
        rightHand: { x: cx + (sw.x - 0.5) * 0.42, y: sw.y },
        leftHand: { x: cx + 0.09 * Math.sin(tt / 520), y: 0.3 + 0.08 * Math.cos(tt / 610) }
      });
    }
    return [half(0.27, t), half(0.73, t + 500)];
  },
  // 左半边的人同单人脚本；右半边的人第一轮早 1 秒落脚、第二轮多站 1 秒
  balance2: function (t) {
    var s = t / 1000;
    var sway = 0.005 * Math.sin(t / 320);
    function one(cx, up1, down1, up2, down2) {
      var o = { cx: cx, height: 0.74, sway: sway };
      if (s >= 26) return skeleton({ cx: cx, height: 0.74, handsUp: true });
      if (s >= up1 && s < down1) o.liftRight = 1;
      else if (s >= up2 && s < down2) o.liftLeft = 1;
      else o.sway = sway * 0.5;
      return skeleton(o);
    }
    return [one(0.27, 3, 9, 14, 20), one(0.73, 3, 8, 14, 21)];
  },
  handsup2: function () {
    return [skeleton({ cx: 0.27, height: 0.72, handsUp: true }), skeleton({ cx: 0.73, height: 0.72 })];
  }
};

// ---------- 跟着游戏提示动的模拟骨架（自动化测试用） ----------
// 新玩法在模拟模式下把「现在该做什么」放在 window.__tdMockHint 里（双人时是数组，按屏幕从左到右），
// 下面的脚本照着做：训练做当前动作、跳舞摆小老师的姿势、摸球把手伸到球上、闪避站到空着的道。
function hintFor(i) {
  var h = typeof window !== 'undefined' ? window.__tdMockHint : null;
  if (Array.isArray(h)) return h[i] || null;
  return h || null;
}

function mirrored() {
  try { return !(window.TD && window.TD.store.settings().mirror === false); } catch (e) { return true; }
}

// 画布坐标（1280×720，已镜像）→ 摄像头原始画面坐标
function toCam(p) { return { x: mirrored() ? 1 - p.x / 1280 : p.x / 1280, y: p.y / 720 }; }

// 双人：屏幕左边的人在摄像头画面右半边（镜像时）
function duo(fn) {
  return function (t) {
    var a = fn(t, 0, 0.73), b = fn(t, 1, 0.27);
    var left = mirrored() ? b : a, right = mirrored() ? a : b; // [摄像头左半边, 右半边]
    return [left, right];
  };
}

function trainOne(t) {
  var h = hintFor(0);
  if (!h || !h.exercise || !EXERCISES[h.exercise]) return figure({ sway: 0.002 * Math.sin(t / 600) });
  return EXERCISES[h.exercise].mock(t, h.side || null);
}

function danceOne(t, i, cx) {
  var h = hintFor(i);
  var o = {};
  var pose = h && h.pose ? h.pose : {};
  for (var k in pose) o[k] = pose[k];
  if (cx != null) {
    o.cx = cx;
    o.height = 0.72;
    // 手的位置按身体中线平移过去
    ['leftHand', 'rightHand'].forEach(function (hk) { if (o[hk]) o[hk] = { x: o[hk].x - 0.5 + cx, y: o[hk].y }; });
  }
  return figure(o);
}

function moleOne(t, i, cx) {
  var h = hintFor(i);
  var o = cx != null ? { cx: cx, height: 0.72 } : {};
  var balls = h && h.balls ? h.balls.filter(function (b) { return b.kind !== 'bomb'; }) : [];
  if (balls.length) {
    var b = balls[0];
    var cam = toCam(b);
    // 「左」「右」球用指定的手；双手球两只手各摸一个；其他球用同一边的手
    if (b.kind === 'pair') {
      var mates = balls.filter(function (x) { return x.pair === b.pair; });
      var c0 = toCam(mates[0]), c1 = toCam(mates[1] || mates[0]);
      var lc = c0.x > c1.x ? c0 : c1, rc = c0.x > c1.x ? c1 : c0; // 孩子的左手在摄像头画面右边
      o.leftHand = lc;
      o.rightHand = rc;
    } else {
      var hand = b.need || (cam.x > (cx != null ? cx : 0.5) ? 'left' : 'right');
      o[hand + 'Hand'] = cam;
    }
  }
  return figure(o);
}

function dodgeOne(t, i, cx) {
  var h = hintFor(i) || {};
  var base = cx != null ? cx : 0.5;
  var lane = h.lane == null ? 1 : h.lane;
  // 屏幕上往左（0 号道）＝ 摄像头画面里往右（镜像时）
  var dx = (lane - 1) * 0.12 * (cx != null ? 0.8 : 1);
  var o = { cx: base + (mirrored() ? -dx : dx), arms: 'down' };
  if (cx != null) o.height = 0.72;
  if (h.duck) o.squat = 0.75;
  if (h.jump) o.jump = 0.16;
  return figure(o);
}

MOCK_SCRIPTS.train = trainOne;
MOCK_SCRIPTS.dance = function (t) { return danceOne(t, 0, null); };
MOCK_SCRIPTS.dance2 = duo(danceOne);
MOCK_SCRIPTS.mole = function (t) { return moleOne(t, 0, null); };
MOCK_SCRIPTS.mole2 = duo(moleOne);
MOCK_SCRIPTS.dodge = function (t) { return dodgeOne(t, 0, null); };
MOCK_SCRIPTS.dodge2 = duo(dodgeOne);
