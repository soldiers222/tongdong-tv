// 跟着视频跳 · 视频库：按类别（学校里的操、儿童律动舞、健身操、我添加的、电视里的视频）一格一格排开，
// 选一个视频按确定看详情，再按确定开始跳。电视版会联网查每个视频的标题、时长、封面，查不到的标成「视频没了」。
// 家长可以添加B站视频（输入 BV 号或 b23.tv 短链接；有屏幕键盘，也能用电视自带的输入法或 adb 输入）。
import * as store from '../core/store.js';
import { setScope } from '../core/nav.js';
import { sfx } from '../core/sfx.js';
import { ui } from '../ui/ui.js';
import { go } from '../router.js';
import { figure, drawFigure } from '../core/figure.js';
import { CATS, VIDEOS, parseInput, fmtDur, pageUrl, videoKey, findVideo } from './videos.js';
import { inApp } from '../pose/native.js';

var APP = 'https://appassets.androidplatform.net/';

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
}

// 电视版才能联网查B站的视频信息、读电视里的视频
function biliOk() { return inApp() && !!(window.TongdongNative && window.TongdongNative.videoOpen); }
function mediaOk() { return inApp() && !!(window.TongdongNative && window.TongdongNative.mediaDir); }

// ---------- 视频信息（标题、时长、封面），只在电视版里查 ----------
var meta = {};     // bv → {code, data} / {pending: true}
var waiters = {};

function loadMeta(bv, cb) {
  if (!biliOk()) return;
  var m = meta[bv];
  if (m && !m.pending) { if (cb) cb(m); return; }
  if (cb) (waiters[bv] = waiters[bv] || []).push(cb);
  if (m && m.pending) return;
  meta[bv] = { pending: true };
  fetch(APP + 'bili/view/' + bv).then(function (r) { return r.json(); }).then(function (j) {
    meta[bv] = j || { code: -1 };
  }, function () {
    meta[bv] = { code: -1, message: '联网失败' };
  }).then(function () {
    var ws = waiters[bv] || [];
    delete waiters[bv];
    for (var i = 0; i < ws.length; i++) ws[i](meta[bv]);
  });
}

function metaOf(bv) {
  var m = meta[bv];
  return m && !m.pending ? m : null;
}

// 视频没了（删了、不公开了）
function goneOf(m) { return !!m && m.code !== 0 && m.code !== -1 && m.code !== -412; }

// ---------- 没有封面时的小人图（按类别摆个姿势），画一次反复用 ----------
var thumbs = {};
var THUMB_POSE = {
  school: { arms: 'out' },
  dance: { leftHand: { x: 0.65, y: 0.09 }, rightHand: { x: 0.4, y: 0.56 } },
  fit: { arms: 'up', spread: 1 },
  mine: { arms: 'wide', spread: 0.8 },
  local: { arms: 'top' }
};
var THUMB_BG = { school: '#B5443A', dance: '#1F4FA8', fit: '#2E7D4F', mine: '#172947', local: '#172947' };

function thumbFor(cat) {
  if (thumbs[cat]) return thumbs[cat];
  var cv = document.createElement('canvas');
  cv.width = 384;
  cv.height = 216;
  var c = cv.getContext('2d');
  c.fillStyle = THUMB_BG[cat] || '#172947';
  c.fillRect(0, 0, 384, 216);
  drawFigure(c, figure(THUMB_POSE[cat] || {}), { x: 0, y: 14, w: 384, h: 190 }, { width: 9 });
  try { thumbs[cat] = cv.toDataURL('image/png'); } catch (e) { thumbs[cat] = ''; }
  return thumbs[cat];
}

// ---------- 列表 ----------
function videosStore() { return store.get().videos; }

function hiddenOf(v) { return !!videosStore().hidden[v.bv]; }

// 一个类别里要显示的视频（我添加的、电视里的另算）
function listOf(cat, showHidden) {
  if (cat === 'mine') {
    return videosStore().mine.map(function (m) {
      return { bv: m.bv, p: m.p || 1, cat: 'mine', title: m.title || m.bv, mine: true };
    });
  }
  return VIDEOS.filter(function (v) { return v.cat === cat && (showHidden || !hiddenOf(v)); });
}

function hiddenCount(cat) {
  return VIDEOS.filter(function (v) { return v.cat === cat && hiddenOf(v); }).length;
}

function bestOf(v) { return store.get().best.other['video-' + videoKey(v)] || 0; }

var cur = 'school';
var showHidden = false;
var lastFocus = {};
var locals = null;      // 电视里的视频列表（/media/list 的结果）
var sheetEntry = null;
var sheetOpen = null;   // 'detail' | 'add' | null
var bound = false;

function renderCats() {
  var box = $('vl-cats');
  box.innerHTML = '';
  CATS.forEach(function (c) {
    if (c.id === 'local' && !mediaOk() && !window.File) return;
    var b = document.createElement('button');
    b.className = 'vl-cat focusable' + (c.id === cur ? ' on' : '');
    b.setAttribute('data-cat', c.id);
    var n = c.id === 'mine' ? videosStore().mine.length : (c.id === 'local' ? (locals ? locals.list.length : '') : listOf(c.id).length);
    b.innerHTML = '<span class="cn">' + c.name + '</span>' + (n !== '' ? '<span class="cc">' + n + '</span>' : '');
    // 遥控器移到哪个类别就显示哪个类别
    b.addEventListener('focus', function () {
      if (cur !== c.id) {
        cur = c.id;
        showHidden = false;
        renderGrid(false);
        markCat();
      }
    });
    b.addEventListener('click', function () {
      var first = $('vl-grid').querySelector('.focusable');
      if (first) first.focus();
    });
    box.appendChild(b);
  });
}

function markCat() {
  var list = document.querySelectorAll('#vl-cats .vl-cat');
  for (var i = 0; i < list.length; i++) list[i].classList.toggle('on', list[i].getAttribute('data-cat') === cur);
  var c = null;
  for (var j = 0; j < CATS.length; j++) if (CATS[j].id === cur) c = CATS[j];
  $('vl-desc').textContent = c ? c.desc : '';
}

// 封面：先放小人图，电视版再盖上B站的封面（加载失败就藏起来）
function coverInner(v, cat) {
  var img = '';
  if (v.bv && biliOk()) img = '<img class="real" src="' + APP + 'bili/cover/' + v.bv + '" alt="" onerror="this.style.display=\'none\'">';
  var t = thumbFor(cat);
  return (t ? '<img class="ph" src="' + t + '" alt="">' : '') + img + '<span class="vc-dur"></span><span class="vc-tags"></span>';
}

function coverHTML(v, cat) {
  return '<span class="vc-cover">' + coverInner(v, cat) + '</span>';
}

function cardFor(v) {
  var b = document.createElement('button');
  b.className = 'vcard focusable' + (hiddenOf(v) ? ' hidden-v' : '');
  b.setAttribute('data-bv', v.bv || '');
  var best = bestOf(v);
  b.innerHTML = coverHTML(v, v.cat) +
    '<span class="vc-title' + (v.mine ? ' body' : '') + '">' + esc(v.title) + '</span>' +
    '<span class="vc-meta">' + esc(v.by || v.note || '') + '</span>' +
    '<span class="vc-foot">' + (best ? '最好 ' + best + ' 分' : '') + '</span>';
  var tags = (v.tags || []).slice(0, 2);
  if (hiddenOf(v)) tags = ['已隐藏'];
  b.querySelector('.vc-tags').innerHTML = tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
  b.addEventListener('click', function () { openDetail(v); });
  b.addEventListener('focus', function () { lastFocus[cur] = v.bv; keepVisible(b); });
  if (v.bv) {
    var apply = function (m) { applyMeta(b, v, m); };
    var m = metaOf(v.bv);
    if (m) apply(m);
    else loadMeta(v.bv, apply);
  }
  return b;
}

function applyMeta(b, v, m) {
  if (!b.isConnected && !document.body.contains(b)) return;
  var d = m && m.data;
  if (goneOf(m)) {
    b.classList.add('gone');
    b.querySelector('.vc-meta').textContent = '视频没了（' + (m.message || m.code) + '）';
    return;
  }
  if (!d) return;
  var page = d.pages && d.pages.length >= (v.p || 1) ? d.pages[(v.p || 1) - 1] : null;
  var dur = page && page.duration ? page.duration : d.duration;
  if (dur) b.querySelector('.vc-dur').textContent = fmtDur(dur);
  var parts = [];
  if (d.owner) parts.push(d.owner);
  if (d.pages && d.pages.length > 1) parts.push('共 ' + d.pages.length + ' 集');
  if (parts.length) b.querySelector('.vc-meta').textContent = parts.join(' · ');
  if (v.mine && d.title && v.title === v.bv) b.querySelector('.vc-title').textContent = d.title;
}

function addCard() {
  var b = document.createElement('button');
  b.className = 'vcard add focusable';
  b.innerHTML = '<span class="vc-cover"><span class="plus">+</span></span><span class="vc-title">添加视频</span><span class="vc-meta">输入B站视频的 BV 号</span><span class="vc-foot"></span>';
  b.addEventListener('click', openAdd);
  b.addEventListener('focus', function () { keepVisible(b); });
  return b;
}

function noteCard(title, text, btnLabel, fn) {
  var d = document.createElement('div');
  d.className = 'vl-empty';
  d.innerHTML = '<h2>' + title + '</h2><p>' + text + '</p>';
  if (btnLabel) {
    var b = document.createElement('button');
    b.className = 'btn focusable';
    b.textContent = btnLabel;
    b.addEventListener('click', fn);
    d.appendChild(b);
  }
  return d;
}

function renderGrid(focusGrid) {
  var grid = $('vl-grid');
  grid.innerHTML = '';
  grid.scrollTop = 0;
  var focusEl = null;
  if (cur === 'local') {
    renderLocal(grid);
  } else {
    if (cur === 'mine') grid.appendChild(addCard());
    var list = listOf(cur, showHidden);
    list.forEach(function (v) {
      var card = cardFor(v);
      grid.appendChild(card);
      if (lastFocus[cur] && lastFocus[cur] === v.bv) focusEl = card;
    });
    var hc = cur === 'mine' ? 0 : hiddenCount(cur);
    if (hc) {
      var more = document.createElement('button');
      more.className = 'vcard more focusable';
      more.innerHTML = '<span class="vc-title">' + (showHidden ? '不显示隐藏的视频' : '显示隐藏的 ' + hc + ' 个视频') + '</span>';
      more.addEventListener('click', function () { showHidden = !showHidden; renderGrid(true); });
      grid.appendChild(more);
    }
    if (cur === 'mine' && !list.length) {
      grid.appendChild(noteCard('还没有添加视频', '在B站找到想跟着跳的视频，把网址里 BV 开头的 12 位（比如 BV1xx411c7mD）输进来就行。也可以在电脑上用 adb：先选中输入框，再运行 adb shell input text BV号。'));
    }
  }
  if (!biliOk() && cur !== 'local') {
    $('vl-note').textContent = '网页版：B站视频放在网页里，看不到视频里的老师，只按动得多不多打分。用电视版 APK 打开，AI 会看着老师给你打分。';
  } else {
    $('vl-note').textContent = '视频来自B站（bilibili.com），用B站官方的外链播放器播放，要联网；童动乐园不下载、不保存视频。视频没了就在详情里隐藏它。';
  }
  if (focusGrid) {
    var target = focusEl || grid.querySelector('.focusable');
    if (target) setScope($('screen-videos'), target);
  }
}

// 遥控器移到下面看不到的格子时，把列表滚过去
function keepVisible(el) {
  var grid = $('vl-grid');
  var top = el.offsetTop, bottom = top + el.offsetHeight;
  if (top < grid.scrollTop + 10) grid.scrollTop = Math.max(0, top - 20);
  else if (bottom > grid.scrollTop + grid.clientHeight - 10) grid.scrollTop = bottom - grid.clientHeight + 20;
}

// ---------- 电视里的视频 ----------
function renderLocal(grid) {
  if (mediaOk()) {
    if (!locals) {
      grid.appendChild(noteCard('正在读电视里的视频…', ''));
      loadLocals();
      return;
    }
    locals.list.forEach(function (f) { grid.appendChild(localCard(f)); });
    var dir = locals.dir || '/sdcard/Android/data/com.family.tongdong/files/Movies';
    var how = '用电脑把视频放进来：adb push 舞蹈.mp4 ' + dir + '/ ，放好后回到这一页就能看到。';
    if (!locals.permitted) {
      grid.appendChild(noteCard(locals.list.length ? '还有 U 盘、下载里的视频？' : '还没有视频',
        how + ' U 盘里、下载的视频要先允许童动乐园读取。', '允许读取电视里的视频', function () {
          window.__tdMediaPermission = function (ok) {
            window.__tdMediaPermission = null;
            if (!ok) ui.toast('没有允许，只能看应用文件夹里的视频', 3000);
            locals = null;
            renderGrid(true);
          };
          try { window.TongdongNative.mediaRequest(); } catch (e) { /* 忽略 */ }
        }));
    } else if (!locals.list.length) {
      grid.appendChild(noteCard('还没有视频', how + ' 也可以插 U 盘。'));
    }
    return;
  }
  // 网页版：选一个视频文件（只在这个网页里用，不上传）
  grid.appendChild(noteCard('选一个视频文件', '选手机或电脑里存的舞蹈视频，网页里的 AI 会看着视频里的老师打分。视频只在这个网页里放，不会上传。', '选择视频文件', function () {
    var input = $('vl-file');
    input.value = '';
    input.click();
  }));
}

function loadLocals() {
  fetch(APP + 'media/list').then(function (r) { return r.json(); }).then(function (j) {
    locals = j && j.list ? j : { list: [], permitted: false };
  }, function () {
    locals = { list: [], permitted: false, error: '读不到' };
  }).then(function () {
    if (cur === 'local') renderGrid(false);
    renderCats();
    markCat();
  });
}

function localCard(f) {
  var b = document.createElement('button');
  b.className = 'vcard focusable';
  var name = f.name.replace(/\.[^.]+$/, '');
  var v = { local: f.id, title: name, cat: 'local' };
  var best = bestOf(v);
  b.innerHTML = '<span class="vc-cover"><img class="ph" src="' + thumbFor('local') + '" alt=""><span class="vc-dur">' + (f.dur ? fmtDur(f.dur / 1000) : '') + '</span><span class="vc-tags"></span></span>' +
    '<span class="vc-title body">' + esc(name) + '</span>' +
    '<span class="vc-meta">' + (f.src === 'app' ? '应用文件夹' : '电视媒体库') + (f.size ? ' · ' + Math.round(f.size / 1048576) + ' MB' : '') + '</span>' +
    '<span class="vc-foot">' + (best ? '最好 ' + best + ' 分' : '') + '</span>';
  b.addEventListener('click', function () {
    start({ local: f.id, title: name, cat: 'local' });
  });
  b.addEventListener('focus', function () { keepVisible(b); });
  return b;
}

// ---------- 详情 ----------
function openDetail(v) {
  sheetEntry = v;
  sheetOpen = 'detail';
  var m = v.bv ? metaOf(v.bv) : null;
  var d = m && m.data;
  var box = $('vl-detail');
  var info = [];
  if (d && d.owner) info.push('UP 主：' + esc(d.owner));
  if (d && d.duration) info.push('时长 ' + fmtDur(d.duration));
  if (d && d.view) info.push('播放 ' + (d.view >= 10000 ? (d.view / 10000).toFixed(1) + ' 万' : d.view));
  var best = bestOf(v);
  if (best) info.push('最好 ' + best + ' 分');
  var gone = goneOf(m);
  box.querySelector('.vs-cover').innerHTML = coverInner(v, v.cat);
  box.querySelector('.vs-title').textContent = v.title;
  box.querySelector('.vs-official').textContent = d && d.title && d.title !== v.title ? d.title : '';
  box.querySelector('.vs-meta').innerHTML = info.join('　');
  box.querySelector('.vs-note').textContent = gone ? '这个视频在B站上找不到了（' + (m.message || m.code) + '），可以隐藏它。' : (v.note || '');
  box.querySelector('.vs-src').textContent = '来源：' + pageUrl(v).replace('https://www.', '');
  // 分集
  var parts = box.querySelector('.vs-parts');
  parts.innerHTML = '';
  if (d && d.pages && d.pages.length > 1) {
    d.pages.slice(0, 24).forEach(function (pg) {
      var b = document.createElement('button');
      b.className = 'vs-part focusable' + ((v.p || 1) === pg.page ? ' on' : '');
      b.innerHTML = '<b>' + pg.page + '</b>' + esc(pg.part || '') + (pg.duration ? '<i>' + fmtDur(pg.duration) + '</i>' : '');
      b.addEventListener('click', function () { start(entryOf(v, pg.page, d)); });
      parts.appendChild(b);
    });
  }
  var row = box.querySelector('.btn-row');
  row.innerHTML = '';
  var primary = button(row, d && d.pages && d.pages.length > 1 ? '从第 ' + (v.p || 1) + ' 集开始跳' : '开始跳', true, function () { start(entryOf(v, v.p || 1, d)); });
  if (gone) primary.setAttribute('disabled', '');
  if (v.mine) button(row, '删除这个视频', false, function () { removeMine(v); });
  else if (hiddenOf(v)) button(row, '不再隐藏', false, function () { setHidden(v, false); });
  else button(row, '隐藏这个视频', false, function () { setHidden(v, true); });
  button(row, '返回', false, closeSheet);
  $('vl-sheet').classList.add('show');
  box.classList.add('show');
  $('vl-addbox').classList.remove('show');
  setScope($('vl-sheet'), gone ? row.querySelector('.btn:not([disabled])') : primary);
  // 信息还没查到：查到了再刷新一下
  if (v.bv && !m) loadMeta(v.bv, function () { if (sheetOpen === 'detail' && sheetEntry === v) openDetail(v); });
}

function button(row, label, primary, fn) {
  var b = document.createElement('button');
  b.className = 'btn focusable' + (primary ? ' primary' : '');
  b.textContent = label;
  b.addEventListener('click', fn);
  row.appendChild(b);
  return b;
}

function entryOf(v, p, d) {
  var title = v.title;
  if (d && d.pages && d.pages.length > 1 && p > 1) {
    var pg = d.pages[p - 1];
    if (pg && pg.part) title = v.title + ' · ' + pg.part;
  }
  var page = d && d.pages ? d.pages[p - 1] : null;
  return { bv: v.bv, p: p, title: title, cat: v.cat, duration: page && page.duration ? page.duration : (d ? d.duration : 0) };
}

function start(e) {
  var p = { mode: 'video', from: 'videos', cat: cur, title: e.title };
  if (e.bv) { p.bv = e.bv; p.p = e.p || 1; }
  if (e.local) p.local = e.local;
  if (e.src) p.src = e.src;
  if (e.duration) p.duration = e.duration;
  sheetOpen = null;
  go('play', p);
}

function closeSheet() {
  sheetOpen = null;
  $('vl-sheet').classList.remove('show');
  $('vl-detail').classList.remove('show');
  $('vl-addbox').classList.remove('show');
  var sel = sheetEntry && sheetEntry.bv ? $('vl-grid').querySelector('[data-bv="' + sheetEntry.bv + '"]') : null;
  setScope($('screen-videos'), sel || $('vl-grid').querySelector('.focusable'));
}

function setHidden(v, on) {
  var h = videosStore().hidden;
  if (on) h[v.bv] = Date.now();
  else delete h[v.bv];
  store.save();
  closeSheet();
  ui.toast(on ? '隐藏了「' + v.title + '」，列表最后可以再显示出来' : '「' + v.title + '」不再隐藏', 2600);
  renderCats();
  markCat();
  renderGrid(true);
}

function removeMine(v) {
  var s = videosStore();
  s.mine = s.mine.filter(function (m) { return !(m.bv === v.bv && (m.p || 1) === (v.p || 1)); });
  store.save();
  closeSheet();
  ui.toast('删掉了「' + v.title + '」', 2200);
  renderCats();
  markCat();
  renderGrid(true);
}

// ---------- 添加视频 ----------
// BV 号用的字符（没有 0、I、O、l，不会认错）
var KEYS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function buildKeys() {
  var box = $('vl-keys');
  if (box.childNodes.length) return;
  for (var i = 0; i < KEYS.length; i++) {
    (function (ch) {
      var b = document.createElement('button');
      b.className = 'vk focusable';
      b.textContent = ch;
      b.addEventListener('click', function () { typeKey(ch); });
      box.appendChild(b);
    })(KEYS.charAt(i));
  }
  var del = document.createElement('button');
  del.className = 'vk wide focusable';
  del.textContent = '删一个';
  del.addEventListener('click', function () {
    var inp = $('vl-input');
    inp.value = inp.value.slice(0, -1);
    checkInput();
  });
  box.appendChild(del);
  var clr = document.createElement('button');
  clr.className = 'vk wide focusable';
  clr.textContent = '清空';
  clr.addEventListener('click', function () { $('vl-input').value = 'BV1'; checkInput(); });
  box.appendChild(clr);
}

function typeKey(ch) {
  var inp = $('vl-input');
  if (inp.value.length >= 40) return;
  inp.value += ch;
  checkInput();
}

function checkInput() {
  var v = $('vl-input').value;
  var p = parseInput(v);
  var msg = $('vl-add-msg');
  var bv = /^BV/.test(v) ? v.slice(0, 12) : '';
  $('vl-input-count').textContent = bv ? bv.length + ' / 12' : '';
  if (p && p.bv) msg.textContent = '可以添加：' + p.bv + (p.p > 1 ? '（第 ' + p.p + ' 集）' : '');
  else if (p && p.b23) msg.textContent = 'b23.tv 短链接，添加时会查出是哪个视频';
  else msg.textContent = 'BV 号是 BV 开头的 12 位，大小写要一样';
  $('vl-add-ok').disabled = !p;
}

function openAdd() {
  sheetOpen = 'add';
  buildKeys();
  var inp = $('vl-input');
  inp.value = 'BV1';
  checkInput();
  $('vl-sheet').classList.add('show');
  $('vl-addbox').classList.add('show');
  $('vl-detail').classList.remove('show');
  setScope($('vl-sheet'), $('vl-keys').querySelector('.vk'));
}

function doAdd() {
  var p = parseInput($('vl-input').value);
  if (!p) return;
  var msg = $('vl-add-msg');
  if (p.b23) {
    if (!biliOk()) { msg.textContent = '网页版查不了短链接，请输入 BV 号'; return; }
    msg.textContent = '正在查短链接…';
    fetch(APP + 'bili/resolve/' + p.b23).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.bv) addBv(j.bv, j.p || 1);
      else msg.textContent = (j && j.error) || '查不到这个短链接';
    }, function () { msg.textContent = '联网失败，请输入 BV 号'; });
    return;
  }
  addBv(p.bv, p.p);
}

function addBv(bv, p) {
  var s = videosStore();
  var exists = s.mine.some(function (m) { return m.bv === bv && (m.p || 1) === p; }) || !!findVideo(bv);
  if (exists) {
    $('vl-add-msg').textContent = findVideo(bv) ? '视频库里已经有这个视频了：' + findVideo(bv).title : '已经添加过了';
    return;
  }
  var entry = { bv: bv, p: p, title: bv, at: Date.now() };
  var finish = function () {
    s.mine.unshift(entry);
    if (s.mine.length > 60) s.mine.length = 60;
    store.save();
    sfx.star();
    ui.toast('添加好了：' + entry.title, 2600);
    cur = 'mine';
    lastFocus.mine = bv;
    closeSheet();
    renderCats();
    markCat();
    renderGrid(true);
  };
  if (!biliOk()) { finish(); return; }
  $('vl-add-msg').textContent = '正在查这个视频…';
  loadMeta(bv, function (m) {
    if (goneOf(m)) {
      $('vl-add-msg').textContent = 'B站上找不到这个视频（' + (m.message || m.code) + '），看看 BV 号对不对';
      return;
    }
    if (m && m.data && m.data.title) entry.title = m.data.title;
    finish();
  });
}

function bind() {
  if (bound) return;
  bound = true;
  $('vl-add').addEventListener('click', openAdd);
  $('vl-add-ok').addEventListener('click', doAdd);
  $('vl-add-cancel').addEventListener('click', closeSheet);
  $('vl-input').addEventListener('input', checkInput);
  $('vl-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    start({ src: url, title: f.name.replace(/\.[^.]+$/, ''), cat: 'local', local: null });
  });
}

export var videosScreen = {
  manageFocus: true,
  enter: function (params) {
    bind();
    if (params && params.cat) {
      for (var i = 0; i < CATS.length; i++) if (CATS[i].id === params.cat) cur = params.cat;
    }
    sheetOpen = null;
    showHidden = false;
    locals = null;
    $('vl-sheet').classList.remove('show');
    renderCats();
    markCat();
    renderGrid(false);
    var grid = $('vl-grid');
    var target = (lastFocus[cur] && grid.querySelector('[data-bv="' + lastFocus[cur] + '"]')) || grid.querySelector('.focusable') || $('vl-cats').querySelector('.on');
    setScope($('screen-videos'), target);
  },
  onBack: function () {
    if (sheetOpen) { closeSheet(); return true; }
    return false;
  },
  backTo: function () { return ['hub', { id: 'dance' }]; },
  debug: function () { return { cat: cur, sheet: sheetOpen, cards: document.querySelectorAll('#vl-grid .vcard').length }; }
};
