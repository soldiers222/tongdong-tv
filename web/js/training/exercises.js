// AI 动作训练 · 动作定义。摄像头在电视上方正前方，只看得到正面：
// 朝镜头的动作（下蹲、抬膝、冲拳）用「画面上变短、变高」来判断，侧面的动作（侧踹、侧平举）直接看。
// 每个动作：要点提示 cue、示范 demo（示范小人的关键帧，见 core/figure.js）、mock（模拟骨架，测试用），
// 计次动作给 measure / active / rest / quality；保持动作给 checks（逐条要点，第一条没做到的就是提示语）。
import * as B from '../core/body.js';
import { figure } from '../core/figure.js';

var SIDE = { left: '左', right: '右' };

function wave(t, period, phase) {
  var ph = ((t + (phase || 0)) % period) / period;
  return 0.5 - 0.5 * Math.cos(ph * 2 * Math.PI);
}

// 左右轮流：前半周期左边、后半周期右边
function alt(t, period) {
  var ph = (t % (period * 2)) / period;
  return ph < 1 ? { side: 'left', v: Math.sin(ph * Math.PI) } : { side: 'right', v: Math.sin((ph - 1) * Math.PI) };
}

function depth(kp, base) {
  var r = (B.thighRatio(kp, 'left') + B.thighRatio(kp, 'right')) / 2;
  var drop = base ? base.drop(kp) : null;
  return Math.max(B.clamp01((1 - r) / 0.7), drop == null ? 0 : B.clamp01(drop / 0.3));
}

function sideKnee(kp, s) { return B.clamp01((kp[s + '_hip'].y + B.shin(kp, s) - kp[s + '_knee'].y) / B.shin(kp, s)); }

export var EXERCISES = {
  // ---------------- 体能 ----------------
  squat: {
    id: 'squat', name: '深蹲', kind: 'rep', group: 'fit', need: B.LOWER,
    target: { '6-8': 10, '9-12': 15 },
    cue: '双脚与肩同宽，屁股往后坐，像要坐椅子，再站起来',
    measure: function (kp, base) { return { v: depth(kp, base), kp: kp }; },
    active: function (m, age) { return m.v >= (age === '6-8' ? 0.42 : 0.5); },
    rest: function (m) { return m.v <= 0.15; },
    better: function (a, b) { return !b || a.v > b.v; },
    quality: function (p, age) {
      if (p.v < (age === '6-8' ? 0.55 : 0.65)) return '再蹲低一点，大腿接近水平';
      var k = p.kp;
      if (Math.abs(k.left_knee.x - k.right_knee.x) < 0.75 * Math.abs(k.left_ankle.x - k.right_ankle.x)) return '膝盖朝着脚尖，别往里扣';
      return null;
    },
    demo: [{ arms: 'out' }, { arms: 'out', squat: 0.9 }],
    mock: function (t) { return figure({ squat: 0.95 * wave(t, 2200), arms: 'out' }); }
  },
  lunge: {
    id: 'lunge', name: '弓步蹲', kind: 'rep', group: 'fit', need: B.LOWER, alternate: true,
    target: { '6-8': 8, '9-12': 12 },
    cue: '一条腿往前迈一大步，身体往下沉，再收回来；左右腿轮流',
    // 正面看：前腿大腿朝镜头（画面上变短），后腿小腿朝后（画面上变短），两条腿的比值差得很远
    measure: function (kp, base) {
      var rl = B.thighRatio(kp, 'left'), rr = B.thighRatio(kp, 'right');
      var drop = base ? base.drop(kp) : null;
      var v = Math.max(B.clamp01((1 - Math.min(rl, rr)) / 0.7), drop == null ? 0 : B.clamp01(drop / 0.3));
      return { v: v, front: rl < rr ? 'left' : 'right', asym: Math.abs(rl - rr), kp: kp };
    },
    sideOf: function (p) { return p.front; },
    active: function (m) { return m.v >= 0.4; },
    rest: function (m) { return m.v <= 0.15; },
    better: function (a, b) { return !b || a.v > b.v; },
    quality: function (p) {
      if (p.v < 0.5) return '身体再往下沉一点';
      if (p.asym < 0.35) return '这是深蹲哦，一条腿往前迈一大步';
      return null;
    },
    demo: [{ arms: 'waist' }, { arms: 'waist', lungeLeft: 1 }, { arms: 'waist' }, { arms: 'waist', lungeRight: 1 }],
    mock: function (t) {
      var a = alt(t, 2200);
      var o = { arms: 'waist' };
      o[a.side === 'left' ? 'lungeLeft' : 'lungeRight'] = a.v;
      return figure(o);
    }
  },
  jacks: {
    id: 'jacks', name: '开合跳', kind: 'rep', group: 'coord', need: B.FULL,
    target: { '6-8': 15, '9-12': 25 },
    cue: '跳开时双手举过头顶，跳回时手放下、脚并拢',
    measure: function (kp) {
      var sw = B.shoulderW(kp);
      return {
        open: B.wristUp(kp, 'left') && B.wristUp(kp, 'right') && B.feetApart(kp) > 1.4 * sw,
        closed: kp.left_wrist.y > kp.left_shoulder.y && kp.right_wrist.y > kp.right_shoulder.y && B.feetApart(kp) < 1.15 * sw,
        armsHigh: B.wristUp(kp, 'left', 0.15) && B.wristUp(kp, 'right', 0.15)
      };
    },
    active: function (m) { return m.open; },
    rest: function (m) { return m.closed; },
    better: function (a, b) { return !b || (a.armsHigh && !b.armsHigh); },
    quality: function (p) { return p.armsHigh ? null : '手举高一点，在头顶拍一下'; },
    demo: [{ arms: 'down' }, { arms: 'up', spread: 1 }],
    mock: function (t) {
      var v = wave(t, 1300);
      return v > 0.5 ? figure({ arms: 'up', spread: 1.1 }) : figure({ arms: 'down' });
    }
  },
  highknees: {
    id: 'highknees', name: '高抬腿', kind: 'rep', group: 'coord', need: B.LOWER, sides: true, alternate: true,
    target: { '6-8': 20, '9-12': 30 },
    cue: '原地跑，膝盖抬到腰那么高，左右交替',
    measure: function (kp) {
      return { left: { v: sideKnee(kp, 'left') }, right: { v: sideKnee(kp, 'right') } };
    },
    active: function (m, age) { return m.v >= (age === '6-8' ? 0.55 : 0.65); },
    rest: function (m) { return m.v <= 0.3; },
    better: function (a, b) { return !b || a.v > b.v; },
    quality: function (p) { return p.v >= 0.8 ? null : '膝盖再抬高一点'; },
    demo: [{ liftLeft: 1, arms: 'chest' }, { arms: 'chest' }, { liftRight: 1, arms: 'chest' }, { arms: 'chest' }],
    mock: function (t) {
      var a = alt(t, 700);
      var o = { arms: 'chest' };
      o[a.side === 'left' ? 'liftLeft' : 'liftRight'] = a.v > 0.3 ? 1 : 0;
      return figure(o);
    }
  },
  crossknee: {
    id: 'crossknee', name: '交叉摸膝', kind: 'rep', group: 'coord', need: B.FULL, sides: true, alternate: true,
    target: { '6-8': 10, '9-12': 16 },
    cue: '抬起一边膝盖，用另一边的手去摸它，左右交替',
    measure: function (kp) {
      var tor = B.torso(kp);
      function one(hand) {
        var leg = B.other(hand);
        var up = sideKnee(kp, leg);
        var d = B.dist(kp[hand + '_wrist'], kp[leg + '_knee']) / tor;
        return { up: up, d: d };
      }
      return { left: one('left'), right: one('right') };
    },
    active: function (m) { return m.up >= 0.45 && m.d <= 0.55; },
    rest: function (m) { return m.up <= 0.3 || m.d >= 0.9; },
    quality: function () { return null; },
    demo: [{ arms: 'down' }, { liftRight: 0.8, leftHand: { x: 0.47, y: 0.66 } }, { arms: 'down' }, { liftLeft: 0.8, rightHand: { x: 0.53, y: 0.66 } }],
    mock: function (t) {
      var a = alt(t, 1200);
      if (a.v < 0.35) return figure({});
      var leg = a.side === 'left' ? 'Right' : 'Left'; // 左手摸右膝
      var o = {};
      o['lift' + leg] = 0.85;
      var p0 = figure(o);
      var k = p0[leg.toLowerCase() + '_knee'];
      o[a.side + 'Hand'] = { x: k.x, y: k.y - 0.01 };
      return figure(o);
    }
  },
  balanceT: {
    id: 'balanceT', name: '单脚平衡', kind: 'hold', group: 'balance', need: B.FULL, perSide: true,
    hold: { '6-8': 10000, '9-12': 20000 },
    cue: '一只脚站稳，另一只脚抬起来，两手侧平举，像飞机一样',
    checks: function (kp, side) {
      var lift = B.other(side);
      return [
        [B.footUp(kp, lift, 0.1), '把' + SIDE[lift] + '脚抬起来，' + SIDE[side] + '脚站稳'],
        [B.knee(kp, side) > 150, SIDE[side] + '腿站直'],
        [B.wristAtShoulder(kp, 'left', 0.45) && B.wristAtShoulder(kp, 'right', 0.45) && B.wristsApart(kp) > 2.1 * B.shoulderW(kp), '两手侧平举，像飞机翅膀']
      ];
    },
    demo: [{ arms: 'out', liftRight: 0.7 }],
    mock: function (t, side) {
      // 没指定哪边：先左脚站（抬右脚），13 秒后换右脚站
      var right = side ? side === 'right' : (t % 26000) > 13000;
      return figure(right ? { arms: 'out', liftLeft: 0.7, sway: 0.002 * Math.sin(t / 300) } : { arms: 'out', liftRight: 0.7, sway: 0.002 * Math.sin(t / 300) });
    }
  },

  // ---------------- 瑜伽 ----------------
  mountain: {
    id: 'mountain', name: '山式', kind: 'hold', group: 'yoga', need: B.FULL,
    hold: { '6-8': 8000, '9-12': 12000 },
    cue: '两脚并拢站直，双手向上伸，像一座高高的山',
    checks: function (kp) {
      return [
        [B.knee(kp, 'left') > 160 && B.knee(kp, 'right') > 160, '两腿站直'],
        [B.wristUp(kp, 'left') && B.wristUp(kp, 'right'), '两手举过头顶，往上伸'],
        [B.feetApart(kp) < 1.3 * B.shoulderW(kp), '两脚并拢一点']
      ];
    },
    demo: [{ arms: 'up' }],
    mock: function () { return figure({ arms: 'up' }); }
  },
  tree: {
    id: 'tree', name: '树式', kind: 'hold', group: 'yoga', need: B.FULL, perSide: true,
    hold: { '6-8': 10000, '9-12': 15000 },
    cue: '一只脚站稳，另一只脚贴在小腿或大腿内侧，膝盖朝外，双手合掌',
    checks: function (kp, side) {
      var lift = B.other(side);
      var handsTogether = B.dist(kp.left_wrist, kp.right_wrist) < 0.8 * B.shoulderW(kp);
      var handsPlace = (B.wristUp(kp, 'left') && B.wristUp(kp, 'right')) || (kp.left_wrist.y < B.hips(kp).y && kp.right_wrist.y < B.hips(kp).y);
      return [
        [B.footUp(kp, lift, 0.12), '把' + SIDE[lift] + '脚抬起来，贴在' + SIDE[side] + '腿内侧'],
        [Math.abs(kp[lift + '_knee'].x - kp[lift + '_hip'].x) > 0.45 * B.hipW(kp), SIDE[lift] + '膝盖朝外打开'],
        [B.knee(kp, side) > 155, SIDE[side] + '腿站直'],
        [handsTogether && handsPlace, '双手合掌，放在胸前或者举过头顶']
      ];
    },
    demo: [{ arms: 'top', footOnRight: true }],
    mock: function (t, side) {
      var right = side ? side === 'right' : (t % 26000) > 13000;
      return figure(right ? { arms: 'top', footOnLeft: true } : { arms: 'top', footOnRight: true });
    }
  },
  warrior2: {
    id: 'warrior2', name: '战士二式', kind: 'hold', group: 'yoga', need: B.FULL, perSide: true,
    hold: { '6-8': 10000, '9-12': 15000 },
    cue: '两脚分开一大步，一条腿屈膝，另一条腿伸直，两手侧平举',
    checks: function (kp, side) {
      var back = B.other(side);
      var sw = B.shoulderW(kp);
      return [
        [B.feetApart(kp) > 1.9 * sw, '两脚分开一大步'],
        [B.knee(kp, side) < 150, SIDE[side] + '腿膝盖弯下去，膝盖对着脚尖'],
        [B.knee(kp, back) > 155, SIDE[back] + '腿伸直'],
        [B.wristAtShoulder(kp, 'left', 0.45) && B.wristAtShoulder(kp, 'right', 0.45) && B.wristsApart(kp) > 2.3 * sw, '两手侧平举，往两边伸长']
      ];
    },
    demo: [{ arms: 'out', spread: 1.4, bendLeft: 1 }],
    mock: function (t, side) {
      var right = side ? side === 'right' : (t % 26000) > 13000;
      return figure(right ? { arms: 'out', spread: 1.4, bendRight: 1 } : { arms: 'out', spread: 1.4, bendLeft: 1 });
    }
  },
  star: {
    id: 'star', name: '星星式', kind: 'hold', group: 'yoga', need: B.FULL,
    hold: { '6-8': 8000, '9-12': 12000 },
    cue: '两脚分开，两手斜着向上伸，变成一颗大星星',
    checks: function (kp) {
      var sw = B.shoulderW(kp);
      return [
        [B.feetApart(kp) > 1.6 * sw, '两脚再分开一点'],
        [kp.left_wrist.y < kp.left_shoulder.y && kp.right_wrist.y < kp.right_shoulder.y && B.wristsApart(kp) > 2.3 * sw, '两手斜着向上伸开'],
        [B.knee(kp, 'left') > 155 && B.knee(kp, 'right') > 155, '两腿伸直']
      ];
    },
    demo: [{ arms: 'wide', spread: 1 }],
    mock: function () { return figure({ arms: 'wide', spread: 1.1 }); }
  },
  chair: {
    id: 'chair', name: '椅子式', kind: 'hold', group: 'yoga', need: B.FULL,
    hold: { '6-8': 8000, '9-12': 12000 },
    cue: '膝盖弯下去，像坐在一把看不见的椅子上，双手举高',
    checks: function (kp, side, age, base) {
      var d = depth(kp, base);
      return [
        [d >= 0.3, '膝盖再弯一点，像坐椅子'],
        [d <= 0.9, '不用蹲那么低'],
        [B.wristUp(kp, 'left') && B.wristUp(kp, 'right'), '两手举过头顶']
      ];
    },
    demo: [{ arms: 'up', squat: 0.5 }],
    mock: function () { return figure({ arms: 'up', squat: 0.55 }); }
  },

  // ---------------- 武术基本功（不和人对打，对着空气练） ----------------
  mabu: {
    id: 'mabu', name: '马步', kind: 'hold', group: 'wushu', need: B.FULL,
    hold: { '6-8': 10000, '9-12': 20000 },
    cue: '两脚分开两个肩宽，屈膝下蹲，背挺直，两拳抱在腰间',
    checks: function (kp, side, age, base) {
      var tor = B.torso(kp);
      var hy = B.hips(kp).y;
      return [
        [B.feetApart(kp) > 1.7 * B.shoulderW(kp), '两脚再分开一点，两个肩宽'],
        [depth(kp, base) >= 0.25, '屈膝往下蹲，像骑马一样'],
        [Math.abs(kp.left_wrist.y - hy) < 0.4 * tor && Math.abs(kp.right_wrist.y - hy) < 0.4 * tor, '两拳抱在腰间']
      ];
    },
    demo: [{ arms: 'waist', spread: 1.3, squat: 0.5 }],
    mock: function () { return figure({ arms: 'waist', spread: 1.35, squat: 0.55 }); }
  },
  punch: {
    id: 'punch', name: '马步冲拳', kind: 'rep', group: 'wushu', need: FULL_UPPER(), sides: true, alternate: true,
    target: { '6-8': 10, '9-12': 20 },
    cue: '拳从腰间往前冲出去，再快快收回来，左右交替（快出快收）',
    measure: function (kp) {
      var tor = B.torso(kp), sw = B.shoulderW(kp), c = B.shoulders(kp);
      function one(s) {
        var w = kp[s + '_wrist'];
        var o = B.other(s);
        return {
          out: Math.abs(w.y - kp[s + '_shoulder'].y) < 0.35 * tor && Math.abs(w.x - c.x) < 0.75 * sw,
          back: w.y > B.hips(kp).y - 0.3 * tor,
          guard: kp[o + '_wrist'].y > B.hips(kp).y - 0.35 * tor
        };
      }
      return { left: one('left'), right: one('right') };
    },
    active: function (m) { return m.out; },
    rest: function (m) { return m.back; },
    quality: function (p) { return p.guard ? null : '另一只手抱拳放在腰间'; },
    demo: [{ arms: 'waist', spread: 1.2, squat: 0.3, punchLeft: 1 }, { arms: 'waist', spread: 1.2, squat: 0.3 }, { arms: 'waist', spread: 1.2, squat: 0.3, punchRight: 1 }, { arms: 'waist', spread: 1.2, squat: 0.3 }],
    mock: function (t) {
      var a = alt(t, 900);
      var o = { arms: 'waist', spread: 1.2, squat: 0.3 };
      if (a.v > 0.4) o[a.side === 'left' ? 'punchLeft' : 'punchRight'] = 1;
      return figure(o);
    }
  },
  block: {
    id: 'block', name: '上架格挡', kind: 'rep', group: 'wushu', need: FULL_UPPER(), sides: true, alternate: true,
    target: { '6-8': 6, '9-12': 10 },
    cue: '双手护在脸前，一只小臂横着往上架过头顶，再收回来，左右交替',
    measure: function (kp) {
      var tor = B.torso(kp);
      var nose = kp.nose && kp.nose.s >= B.T ? kp.nose.y : B.shoulders(kp).y - 0.35 * tor;
      function one(s) {
        var w = kp[s + '_wrist'];
        return {
          up: w.y < nose - 0.2 * tor && kp[s + '_elbow'].y < kp[s + '_shoulder'].y,
          down: w.y > nose - 0.05 * tor
        };
      }
      return { left: one('left'), right: one('right') };
    },
    active: function (m) { return m.up; },
    rest: function (m) { return m.down; },
    quality: function () { return null; },
    demo: [{ arms: 'guard' }, { arms: 'guard', leftHand: { x: 0.56, y: 0.12 } }, { arms: 'guard' }, { arms: 'guard', rightHand: { x: 0.44, y: 0.12 } }],
    mock: function (t) {
      var a = alt(t, 1100);
      var o = { arms: 'guard' };
      // 手腕架到头顶上方（画面坐标），肘也在肩上方；另一只手护在脸前
      if (a.v >= 0.4) o[a.side + 'Hand'] = { x: a.side === 'left' ? 0.56 : 0.44, y: 0.13 };
      return figure(o);
    }
  },
  kneestrike: {
    id: 'kneestrike', name: '护头提膝', kind: 'rep', group: 'wushu', need: B.FULL, sides: true, alternate: true,
    target: { '6-8': 8, '9-12': 12 },
    cue: '双手护在脸前，膝盖向上提起再放下（泰拳的提膝，对着空气练）',
    measure: function (kp) {
      var guard = kp.left_wrist.y < kp.left_shoulder.y && kp.right_wrist.y < kp.right_shoulder.y;
      return { left: { v: sideKnee(kp, 'left'), guard: guard }, right: { v: sideKnee(kp, 'right'), guard: guard } };
    },
    active: function (m) { return m.v >= 0.6; },
    rest: function (m) { return m.v <= 0.3; },
    better: function (a, b) { return !b || a.v > b.v; },
    quality: function (p) { return p.guard ? null : '双手护在脸前'; },
    demo: [{ arms: 'guard', liftLeft: 1 }, { arms: 'guard' }, { arms: 'guard', liftRight: 1 }, { arms: 'guard' }],
    mock: function (t) {
      var a = alt(t, 1000);
      var o = { arms: 'guard' };
      if (a.v > 0.35) o[a.side === 'left' ? 'liftLeft' : 'liftRight'] = 1;
      return figure(o);
    }
  },
  sidekick: {
    id: 'sidekick', name: '侧踹', kind: 'rep', group: 'wushu', need: B.FULL, sides: true, alternate: true,
    target: { '6-8': 6, '9-12': 10 },
    cue: '先提膝，再把脚往侧面蹬出去，收回来站稳（散打的侧踹，不用踢高）',
    measure: function (kp) {
      function one(s) {
        var o = B.other(s);
        var leg = B.legLen(kp, o);
        var a = kp[s + '_ankle'];
        return {
          out: a.y < kp[s + '_hip'].y + 0.5 * leg && Math.abs(a.x - kp[s + '_hip'].x) > 0.4 * leg,
          back: a.y > kp[o + '_ankle'].y - 0.08 * leg
        };
      }
      return { left: one('left'), right: one('right') };
    },
    active: function (m) { return m.out; },
    rest: function (m) { return m.back; },
    quality: function () { return null; },
    demo: [{ arms: 'guard' }, { arms: 'guard', kickLeft: 1 }, { arms: 'guard' }, { arms: 'guard', kickRight: 1 }],
    mock: function (t) {
      var a = alt(t, 1300);
      var o = { arms: 'guard' };
      if (a.v > 0.45) o[a.side === 'left' ? 'kickLeft' : 'kickRight'] = 1;
      return figure(o);
    }
  },
  taichi: {
    id: 'taichi', name: '太极起势', kind: 'rep', group: 'wushu', need: FULL_UPPER(),
    target: { '6-8': 3, '9-12': 5 },
    cue: '两手慢慢抬到肩那么高，再慢慢按下去，膝盖微微弯（越慢越好）',
    measure: function (kp) {
      var h = B.hips(kp).y, s = B.shoulders(kp).y;
      var wy = (kp.left_wrist.y + kp.right_wrist.y) / 2;
      return { v: B.clamp01((h - wy) / Math.max(1, h - s)) };
    },
    active: function (m) { return m.v >= 0.8; },
    rest: function (m) { return m.v <= 0.25; },
    moving: function (m) { return m.v > 0.3; },
    quality: function (p, age, side, startT, t) {
      // 从开始抬手到按回去不到 2.4 秒：太快了
      if (startT !== null && t - startT < 2400) return '慢一点，像在水里推';
      return null;
    },
    demo: [{ arms: 'down', squat: 0.15 }, { leftHand: { x: 0.56, y: 0.33 }, rightHand: { x: 0.44, y: 0.33 }, squat: 0.15 }],
    mock: function (t) {
      var v = wave(t, 6000);
      // 手从腰下慢慢抬到肩高
      var y = 0.62 - 0.3 * v;
      return figure({ leftHand: { x: 0.56, y: y }, rightHand: { x: 0.44, y: y }, squat: 0.15 });
    }
  }
};

// 上半身动作也要看到髋（判断抱拳在腰间）
function FULL_UPPER() {
  return B.UPPER.concat(['left_hip', 'right_hip']);
}

// 课程：一串动作。sides：保持类动作左右各做一次
export var COURSES = {
  coord: {
    id: 'coord', name: '协调训练', group: 'coord',
    desc: '开合跳、高抬腿、交叉摸膝，练手脚配合',
    steps: [{ id: 'jacks' }, { id: 'highknees' }, { id: 'crossknee' }]
  },
  yoga: {
    id: 'yoga', name: '瑜伽小课', group: 'yoga',
    desc: '山式、树式、战士二式、星星式、椅子式',
    steps: [{ id: 'mountain' }, { id: 'tree', side: 'left' }, { id: 'tree', side: 'right' }, { id: 'warrior2', side: 'left' }, { id: 'warrior2', side: 'right' }, { id: 'star' }, { id: 'chair' }]
  },
  wushu: {
    id: 'wushu', name: '武术基本功', group: 'wushu',
    desc: '马步、冲拳、格挡、提膝、侧踹、太极起势',
    safety: true,
    steps: [{ id: 'mabu' }, { id: 'punch' }, { id: 'block' }, { id: 'kneestrike' }, { id: 'sidekick' }, { id: 'taichi' }]
  },
  // 单个动作也当成只有一步（或左右两步）的课程来跑
  squat: { id: 'squat', name: '深蹲', single: true, steps: [{ id: 'squat' }] },
  lunge: { id: 'lunge', name: '弓步蹲', single: true, steps: [{ id: 'lunge' }] },
  balanceT: { id: 'balanceT', name: '单脚平衡', single: true, steps: [{ id: 'balanceT', side: 'left' }, { id: 'balanceT', side: 'right' }] }
};

// 课程第一步开始前的安全提示（武术）
export var SAFETY = [
  '前后左右留出两大步的空地，远离桌角和电视',
  '只对着空气练，不打人、不踢人，也不对着家人练',
  '动作做到位比用力重要，膝盖和脚尖方向一致',
  '遇到危险先跑开、大声喊、找大人，不跟人打架'
];

export function sideName(s) { return SIDE[s] || ''; }
