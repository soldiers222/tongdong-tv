// 纯逻辑单元测试：node --test tests/unit/
import test from 'node:test';
import assert from 'node:assert/strict';

import { angleAt, distToSegment } from '../../web/js/core/geometry.js';
import { OneEuro } from '../../web/js/core/filters.js';
import { checkSpace, SpaceGate } from '../../web/js/core/space.js';
import { HandsUp } from '../../web/js/core/gestures.js';
import { toPixels, handTip, countVisible } from '../../web/js/core/keypoints.js';
import { skeleton, MOCK_SCRIPTS } from '../../web/js/pose/mock.js';
import { FruitWorld } from '../../web/js/games/fruit-logic.js';
import { BalanceJudge } from '../../web/js/training/balance-logic.js';
import { percentile, rng, fmtSec } from '../../web/js/core/util.js';

const FW = 1280, FH = 720;

test('几何：关节角与点到线段距离', () => {
  assert.equal(Math.round(angleAt({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })), 180);
  assert.equal(Math.round(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 90);
  assert.equal(distToSegment(5, 5, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(15, 0, 0, 0, 10, 0), 5);
});

test('One Euro 滤波：静止去抖、阶跃能跟上', () => {
  const f = new OneEuro(1.0, 0.01);
  let out = 0;
  for (let i = 0; i < 60; i++) out = f.filter(100 + (i % 2 ? 2 : -2), i / 30);
  assert.ok(Math.abs(out - 100) < 2, '抖动应被压小');
  for (let i = 60; i < 120; i++) out = f.filter(300, i / 30);
  assert.ok(Math.abs(out - 300) < 5, '阶跃后应收敛');
});

test('分位数与随机数可复现', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  const a = rng(7), b = rng(7);
  assert.equal(a(), b());
});

test('合成骨架：原始画面里身体左侧在画面右边', () => {
  const k = skeleton();
  assert.ok(k.left_shoulder.x > k.right_shoulder.x);
  assert.equal(countVisible(k), 17);
  const tip = handTip(toPixels(k, FW, FH), 'left');
  assert.ok(tip.y > k.left_wrist.y * FH, '手掌应在手腕延长线上（手臂下垂时更低）');
});

test('站位检测：全身合格 / 偏左 / 太远 / 看不到脚', () => {
  assert.equal(checkSpace(skeleton(), 'full', true).ok, true);
  // 原始画面人在右侧 → 镜像后在屏幕左侧 → 让他往右边走
  const r1 = checkSpace(skeleton({ cx: 0.85 }), 'full', true);
  assert.equal(r1.ok, false);
  assert.equal(r1.msg, '往右边走一点');
  const far = checkSpace(skeleton({ height: 0.3, foot: 0.7 }), 'full', true);
  assert.equal(far.code, 'far');
  const k = skeleton();
  k.left_ankle.s = 0.05;
  assert.equal(checkSpace(k, 'full', true).code, 'feet');
  assert.equal(checkSpace(null, 'full', true).code, 'none');
  assert.equal(checkSpace(skeleton(), 'upper', true).ok, true);
});

test('站位闸门：连续合格 0.9 秒才通过', () => {
  const g = new SpaceGate(900);
  const k = skeleton();
  assert.equal(g.update(k, 'full', true, 0).passed, false);
  assert.equal(g.update(k, 'full', true, 500).passed, false);
  assert.equal(g.update(k, 'full', true, 950).passed, true);
});

test('举起双手 1.5 秒触发一次', () => {
  const h = new HandsUp(1500);
  const up = skeleton({ handsUp: true });
  h.update(skeleton(), -100); // 先看到手放下
  assert.equal(h.update(up, 0).fire, false);
  assert.equal(h.update(up, 1600).fire, true);
  assert.equal(h.update(up, 1700).fire, false, '只触发一次');
  assert.equal(h.update(skeleton(), 1800).up, false);
});

function firstItem(w) {
  for (let i = 0; i < 2000 && !w.items.length; i++) w.update(16);
  return w.items[0];
}

test('切水果：快速挥过切中，慢速挥过不算', () => {
  const w = new FruitWorld({ age: '6-8', seed: 1 });
  const it = firstItem(w);
  assert.ok(it, '应生成水果');
  w.update(500);
  const t = w.t;
  const p = w.posAt(it, t);
  // 慢速：0.5 秒挥 200 像素 = 400 px/s，低于门槛
  let hits = w.blade('right', { x: p.x - 100, y: p.y, t: t - 500 }, { x: p.x + 100, y: p.y, t: t });
  assert.equal(hits.length, 0);
  // 快速：0.1 秒挥 300 像素 = 3000 px/s
  const pa = w.posAt(it, t - 100);
  hits = w.blade('right', { x: pa.x - 150, y: pa.y, t: t - 100 }, { x: p.x + 150, y: p.y, t: t });
  assert.equal(hits.length, 1);
  assert.equal(w.score, 1);
  const ev = w.drainEvents().filter(e => e.type === 'slice');
  assert.equal(ev.length, 1);
});

test('切水果：用水果在刀光那一刻的位置判定（延迟补偿）', () => {
  const w = new FruitWorld({ age: '9-12', seed: 3 });
  const it = firstItem(w);
  w.update(400);
  const tPast = w.t - 150;          // 识别结果晚到 150 毫秒
  const past = w.posAt(it, tPast);
  w.update(150);
  // 刀光经过水果 150 毫秒前的位置 → 仍应切中
  const hits = w.blade('left', { x: past.x - 200, y: past.y, t: tPast - 60 }, { x: past.x + 200, y: past.y, t: tPast });
  assert.equal(hits.length, 1);
});

test('交叉手星星：用错手不算并提示，用对手 +3', () => {
  const w = new FruitWorld({ age: '6-8', seed: 5 });
  w.nextSpawn = 1e12;
  w.nextStar = 0;
  w.update(16);
  const star = w.items.find(i => i.golden);
  assert.ok(star && star.needHand);
  const wrong = star.needHand === 'left' ? 'right' : 'left';
  w.update(400);
  const t = w.t, p = w.posAt(star, t), pa = w.posAt(star, t - 80);
  assert.equal(w.blade(wrong, { x: pa.x - 150, y: pa.y, t: t - 80 }, { x: p.x + 150, y: p.y, t }).length, 0);
  assert.ok(w.drainEvents().some(e => e.type === 'wrongHand'));
  assert.equal(w.blade(star.needHand, { x: pa.x - 150, y: pa.y, t: t - 80 }, { x: p.x + 150, y: p.y, t }).length, 1);
  assert.equal(w.score, 3);
  assert.equal(w.stars, 1);
});

test('一刀切 3 个水果算连切，加 3 分', () => {
  const w = new FruitWorld({ age: '9-12', seed: 9 });
  w.nextSpawn = 1e12;
  w.nextStar = 1e12;
  const a = w.spawn('apple'), b = w.spawn('orange'), c = w.spawn('kiwi');
  w.update(700);
  const t = w.t;
  // 把三个水果摆成一排，刀光一次扫过
  [a, b, c].forEach((it, i) => { it.x0 = 300 + i * 200; it.vx = 0; it.y0 = 300; it.vy = 0; it.g = 0; });
  const hits = w.blade('right', { x: 150, y: 300, t: t - 100 }, { x: 900, y: 300, t });
  assert.equal(hits.length, 3);
  w.update(400); // 超过 350 毫秒没有新刀光 → 结算连切
  const combo = w.drainEvents().find(e => e.type === 'combo');
  assert.ok(combo);
  assert.equal(combo.n, 3);
  assert.equal(w.score, 6);
  assert.equal(w.maxCombo, 3);
});

test('炸弹扣 5 分但不为负；漏掉水果计数；时间到结束', () => {
  const w = new FruitWorld({ age: '9-12', seed: 11, durationMs: 5000 });
  w.nextSpawn = 1e12;
  w.nextStar = 1e12;
  const bomb = w.spawn('bomb');
  w.update(300);
  const t = w.t, p = w.posAt(bomb, t), pa = w.posAt(bomb, t - 80);
  w.blade('left', { x: pa.x - 150, y: pa.y, t: t - 80 }, { x: p.x + 150, y: p.y, t });
  assert.equal(w.score, 0);
  assert.equal(w.bombsHit, 1);
  w.spawn('melon');
  for (let i = 0; i < 400 && !w.over; i++) w.update(16);
  assert.equal(w.missed, 1);
  assert.equal(w.over, true);
});

test('难度自适应：连续切中 8 个升一级', () => {
  const w = new FruitWorld({ age: '6-8', seed: 13 });
  for (let i = 0; i < 8; i++) w._resolve(true);
  assert.equal(w.level, 1);
  for (let i = 0; i < 8; i++) w._resolve(false);
  assert.equal(w.level, 0);
});

test('模拟挥手脚本 10 秒内能切中水果', () => {
  const w = new FruitWorld({ age: '6-8', seed: 21, durationMs: 15000 });
  const script = MOCK_SCRIPTS.fruit;
  let prev = null;
  for (let t = 0; t < 15000; t += 50) {
    w.update(50);
    const k = toPixels(script(t), FW, FH);
    // 画面镜像：x → 1280 - x
    const tip = handTip(k, 'right');
    const cur = { x: FW - tip.x, y: tip.y, t: w.t };
    if (prev) w.blade('right', prev, cur);
    prev = cur;
  }
  assert.ok(w.sliced >= 3, '切中 ' + w.sliced + ' 个');
});

function feed(judge, opts, t0, t1, step) {
  let st;
  for (let t = t0; t <= t1; t += step || 50) st = judge.update(toPixels(skeleton(opts(t)), FW, FH), t);
  return st;
}

test('金鸡独立：抬腿达标后计时，脚落地结束', () => {
  const j = new BalanceJudge({ stand: 'left', age: '6-8' });
  let st = feed(j, () => ({}), 0, 1000);
  assert.equal(st.phase, 'ready');
  assert.match(st.msg, /抬起来/);
  st = feed(j, (t) => ({ liftRight: 1, sway: 0.004 * Math.sin(t / 300) }), 1050, 7000);
  assert.equal(st.phase, 'hold');
  assert.ok(st.holdMs > 5000 && st.holdMs < 6000, 'holdMs=' + st.holdMs);
  st = feed(j, () => ({}), 7050, 7600);
  assert.equal(st.phase, 'done');
  assert.equal(st.result.reason, 'down');
  assert.ok(st.result.holdMs > 5200 && st.result.holdMs < 6100, 'result=' + st.result.holdMs);
  assert.ok(st.result.stars >= 1);
});

test('金鸡独立：膝盖抬不够时提示，不开始计时', () => {
  const j = new BalanceJudge({ stand: 'right', age: '9-12' });
  const st = feed(j, () => ({ liftLeft: 0.4 }), 0, 2000);
  assert.equal(st.phase, 'ready');
  assert.match(st.msg, /膝盖再抬高/);
});

test('金鸡独立：达到目标时间得满星', () => {
  const j = new BalanceJudge({ stand: 'left', age: '6-8', targetMs: 3000 });
  const st = feed(j, () => ({ liftRight: 1 }), 0, 4000);
  assert.equal(st.phase, 'done');
  assert.equal(st.result.reason, 'target');
  assert.equal(st.result.holdMs, 3000);
  assert.equal(st.result.stars, 3);
});

test('金鸡独立：身体大幅歪出去判失稳', () => {
  const j = new BalanceJudge({ stand: 'left', age: '6-8' });
  feed(j, () => ({ liftRight: 1 }), 0, 1500);
  const st = feed(j, () => ({ liftRight: 1, sway: 0.12 }), 1550, 2600);
  assert.equal(st.phase, 'done');
  assert.equal(st.result.reason, 'sway');
});

// ---------- 双人 ----------
import { screenPlayers, winnerOf, shownTenths, DUO } from '../../web/js/games/duo.js';

test('双人：站位按半边检查，各自提示往哪边走', () => {
  const [l, r] = MOCK_SCRIPTS.still2(0); // 摄像头画面左半边、右半边的人
  // 镜像：屏幕左边是摄像头画面右半边的人
  assert.equal(checkSpace(r, 'full', true, DUO[0].region).ok, true);
  assert.equal(checkSpace(l, 'full', true, DUO[1].region).ok, true);
  // 站错半边：屏幕左边的区域里看到的是右半边的人 → 要往（屏幕）右边挪的反方向
  const wrong = checkSpace(l, 'full', true, DUO[0].region);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'right');
  // 不给区域时同单人：人在中间才合格
  assert.equal(checkSpace(skeleton({}), 'full', true).ok, true);
  assert.equal(checkSpace(skeleton({ cx: 0.15 }), 'full', true).ok, false);
});

test('双人：识别结果按屏幕左右分给两个人', () => {
  const a = { tag: 'cam-left' }, b = { tag: 'cam-right' };
  assert.deepEqual(screenPlayers({ kps: [a, b] }, true), [b, a]);
  assert.deepEqual(screenPlayers({ kps: [a, b] }, false), [a, b]);
  assert.deepEqual(screenPlayers({ kps: [a, null] }, true), [null, a]);
  assert.deepEqual(screenPlayers({ kp: a }, true), [null, null]);
  assert.equal(winnerOf(3, 2), 'left');
  assert.equal(winnerOf(2, 3), 'right');
  assert.equal(winnerOf(2, 2), 'tie');
});

test('双人计时：按屏幕上显示的 0.1 秒比输赢，显示一样就是平局', () => {
  assert.equal(shownTenths(8740), 87);
  assert.equal(shownTenths(8760), 88);
  assert.equal(shownTenths(-50), 0);
  // 8.70 秒和 8.74 秒都显示 8.7：平局，不判一边赢
  assert.equal(winnerOf(shownTenths(8700), shownTenths(8740)), 'tie');
  assert.equal(winnerOf(shownTenths(8760), shownTenths(8700)), 'left');
  // 和显示用的 fmtSec 在 .x5 这种边界上取整一致
  for (const ms of [4850, 4950, 1250, 3350, 9999]) assert.equal(shownTenths(ms) / 10, Number(fmtSec(ms)));
});

test('双人：同一个随机种子两边出的水果一样', () => {
  const a = new FruitWorld({ W: 640, H: 720, age: '9-12', seed: 7 });
  const b = new FruitWorld({ W: 640, H: 720, age: '9-12', seed: 7 });
  for (let t = 0; t < 6000; t += 16) { a.update(16); b.update(16); }
  assert.ok(a.items.length > 0);
  assert.deepEqual(a.items.map((i) => [i.type, Math.round(i.x0)]), b.items.map((i) => [i.type, Math.round(i.x0)]));
  for (const it of a.items) assert.ok(it.x0 >= 0 && it.x0 <= 640, '水果从这半边里出来');
});
