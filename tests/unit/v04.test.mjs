// 0.4.0 新增逻辑的单元测试：示范小人、站立基准、AI 动作训练判定、敏捷摸球、闪避、跟跳打分、舞曲、成长中心
import test from 'node:test';
import assert from 'node:assert/strict';

import { figure, blend, animate, movingLimbs } from '../../web/js/core/figure.js';
import * as B from '../../web/js/core/body.js';
import { EXERCISES, COURSES } from '../../web/js/training/exercises.js';
import { makeJudge, RepJudge } from '../../web/js/training/exercise-logic.js';
import { MoleWorld } from '../../web/js/games/mole-logic.js';
import { DodgeWorld, LaneTracker } from '../../web/js/games/dodge-logic.js';
import { ROUTINES, MOVES, timeline, uniqueMoves } from '../../web/js/dance/routines.js';
import { DanceJudge, coachPose, targetPx, similarity, weightsFor, tipFor, gradeOf } from '../../web/js/dance/dance-logic.js';
import { compile, midi } from '../../web/js/core/music.js';
import { ratingOf, dailyTasks, taskStatus, planet, streaks, BADGES, afterSession, TASKS } from '../../web/js/core/growth.js';
import { HandsUp } from '../../web/js/core/gestures.js';
import { skeleton } from '../../web/js/pose/mock.js';
import { dayKey } from '../../web/js/core/util.js';

const px = (kp) => { const o = {}; for (const k in kp) o[k] = { x: kp[k].x * 1280, y: kp[k].y * 720, s: kp[k].s }; return o; };
const stand = () => px(figure({}));

function standingBase(n) {
  const b = new B.Baseline();
  for (let i = 0; i < (n || 20); i++) b.add(stand());
  return b;
}

// ---------- 示范小人 ----------
test('示范小人：孩子的左边在摄像头画面右边，下蹲时髋往下沉', () => {
  const f = figure({});
  assert.ok(f.left_shoulder.x > f.right_shoulder.x);
  assert.ok(f.left_hip.x > 0.5 && f.right_hip.x < 0.5);
  const sq = figure({ squat: 1 });
  assert.ok(sq.left_hip.y > f.left_hip.y + 0.1, '蹲下髋变低');
  const up = figure({ arms: 'up' });
  assert.ok(up.left_wrist.y < up.nose.y && up.right_wrist.y < up.nose.y, '举手过头');
});

test('示范小人：关键帧插值和动起来的肢体', () => {
  const m = blend({ squat: 0 }, { squat: 1 }, 0.5);
  assert.equal(m.squat, 0.5);
  assert.deepEqual(animate([{ arms: 'down' }], 1000, 400), { arms: 'down' });
  const hi = movingLimbs([{ arms: 'down' }, { arms: 'up' }]);
  assert.ok(hi['left_elbow|left_wrist'] && hi['left_shoulder|left_elbow'], '手臂动了');
  assert.ok(!hi['left_knee|left_ankle'], '腿没动');
});

// ---------- 站立基准 ----------
test('站立基准：半蹲不算站立；往前走一步不会被当成下蹲；跳起来 rise 为正', () => {
  const b = standingBase(20);
  assert.ok(b.ready());
  assert.ok(Math.abs(b.drop(stand())) < 0.02);
  const chair = px(figure({ squat: 0.55 }));
  for (let i = 0; i < 60; i++) b.add(chair); // 半蹲一直不起来
  assert.ok(b.drop(chair) > 0.15, '半蹲时 drop 仍然明显：' + b.drop(chair));
  const deep = px(figure({ squat: 1 }));
  assert.ok(b.drop(deep) > 0.3, '深蹲 drop：' + b.drop(deep));
  // 往前走：人在画面里变大、往下挪，比例不变
  const near = px(figure({ height: 0.86, foot: 0.99 }));
  assert.ok(Math.abs(b.drop(near)) < 0.03, '往前走一步 drop 接近 0：' + b.drop(near));
  const jump = px(figure({ jump: 0.15 }));
  assert.ok(b.rise(jump) > 0.1, '跳起来 rise：' + b.rise(jump));
});

// ---------- AI 动作训练 ----------
function runEx(id, side, age, fn, ms, base) {
  const j = makeJudge(EXERCISES[id], { age, side, base: base || standingBase(20) });
  let s, tips = [];
  for (let t = 0; t < ms; t += 40) {
    s = j.update(px(fn(t)), t + 1000);
    for (const e of s.events) if (e.tip) tips.push(e.tip);
    if (s.done) break;
  }
  return { r: j.result(), s, tips };
}

test('训练：每个动作照着示范做都能完成，站着不动不算', () => {
  for (const age of ['6-8', '9-12']) {
    for (const id in EXERCISES) {
      const def = EXERCISES[id];
      const sides = def.perSide ? ['left', 'right'] : [null];
      for (const side of sides) {
        const ok = runEx(id, side, age, (t) => def.mock(t, side), 70000);
        if (def.kind === 'rep') {
          assert.equal(ok.r.reps, ok.r.target, `${age} ${id} 次数`);
          assert.equal(ok.r.stars, 3, `${age} ${id} 星级`);
        } else {
          assert.equal(ok.r.reason, 'target', `${age} ${id} ${side} 保持到时间`);
        }
        const still = runEx(id, side, age, () => figure({}), 6000);
        if (def.kind === 'rep') assert.equal(still.r.reps, 0, `${id} 站着不算`);
        else assert.ok(still.r.holdMs < 300, `${id} 站着不计时`);
      }
    }
  }
});

test('训练：没有站立基准也能数深蹲（只看大腿在画面上变短）', () => {
  const r = runEx('squat', null, '6-8', EXERCISES.squat.mock, 40000, new B.Baseline());
  assert.equal(r.r.reps, 10);
});

test('训练：蹲得太浅提醒，弓步总用同一条腿提醒换边，太极做太快提醒慢一点', () => {
  const shallow = runEx('squat', null, '9-12', (t) => figure({ squat: 0.45 * (0.5 - 0.5 * Math.cos(t / 2200 * 2 * Math.PI)), arms: 'out' }), 30000);
  assert.ok(shallow.r.reps > 0 && shallow.r.good === 0, '浅蹲算次数但不算做对');
  assert.ok(shallow.tips.some((x) => /蹲低/.test(x)));
  const sameLeg = runEx('lunge', null, '6-8', (t) => figure({ arms: 'waist', lungeLeft: 0.5 - 0.5 * Math.cos(t / 2200 * 2 * Math.PI) }), 30000);
  assert.ok(sameLeg.tips.indexOf('换另一边') >= 0, '提醒换边：' + sameLeg.tips.join(','));
  const fast = runEx('taichi', null, '6-8', (t) => {
    const v = 0.5 - 0.5 * Math.cos(t / 1200 * 2 * Math.PI);
    const y = 0.62 - 0.3 * v;
    return figure({ leftHand: { x: 0.56, y }, rightHand: { x: 0.44, y }, squat: 0.15 });
  }, 20000);
  assert.ok(fast.tips.some((x) => /慢一点/.test(x)), '太极太快：' + fast.tips.join(','));
});

test('训练：计次动作超时按做了多少算', () => {
  const j = new RepJudge(EXERCISES.squat, { age: '6-8', limitMs: 2000 });
  let s;
  for (let t = 0; t <= 2100; t += 40) s = j.update(stand(), t);
  assert.ok(s.done);
  assert.equal(j.result().reason, 'time');
  assert.equal(j.result().stars, 0);
});

test('训练：课程里的动作都存在', () => {
  for (const id in COURSES) for (const st of COURSES[id].steps) assert.ok(EXERCISES[st.id], id + ' → ' + st.id);
});

// ---------- 敏捷摸球 ----------
const BODY = { x: 640, y: 300, reach: 190, head: { x: 640, y: 220 } };

test('摸球：出球在够得着的地方，摸到得分，漏掉算没摸到', () => {
  const w = new MoleWorld({ age: '6-8', seed: 3 });
  for (let i = 0; i < 100 && !w.balls.length; i++) w.update(16, {}, BODY);
  const b = w.balls[0];
  assert.ok(b, '出球了');
  const d = Math.hypot(b.x - BODY.x, b.y - BODY.y);
  assert.ok(d > BODY.reach * 0.5 && d < BODY.reach * 1.25, '距离 ' + d);
  const hand = b.need || 'left';
  w.update(16, { [hand]: { x: b.x, y: b.y } }, BODY);
  const ev = w.drainEvents();
  assert.ok(ev.some((e) => e.type === 'hit'), JSON.stringify(ev));
  assert.ok(w.score >= 10);
  // 不摸：等球过期
  for (let i = 0; i < 400; i++) w.update(16, {}, BODY);
  assert.ok(w.misses > 0);
});

test('摸球：写着「左」「右」的球用错手不算；双手球要两只手一起；炸弹扣分', () => {
  const w = new MoleWorld({ age: '9-12', seed: 5 });
  w.balls = [{ id: 1, kind: 'hand', need: 'left', x: 500, y: 200, r: 42, born: 0, life: 3000, wrongT: -1e9 }];
  w.update(16, { right: { x: 500, y: 200 } }, BODY);
  assert.ok(w.drainEvents().some((e) => e.type === 'wrongHand'));
  assert.equal(w.hits, 0);
  w.update(16, { left: { x: 500, y: 200 } }, BODY);
  assert.equal(w.hits, 1);
  w.balls = [
    { id: 2, pair: 9, kind: 'pair', x: 450, y: 250, r: 42, born: w.t, life: 3000, touchT: null },
    { id: 3, pair: 9, kind: 'pair', x: 830, y: 250, r: 42, born: w.t, life: 3000, touchT: null }
  ];
  w.update(16, { left: { x: 450, y: 250 } }, BODY);
  assert.equal(w.hits, 1, '只摸一个不算');
  w.update(16, { left: { x: 450, y: 250 }, right: { x: 830, y: 250 } }, BODY);
  assert.equal(w.hits, 2, '两只手一起算');
  const before = w.score;
  w.balls = [{ id: 4, kind: 'bomb', x: 600, y: 200, r: 42, born: w.t, life: 3000 }];
  w.update(16, { left: { x: 600, y: 200 } }, BODY);
  assert.equal(w.score, Math.max(0, before - 10));
  assert.equal(w.bombsHit, 1);
});

test('摸球：连续摸中加快，时间到结束并给星级', () => {
  const w = new MoleWorld({ age: '6-8', seed: 7, durationMs: 30000 });
  const iv = w.interval;
  while (!w.over) {
    const hands = {};
    if (w.balls.length) {
      const b = w.balls.find((x) => x.kind !== 'bomb');
      if (b && b.kind === 'pair') {
        const m = w.balls.filter((x) => x.pair === b.pair);
        hands.left = { x: m[0].x, y: m[0].y };
        hands.right = { x: m[1].x, y: m[1].y };
      } else if (b) hands[b.need || 'left'] = { x: b.x, y: b.y };
    }
    w.update(16, hands, BODY);
  }
  const r = w.result();
  assert.ok(r.hits >= 12 && r.misses === 0, JSON.stringify(r));
  assert.ok(w.interval < iv, '加快了');
  assert.equal(r.stars, 3);
});

// ---------- 闪避 ----------
function playDodge(variant, policy, ms) {
  const w = new DodgeWorld({ variant, age: '9-12', seed: 11, durationMs: ms || 40000 });
  while (!w.over) w.update(16, policy(w));
  return w;
}

function smartPolicy(w) {
  let next = null;
  for (const o of w.objects) if (!o.judged && o.kind !== 'coin' && (!next || o.arrive < next.arrive)) next = o;
  if (!next) return { lane: 1 };
  const dt = next.arrive - w.t;
  if (next.kind === 'laser') return { lane: 1, duck: dt < 300 };
  if (next.kind === 'bar') return { lane: 1, air: dt < 120 && dt > -100 };
  const blocked = {};
  for (const o of w.objects) if (o.kind === 'block' && !o.judged && Math.abs(o.arrive - next.arrive) < 50) blocked[o.lane] = true;
  for (let l = 0; l < 3; l++) if (!blocked[l]) return { lane: l };
  return { lane: 1 };
}

test('闪避：会躲的人撑到最后不被撞，站着不动会被撞到没命', () => {
  for (const v of ['side', 'space']) {
    const good = playDodge(v, smartPolicy);
    const r = good.result();
    assert.ok(r.survived && r.hits === 0 && r.dodged > 10, v + ' ' + JSON.stringify(r));
    assert.equal(r.stars, 3);
    const lazy = playDodge(v, () => ({ lane: 1 }));
    assert.ok(lazy.result().hits >= 1, v + ' 站着不动会被撞');
  }
});

test('闪避：激光不蹲、能量栏不跳都算撞到；被撞后短暂无敌', () => {
  const w = new DodgeWorld({ variant: 'space', age: '6-8', seed: 1 });
  w.nextSpawn = 1e9;
  w.objects.push({ kind: 'laser', lane: null, t0: 0, arrive: 500, judged: false });
  w.objects.push({ kind: 'bar', lane: null, t0: 0, arrive: 900, judged: false });
  for (let t = 0; t < 1300; t += 16) w.update(16, { lane: 1 });
  assert.equal(w.hitsTaken, 1, '第二下在无敌时间里');
  assert.equal(w.lives, 2);
  const w2 = new DodgeWorld({ variant: 'space', age: '6-8', seed: 1 });
  w2.nextSpawn = 1e9;
  w2.objects.push({ kind: 'laser', lane: null, t0: 0, arrive: 500, judged: false });
  for (let t = 0; t < 900; t += 16) w2.update(16, { lane: 1, duck: w2.t > 350 && w2.t < 600 });
  assert.equal(w2.hitsTaken, 0);
  assert.equal(w2.dodged, 1);
});

test('闪避：站位换道有迟滞，抖一下不会来回跳', () => {
  const L = new LaneTracker();
  L.calibrate(640, 120);
  assert.equal(L.update(640), 1);
  assert.equal(L.update(640 - 0.7 * 120), 1, '跨得不够还在中间');
  assert.equal(L.update(640 - 0.9 * 120), 0);
  assert.equal(L.update(640 - 0.6 * 120), 0, '稍微回来一点还在左边');
  assert.equal(L.update(640 - 0.3 * 120), 1);
  assert.equal(L.update(640 + 1.0 * 120), 2);
});

// ---------- 跟跳练舞 ----------
test('跳舞：每支舞正好填满音乐，舞步都有名字和要点', () => {
  for (const id in ROUTINES) {
    const r = ROUTINES[id];
    const beats = r.moves.reduce((n, m) => n + MOVES[m].beats, 0);
    assert.equal(beats, (r.song.bars.length - r.song.intro - r.song.outro) * 4, id);
    for (const m of uniqueMoves(r)) assert.ok(MOVES[m].name && MOVES[m].cue, m);
  }
  assert.equal(MOVES.pointR.name, '右手指天');
  assert.ok(MOVES.pointR.keys[0].pose.rightHand.x < 0.5, '右手在摄像头画面左边');
});

test('跳舞：小老师在拍子上正好摆到关键帧；照着跳全是完美，站着不动全是加油', () => {
  const r = ROUTINES.beat;
  const keys = timeline(r);
  const k = keys.find((x) => x.score);
  const sim = similarity(targetPx(coachPose(keys, k.beat)), targetPx(k.pose));
  assert.ok(sim.score > 0.99);
  function run(mover) {
    const j = new DanceJudge(keys, r.song.bpm);
    const len = r.song.bars.length * 4 * 60 / r.song.bpm;
    for (let ts = 0; ts < len + 1; ts += 0.04) {
      j.add(mover(ts * r.song.bpm / 60), ts);
      j.update(ts + 0.12);
    }
    j.finish();
    return j.result();
  }
  const good = run((beat) => targetPx(coachPose(keys, beat - 0.3)));
  assert.equal(good.counts.perfect, good.counts.perfect + good.counts.great + good.counts.good + good.counts.miss);
  assert.equal(good.stars, 3);
  const still = run(() => targetPx({}));
  assert.ok(still.frac < 0.1 && still.stars === 0, JSON.stringify(still.counts));
  assert.ok(/手/.test(still.tip), '纠错提示：' + still.tip);
});

test('跳舞：纠错说清楚哪只手往哪边', () => {
  const tgt = targetPx(MOVES.pointL.keys[0].pose);
  const me = targetPx({ arms: 'waist' });
  const sim = similarity(me, tgt, weightsFor(tgt));
  assert.ok(sim.score < 0.5);
  assert.equal(tipFor(me, tgt, sim), '左手再举高一点');
  assert.equal(gradeOf(0.9).id, 'perfect');
  assert.equal(gradeOf(0.3).id, 'miss');
});

test('舞曲：音符能解析，每小节都有鼓', () => {
  assert.equal(midi('A4'), 69);
  assert.equal(midi('C5'), 72);
  for (const id in ROUTINES) {
    const song = ROUTINES[id].song;
    const ev = compile(song);
    const lastStep = song.bars.length * 16;
    assert.ok(ev.every((e) => e.step >= 0 && e.step < lastStep), id);
    assert.ok(ev.filter((e) => e.k === 'lead').length > 40, id + ' 有旋律');
  }
});

// ---------- 成长中心 ----------
test('成长：星级口径、每日任务固定且不重复、星球等级', () => {
  assert.equal(ratingOf({ type: 'fruit', sliced: 20, accuracy: 0.8 }), 3);
  assert.equal(ratingOf({ type: 'fruit', sliced: 0 }), 0);
  assert.equal(ratingOf({ type: 'mole', stars: 2 }), 2);
  assert.equal(ratingOf({ type: 'mole', players: 2 }), 2);
  const a = dailyTasks('2026-10-28'), b = dailyTasks('2026-10-28');
  assert.deepEqual(a, b);
  assert.equal(a[0], 'move10');
  assert.equal(new Set(a).size, 3);
  for (const id of a) assert.ok(TASKS[id]);
  assert.equal(planet(0).level, 1);
  assert.equal(planet(8).level, 2);
  assert.ok(planet(10).frac > 0 && planet(10).frac < 1);
  assert.equal(planet(1000).level, 10);
});

test('成长：连续运动天数', () => {
  const days = { '2026-10-28': { sec: 300 }, '2026-10-27': { sec: 90 }, '2026-10-26': { sec: 120 }, '2026-10-24': { sec: 600 } };
  const s = streaks(days, '2026-10-28');
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
  const s2 = streaks({ '2026-10-27': { sec: 90 } }, '2026-10-28');
  assert.equal(s2.current, 1, '今天还没动，从昨天往前数');
});

test('成长：一局之后完成任务、拿勋章、星球升级', () => {
  const st = {
    settings: {}, best: { fruit: { '6-8': 0, '9-12': 0 }, balance: { left: 0, right: 0 }, other: {} },
    totals: { sessions: 1, stars: 3, sec: 700, duo: 0 }, progress: { 'ex:coord': { n: 1, stars: 3 } },
    growth: { tasks: {}, badges: {}, perfectDays: 0, perfectDay: null, bestStreak: 0, level: 1 },
    days: {}, sessions: []
  };
  const key = dayKey();
  st.days[key] = { sec: 700 };
  st.sessions.push({ type: 'exercise', course: 'coord', rating: 3, at: Date.now() });
  const fake = { get: () => st, save: () => {}, todaySeconds: () => 700 };
  const news = afterSession(fake);
  assert.ok(news.some((n) => /完成任务：今天运动满 10 分钟/.test(n)), news.join(' | '));
  assert.ok(news.some((n) => /获得勋章：第一步/.test(n)));
  assert.ok(news.some((n) => /协调小能手/.test(n)));
  assert.ok(st.totals.stars >= 5, '任务加星');
  const again = afterSession(fake);
  assert.ok(!again.some((n) => /第一步/.test(n)), '勋章不重复发');
  assert.ok(taskStatus(st, key, 700)[0].done);
  assert.ok(BADGES.every((b) => b.mark && b.name && b.desc));
});

test('举起双手：先放下过手才算（跳舞结束时手正举着，不能自动再来一局）', () => {
  const h = new HandsUp(1500);
  const up = skeleton({ handsUp: true });
  assert.equal(h.update(up, 0).fire, false);
  assert.equal(h.update(up, 1600).fire, false, '一直举着不算');
  h.update(skeleton(), 1700);
  assert.equal(h.update(up, 1800).fire, false);
  assert.equal(h.update(up, 3400).fire, true);
});
