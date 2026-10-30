// 四个入口页（体感游戏、跟跳练舞、AI 动作训练、遥控游戏）：一页一块场地颜色，里面是一格一格的活动。
// 能双人的格子上按左右键切换单人 / 双人（所有游戏共用一个设置）。
import * as store from '../core/store.js';
import { setScope } from '../core/nav.js';
import { sfx } from '../core/sfx.js';
import { ui } from './ui.js';
import { go } from '../router.js';
import { fmtSec } from '../core/util.js';
import { figure, drawFigure } from '../core/figure.js';
import { MOVES } from '../dance/routines.js';
import { EXERCISES } from '../training/exercises.js';
import * as native from '../pose/native.js';
import { VIDEOS } from '../video/videos.js';

var VIDEO_TOTAL = VIDEOS.length;

// 跟着跳过几个不同的视频
function videoCount() {
  var n = 0, pr = store.get().progress;
  for (var k in pr) if (k.indexOf('video:') === 0) n++;
  return n;
}

function $(id) { return document.getElementById(id); }

var ICONS = {
  fruit: '<svg viewBox="0 0 120 120"><path d="M8 46 A52 52 0 0 0 112 46 Z" fill="#2E7D4F" stroke="#13213C" stroke-width="4" stroke-linejoin="round"/><path d="M17 46 A43 43 0 0 0 103 46 Z" fill="#F7F5EF"/><path d="M23 46 A37 37 0 0 0 97 46 Z" fill="#E8414B"/><g fill="#13213C"><ellipse cx="42" cy="58" rx="3.2" ry="5"/><ellipse cx="60" cy="64" rx="3.2" ry="5"/><ellipse cx="78" cy="58" rx="3.2" ry="5"/></g></svg>',
  space: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30 26 L48 18 L66 24 L70 42 L58 56 L38 54 L26 42 Z" fill="currentColor" fill-opacity="0.25"/><path d="M6 78 L114 78" stroke-dasharray="2 12"/><path d="M20 100 L100 100"/><path d="M86 20 L104 38 M104 20 L86 38"/></svg>',
  mole: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><circle cx="34" cy="40" r="16" fill="currentColor" fill-opacity="0.25"/><circle cx="86" cy="32" r="12"/><circle cx="74" cy="84" r="20" fill="currentColor" fill-opacity="0.25"/><path d="M22 96 L40 78 M34 100 L46 86 M18 84 L36 70"/></svg>',
  dodge: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M48 14 L20 110 M72 14 L100 110 M56 14 L52 110 M64 14 L68 110" stroke-width="4"/><circle cx="60" cy="52" r="14" fill="currentColor" fill-opacity="0.3"/><path d="M26 86 L8 86 M14 80 L8 86 L14 92 M94 86 L112 86 M106 80 L112 86 L106 92"/></svg>',
  duo: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="36" cy="22" r="9"/><path d="M36 32 L36 66 M36 42 L18 56 M36 42 L56 34 M36 66 L24 100 M36 66 L48 100"/><circle cx="84" cy="22" r="9"/><path d="M84 32 L84 66 M84 42 L64 34 M84 42 L102 56 M84 66 L72 100 M84 66 L96 100"/></svg>',
  blocks: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"><path d="M14 22 L52 22 L52 30 L62 30 L62 22 L100 22 L100 46 L14 46 Z" fill="currentColor" fill-opacity="0.25"/><path d="M26 52 L64 52 L64 60 L74 60 L74 52 L106 52 L106 76 L26 76 Z"/><path d="M14 82 L52 82 L52 90 L62 90 L62 82 L92 82 L92 106 L14 106 Z" fill="currentColor" fill-opacity="0.25"/></svg>',
  code: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M42 30 L14 60 L42 90 M78 30 L106 60 L78 90 M68 20 L52 100"/></svg>',
  quest: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 104 L20 40 L36 40 L36 30 L48 30 L48 40 L72 40 L72 30 L84 30 L84 40 L100 40 L100 104 Z"/><path d="M48 104 L48 76 C48 64 72 64 72 76 L72 104"/><path d="M58 14 L58 30 M58 14 L74 20 L58 24"/></svg>',
  board: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"><rect x="14" y="14" width="92" height="92" rx="8"/><path d="M14 52 L106 52 M14 68 L106 68 M52 14 L52 106 M68 14 L68 106" stroke-width="4"/><circle cx="34" cy="34" r="9" fill="currentColor"/><circle cx="86" cy="86" r="9"/></svg>',
  knight: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M34 104 L86 104 M40 92 L80 92 L76 70 C90 58 88 32 70 22 L64 12 L58 22 C44 24 30 40 32 54 L46 52 L52 60 C44 70 40 80 40 92 Z" fill="currentColor" fill-opacity="0.25"/><circle cx="60" cy="38" r="3" fill="currentColor"/></svg>',
  video: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"><rect x="14" y="26" width="92" height="68" rx="10"/><path d="M50 44 L76 60 L50 76 Z" fill="currentColor"/></svg>'
};

function bestOther(key) { return store.get().best.other[key] || 0; }
function prog(key) { return store.get().progress[key] || { n: 0, stars: 0 }; }
function starsText(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆'; return s; }
function age() { return store.settings().age === '9-12' ? '9-12' : '6-8'; }

function playMeta(scoreKey, unit) {
  return function () {
    var b = bestOther(scoreKey());
    return b ? '最好 ' + b + (unit || ' 分') : '还没玩过';
  };
}

function courseMeta(key) {
  return function () {
    var p = prog(key);
    return p.n ? starsText(p.stars) + '　练过 ' + p.n + ' 次' : '还没练过';
  };
}

export var HUBS = {
  games: {
    title: '体感游戏',
    sub: '站起来，用整个身体玩',
    note: '右上角选单人或双人（按确定切换）。双人时两个人一左一右站在电视前，各玩各的半边。',
    tiles: [
      { id: 'fruit', title: '西瓜切切切', desc: '挥手切水果，用对的手切星星，别碰炸弹', icon: 'fruit', go: { mode: 'fruit' }, duo: true,
        meta: function () { var b = store.get().best.fruit[age()] || 0; return b ? '最好 ' + b + ' 分' : '还没玩过'; } },
      { id: 'space', title: '太空躲障碍', desc: '陨石往旁边躲，激光要蹲下，能量栏要跳过去', icon: 'space', go: { mode: 'dodge', variant: 'space' }, duo: true,
        meta: playMeta(function () { return 'space-' + age(); }) },
      { id: 'mole', title: '敏捷摸球', desc: '球在身边冒出来，快伸手去摸', icon: 'mole', go: { mode: 'mole' }, duo: true,
        meta: playMeta(function () { return 'mole-' + age(); }) },
      { id: 'dodge', title: '左右闪避', desc: '大球滚过来，往旁边跨一步躲开', icon: 'dodge', go: { mode: 'dodge', variant: 'side' }, duo: true,
        meta: playMeta(function () { return 'dodge-' + age(); }) },
      { id: 'duo', title: '双人闯关', desc: '两个人合作，一关一关闯过去', icon: 'duo', soon: true }
    ]
  },
  dance: {
    title: '跟跳练舞',
    sub: '跟着网上的视频跳，或者先学舞步再跟着音乐跳；骨架线变绿就是跳对了',
    note: '跟着视频跳：视频来自B站，要联网，AI 一边看视频里的老师一边看你。跟跳可以两个人一起跳（右上角切换），音乐是现场合成的。',
    tiles: [
      { id: 'videos', title: '跟着视频跳', desc: '广播体操、儿童舞、健身操，AI 看着老师给你打分', icon: 'video', screen: 'videos',
        meta: function () { var n = videoCount(); return n ? '跳过 ' + n + ' 个视频' : VIDEO_TOTAL + ' 个视频'; } },
      { id: 'twinkle', title: '跟跳：小星星', desc: '入门，跟着童谣慢慢跳', pose: MOVES.star.keys[0].pose, go: { mode: 'dance', routine: 'twinkle' }, duo: true,
        meta: function () { var b = bestOther('dance-twinkle'); return b ? '最好 ' + b + ' 分' : '还没跳过'; } },
      { id: 'twinkle-learn', title: '教学：小星星', desc: '一个一个学舞步，摆像了才往下', pose: MOVES.sparkle.keys[0].pose, go: { mode: 'dance', routine: 'twinkle', learn: true }, meta: courseMeta('learn:twinkle') },
      { id: 'beat', title: '跟跳：动感节拍', desc: '进阶，节奏快，左右手轮流换', pose: MOVES.discoL.keys[0].pose, go: { mode: 'dance', routine: 'beat' }, duo: true,
        meta: function () { var b = bestOther('dance-beat'); return b ? '最好 ' + b + ' 分' : '还没跳过'; } },
      { id: 'beat-learn', title: '教学：动感节拍', desc: '16 个舞步，先学会再跳', pose: MOVES.pointL.keys[0].pose, go: { mode: 'dance', routine: 'beat', learn: true }, meta: courseMeta('learn:beat') },
      { id: 'kungfu', title: '跟跳：功夫小子', desc: '冲拳、上架、提膝，跳一支武术操', pose: MOVES.punchL.keys[0].pose, go: { mode: 'dance', routine: 'kungfu' }, duo: true,
        meta: function () { var b = bestOther('dance-kungfu'); return b ? '最好 ' + b + ' 分' : '还没跳过'; } },
      { id: 'kungfu-learn', title: '教学：功夫小子', desc: '马步、抱拳礼、白鹤亮翅', pose: MOVES.crane.keys[0].pose, go: { mode: 'dance', routine: 'kungfu', learn: true }, meta: courseMeta('learn:kungfu') }
    ]
  },
  train: {
    title: 'AI 动作训练',
    sub: '摄像头看着你做：数个数、计时间、提醒哪里要改',
    note: '每个动作开始前有示范，黄色的是要动的地方。做不来的动作可以按返回键暂停，选「跳过这个动作」。',
    tiles: [
      { id: 'balance', title: '金鸡独立', desc: '单脚站，膝盖抬到腰高，比比哪条腿站得久', pose: { arms: 'out', liftRight: 1 }, go: { mode: 'balance' }, duo: true,
        meta: function () { var b = store.get().best.balance; var m = Math.max(b.left || 0, b.right || 0); return m ? '最久 ' + fmtSec(m) + ' 秒' : '还没站过'; } },
      { id: 'balanceT', title: '单脚平衡', desc: '飞机式：单脚站稳，两手侧平举', pose: EXERCISES.balanceT.demo[0], go: { mode: 'exercise', course: 'balanceT' }, meta: courseMeta('ex:balanceT') },
      { id: 'squat', title: '深蹲', desc: '屁股往后坐，膝盖朝脚尖', pose: { arms: 'out', squat: 0.85 }, go: { mode: 'exercise', course: 'squat' }, meta: courseMeta('ex:squat') },
      { id: 'lunge', title: '弓步蹲', desc: '一步迈出去，身体往下沉，左右轮流', pose: { arms: 'waist', lungeLeft: 1 }, go: { mode: 'exercise', course: 'lunge' }, meta: courseMeta('ex:lunge') },
      { id: 'coord', title: '协调训练', desc: '开合跳、高抬腿、交叉摸膝', pose: { arms: 'up', spread: 1 }, go: { mode: 'exercise', course: 'coord' }, meta: courseMeta('ex:coord') },
      { id: 'yoga', title: '瑜伽小课', desc: '山式、树式、战士二式、星星式、椅子式', pose: { arms: 'top', footOnRight: true }, go: { mode: 'exercise', course: 'yoga' }, meta: courseMeta('ex:yoga') },
      { id: 'wushu', title: '武术基本功', desc: '马步、冲拳、格挡、提膝、侧踹、太极起势', pose: { arms: 'waist', spread: 1.2, squat: 0.3, punchLeft: 1 }, go: { mode: 'exercise', course: 'wushu' }, meta: courseMeta('ex:wushu') }
    ]
  },
  remote: {
    title: '遥控游戏',
    sub: '坐下来动动脑：编程和下棋（会打开这些网站；拖积木的插个无线鼠标更好用）',
    note: '网站里：方向键移动光标，确定键点一下，按住确定再按方向键可以拖动、滚动；返回键后退，菜单键放大缩小。',
    tiles: [
      { id: 'scratch', title: 'Scratch', desc: '拖积木编程，做动画和小游戏', icon: 'blocks', url: 'https://scratch.mit.edu/', tag: '要拖积木' },
      { id: 'codeorg', title: 'Code.org', desc: '闯关学编程，有很多主题小课', icon: 'code', url: 'https://code.org/en-US', tag: '要拖积木' },
      { id: 'blockly', title: 'Blockly Games', desc: '迷宫、鸟、乌龟，一关一关学编程', icon: 'blocks', url: 'https://blockly.games/?lang=zh-hans', tag: '要拖积木' },
      { id: 'codecombat', title: 'CodeCombat', desc: '写代码控制英雄闯关', icon: 'quest', url: 'https://codecombat.com/', tag: '要打字' },
      { id: 'makecode', title: 'MakeCode', desc: '微软的积木编程，可以做小游戏', icon: 'blocks', url: 'https://makecode.microsoft.com/', tag: '要拖积木' },
      { id: 'hour', title: '编程一小时', desc: 'Hour of Code / Hour of AI 活动合集', icon: 'code', url: 'https://csforall.org/en-US/hour-of-ai', tag: '英文' },
      { id: 'chesskid', title: 'ChessKid', desc: '给小朋友的国际象棋：学棋、做题、对弈', icon: 'knight', url: 'https://www.chesskid.com/', tag: '点一点就能下' },
      { id: 'lichess', title: 'Lichess', desc: '免费国际象棋，可以和电脑下', icon: 'board', url: 'https://lichess.org/', tag: '点一点就能下' }
    ]
  }
};

var current = null;
var lastFocus = {};

function players() { return store.settings().players === 2 ? 2 : 1; }

function renderPlayers() {
  var opts = document.querySelectorAll('#hub-players .opt');
  for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('on', Number(opts[i].getAttribute('data-p')) === players());
  var tags = document.querySelectorAll('#hub-tiles .duo-tag');
  for (var j = 0; j < tags.length; j++) tags[j].classList.toggle('on', players() === 2);
}

function setPlayers(n) {
  if (n === players()) return;
  store.setSetting('players', n);
  renderPlayers();
  sfx.select();
  ui.toast(n === 2 ? '双人：两个人一左一右站在电视前，标着「可双人」的可以一起玩' : '单人：一个人站在电视前玩', 2600);
}

var bound = false;
function bind() {
  if (bound) return;
  bound = true;
  // 页面右上角的「单人 / 双人」：按确定切换（左右键留给在格子之间移动）
  $('hub-players').addEventListener('click', function () { setPlayers(players() === 2 ? 1 : 2); });
}

function open(tile) {
  if (tile.soon) {
    sfx.wrong();
    ui.toast('「' + tile.title + '」下一版就有，先玩别的吧', 2600);
    return;
  }
  if (tile.url) {
    openSite(tile);
    return;
  }
  if (tile.screen) {
    go(tile.screen, { from: current });
    return;
  }
  var p = {};
  for (var k in tile.go) p[k] = tile.go[k];
  p.from = current;
  go('play', p);
}

export function openSite(tile) {
  if (native.openBrowser(tile.url, tile.title)) return;
  if (native.inApp()) {
    // 旧版电视 APK 没有带光标的浏览器：别把应用自己的页面跳走
    ui.toast('这个功能要更新到新版电视 APK', 3000);
    return;
  }
  // 网页版：新窗口打开
  try {
    var w = window.open(tile.url, '_blank');
    if (!w) location.href = tile.url;
  } catch (e) {
    location.href = tile.url;
  }
}

function drawThumb(cv, pose) {
  var c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  drawFigure(c, figure(pose), { x: 0, y: 6, w: cv.width, h: cv.height - 12 }, { mirror: store.settings().mirror !== false, width: 9 });
}

export var hubScreen = {
  manageFocus: true,
  enter: function (params) {
    bind();
    var id = params && HUBS[params.id] ? params.id : 'games';
    current = id;
    var hub = HUBS[id];
    var el = $('screen-hub');
    el.setAttribute('data-hub', id);
    $('hub-title').textContent = hub.title;
    $('hub-sub').textContent = hub.sub;
    $('hub-note').textContent = hub.note || '';
    var box = $('hub-tiles');
    box.innerHTML = '';
    var first = null, remember = null;
    hub.tiles.forEach(function (tile) {
      var b = document.createElement('button');
      b.className = 'tile focusable' + (tile.soon ? ' soon' : '');
      b.setAttribute('data-tile', tile.id);
      var art = '';
      if (tile.pose) art = '<canvas width="220" height="200"></canvas>';
      else art = ICONS[tile.icon] || '';
      var meta = tile.soon ? '下一版' : (tile.tag || (tile.meta ? tile.meta() : ''));
      b.innerHTML = '<span class="tile-art">' + art + '</span>' +
        '<span class="tile-title">' + tile.title + '</span>' +
        '<span class="tile-desc">' + tile.desc + '</span>' +
        '<span class="tile-foot"><span class="tile-meta">' + meta + '</span>' +
        (tile.duo ? '<span class="duo-tag">可双人</span>' : '') +
        '</span>';
      b.addEventListener('click', function () { open(tile); });
      b.addEventListener('focus', function () { lastFocus[id] = tile.id; });
      box.appendChild(b);
      if (tile.pose) drawThumb(b.querySelector('canvas'), tile.pose);
      if (!first) first = b;
      if (lastFocus[id] === tile.id) remember = b;
    });
    var anyDuo = hub.tiles.some(function (t) { return t.duo; });
    $('hub-players').style.display = anyDuo ? '' : 'none';
    renderPlayers();
    setScope(el, remember || first);
  },
  backTo: function () { return ['home', { from: current }]; },
  current: function () { return current; }
};
