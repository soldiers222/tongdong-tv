// 端到端测试：本机 Chrome 无头模式 + 假摄像头。
// 用法：cd tests && npm install && FAKE_CAMERA=/path/person.y4m node e2e.mjs
//   FAKE_CAMERA 可选：提供一段 y4m 全身视频（见 make-fixture.py）时，会用真实识别模型跑设备测试。
//   CHROME 可选：Chrome 路径，默认 /opt/google/chrome/chrome。
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB = join(ROOT, 'web');
const OUT = process.env.E2E_OUT || join(ROOT, 'tests', 'out');
const FIXTURE = process.env.FAKE_CAMERA || '';
const CHROME = process.env.CHROME || '/opt/google/chrome/chrome';
const PORT = Number(process.env.PORT || 8765);
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? '✓ ' : '✗ ') + name + (detail ? '：' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 静态服务器。默认带跨源隔离响应头，和电视版 APK 一样（ISOLATE=0 时不带，和网页版一样）
const ISOLATE = process.env.ISOLATE !== '0';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(WEB, p));
  const headers = ISOLATE ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } : {};
  if (!file.startsWith(WEB)) { res.writeHead(403, headers); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', ...headers });
    res.end(data);
  } catch (e) {
    res.writeHead(404, headers);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log('跨源隔离：' + (ISOLATE ? '开（同电视版 APK）' : '关（同网页版）'));

const args = [
  '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
  '--window-size=1920,1080'
];
if (FIXTURE) args.push('--use-file-for-fake-video-capture=' + FIXTURE);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, protocolTimeout: 300000 });

// 模拟电视版 APK 的安卓接口（TongdongNative）：原生识别每秒推 25 组关键点（站着的人，右手左右挥）
function nativeStub() {
  var timer = null;
  var t0 = 0;
  var log = { starts: 0, stops: 0, previews: [], startOpts: [], configs: [], benches: [], videoOpens: [], videoCmds: [], videoCloses: 0, coachStarts: [], coachStops: 0 };
  var config = { accel: 'cpu', threads: 3, workers: 2 };
  var players = 1;
  window.__nativeLog = log;
  // 模拟算力：单次耗时 = 40 + 30/线程数 毫秒，几路并行就快几倍；GPU 不在兼容列表；NNAPI 每秒 15 次
  function benchResult(c) {
    if (c.accel === 'gpu') return { ok: false, accel: 'gpu', error: 'GPU 不在 TensorFlow Lite 的兼容列表里' };
    var ms = c.accel === 'nnapi' ? 66 : 40 + 30 / c.threads;
    return { ok: true, accel: c.accel, threads: c.threads, workers: c.workers, fps: c.workers * 1000 / ms, p50: ms, p95: ms * 1.2, cpu: c.threads * c.workers * 0.9, model: 'movenet_lightning_int8.tflite' };
  }
  // 视频层和老师识别：一段 24 秒的「视频」，老师的手每 1.2 秒换一个动作（左手举高、两手侧平举、右手举高、两手举高）；
  // 视频放着时，摄像头里的孩子跟着老师做，慢 0.5 秒
  var video = null, stateTimer = null, coachTimer = null;
  function vnow() {
    if (!video) return 0;
    return Math.min(video.dur, video.t + (video.playing ? (performance.now() - video.at) / 1000 : 0));
  }
  function body(t, cx, cy, S, w, h) {
    var ph = Math.floor(Math.max(0, t) / 1.2) % 4;
    var up = function (side) { return [[side * 0.6, -1.8], [side * 0.65, -2.4]]; };
    var out = function (side) { return [[side * 1.1, -1.2], [side * 1.7, -1.2]]; };
    var down = function (side) { return [[side * 0.6, -0.6], [side * 0.65, -0.05]]; };
    var L = ph === 0 || ph === 3 ? up(1) : (ph === 1 ? out(1) : down(1));
    var R = ph === 2 || ph === 3 ? up(-1) : (ph === 1 ? out(-1) : down(-1));
    var u = [[0, -1.6], [0.1, -1.7], [-0.1, -1.7], [0.25, -1.65], [-0.25, -1.65], [0.5, -1.2], [-0.5, -1.2],
      L[0], R[0], L[1], R[1], [0.35, 0], [-0.35, 0], [0.35, 1], [-0.35, 1], [0.35, 2], [-0.35, 2]];
    var k = [];
    for (var i = 0; i < 17; i++) k.push((cx + u[i][0] * S) / w, (cy + u[i][1] * S) / h, 0.85);
    return k;
  }
  function videoState() {
    if (!video) return;
    var t = vnow();
    if (video.playing && t >= video.dur) { video.t = video.dur; video.playing = false; video.ended = true; }
    var ready = performance.now() - video.openedAt > 900;
    if (window.__tdVideo) window.__tdVideo(JSON.stringify({ ok: true, t: t, dur: video.dur, paused: !video.playing, ended: !!video.ended, ready: ready ? 4 : 0, vw: 1280, vh: 720, rect: [0, 0, 880, 495], W: 880, H: 495, mirror: video.mirror, push: false, taint: false, pushed: 0 }));
  }

  function pose(t) {
    if (video && video.playing) return body(vnow() - 0.5, 320, 260, 70, 640, 480);
    var p = [
      [0.50, 0.20], [0.49, 0.19], [0.51, 0.19], [0.48, 0.20], [0.52, 0.20],
      [0.45, 0.30], [0.55, 0.30], [0.42, 0.42], [0.58, 0.40],
      [0.40, 0.52], [0.60, 0.40], [0.46, 0.55], [0.54, 0.55],
      [0.46, 0.72], [0.54, 0.72], [0.46, 0.90], [0.54, 0.90]
    ];
    var ph = t / 1000 * Math.PI * 2 * 0.7;
    p[10] = [0.5 + 0.3 * Math.sin(ph), 0.32 + 0.08 * Math.cos(ph * 2)];
    p[8] = [0.55 + 0.12 * Math.sin(ph), 0.38];
    var k = [];
    for (var i = 0; i < 17; i++) k.push(p[i][0], p[i][1], 0.8);
    return k;
  }
  // 双人：把一个人放到画面左半边或右半边（横向缩到 0.8 倍，肩宽还在合格范围里）
  function half(k, slot) {
    var out = k.slice();
    for (var i = 0; i < 17; i++) out[i * 3] = (slot ? 0.75 : 0.25) + (k[i * 3] - 0.5) * 0.8;
    return out;
  }
  window.TongdongNative = {
    poseAvailable: function () { return true; },
    hasCameraPermission: function () { return true; },
    poseStart: function (opts) {
      log.starts++;
      var o = JSON.parse(opts || '{}');
      log.startOpts.push(o);
      if (o.accel) config = { accel: o.accel, threads: o.threads, workers: o.workers };
      if (o.players) players = o.players;
      if (!timer) {
        t0 = performance.now();
        timer = setInterval(function () {
          if (!window.__tdNativePose) return;
          var t = performance.now() - t0;
          if (players === 2) window.__tdNativePose({ k: half(pose(t), 0), k2: half(pose(t + 400), 1), n: 2, w: 640, h: 480, age: 30, ms: 21.5 });
          else window.__tdNativePose({ k: pose(t), n: 1, w: 640, h: 480, age: 30, ms: 18.5 });
        }, 40);
      }
      return JSON.stringify({ ok: true, w: 640, h: 480 });
    },
    poseStop: function () { log.stops++; clearInterval(timer); timer = null; },
    poseInfo: function () {
      var t = performance.now();
      return JSON.stringify({ camera: '0', facing: 'back', level: 'EXTERNAL', w: 640, h: 480, pw: 1440, ph: 1080, rotation: 0, threads: config.threads * config.workers, config: config, input: 'UINT8', running: !!timer, p50: 18.5, p95: 22, fps: 25, camFps: 25, sampleMs: 0.6, cpuMs: Math.round(t * 2.5), wallMs: Math.round(t), bad: [], error: '' });
    },
    poseConfig: function (json) {
      var c = JSON.parse(json);
      log.configs.push(c);
      if (c.accel) config = { accel: c.accel, threads: c.threads, workers: c.workers };
      if (c.players) players = c.players;
      return JSON.stringify({ ok: true });
    },
    poseBench: function (json) {
      var c = JSON.parse(json);
      log.benches.push(c);
      setTimeout(function () { if (window.__tdNativeBench) window.__tdNativeBench(benchResult(c)); }, c.ms || 300);
    },
    cameraSizes: function () { return '[]'; },
    videoAvailable: function () { return true; },
    videoOpen: function (json) {
      log.videoOpens.push(JSON.parse(json));
      video = { t: 0, dur: 24, playing: true, at: performance.now(), openedAt: performance.now(), mirror: false, ended: false };
      clearInterval(stateTimer);
      stateTimer = setInterval(videoState, 250);
    },
    videoLayout: function () {},
    videoCmd: function (json) {
      var c = JSON.parse(json);
      log.videoCmds.push(c.c);
      if (!video) return;
      if (c.c === 'play' && !video.playing && !video.ended) { video.at = performance.now(); video.playing = true; }
      else if (c.c === 'pause' && video.playing) { video.t = vnow(); video.playing = false; }
      else if (c.c === 'seek') { video.t = Math.min(video.dur, c.v); video.at = performance.now(); video.ended = false; }
      else if (c.c === 'mirror') video.mirror = !!c.v;
    },
    videoClose: function () { log.videoCloses++; video = null; clearInterval(stateTimer); clearInterval(coachTimer); },
    videoState: function () { return '{}'; },
    coachStart: function (json) {
      log.coachStarts.push(JSON.parse(json));
      clearInterval(coachTimer);
      setTimeout(function () { if (window.__tdCoachEvent) window.__tdCoachEvent({ type: 'mode', mode: 'copy', target: 'video' }); }, 50);
      coachTimer = setInterval(function () {
        if (!video || !video.playing || !window.__tdCoachPose) return;
        window.__tdCoachPose({ k: body(vnow(), 640, 400, 110, 1280, 720), w: 1280, h: 720, age: 30, ms: 15, vt: vnow(), src: 'copy', luma: 90 });
      }, 125);
      return JSON.stringify({ ok: true });
    },
    coachUpdate: function () {},
    coachFrame: function () {},
    coachStop: function () { log.coachStops++; clearInterval(coachTimer); },
    coachInfo: function () { return JSON.stringify({ running: !!coachTimer, mode: 'copy', frames: 10 }); },
    mediaDir: function () { return '/sdcard/Android/data/com.family.tongdong/files/Movies'; },
    mediaPermission: function () { return false; },
    mediaRequest: function () {},
    openBrowser: function (url, title) { (log.browser = log.browser || []).push({ url: url, title: title }); },
    saveText: function (name, text) {
      log.saved = { name: name, text: text };
      return '/sdcard/Android/data/com.family.tongdong/files/' + name;
    },
    preview: function (json) { log.previews.push(JSON.parse(json)); },
    info: function () {
      var cpus = [];
      for (var i = 0; i < 8; i++) cpus.push({ i: i, mhz: i < 4 ? 1800 : 1400, part: i < 4 ? 'A73' : 'A53' });
      return JSON.stringify({ manufacturer: 'HUAWEI', model: 'FREU-560B', android: '12', sdk: 31, harmony: '4.3.0', app: 'stub', webview: 'stub', cameraPermission: true, nativePose: true, cpus: cpus });
    }
  };
}

const external = [];
const pageErrors = [];
// 电视版 APK 里网页访问 https://appassets.androidplatform.net/bili/…、/media/… 由安卓代答（视频信息、封面、电视里的视频）；
// 测试里用假数据回答
const APP_HOST = 'https://appassets.androidplatform.net/';
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function appAnswer(u) {
  const path = u.slice(APP_HOST.length);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  if (path.startsWith('bili/view/')) {
    const bv = path.slice(10);
    const data = { bvid: bv, title: '测试视频 ' + bv, duration: 95, owner: '测试UP主', view: 23456, pages: [{ page: 1, part: '', duration: 95 }] };
    return { status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(bv === 'BV1Su4y1V7rS' ? { code: -404, message: '啥都木有' } : { code: 0, data: data }) };
  }
  if (path.startsWith('bili/cover/')) return { status: 200, headers: cors, contentType: 'image/png', body: PNG1 };
  if (path.startsWith('media/list')) return { status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ dir: '/sdcard/Android/data/com.family.tongdong/files/Movies', permitted: false, list: [] }) };
  return { status: 404, headers: cors, body: '' };
}

async function open(path, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  if (opts && opts.nativeStub) {
    await page.evaluateOnNewDocument(nativeStub);
    await page.setRequestInterception(true);
  }
  page.on('request', (req) => {
    const u = req.url();
    if (opts && opts.nativeStub) {
      if (u.startsWith(APP_HOST)) { req.respond(appAnswer(u)); return; }
      req.continue();
    }
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', (e) => pageErrors.push(path + ' → ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(path + ' → console: ' + m.text()); });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return page;
}
async function waitFor(page, fn, timeout, arg) {
  try { await page.waitForFunction(fn, { timeout, polling: 250 }, arg); return true; } catch (e) { return false; }
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png') });

try {
  // 1. 首页五条跑道、入口页与遥控器导航
  {
    const page = await open('/');
    check('首页显示', await waitFor(page, () => document.querySelector('#screen-home.active'), 8000));
    check('展示字体已加载', await page.evaluate(() => document.fonts.check('48px "TD Display"')));
    await sleep(300);
    await shot(page, '01-home');
    const id = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    const tile = () => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-tile'));
    check('首页五个入口', (await page.evaluate(() => document.querySelectorAll('#screen-home .lane5').length)) === 5);
    check('默认焦点在体感游戏', (await id()) === 'lane-games');
    await page.keyboard.press('ArrowRight');
    check('右键到跟跳练舞', (await id()) === 'lane-dance');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    check('再右键三次到成长中心', (await id()) === 'lane-growth');
    await page.keyboard.press('ArrowDown');
    check('下键到草坪上的工具', /^tool-/.test(await id()), await id());
    await page.keyboard.press('ArrowUp');
    check('上键回到跑道', /^lane-/.test(await id()), await id());
    await page.evaluate(() => document.getElementById('tool-settings').focus());
    await page.keyboard.press('Enter');
    check('进入家长设置', await waitFor(page, () => document.querySelector('#screen-settings.active'), 3000));
    const before = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    check('左右键修改年龄段', before !== after, before + ' → ' + after);
    await page.keyboard.press('ArrowLeft');
    await shot(page, '06-settings');
    await page.keyboard.press('Escape');
    check('返回键回首页', await waitFor(page, () => document.querySelector('#screen-home.active'), 3000));
    // 体感游戏入口
    await page.evaluate(() => document.getElementById('lane-games').focus());
    await page.keyboard.press('Enter');
    check('进入体感游戏', await waitFor(page, () => document.querySelector('#screen-hub.active') && document.getElementById('screen-hub').getAttribute('data-hub') === 'games', 3000));
    check('体感游戏五格，焦点在西瓜切切切', (await page.evaluate(() => document.querySelectorAll('#hub-tiles .tile').length)) === 5 && (await tile()) === 'fruit');
    await page.keyboard.press('ArrowRight');
    check('左右键在格子之间移动', (await tile()) === 'space', await tile());
    await page.evaluate(() => document.getElementById('hub-players').focus());
    await page.keyboard.press('Enter');
    check('右上角按确定换成双人', (await page.evaluate(() => window.TD.store.settings().players)) === 2 && (await page.evaluate(() => document.querySelectorAll('#hub-tiles .duo-tag.on').length)) === 4);
    await sleep(300);
    await shot(page, '01b-hub-games-duo');
    await page.keyboard.press('Enter');
    check('再按确定换回单人', (await page.evaluate(() => window.TD.store.settings().players)) === 1);
    await page.keyboard.press('Escape');
    check('返回键回首页，焦点回到体感游戏', await waitFor(page, () => document.querySelector('#screen-home.active') && document.activeElement.id === 'lane-games', 3000));
    for (const [lane, hub, n] of [['lane-dance', 'dance', 7], ['lane-train', 'train', 7], ['lane-remote', 'remote', 8]]) {
      await page.evaluate((l) => document.getElementById(l).focus(), lane);
      await page.keyboard.press('Enter');
      const ok = await waitFor(page, (h) => document.querySelector('#screen-hub.active') && document.getElementById('screen-hub').getAttribute('data-hub') === h, 3000, hub);
      const count = await page.evaluate(() => document.querySelectorAll('#hub-tiles .tile').length);
      check('入口页：' + hub + ' 有 ' + n + ' 格', ok && count === n, String(count));
      await sleep(300);
      await shot(page, '01c-hub-' + hub);
      await page.keyboard.press('Escape');
      await waitFor(page, () => document.querySelector('#screen-home.active'), 3000);
    }
    await page.evaluate(() => document.getElementById('lane-games').focus());
    check('首页返回返回 false（外壳据此退出）', (await page.evaluate(() => window.__tdBack())) === false);
    await page.close();
  }

  // 1b. 电视视口：像素比 1.75 的小视口；WebView 先把页面缩小又恢复（华为电视上出现过画面被放大裁掉）
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1097, height: 617, deviceScaleFactor: 1.75 });
    const cdp = await page.target().createCDPSession();
    page.on('pageerror', (e) => pageErrors.push('tv → ' + e.message));
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.571 });
    await page.goto(BASE + '/?mock=still&screen=day0', { waitUntil: 'load' });
    await waitFor(page, () => document.querySelector('#screen-day0.active'), 8000);
    await sleep(600);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await sleep(400);
    // 焦点移到最下面的按钮，再按一次方向键
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);
    const box = await page.evaluate(() => {
      const r = document.getElementById('app').getBoundingClientRect();
      const de = document.documentElement;
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, cw: de.clientWidth, ch: de.clientHeight, sx: window.scrollX, sy: window.scrollY, view: window.TD.view() };
    });
    const fits = Math.abs(box.l) < 2 && Math.abs(box.t) < 2 && Math.abs(box.r - box.cw) < 2 && Math.abs(box.b - box.ch) < 2;
    check('电视视口下画布正好铺满屏幕', fits, JSON.stringify(box));
    check('焦点移动不滚动页面', box.sx === 0 && box.sy === 0);
    check('设备测试显示画面信息', /像素比/.test(await page.evaluate(() => document.getElementById('d0-view').textContent)));
    await shot(page, '00-tv-viewport');
    await page.close();
  }

  // 2. 西瓜切切切（模拟骨架）
  {
    const page = await open('/?mock=fruit&screen=fruit&dur=12');
    await sleep(9000);
    await shot(page, '02-fruit-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('切水果一局结束并出结算', done && rec && rec.type === 'fruit');
    check('模拟挥手切中水果得分', rec && rec.score > 0, rec ? `得分 ${rec.score}，切中 ${rec.sliced}，连切 ${rec.maxCombo}` : '');
    await sleep(400);
    await shot(page, '03-fruit-result');
    check('结算页焦点在「再来一局」', (await page.evaluate(() => document.activeElement.id)) === 'btn-again');
    await page.keyboard.press('Enter');
    check('再来一局重新倒计时', await waitFor(page, () => window.TD.play.debug().phase === 'count' || window.TD.play.debug().phase === 'play', 3000));
    // 电视外壳切到后台 / 回到前台
    await page.evaluate(() => window.__tdPause());
    check('切到后台时停止运动', (await page.evaluate(() => window.TD.play.debug().running)) === false);
    await page.evaluate(() => window.__tdResume());
    check('回到前台重新开始这一局', await waitFor(page, () => window.TD.play.debug().running === true, 8000));
    await page.close();
  }

  // 2b. 西瓜切切切 · 双人（模拟两个人）
  {
    const page = await open('/?mock=fruit2&screen=fruit&players=2&dur=12');
    const bestBefore = await page.evaluate(() => window.TD.store.get().best.fruit['6-8']);
    check('双人切水果：进入双人模式', await waitFor(page, () => window.TD.play.debug().players === 2 && window.TD.feed.latest && window.TD.feed.latest.kps && window.TD.feed.latest.kps.length === 2, 8000));
    await waitFor(page, () => window.TD.play.debug().phase === 'play', 15000);
    await sleep(5000);
    await shot(page, '02b-fruit-duo-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('双人切水果：一局结束，两边都有分数和胜负', done && rec && rec.players === 2 && rec.scores.length === 2 && rec.scores[0] > 0 && rec.scores[1] > 0 && ['left', 'right', 'tie'].indexOf(rec.winner) >= 0,
      rec ? `左 ${rec.scores[0]} 分，右 ${rec.scores[1]} 分，${rec.winner}` : '');
    await sleep(400);
    await shot(page, '03b-fruit-duo-result');
    check('双人切水果：结算页有两栏和胜负', await page.evaluate(() => document.querySelectorAll('#result .duo-p').length === 2 && /赢了|平局/.test(document.querySelector('#result .winner').textContent)));
    const best = await page.evaluate(() => window.TD.store.get().best.fruit['6-8']);
    check('双人不算个人最好成绩', best === bestBefore, bestBefore + ' → ' + best);
    await page.evaluate(() => window.TD.store.setSetting('players', 1));
    await page.close();
  }

  // 3b. 金鸡独立 · 双人（模拟两个人：右边的人第一轮早 1 秒落脚、第二轮多站 1 秒）
  {
    const page = await open('/?mock=balance2&screen=balance&players=2&target=30');
    await sleep(7500);
    await shot(page, '04b-balance-duo-hold');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 50000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    await sleep(400);
    await shot(page, '05b-balance-duo-result');
    const ok = done && rec && rec.players === 2 && rec.sides.length === 2 && rec.sides[0].length === 2 && rec.sides[1].length === 2;
    check('双人金鸡独立：两轮结束，两个人各两条成绩', ok, ok ? rec.sides.map((x) => x.map((l) => l.stand + ' ' + l.holdMs + 'ms ' + l.reason).join('，')).join(' | ') + '，总 ' + rec.totals.join(' / ') + '，' + rec.winner : '');
    if (ok) {
      const [L, R] = rec.sides; // 屏幕左右（镜像：屏幕左边是画面右半边的人）
      check('双人金鸡独立：每轮各自判定，时间合理', L.concat(R).every((l) => l.holdMs > 2500 && l.holdMs < 8000 && l.reason === 'down'));
      check('双人金鸡独立：胜负按总时间', rec.winner === (rec.totals[0] > rec.totals[1] ? 'left' : rec.totals[1] > rec.totals[0] ? 'right' : 'tie'));
    }
    await page.evaluate(() => window.TD.store.setSetting('players', 1));
    await page.close();
  }

  // 3. 金鸡独立（模拟骨架：左脚站约 5 秒、右脚站约 4.5 秒，最后举双手）
  {
    const page = await open('/?mock=balance&screen=balance&target=30');
    await sleep(7500);
    await shot(page, '04-balance-hold');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 45000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    await shot(page, '05-balance-result');
    check('金鸡独立两轮结束并出结算', done && rec && rec.legs && rec.legs.length === 2);
    if (rec && rec.legs) {
      const [a, b] = rec.legs;
      check('左脚站计时合理（3–7 秒）', a.stand === 'left' && a.holdMs > 3000 && a.holdMs < 7000, a.holdMs + ' 毫秒，' + a.reason);
      check('右脚站计时合理（3–7 秒）', b.stand === 'right' && b.holdMs > 3000 && b.holdMs < 7000, b.holdMs + ' 毫秒，' + b.reason);
      check('脚落地判定为失稳', a.reason === 'down' && b.reason === 'down');
    }
    const replay = await waitFor(page, () => ['intro', 'judge'].indexOf(window.TD.play.debug().phase) >= 0 && !window.TD.play.debug().showingResult, 8000);
    check('举起双手自动再来一局', replay);
    await page.close();
  }

  // 4. 设备测试（真实识别模型 + 假摄像头视频）
  if (FIXTURE) {
    const page = await open('/?screen=day0&bench=fast');
    check('设备测试打开摄像头', await waitFor(page, () => /×/.test(document.getElementById('d0-cam').textContent), 15000));
    await page.click('#d0-run');
    const ok = await waitFor(page, () => !window.TD.day0.debug().benching && window.TD.day0.debug().results.length === 7, 330000);
    const dbg = await page.evaluate(() => window.TD.day0.debug());
    check('七个引擎都测完', ok, dbg.results.map((r) => r.id + (r.error ? '（' + r.error + '）' : ' ' + r.fps.toFixed(1) + 'fps/' + r.kpAvg.toFixed(1) + '点')).join('；'));
    const nat = dbg.results.find((x) => x.id === 'native');
    check('浏览器里原生识别标为不支持', nat && /只有电视版 APK 能用/.test(nat.error || ''), nat ? nat.error : '无结果');
    for (const id of ['mn-worker-gl', 'mn-worker', 'mp-lite', 'mn-webgl', 'mn-wasm']) {
      const r = dbg.results.find((x) => x.id === id);
      check(id + ' 识别到人体', r && !r.error && r.fps > 0 && r.kpAvg >= 8, r ? (r.error || r.kpAvg.toFixed(1) + ' 个关键点') : '无结果');
    }
    await sleep(2500);
    const fit = await page.evaluate(() => window.TD.day0.debug().lastFit);
    check('全身入镜检测有结果', !!fit, fit ? fit.msg : '');
    await shot(page, '07-day0');
    await page.click('#d0-summary-btn');
    await sleep(300);
    await shot(page, '08-day0-summary');
    writeFileSync(join(OUT, 'day0-summary.txt'), dbg.summary);
    await page.close();
  }

  // 4c. 电视版原生识别（模拟安卓接口）：设备测试
  {
    const page = await open('/?screen=day0&bench=fast&engines=native,mn-wasm', { nativeStub: true });
    check('原生识别：设备测试直接用原生摄像头', await waitFor(page, () => /原生/.test(document.getElementById('d0-cam').textContent), 8000),
      await page.evaluate(() => document.getElementById('d0-cam').textContent));
    check('原生识别：收到关键点', await waitFor(page, () => window.TD.feed.engineId === 'native' && window.TD.feed.latest && window.TD.feed.latest.kp, 5000));
    const lay = await page.evaluate(() => {
      const p = window.__nativeLog.previews.filter((x) => x.show).pop();
      const r = document.querySelector('.d0-preview').getBoundingClientRect();
      return { p, r: { x: r.left, y: r.top, w: r.width, h: r.height }, cls: document.body.classList.contains('native-cam') };
    });
    const near = (a, b) => Math.abs(a - b) < 2;
    check('原生识别：网页变透明，预览层对准画面框', lay.cls && lay.p && near(lay.p.x, lay.r.x) && near(lay.p.y, lay.r.y) && near(lay.p.w, lay.r.w) && lay.p.fit === 'contain', JSON.stringify(lay));
    await sleep(800);
    await shot(page, '11-native-day0');
    await page.click('#d0-run');
    const ok = await waitFor(page, () => !window.TD.day0.debug().benching && window.TD.day0.debug().results.length === 2, 150000);
    const dbg = await page.evaluate(() => window.TD.day0.debug());
    const nat = dbg.results.find((x) => x.id === 'native');
    const wasm = dbg.results.find((x) => x.id === 'mn-wasm');
    const tune = await page.evaluate(() => ({ benches: window.__nativeLog.benches, configs: window.__nativeLog.configs, saved: window.TD.store.get().day0.nativeConfig }));
    check('原生识别：调优试了 CPU 和 GPU', tune.benches.length === 3 && tune.benches.some((b) => b.accel === 'gpu'), JSON.stringify(tune.benches));
    check('原生识别：选了跟得上摄像头、延迟最低的方式并换上', tune.saved && tune.saved.accel === 'cpu' && tune.saved.threads === 4 && tune.saved.workers === 2 && tune.configs.length === 1, JSON.stringify(tune.saved));
    check('原生识别：测速完成，速度接近每秒 25 次', ok && nat && !nat.error && nat.fps > 18 && nat.fps < 30, nat ? (nat.error || nat.fps.toFixed(1) + ' 帧/秒，画面 ' + Math.round(nat.renderFps) + ' 帧/秒') : '无结果');
    check('原生识别：单帧耗时用安卓里实测的', nat && nat.p50 > 18 && nat.p50 < 19, nat ? String(nat.p50) : '');
    check('原生识别：关键点数量', nat && nat.kpAvg >= 15, nat ? nat.kpAvg.toFixed(1) : '');
    check('原生识别让出摄像头后，网页摄像头能打开', wasm && !wasm.error, wasm ? (wasm.error || wasm.fps.toFixed(1) + ' 帧/秒') : '无结果');
    check('测速后接着用最快的原生识别', await waitFor(page, () => window.TD.feed.engineId === 'native' && document.body.classList.contains('native-cam'), 8000));
    const summary = await page.evaluate(() => window.TD.day0.debug().summary);
    check('结果摘要里有原生识别和两路摄像头', /原生识别（多核 CPU）：\d/.test(summary) && /原生摄像头：Camera2 #0 后置 EXTERNAL，识别 640×480，预览 1440×1080/.test(summary) && /网页摄像头：/.test(summary),
      summary.split('\n').filter((l) => /原生|摄像头/.test(l)).join(' / '));
    check('结果摘要里有 CPU、调优结果和进程占用', /CPU：4×A73 1\.8GHz \+ 4×A53 1\.4GHz/.test(summary) && /GPU：GPU 不在/.test(summary) && /选用：CPU 2 路×4 线程/.test(summary) && /进程用了 2\.5 核/.test(summary) && /摄像头 25 帧\/秒/.test(summary),
      summary.split('\n').filter((l) => /CPU|调优|选用|进程/.test(l)).join(' / '));
    writeFileSync(join(OUT, 'day0-native-summary.txt'), summary);
    const saved = await page.evaluate(() => window.__nativeLog.saved);
    check('测速结束时摘要存到电视上的文件', saved && saved.name === 'day0-summary.txt' && /原生识别调优/.test(saved.text));
    await page.click('#d0-summary-btn');
    await sleep(300);
    const fit = await page.evaluate(() => {
      const el = document.getElementById('d0-summary');
      return { sh: el.scrollHeight, ch: el.clientHeight, fs: el.style.fontSize, last: el.textContent.split('\n').slice(-1)[0] };
    });
    check('结果摘要一屏放得下，最后一行是文件位置', fit.sh <= fit.ch + 1 && /这份摘要也存在电视上：\/sdcard\//.test(fit.last), JSON.stringify(fit));
    await shot(page, '12b-native-summary');
    await page.click('#d0-summary-btn');
    await sleep(600);
    await shot(page, '12-native-day0-done');
    const stops0 = await page.evaluate(() => window.__nativeLog.stops);
    await page.evaluate(() => window.__tdBack());
    check('离开设备测试：停掉原生识别、收起预览层', await waitFor(page, (n) => {
      const log = window.__nativeLog;
      const last = log.previews[log.previews.length - 1];
      return document.querySelector('#screen-home.active') && !document.body.classList.contains('native-cam') && log.stops > n && last && last.show === false && !window.TD.feed.engine;
    }, 3000, stops0));
    await page.close();
  }

  // 4d. 电视版原生识别（模拟安卓接口）：切水果
  {
    const page = await open('/?screen=fruit&dur=10', { nativeStub: true });
    check('原生识别：切水果用原生识别', await waitFor(page, () => window.TD.feed.engineId === 'native' && window.TD.play.debug().running, 10000), await page.evaluate(() => window.TD.feed.engineId));
    const opts = await page.evaluate(() => window.__nativeLog.startOpts.slice(-1)[0]);
    check('原生识别：游戏用设备测试选好的方式', opts && opts.accel === 'cpu' && opts.threads === 4 && opts.workers === 2, JSON.stringify(opts));
    const lay = await page.evaluate(() => ({ p: window.__nativeLog.previews.filter((x) => x.show).pop(), cls: document.body.classList.contains('native-cam') }));
    check('原生识别：运动页透明，预览层铺满全屏', lay.cls && lay.p && lay.p.fit === 'cover' && Math.abs(lay.p.w - 1920) < 2 && Math.abs(lay.p.h - 1080) < 2, JSON.stringify(lay.p));
    await sleep(5000);
    await shot(page, '13-native-fruit');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('原生识别：切水果一局结束', done && rec && rec.type === 'fruit', rec ? `得分 ${rec.score}，切中 ${rec.sliced}` : '');
    const stops = await page.evaluate(() => window.__nativeLog.stops);
    await page.evaluate(() => window.__tdPause());
    check('切到后台：停掉原生识别', await page.evaluate((n) => window.__nativeLog.stops > n && !document.body.classList.contains('native-cam'), stops));
    const starts = await page.evaluate(() => window.__nativeLog.starts);
    await page.evaluate(() => window.__tdResume());
    check('回到前台：重新启动原生识别', await waitFor(page, (n) => window.__nativeLog.starts > n && window.TD.play.debug().running && document.body.classList.contains('native-cam'), 8000, starts));
    await page.evaluate(() => window.TD.go('home'));
    check('回首页：停掉原生识别', await waitFor(page, () => document.querySelector('#screen-home.active') && !document.body.classList.contains('native-cam') && !window.TD.feed.engine, 4000));
    await page.close();
  }

  // 4e. 电视版原生识别 · 双人切水果：用设备测试选好的双人方式，安卓一帧推两个人
  {
    const page = await open('/?screen=fruit&players=2&dur=8', { nativeStub: true });
    check('原生双人：进入双人模式', await waitFor(page, () => window.TD.feed.engineId === 'native' && window.TD.play.debug().players === 2 && window.TD.play.debug().running, 10000));
    const opts = await page.evaluate(() => ({ start: window.__nativeLog.startOpts.slice(-1)[0], saved2: window.TD.store.get().day0.nativeConfig2 }));
    check('原生双人：启动参数是双人和设备测试选的双人方式', opts.start && opts.start.players === 2 && opts.saved2 && opts.start.accel === opts.saved2.accel && opts.start.threads === opts.saved2.threads && opts.start.workers === opts.saved2.workers, JSON.stringify(opts));
    check('原生双人：收到两个人的关键点', await waitFor(page, () => {
      const l = window.TD.feed.latest;
      return l && l.kps && l.kps.length === 2 && l.kps[0] && l.kps[1] && l.kps[0].left_hip.x < 0.5 && l.kps[1].left_hip.x > 0.5;
    }, 5000));
    await waitFor(page, () => window.TD.play.debug().phase === 'play', 15000);
    await sleep(3000);
    await shot(page, '14-native-fruit-duo');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('原生双人：一局结束', done && rec && rec.players === 2, rec ? rec.scores.join(' : ') : '');
    await page.evaluate(() => { window.TD.store.setSetting('players', 1); window.TD.go('home'); });
    await page.close();
  }

  // 4b. 外壳返回键：页面里有弹层时先关弹层
  {
    const page = await open('/?mock=still&screen=day0');
    await waitFor(page, () => document.querySelector('#screen-day0.active'), 8000);
    await page.click('#d0-summary-btn');
    const opened = await page.evaluate(() => document.getElementById('d0-summary').classList.contains('show'));
    const handled = await page.evaluate(() => window.__tdBack());
    const stillOpen = await page.evaluate(() => document.getElementById('d0-summary').classList.contains('show'));
    const onDay0 = await page.evaluate(() => !!document.querySelector('#screen-day0.active'));
    check('外壳返回键先关掉结果摘要', opened && handled === true && !stillOpen && onDay0);
    check('外壳返回键再按回首页', (await page.evaluate(() => window.__tdBack())) === true && await waitFor(page, () => document.querySelector('#screen-home.active'), 3000));
    await page.close();
  }

  // 6. AI 动作训练：协调训练（每个动作 3 次）
  {
    const page = await open('/?mock=train&screen=play&mode=exercise&course=coord&reps=3&from=train');
    check('训练：先看示范', await waitFor(page, () => window.TD.play.debug().phase === 'intro', 12000));
    await sleep(2500);
    await shot(page, '11-train-intro');
    await waitFor(page, () => window.TD.play.debug().phase === 'go', 8000);
    await sleep(1500);
    await shot(page, '12-train-go');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 60000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('训练：协调训练三个动作都完成', done && rec && rec.type === 'exercise' && rec.steps.length === 3 && rec.steps.every((x) => x.reps === 3),
      rec ? rec.steps.map((x) => x.id + ' ' + x.reps + '/' + x.target).join('，') : '');
    check('训练：做对了三颗星', rec && rec.stars === 3);
    await sleep(400);
    await shot(page, '13-train-result');
    check('训练：结算页有完成任务或勋章的消息', await page.evaluate(() => document.querySelectorAll('#result .news-item').length > 0));
    check('训练：从入口进来的，结算页是「回上一页」', await page.evaluate(() => document.getElementById('btn-home').textContent === '回上一页'));
    await page.keyboard.press('Escape');
    check('训练：返回键回到 AI 动作训练入口', await waitFor(page, () => document.querySelector('#screen-hub.active') && document.getElementById('screen-hub').getAttribute('data-hub') === 'train', 4000));
    await page.close();
  }

  // 6b. 做不来可以跳过：暂停菜单里「跳过这个动作」
  {
    const page = await open('/?mock=still&screen=play&mode=exercise&course=balanceT&hold=3');
    for (let i = 0; i < 2; i++) {
      await waitFor(page, () => window.TD.play.debug().phase === 'go', 20000);
      await page.keyboard.press('Escape');
      await waitFor(page, () => document.getElementById('loading').classList.contains('show'), 3000);
      const hasSkip = await page.evaluate(() => Array.from(document.querySelectorAll('#loading-btns .btn')).some((b) => b.textContent === '跳过这个动作'));
      if (i === 0) check('训练：暂停菜单里有「跳过这个动作」', hasSkip);
      await page.evaluate(() => Array.from(document.querySelectorAll('#loading-btns .btn')).find((b) => b.textContent === '跳过这个动作').click());
      await waitFor(page, () => window.TD.play.debug().phase === 'stepdone' || window.TD.play.debug().phase === 'result', 3000);
    }
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 10000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('训练：两边都跳过，记为跳过、零星', done && rec && rec.steps.length === 2 && rec.steps.every((x) => x.skipped) && rec.stars === 0);
    await page.close();
  }

  // 7. 敏捷摸球
  {
    const page = await open('/?mock=mole&screen=play&mode=mole&dur=15&players=1');
    await waitFor(page, () => window.TD.play.debug().phase === 'play', 15000);
    await sleep(4000);
    await shot(page, '14-mole-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('敏捷摸球：一局结束，摸中了球', done && rec && rec.type === 'mole' && rec.hits >= 5, rec ? `得分 ${rec.score}，摸中 ${rec.hits}，漏掉 ${rec.misses}` : '');
    await page.close();
  }

  // 8. 左右闪避、太空躲障碍
  for (const [variant, type, age] of [['side', 'dodge', '6-8'], ['space', 'space', '9-12']]) {
    const page = await open(`/?mock=dodge&screen=play&mode=dodge&variant=${variant}&dur=22&age=${age}&players=1`);
    check(type + '：先学怎么躲', await waitFor(page, () => window.TD.play.debug().phase === 'learn', 20000));
    await waitFor(page, () => window.TD.play.debug().phase === 'play', 40000);
    await sleep(8000);
    await shot(page, '15-' + type + '-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check(type + '：坚持到最后，躲开了障碍', done && rec && rec.type === type && rec.survived && rec.dodged >= 5, rec ? `躲开 ${rec.dodged}，被撞 ${rec.hits}，得分 ${rec.score}` : '');
    await page.close();
  }

  // 9. 跟跳练舞（截短到 8 个舞步）和舞蹈教学
  {
    const page = await open('/?mock=dance&screen=play&mode=dance&routine=beat&short=8&players=1');
    check('跟跳：音乐开始，前奏数拍子', await waitFor(page, () => window.TD.play.debug().phase === 'dance', 15000));
    await sleep(12000);
    await shot(page, '16-dance');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('跟跳：跳完出结算，跟着小老师跳得了高分', done && rec && rec.type === 'dance' && rec.frac > 0.8, rec ? JSON.stringify(rec.counts) : '');
    await page.close();
  }
  {
    const page = await open('/?mock=dance&screen=play&mode=dance&routine=kungfu&learn=1&short=3&from=dance');
    check('教学：先看慢动作示范', await waitFor(page, () => window.TD.play.debug().phase === 'show', 15000));
    await sleep(2000);
    await shot(page, '17-dance-learn');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 60000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('教学：每个舞步都摆像了', done && rec && rec.type === 'dancelearn' && rec.ok === rec.total && rec.total >= 2, rec ? rec.ok + '/' + rec.total : '');
    check('教学：结算页第一个按钮是「跟着音乐跳」', await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-extra' && document.activeElement.textContent === '跟着音乐跳'));
    await page.keyboard.press('Enter');
    check('教学：按确定直接去跟着音乐跳', await waitFor(page, () => { const d = window.TD.play.debug(); return d.params && d.params.mode === 'dance' && !d.params.learn && d.phase === 'dance'; }, 15000));
    await page.close();
  }
  {
    const page = await open('/?mock=dance&screen=play&mode=dance&routine=twinkle&short=4&players=2');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 50000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('双人跟跳：两个人各自打分', done && rec && rec.players === 2 && rec.scores.length === 2 && rec.scores[0] > 0 && rec.scores[1] > 0, rec ? rec.scores.join(' : ') : '');
    await page.evaluate(() => window.TD.store.setSetting('players', 1));
    await page.close();
  }

  // 9b. 跟着视频跳：视频库（网页版：不联网查视频信息，B站视频要放的时候才打开）
  {
    const page = await open('/?screen=hub&hub=dance');
    await waitFor(page, () => document.querySelector('#screen-hub.active'), 5000);
    check('跟跳练舞：第一格是「跟着视频跳」', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-tile') === 'videos'));
    await page.keyboard.press('Enter');
    check('视频库：打开', await waitFor(page, () => document.querySelector('#screen-videos.active'), 3000));
    const info = await page.evaluate(() => ({ cats: document.querySelectorAll('#vl-cats .vl-cat').length, cards: document.querySelectorAll('#vl-grid .vcard').length, focus: document.activeElement && document.activeElement.className }));
    check('视频库：五个类别，学校里的操 13 个视频，焦点在第一个', info.cats === 5 && info.cards === 13 && /vcard/.test(info.focus), JSON.stringify(info));
    await sleep(500);
    await shot(page, '20-video-lib');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    const n2 = await page.evaluate(() => ({ cat: document.activeElement.getAttribute('data-cat'), cards: document.querySelectorAll('#vl-grid .vcard').length }));
    check('视频库：在类别之间移动就换列表', n2.cat === 'dance' && n2.cards === 22, JSON.stringify(n2));
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    const sc = await page.evaluate(() => document.getElementById('vl-grid').scrollTop);
    check('视频库：往下移，列表跟着滚', sc > 300, String(sc));
    await page.keyboard.press('Enter');
    check('视频库：确定键打开详情，焦点在「开始跳」', await waitFor(page, () => document.getElementById('vl-detail').classList.contains('show') && document.activeElement.textContent === '开始跳', 2000));
    await shot(page, '21-video-detail');
    await page.keyboard.press('Escape');
    check('视频库：返回键关掉详情', await waitFor(page, () => !document.getElementById('vl-sheet').classList.contains('show') && !!document.querySelector('#screen-videos.active'), 2000));
    // 隐藏一个视频，再显示出来
    await page.keyboard.press('Enter');
    await waitFor(page, () => document.getElementById('vl-detail').classList.contains('show'), 2000);
    await page.evaluate(() => Array.from(document.querySelectorAll('#vl-detail .btn')).find((b) => b.textContent === '隐藏这个视频').click());
    check('视频库：隐藏视频', await waitFor(page, () => Object.keys(window.TD.store.get().videos.hidden).length === 1 && document.querySelectorAll('#vl-grid .vcard:not(.more)').length === 21, 2000));
    await page.evaluate(() => document.querySelector('#vl-grid .vcard.more').click());
    check('视频库：列表最后可以显示隐藏的视频', await waitFor(page, () => document.querySelectorAll('#vl-grid .vcard.hidden-v').length === 1, 2000));
    await page.evaluate(() => document.querySelector('#vl-grid .vcard.hidden-v').click());
    await waitFor(page, () => document.getElementById('vl-detail').classList.contains('show'), 2000);
    await page.evaluate(() => Array.from(document.querySelectorAll('#vl-detail .btn')).find((b) => b.textContent === '不再隐藏').click());
    check('视频库：不再隐藏', await waitFor(page, () => Object.keys(window.TD.store.get().videos.hidden).length === 0, 2000));
    // 添加视频：屏幕键盘
    await page.evaluate(() => document.getElementById('vl-add').click());
    await waitFor(page, () => document.getElementById('vl-addbox').classList.contains('show'), 2000);
    check('添加视频：焦点在屏幕键盘上，添加按钮先是灰的', await page.evaluate(() => document.activeElement.classList.contains('vk') && document.getElementById('vl-add-ok').disabled));
    await page.evaluate(() => { const inp = document.getElementById('vl-input'); inp.value = 'BV1xx411c7m'; inp.dispatchEvent(new Event('input')); });
    await page.evaluate(() => Array.from(document.querySelectorAll('#vl-keys .vk')).find((b) => b.textContent === 'D').focus());
    await page.keyboard.press('Enter');
    const val = await page.evaluate(() => document.getElementById('vl-input').value);
    check('添加视频：屏幕键盘输入', val === 'BV1xx411c7mD', val);
    await shot(page, '22-video-add');
    await page.evaluate(() => document.getElementById('vl-add-ok').click());
    check('添加视频：加到「我添加的」', await waitFor(page, () => window.TD.store.get().videos.mine.length === 1 && document.querySelector('#vl-cats .vl-cat.on').getAttribute('data-cat') === 'mine', 3000));
    check('添加视频：列表里有它和「添加视频」格子', await page.evaluate(() => document.querySelectorAll('#vl-grid .vcard').length === 2 && !!document.querySelector('#vl-grid [data-bv="BV1xx411c7mD"]')));
    await page.evaluate(() => document.querySelector('#vl-grid [data-bv="BV1xx411c7mD"]').click());
    await waitFor(page, () => document.getElementById('vl-detail').classList.contains('show'), 2000);
    await page.evaluate(() => Array.from(document.querySelectorAll('#vl-detail .btn')).find((b) => b.textContent === '删除这个视频').click());
    check('添加视频：可以删掉', await waitFor(page, () => window.TD.store.get().videos.mine.length === 0, 2000));
    await page.keyboard.press('Escape');
    check('视频库：返回键回跟跳练舞', await waitFor(page, () => document.querySelector('#screen-hub.active') && document.getElementById('screen-hub').getAttribute('data-hub') === 'dance', 3000));
    await page.close();
  }

  // 9c. 跟着视频跳：演示视频（画出来的小人当老师；模拟的孩子慢 0.6 秒跟着做）
  {
    const page = await open('/?mock=video&screen=play&mode=video&demo=beat&dur=30&title=演示&from=videos');
    check('跟着视频跳：站好、倒数后开始放', await waitFor(page, () => { const m = window.TD.play.mode(); return m && m.phase === 'play'; }, 15000));
    await sleep(12000);
    await shot(page, '23-video-play');
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('跟着视频跳：跟着老师跳得了高分，AI 算出慢了 0.6 秒', done && rec && rec.type === 'video' && rec.score >= 80 && rec.aiBlocks >= 5 && Math.abs(rec.lag - 0.6) <= 0.2, rec ? JSON.stringify({ score: rec.score, lag: rec.lag, ai: rec.aiBlocks, counts: rec.counts }) : '');
    await sleep(500);
    await shot(page, '24-video-result');
    check('跟着视频跳：结算页是「回视频库」', await page.evaluate(() => document.getElementById('btn-home').textContent === '回视频库'));
    await page.keyboard.press('Escape');
    check('跟着视频跳：返回键回视频库', await waitFor(page, () => document.querySelector('#screen-videos.active'), 4000));
    await page.close();
  }

  // 9d. 跟着视频跳：电视版（B站播放器在视频层，安卓识别视频里的老师）
  {
    const page = await open('/?screen=play&mode=video&bv=BV1iPH8zmEyB&title=七彩阳光&cat=school&from=videos', { nativeStub: true });
    check('电视版视频：打开B站外链播放器', await waitFor(page, () => window.__nativeLog.videoOpens.length === 1, 10000));
    const open0 = await page.evaluate(() => window.__nativeLog.videoOpens[0]);
    check('电视版视频：播放器地址和位置', /^https:\/\/player\.bilibili\.com\/player\.html\?/.test(open0.url) && /bvid=BV1iPH8zmEyB/.test(open0.url) && /danmaku=0/.test(open0.url) && Math.abs(open0.x - 24) < 2 && Math.abs(open0.w - 1320) < 2, JSON.stringify(open0));
    check('电视版视频：摄像头画面放在右边的小框里', await waitFor(page, () => window.__nativeLog.previews.some((p) => p.show && Math.abs(p.x - 1368) < 3 && Math.abs(p.w - 528) < 3), 8000), JSON.stringify(await page.evaluate(() => window.__nativeLog.previews.slice(-1))));
    check('电视版视频：自动播放先停住，站好后再放', await waitFor(page, () => { const m = window.TD.play.mode(); return m && m.phase === 'play'; }, 20000) && (await page.evaluate(() => window.__nativeLog.videoCmds.indexOf('pause') >= 0 && window.__nativeLog.videoCmds.indexOf('play') >= 0)));
    check('电视版视频：开始识别视频里的老师', (await page.evaluate(() => window.__nativeLog.coachStarts.length >= 1 && window.__nativeLog.coachStarts[0].target === 'video')));
    await sleep(6000);
    await shot(page, '25-video-native');
    await page.keyboard.press('Escape');
    await waitFor(page, () => document.getElementById('loading').classList.contains('show'), 3000);
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#loading-btns .btn')).map((b) => b.textContent));
    check('电视版视频：暂停菜单里能镜像画面、提前结束', btns.indexOf('画面左右镜像') >= 0 && btns.indexOf('结束，看成绩') >= 0, btns.join('、'));
    await page.evaluate(() => Array.from(document.querySelectorAll('#loading-btns .btn')).find((b) => b.textContent === '画面左右镜像').click());
    check('电视版视频：镜像后接着放', await waitFor(page, () => window.__nativeLog.videoCmds.indexOf('mirror') >= 0 && !document.getElementById('loading').classList.contains('show'), 3000));
    await page.keyboard.press('ArrowRight');
    check('电视版视频：右键快进 10 秒', await page.evaluate(() => window.__nativeLog.videoCmds.indexOf('seek') >= 0));
    const done = await waitFor(page, () => window.TD.play.debug().lastRec, 40000);
    const rec = await page.evaluate(() => window.TD.play.debug().lastRec);
    check('电视版视频：放完出结算，AI 看着老师打分', done && rec && rec.type === 'video' && rec.coach === 'copy' && rec.aiBlocks >= 3 && rec.score >= 60, rec ? JSON.stringify({ score: rec.score, coach: rec.coach, ai: rec.aiBlocks, move: rec.moveBlocks, lag: rec.lag, counts: rec.counts }) : '');
    await shot(page, '26-video-native-result');
    await page.keyboard.press('Escape');
    check('电视版视频：回到视频库', await waitFor(page, () => document.querySelector('#screen-videos.active'), 4000));
    check('电视版视频：离开后关掉视频层和老师识别', await page.evaluate(() => window.__nativeLog.videoCloses >= 1 && window.__nativeLog.coachStops >= 1));
    check('电视版视频库：查到了视频的时长和 UP 主', await waitFor(page, () => { const c = document.querySelector('#vl-grid .vcard'); return c && c.querySelector('.vc-dur').textContent === '1:35' && /测试UP主/.test(c.querySelector('.vc-meta').textContent); }, 5000));
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#vl-cats .vl-cat')).find((x) => x.getAttribute('data-cat') === 'dance'); b.focus(); });
    check('电视版视频库：B站上没了的视频标出来', await waitFor(page, () => { const c = document.querySelector('#vl-grid [data-bv="BV1Su4y1V7rS"]'); return c && c.classList.contains('gone'); }, 5000));
    await shot(page, '27-video-lib-native');
    await page.close();
  }

  // 10. 遥控游戏：电视版用带光标的浏览器打开网站
  {
    const page = await open('/?screen=hub&hub=remote', { nativeStub: true });
    await waitFor(page, () => document.querySelector('#screen-hub.active'), 5000);
    await page.keyboard.press('Enter');
    const log = await page.evaluate(() => window.__nativeLog.browser || []);
    check('遥控游戏：确定键用安卓浏览器打开 Scratch', log.length === 1 && log[0].url === 'https://scratch.mit.edu/' && log[0].title === 'Scratch', JSON.stringify(log));
    check('遥控游戏：应用自己的页面没有跳走', await page.evaluate(() => !!document.querySelector('#screen-hub.active')));
    await page.close();
  }

  // 11. 成长中心
  {
    const page = await open('/?screen=growth');
    check('成长中心：三个今日任务', await waitFor(page, () => document.querySelectorAll('#tasks li').length === 3, 5000));
    const info = await page.evaluate(() => ({
      medals: document.querySelectorAll('#medals .medal').length,
      got: document.querySelectorAll('#medals .medal.on').length,
      chips: document.querySelectorAll('#course-chips .chip').length,
      planet: document.getElementById('planet-name').textContent,
      stars: window.TD.store.get().totals.stars
    }));
    check('成长中心：勋章和课程进度', info.medals === 18 && info.got >= 2 && info.chips === 9, JSON.stringify(info));
    check('成长中心：玩过之后星球有了星星', info.stars > 0 && /第 \d+ 级/.test(info.planet), JSON.stringify(info));
    await page.evaluate(() => document.querySelector('#medals .medal').focus());
    check('成长中心：选中勋章显示怎么得到', /：/.test(await page.evaluate(() => document.getElementById('medal-desc').textContent)));
    await sleep(800);
    await shot(page, '18-growth');
    await page.click('#growth-records');
    check('训练记录：从成长中心进入', await waitFor(page, () => document.querySelector('#screen-records.active'), 3000));
    check('训练记录：最近的训练有记录', (await page.evaluate(() => document.querySelectorAll('#rec-recent li:not(.empty-note)').length)) >= 5);
    await shot(page, '19-records');
    await page.keyboard.press('Escape');
    check('训练记录：返回键回成长中心', await waitFor(page, () => document.querySelector('#screen-growth.active'), 3000));
    await page.close();
  }

  const home = await open('/');
  await waitFor(home, () => document.querySelector('#screen-home.active'), 8000);
  await sleep(300);
  await shot(home, '10-home-after');
  await home.close();

  check('没有访问外网', external.length === 0, external.slice(0, 5).join(' '));
  check('没有脚本报错', pageErrors.length === 0, pageErrors.slice(0, 6).join(' | '));
} catch (e) {
  check('测试脚本执行', false, e && e.stack ? e.stack : String(e));
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 项未通过` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
