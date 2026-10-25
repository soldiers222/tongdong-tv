// 合成骨架：模拟模式（?mock=fruit 等）和自动化测试用，不需要摄像头。
// 坐标按摄像头原始画面给出（未镜像）：人面对镜头，身体左侧出现在画面右边。
import { lerp, clamp } from '../core/util.js';

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
  // 0–3 秒双脚站；3–9 秒左脚站抬右腿；9 秒落脚；14–20 秒右脚站抬左腿；20 秒落脚；之后举双手
  balance: function (t) {
    var s = t / 1000;
    var sway = 0.005 * Math.sin(t / 320);
    if (s >= 3 && s < 9) return skeleton({ liftRight: 1, sway: sway });
    if (s >= 14 && s < 20) return skeleton({ liftLeft: 1, sway: sway });
    if (s >= 23) return skeleton({ handsUp: true });
    return skeleton({ sway: sway * 0.5 });
  },
  handsup: function () {
    return skeleton({ handsUp: true });
  }
};
