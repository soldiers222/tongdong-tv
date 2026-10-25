// 端到端测试：本机 Chrome 无头模式 + 假摄像头。
// 用法：cd tests && npm install && FAKE_CAMERA=/path/person.y4m node e2e.mjs
//   FAKE_CAMERA 可选：提供一段 y4m 全身视频（见 make-fixture.py）时，会用真实识别模型跑设备测试。
//   CHROME 可选：Chrome 路径，默认 /opt/google/chrome/chrome。
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch (e) { /* wait */ }
  await sleep(100);
}

const args = [
  '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
  '--window-size=1920,1080'
];
if (FIXTURE) args.push('--use-file-for-fake-video-capture=' + FIXTURE);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, protocolTimeout: 300000 });

const external = [];
const pageErrors = [];
async function open(path) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('request', (req) => {
    const u = req.url();
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
  // 1. 首页与遥控器导航
  {
    const page = await open('/');
    check('首页显示', await waitFor(page, () => document.querySelector('#screen-home.active'), 8000));
    check('展示字体已加载', await page.evaluate(() => document.fonts.check('48px "TD Display"')));
    await sleep(300);
    await shot(page, '01-home');
    const id = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    check('默认焦点在西瓜切切切', (await id()) === 'lane-fruit');
    await page.keyboard.press('ArrowDown');
    check('下键到金鸡独立', (await id()) === 'lane-balance');
    await page.keyboard.press('ArrowDown');
    check('再下键到设备测试', (await id()) === 'tool-day0');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    check('右键两次进入家长设置', await waitFor(page, () => document.querySelector('#screen-settings.active'), 3000));
    const before = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => document.activeElement.querySelector('.val').textContent);
    check('左右键修改年龄段', before !== after, before + ' → ' + after);
    await page.keyboard.press('ArrowLeft');
    await shot(page, '06-settings');
    await page.keyboard.press('Escape');
    check('返回键回首页', await waitFor(page, () => document.querySelector('#screen-home.active'), 3000));
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
    const ok = await waitFor(page, () => !window.TD.day0.debug().benching && window.TD.day0.debug().results.length === 6, 330000);
    const dbg = await page.evaluate(() => window.TD.day0.debug());
    check('六个引擎都测完', ok, dbg.results.map((r) => r.id + (r.error ? '（' + r.error + '）' : ' ' + r.fps.toFixed(1) + 'fps/' + r.kpAvg.toFixed(1) + '点')).join('；'));
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

  // 5. 运动记录
  {
    const page = await open('/?screen=records');
    check('运动记录页显示', await waitFor(page, () => document.querySelectorAll('#rec-bars li').length === 7, 5000));
    await shot(page, '09-records');
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
  server.kill();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 项未通过` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
