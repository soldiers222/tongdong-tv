// 生成电视版 APK 的图标和桌面横幅（PNG），放进 android/app/src/main/res/。
// 用法：先在 tests/ 里 npm install，然后 node tools/make-icons.mjs
//   CHROME 可选：Chrome 路径，默认 /opt/google/chrome/chrome
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../tests/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const ROOT = new URL('..', import.meta.url).pathname;
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const CHROME = process.env.CHROME || '/opt/google/chrome/chrome';
// 有完整字体就用完整字体（横幅里有网页没用到的字），否则用网页里的子集
const fullFont = join(ROOT, 'tools', 'fonts', 'ZCOOLQingKeHuangYou-Regular.ttf');
let font, fontFormat;
try { font = readFileSync(fullFont).toString('base64'); fontFormat = 'truetype'; }
catch (e) { font = readFileSync(join(ROOT, 'web', 'fonts', 'display.woff2')).toString('base64'); fontFormat = 'woff2'; }
const icon = 'data:image/svg+xml;base64,' + readFileSync(join(ROOT, 'web', 'favicon.svg')).toString('base64');

// 西瓜图形（与首页、favicon 同一套）
const melon = `
  <path d="M8 46 A52 52 0 0 0 112 46 Z" fill="#2E7D4F" stroke="#13213C" stroke-width="4" stroke-linejoin="round"/>
  <path d="M17 46 A43 43 0 0 0 103 46 Z" fill="#F7F5EF"/>
  <path d="M23 46 A37 37 0 0 0 97 46 Z" fill="#E8414B"/>
  <g fill="#13213C">
    <ellipse cx="42" cy="58" rx="3.2" ry="5" transform="rotate(-20 42 58)"/>
    <ellipse cx="60" cy="64" rx="3.2" ry="5"/>
    <ellipse cx="78" cy="58" rx="3.2" ry="5" transform="rotate(20 78 58)"/>
    <ellipse cx="51" cy="74" rx="3" ry="4.6" transform="rotate(-10 51 74)"/>
    <ellipse cx="69" cy="74" rx="3" ry="4.6" transform="rotate(10 69 74)"/>
  </g>`;

// 横幅 320×180：塑胶跑道红底，左边西瓜，右边字标，底部一条白色跑道线
const banner = `<!doctype html><html><head><style>
  @font-face { font-family: TD; src: url(data:font/${fontFormat === 'woff2' ? 'woff2' : 'ttf'};base64,${font}) format('${fontFormat}'); }
  html, body { margin: 0; width: 320px; height: 180px; overflow: hidden; }
  body { background: #B5443A; position: relative; font-family: TD, sans-serif; }
  .line { position: absolute; left: 0; right: 0; height: 5px; background: #F7F5EF; }
  .m { position: absolute; left: 14px; top: 34px; width: 104px; height: 104px; }
  .t { position: absolute; left: 124px; top: 52px; font-size: 46px; font-weight: bold; line-height: 1; color: #F7F5EF; letter-spacing: 1px; }
  .s { position: absolute; left: 126px; top: 108px; font-size: 20px; font-weight: bold; color: #FFC928; letter-spacing: 3px; }
</style></head><body>
  <div class="line" style="top:16px"></div>
  <div class="line" style="bottom:16px"></div>
  <svg class="m" viewBox="0 0 120 120"><g transform="translate(0 -4)">${melon}</g></svg>
  <div class="t">童动乐园</div>
  <div class="s">体感运动</div>
</body></html>`;

const iconPage = (size) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
  img { width: ${size}px; height: ${size}px; display: block; }
</style></head><body><img src="${icon}"></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, size] of Object.entries(densities)) {
    const dir = join(RES, 'mipmap-' + d);
    mkdirSync(dir, { recursive: true });
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(iconPage(size), { waitUntil: 'load' });
    await page.screenshot({ path: join(dir, 'ic_launcher.png'), omitBackground: true });
  }
  for (const [d, scale] of Object.entries({ xhdpi: 1, xxxhdpi: 2 })) {
    const dir = join(RES, 'drawable-' + d);
    mkdirSync(dir, { recursive: true });
    await page.setViewport({ width: 320, height: 180, deviceScaleFactor: scale });
    await page.setContent(banner, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, 'banner.png') });
  }
  console.log('图标和横幅已生成到', RES);
} finally {
  await browser.close();
}
