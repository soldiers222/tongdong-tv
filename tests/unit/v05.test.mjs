// 0.5.0：跟着视频跳（视频库小工具、和视频里老师比动作的判定）
import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoJudge, mirrorPx, toPx, motion, posedness, activityScore, lagOf, LAG_MIN, LAG_MAX } from '../../web/js/video/video-logic.js';
import { VIDEOS, CATS, parseInput, embedUrl, pageUrl, fmtDur, videoKey, findVideo } from '../../web/js/video/videos.js';
import { ROUTINES, timeline } from '../../web/js/dance/routines.js';
import { coachPose, similarity, targetPx } from '../../web/js/dance/dance-logic.js';
import { figure } from '../../web/js/core/figure.js';
import { rng } from '../../web/js/core/util.js';
import { BADGES, TASKS } from '../../web/js/core/growth.js';

// ---------- 视频库 ----------
test('视频库：BV 号格式都对、不重复，每个都有类别和标题', () => {
  const seen = new Set();
  const cats = new Set(CATS.map((c) => c.id));
  for (const v of VIDEOS) {
    assert.match(v.bv, /^BV1[0-9A-Za-z]{9}$/, v.bv);
    assert.ok(!seen.has(v.bv), '重复：' + v.bv);
    seen.add(v.bv);
    assert.ok(cats.has(v.cat), v.bv + ' 的类别 ' + v.cat);
    assert.ok(v.title && v.title.length <= 14, v.bv + ' 的标题太长：' + v.title);
  }
  for (const c of ['school', 'dance', 'fit']) assert.ok(VIDEOS.filter((v) => v.cat === c).length >= 8, c + ' 至少 8 个');
});

test('视频库：认得 BV 号、视频网址、分集、b23 短链接', () => {
  assert.deepEqual(parseInput('BV1xx411c7mD'), { bv: 'BV1xx411c7mD', p: 1 });
  assert.deepEqual(parseInput('  https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333&p=3 '), { bv: 'BV1xx411c7mD', p: 3 });
  assert.deepEqual(parseInput('【海草舞】 https://b23.tv/AbC123x'), { b23: 'AbC123x' });
  assert.deepEqual(parseInput('1xx411c7mD'), { bv: 'BV1xx411c7mD', p: 1 });
  assert.equal(parseInput('BV1xx'), null);
  assert.equal(parseInput(''), null);
  assert.equal(parseInput('海草舞'), null);
});

test('视频库：外链播放器地址、B站网址、时长、记录用的键', () => {
  const u = embedUrl({ bv: 'BV1xx411c7mD', p: 2 }, { t: 12.7 });
  assert.ok(u.startsWith('https://player.bilibili.com/player.html?'));
  for (const part of ['bvid=BV1xx411c7mD', 'p=2', 'autoplay=1', 'danmaku=0', 't=12']) assert.ok(u.includes(part), part);
  assert.ok(embedUrl({ bv: 'BV1xx411c7mD' }, { autoplay: false }).includes('autoplay=0'));
  assert.equal(pageUrl({ bv: 'BV1xx411c7mD', p: 1 }), 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(pageUrl({ bv: 'BV1xx411c7mD', p: 2 }), 'https://www.bilibili.com/video/BV1xx411c7mD?p=2');
  assert.equal(fmtDur(65), '1:05');
  assert.equal(fmtDur(3725), '1:02:05');
  assert.equal(videoKey({ bv: 'BV1xx411c7mD', p: 1 }), 'BV1xx411c7mD');
  assert.equal(videoKey({ bv: 'BV1xx411c7mD', p: 3 }), 'BV1xx411c7mD-p3');
  assert.equal(videoKey({ local: 'a/x.mp4' }), 'local:a/x.mp4');
  assert.equal(findVideo(VIDEOS[0].bv), VIDEOS[0]);
});

// ---------- 判定 ----------
const SW = { left: 'right', right: 'left' };
function swapNames(kp) {
  const o = {};
  for (const k in kp) o[k.replace(/^(left|right)_/, (m, s) => SW[s] + '_')] = { x: 1 - kp[k].x, y: kp[k].y, s: kp[k].s };
  return o;
}
function noisy(kp, r, amt) {
  const o = {};
  for (const k in kp) o[k] = { x: kp[k].x + (r() - 0.5) * amt, y: kp[k].y + (r() - 0.5) * amt, s: kp[k].s };
  return o;
}
const F = (pose) => figure(Object.assign({}, pose, { fw: 640, fh: 480 }));

// 老师跳 routine 这支舞（10 帧/秒，视频画面 480×270），孩子 25 帧/秒（摄像头 640×480）
function run(childFn, opts = {}) {
  const ro = ROUTINES[opts.routine || 'beat'];
  const keys = timeline(ro);
  const spb = 60 / ro.song.bpm;
  const j = new VideoJudge({ noCoach: !!opts.noCoach });
  const r = rng(opts.seed || 7);
  const coachAt = (t) => coachPose(keys, t / spb);
  const T = opts.dur || 36;
  let tc = 0, tk = 0;
  const events = [];
  for (let t = 0; t <= T; t += 0.01) {
    if (t >= tc) {
      let kp = figure(Object.assign({}, coachAt(t), { fw: 480, fh: 270 }));
      if (opts.coachMirror) kp = swapNames(kp);
      if (!opts.noCoach) j.addCoach(noisy(kp, r, 0.008), t, 480, 270);
      tc += 0.1;
    }
    if (t >= tk) {
      const kp = childFn(t, coachAt);
      j.addChild(kp ? noisy(kp, r, 0.01) : null, t, 640, 480);
      tk += 0.04;
    }
    events.push(...j.update(t + 0.05));
  }
  events.push(...j.finish());
  return { res: j.result(), events };
}

test('照镜子：左右对调再水平翻转', () => {
  const px = toPx(figure({ arms: 'waist', leftHand: { x: 0.65, y: 0.1 } }), 1280, 720);
  const m = mirrorPx(px, 1280);
  assert.ok(Math.abs(m.right_wrist.x - (1280 - px.left_wrist.x)) < 1e-9);
  assert.equal(m.right_wrist.y, px.left_wrist.y);
  const back = mirrorPx(m, 1280);
  assert.ok(Math.abs(back.left_wrist.x - px.left_wrist.x) < 1e-9);
});

test('相似度：老师看不清的关节不比，两边都看不清就不打分', () => {
  const kid = toPx(F({ arms: 'up' }), 640, 480);
  const teacher = toPx(figure({ arms: 'up' }), 480, 270);
  assert.ok(similarity(kid, teacher).score > 0.95);
  const half = {};
  for (const k in teacher) half[k] = Object.assign({}, teacher[k], { s: /hip|knee|ankle|shoulder/.test(k) ? 0.05 : teacher[k].s });
  assert.equal(similarity(kid, half), null);
});

test('摆姿势程度：普通站姿接近 0，两手举高接近 1；运动量和帧率无关', () => {
  assert.ok(posedness(toPx(figure({}), 480, 270)) < 0.1);
  assert.ok(posedness(toPx(figure({ arms: 'up', spread: 1 }), 480, 270)) > 0.6);
  const r = rng(3);
  const still = (fps) => {
    const fr = [];
    for (let t = 0; t < 2; t += 1 / fps) fr.push({ t, px: toPx(noisy(F({}), r, 0.01), 640, 480) });
    return motion(fr);
  };
  assert.ok(still(10) < 0.2 && still(30) < 0.2, still(10) + ' / ' + still(30));
  assert.equal(activityScore(0.1), 0);
  assert.ok(activityScore(1.2) >= 0.99);
});

test('跟着老师跳：慢 0.3 / 0.7 / 1.2 秒都能对上，几乎全是完美', () => {
  for (const lag of [0.3, 0.7, 1.2]) {
    const { res } = run((t, c) => F(c(t - lag)));
    assert.ok(res.score >= 95, lag + ' 秒：' + res.score);
    assert.ok(Math.abs(res.lag - lag) <= 0.15, '算出的延迟 ' + res.lag);
    assert.equal(res.mirror, false);
    assert.equal(res.stars, 3);
  }
});

test('照镜子跟着跳、视频本身是镜面的：都认得出来', () => {
  const a = run((t, c) => swapNames(F(c(t - 0.6)))).res;
  assert.ok(a.score >= 95 && a.mirror === true, JSON.stringify(a));
  const b = run((t, c) => F(c(t - 0.6)), { coachMirror: true }).res;
  assert.ok(b.score >= 95 && b.mirror === true, JSON.stringify(b));
});

test('跟得时快时慢（0.4 到 1.0 秒）也算跟上了', () => {
  const { res } = run((t, c) => F(c(t - (0.7 + 0.3 * Math.sin(t / 3)))));
  assert.ok(res.score >= 85, String(res.score));
});

test('站着不动、跳别的舞、乱挥手：分数低', () => {
  const still = run(() => F({})).res;
  assert.ok(still.score <= 15 && still.stars === 0, '站着不动 ' + still.score);
  const other = run((t) => F(coachPose(timeline(ROUTINES.kungfu), t / (60 / ROUTINES.kungfu.song.bpm)))).res;
  assert.ok(other.score <= 35, '跳别的舞 ' + other.score);
  const flail = run((t) => F({ leftHand: { x: 0.6 + 0.1 * Math.sin(t * 3), y: 0.3 + 0.2 * Math.sin(t * 2.3) }, rightHand: { x: 0.4 + 0.1 * Math.sin(t * 2.1), y: 0.3 + 0.2 * Math.cos(t * 2.7) } })).res;
  assert.ok(flail.score <= 40, '乱挥手 ' + flail.score);
  // 站着不动的提示是要动起来
  assert.ok(still.tip, '要有提示');
});

test('老师在前奏里站着不动：那几段不评；孩子不在画面里：评「加油」并提示站到摄像头前', () => {
  const { res, events } = run((t, c) => F(c(t - 0.6)));
  assert.ok(events.some((e) => e.type === 'skip' && e.why === 'rest'), '前奏应该跳过');
  assert.ok(res.skipped >= 3);
  const away = run(() => null).res;
  assert.equal(away.score, 0);
  assert.equal(away.tip, '站到摄像头前面来');
});

test('看不到老师时按运动量：跟着动的分数中上，站着不动的前奏不评', () => {
  const moving = run((t, c) => F(c(t - 0.7)), { noCoach: true }).res;
  assert.ok(moving.score >= 50 && moving.aiBlocks === 0 && moving.moveBlocks > 0, JSON.stringify(moving));
  const still = run(() => F({}), { noCoach: true }).res;
  assert.equal(still.graded, 0, '一直不动，一段都不评');
});

test('暂停（gap）：不够 1 秒的半段不评，之后从新的一段开始', () => {
  const j = new VideoJudge();
  const kp = figure({ arms: 'up' });
  for (let t = 0; t < 0.5; t += 0.04) { j.addCoach(kp, t, 1280, 720); j.addChild(kp, t, 1280, 720); }
  j.update(10);
  assert.equal(j.gap().length, 0);
  assert.equal(j.graded, 0);
  for (let t = 20; t < 21.6; t += 0.04) { j.addCoach(kp, t, 1280, 720); j.addChild(kp, t, 1280, 720); }
  const ev = j.gap();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].grade.id, 'perfect');
});

test('延迟档位覆盖 -0.3 到 1.6 秒', () => {
  assert.equal(lagOf(0), LAG_MIN);
  assert.equal(lagOf(Math.round((LAG_MAX - LAG_MIN) / 0.1)), LAG_MAX);
});

test('成长中心：有「跟着视频跳」的任务和勋章', () => {
  assert.ok(TASKS.video && TASKS.video.go.screen === 'videos');
  const b = BADGES.find((x) => x.id === 'video');
  const st = { progress: { 'video:a': { n: 1, stars: 1 }, 'video:b': { n: 2, stars: 2 }, 'dance:beat': { n: 1, stars: 3 } } };
  assert.equal(b.test(st), false);
  st.progress['video:c'] = { n: 1, stars: 0 };
  assert.equal(b.test(st), true);
  assert.ok(TASKS.video.test({ list: [{ type: 'video', activeSec: 150 }] }));
  assert.ok(!TASKS.video.test({ list: [{ type: 'video', activeSec: 60 }] }));
});

test('targetPx 的示范小人每个关节都看得清（相似度新加的老师可见性检查不影响跟跳练舞）', () => {
  const t = targetPx({ arms: 'up' });
  for (const k in t) assert.equal(t[k].s, 1);
});
