// 参数化的人形骨架：示范小人和模拟骨架（测试用）共用。
// 输出同识别引擎：0–1 归一化的摄像头画面坐标（未镜像：人面对镜头，身体左侧出现在画面右边）。
import { lerp, clamp } from './util.js';

function pt(x, y, fw, fh, s) { return { x: x / fw, y: y / fh, s: s == null ? 0.92 : s }; }

// o（都可省略）：
//   cx 身体中线（0–1），height 头顶到脚底占画面高度，foot 脚底位置（0–1），sway 左右偏移
//   squat 下蹲 0–1（1 ≈ 大腿水平），spread 两脚分开 0–1（1 ≈ 两倍肩宽），jump 整个人离地（占身高）
//   liftLeft / liftRight 抬膝 0–1（1 = 膝到髋高），kickLeft / kickRight 侧踹 0–1（腿伸向侧面）
//   lungeLeft / lungeRight 弓步 0–1（这条腿在前；前腿大腿朝镜头变短，后腿膝盖沉向地面、小腿朝后变短）
//   footOnLeft / footOnRight 树式：这只脚贴到另一条腿内侧，膝盖朝外
//   bendLeft / bendRight 单腿屈膝 0–1（战士式的前腿，膝盖朝外）
//   leftHand / rightHand 手腕位置 {x, y}（0–1），arms 预设手型：
//     'down' 垂手、'up' 举过头、'out' 侧平举、'wide' 斜上举、'waist' 抱拳在腰、'guard' 护头、
//     'chest' 合掌胸前、'top' 合掌头顶、'block' 双手上架；punchLeft / punchRight 冲拳 0–1
export function figure(o) {
  o = o || {};
  var FW = o.fw || 1280, FH = o.fh || 720;
  var H = (o.height || 0.78) * FH;
  var cx = ((o.cx == null ? 0.5 : o.cx) + (o.sway || 0)) * FW;
  var foot = (o.foot == null ? 0.95 : o.foot) * FH - (o.jump || 0) * H;
  var squat = clamp(o.squat || 0, 0, 1);
  var lungeL = clamp(o.lungeLeft || 0, 0, 1), lungeR = clamp(o.lungeRight || 0, 0, 1);
  var sink = squat * 0.17 * H + Math.max(lungeL, lungeR) * 0.14 * H;
  var top = foot - H;
  function y(f) { return top + f * H; }
  var shHalf = 0.11 * H, hipHalf = 0.075 * H;
  var thigh = 0.22 * H, shin = 0.225 * H;
  var hipY = y(0.52) + sink;
  var shY = y(0.19) + sink;
  var headY = y(0.07) + sink;
  var p = {};
  p.nose = pt(cx, headY, FW, FH);
  p.left_eye = pt(cx + 0.022 * H, headY - 0.015 * H, FW, FH);
  p.right_eye = pt(cx - 0.022 * H, headY - 0.015 * H, FW, FH);
  p.left_ear = pt(cx + 0.05 * H, headY - 0.005 * H, FW, FH);
  p.right_ear = pt(cx - 0.05 * H, headY - 0.005 * H, FW, FH);
  p.left_shoulder = pt(cx + shHalf, shY, FW, FH);
  p.right_shoulder = pt(cx - shHalf, shY, FW, FH);
  p.left_hip = pt(cx + hipHalf, hipY, FW, FH);
  p.right_hip = pt(cx - hipHalf, hipY, FW, FH);

  // 腿：side = 1 是孩子的左腿（画面右边）
  var spread = o.spread || 0;
  function leg(side, name) {
    var hx = cx + side * hipHalf;
    var ankX = hx + side * spread * 0.16 * H;
    var ankY = foot - 0.035 * H;
    var lift = clamp(o['lift' + name] || 0, 0, 1);
    var kick = clamp(o['kick' + name] || 0, 0, 1);
    var bend = clamp(o['bend' + name] || 0, 0, 1);
    var onLeg = !!o['footOn' + name];
    var front = name === 'Left' ? lungeL : lungeR, back = name === 'Left' ? lungeR : lungeL;
    var kx, ky, ax, ay;
    if (front > 0) {
      // 弓步前腿：脚往前（离镜头近，画面上稍低），大腿朝镜头，画面上变短
      ax = hx + side * 0.01 * H;
      ay = ankY + 0.03 * H * front;
      kx = ax + side * 0.01 * H;
      ky = hipY + lerp(0.2225, 0.07, front) * H;
    } else if (back > 0) {
      // 弓步后腿：膝盖沉向地面，脚在后面（离镜头远，画面上稍高），小腿朝后，画面上变短
      ax = hx;
      ay = ankY - 0.04 * H * back;
      kx = hx;
      ky = hipY + lerp(0.2225, 0.2, back) * H;
    } else if (kick > 0) {
      // 侧踹：腿向侧面伸出，脚抬到接近髋高
      kx = hx + side * lerp(0.03, 0.16, kick) * H;
      ky = lerp(hipY + thigh * 0.95, hipY + thigh * 0.15, kick);
      ax = hx + side * lerp(0.05, 0.4, kick) * H;
      ay = lerp(ankY, hipY + 0.06 * H, kick);
    } else if (onLeg) {
      // 树式：脚贴另一条腿内侧，膝盖朝外
      kx = hx + side * 0.13 * H;
      ky = hipY + thigh * 0.6;
      ax = cx - side * 0.01 * H;
      ay = hipY + thigh * 0.9;
    } else if (lift > 0) {
      // 抬膝（朝镜头抬，画面上膝盖往上走）
      kx = hx - side * 0.02 * H * lift;
      ky = lerp(hipY + thigh * 0.98, hipY - 0.03 * H, lift);
      ax = kx - side * 0.01 * H * lift;
      ay = lerp(ankY, ky + 0.2 * H, lift);
    } else if (bend > 0) {
      // 单腿屈膝，膝盖朝外（战士二式的前腿）
      ax = ankX;
      ay = ankY;
      kx = lerp((hx + ankX) / 2, ankX + side * 0.02 * H, bend);
      ky = lerp((hipY + ankY) / 2, hipY + 0.05 * H, bend * 0.75);
    } else {
      // 站立或下蹲：下蹲时髋往下沉，膝盖往外一点（大腿朝镜头，画面上变短）；
      // 两脚分得很开再蹲（马步）：膝盖在脚踝正上方，小腿竖直，大腿斜着往外
      ax = ankX;
      ay = ankY;
      kx = lerp((hx + ax) / 2 + side * squat * 0.045 * H, ax - side * 0.01 * H, clamp(spread * squat * 2, 0, 1));
      ky = lerp((hipY + ay) / 2, ay - shin * 0.92, squat);
    }
    p[name.toLowerCase() + '_knee'] = pt(kx, ky, FW, FH);
    p[name.toLowerCase() + '_ankle'] = pt(ax, ay, FW, FH);
  }
  leg(1, 'Left');
  leg(-1, 'Right');

  // 手臂
  var preset = o.arms || 'down';
  function hand(side, name) {
    var sx = cx + side * shHalf;
    var explicit = o[name.toLowerCase() + 'Hand'];
    var punch = clamp(o['punch' + name] || 0, 0, 1);
    var wx, wy;
    if (explicit) { wx = explicit.x * FW; wy = explicit.y * FH; }
    else if (punch > 0) {
      // 冲拳（朝镜头）：拳从腰间送到胸前正中、肩高
      wx = lerp(sx + side * 0.02 * H, cx + side * 0.02 * H, punch);
      wy = lerp(hipY - 0.02 * H, shY + 0.02 * H, punch);
    } else if (preset === 'up') { wx = sx + side * 0.04 * H; wy = y(-0.04) + squat * 0.17 * H; }
    else if (preset === 'out') { wx = sx + side * 0.36 * H; wy = shY + 0.01 * H; }
    else if (preset === 'wide') { wx = sx + side * 0.3 * H; wy = shY - 0.2 * H; }
    else if (preset === 'waist') { wx = sx + side * 0.01 * H; wy = hipY - 0.02 * H; }
    else if (preset === 'guard') { wx = cx + side * 0.06 * H; wy = headY + 0.03 * H; }
    else if (preset === 'chest') { wx = cx + side * 0.015 * H; wy = shY + 0.08 * H; }
    else if (preset === 'top') { wx = cx + side * 0.015 * H; wy = headY - 0.13 * H; }
    else if (preset === 'block') { wx = cx + side * 0.13 * H; wy = headY - 0.1 * H; }
    else { wx = sx + side * 0.04 * H; wy = hipY - 0.05 * H; }
    // 肘：在肩和手腕之间，往外弯一点
    var ex = (sx + wx) / 2 + side * 0.05 * H, ey = (shY + wy) / 2 + 0.02 * H;
    if (preset === 'out' && !explicit && !punch) { ex = (sx + wx) / 2; ey = shY + 0.005 * H; }
    p[name.toLowerCase() + '_elbow'] = pt(ex, ey, FW, FH);
    p[name.toLowerCase() + '_wrist'] = pt(wx, wy, FW, FH);
  }
  hand(1, 'Left');
  hand(-1, 'Right');
  return p;
}

// 两组参数之间插值（数字插值，其他取前一组），做示范动画用
export function blend(a, b, f) {
  var out = {};
  var k;
  for (k in a) out[k] = a[k];
  for (k in b) {
    if (typeof b[k] === 'number' && typeof a[k] === 'number') out[k] = a[k] + (b[k] - a[k]) * f;
    else if (typeof b[k] === 'number' && a[k] == null) out[k] = b[k] * f;
    else if (f >= 0.5) out[k] = b[k];
  }
  for (k in a) {
    if (typeof a[k] === 'number' && b[k] == null) out[k] = a[k] * (1 - f);
  }
  return out;
}

// 按关键帧循环播放：frames 是参数数组，period 一轮毫秒数（帧之间平滑过渡，每帧停一会儿）
export function animate(frames, period, t) {
  if (!frames || !frames.length) return {};
  if (frames.length === 1) return frames[0];
  var n = frames.length;
  var ph = ((t % period) + period) % period / period * n;
  var i = Math.floor(ph), f = ph - i;
  var e = f < 0.3 ? 0 : (f > 0.85 ? 1 : (f - 0.3) / 0.55);
  e = e * e * (3 - 2 * e);
  return blend(frames[i], frames[(i + 1) % n], e);
}

// ---------- 画示范小人 ----------
var LIMBS = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
];

// 关键帧之间动得多的肢体（示范时用黄色标出来，孩子一眼看出要动哪里）
export function movingLimbs(frames) {
  var out = {};
  if (!frames || frames.length < 2) return out;
  var pts = frames.map(function (f) { return figure(f); });
  for (var i = 0; i < LIMBS.length; i++) {
    var b = LIMBS[i][1];
    var mx = 0;
    for (var a = 0; a < pts.length; a++) {
      for (var c = a + 1; c < pts.length; c++) {
        var dx = (pts[a][b].x - pts[c][b].x) * 1280, dy = (pts[a][b].y - pts[c][b].y) * 720;
        mx = Math.max(mx, Math.sqrt(dx * dx + dy * dy));
      }
    }
    if (mx > 40) out[LIMBS[i][0] + '|' + b] = true;
  }
  // 小臂、小腿动了，大臂、大腿一起标
  for (var k = 0; k < LIMBS.length; k += 2) {
    var upper = LIMBS[k][0] + '|' + LIMBS[k][1], lower = LIMBS[k + 1][0] + '|' + LIMBS[k + 1][1];
    if (out[lower]) out[upper] = true;
  }
  return out;
}

// kp：figure() 的输出；box：画在画布的哪个框里 {x, y, w, h}；
// opts.mirror 和孩子看到的镜子画面同向；opts.hi 要标黄的肢体；opts.width 线宽
export function drawFigure(c, kp, box, opts) {
  opts = opts || {};
  var s = box.h / 640;
  var mir = opts.mirror ? -1 : 1;
  function P(name) {
    var p = kp[name];
    return { x: box.x + box.w / 2 + (p.x * 1280 - 640) * s * mir, y: box.y + (p.y * 720 - 70) * s };
  }
  var w = opts.width || Math.max(6, box.h * 0.04);
  var body = opts.color || '#F7F5EF', hiColor = opts.hiColor || '#FFC928', ink = 'rgba(10,18,36,0.6)';
  var hi = opts.hi || {};
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  var ls = P('left_shoulder'), rs = P('right_shoulder'), lh = P('left_hip'), rh = P('right_hip');
  // 躯干：一块实心的梯形
  function torso(stroke, lw) {
    c.beginPath();
    c.moveTo(ls.x, ls.y); c.lineTo(rs.x, rs.y); c.lineTo(rh.x, rh.y); c.lineTo(lh.x, lh.y);
    c.closePath();
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.stroke();
  }
  torso(ink, w * 1.2 + 6);
  for (var i = 0; i < LIMBS.length; i++) {
    var a = P(LIMBS[i][0]), b = P(LIMBS[i][1]);
    c.strokeStyle = ink;
    c.lineWidth = w + 6;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  }
  torso(body, w * 1.2);
  c.fillStyle = body;
  c.fill();
  for (var j = 0; j < LIMBS.length; j++) {
    var p = P(LIMBS[j][0]), q = P(LIMBS[j][1]);
    c.strokeStyle = hi[LIMBS[j][0] + '|' + LIMBS[j][1]] ? hiColor : body;
    c.lineWidth = w;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
  }
  // 头
  var n = P('nose');
  var sh = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  var r = Math.max(w * 1.1, Math.abs(ls.x - rs.x) * 0.3);
  c.strokeStyle = ink;
  c.lineWidth = w + 6;
  c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(n.x, n.y + r * 0.6); c.stroke();
  c.strokeStyle = body;
  c.lineWidth = w;
  c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(n.x, n.y + r * 0.6); c.stroke();
  c.beginPath();
  c.arc(n.x, n.y - r * 0.15, r, 0, Math.PI * 2);
  c.fillStyle = body;
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = ink;
  c.stroke();
  c.restore();
}
