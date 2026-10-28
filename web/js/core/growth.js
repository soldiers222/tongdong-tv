// 成长中心（纯逻辑，可在 Node 里测试）：每局的星级、每日运动任务、勋章、成长星球、课程进度。
// 所有数据都来自本机的运动记录（store.js），不上传。
import { dayKey, rng } from './util.js';

function clamp3(n) { return Math.max(0, Math.min(3, Math.round(n || 0))); }

// 这一局表现怎么样（0–3 颗星），各种玩法统一口径，成长星球的能量就是这些星星
export function ratingOf(rec) {
  if (!rec) return 0;
  if (rec.players === 2) return 2; // 和家人一起玩，就给两颗
  if (rec.type === 'fruit') {
    var acc = rec.accuracy || 0;
    if (!rec.sliced) return 0;
    return acc >= 0.75 ? 3 : (acc >= 0.5 ? 2 : 1);
  }
  if (rec.type === 'balance' && rec.legs) {
    var s = 0;
    for (var i = 0; i < rec.legs.length; i++) s += rec.legs[i].stars || 0;
    return clamp3(rec.legs.length ? s / rec.legs.length : 0);
  }
  return clamp3(rec.stars);
}

// ---------- 每日任务 ----------
function todays(st, key) {
  var out = [];
  for (var i = 0; i < st.sessions.length; i++) {
    if (dayKey(new Date(st.sessions[i].at)) === key) out.push(st.sessions[i]);
  }
  return out;
}

function any(list, fn) {
  for (var i = 0; i < list.length; i++) if (fn(list[i])) return true;
  return false;
}

export var TASKS = {
  move10: { text: '今天运动满 10 分钟', test: function (c) { return c.sec >= 600; } },
  fruit: { text: '西瓜切切切命中一半以上', go: { mode: 'fruit', from: 'games' }, test: function (c) { return any(c.list, function (r) { return r.type === 'fruit' && (r.players === 2 || (r.accuracy || 0) >= 0.5); }); } },
  mole: { text: '敏捷摸球摸中 15 个', go: { mode: 'mole', from: 'games' }, test: function (c) { return any(c.list, function (r) { return r.type === 'mole' && (r.players === 2 || (r.hits || 0) >= 15); }); } },
  dodge: { text: '左右闪避坚持到最后', go: { mode: 'dodge', variant: 'side', from: 'games' }, test: function (c) { return any(c.list, function (r) { return r.type === 'dodge' && (r.players === 2 || r.survived); }); } },
  space: { text: '太空躲障碍躲开 12 次', go: { mode: 'dodge', variant: 'space', from: 'games' }, test: function (c) { return any(c.list, function (r) { return r.type === 'space' && (r.players === 2 || (r.dodged || 0) >= 12); }); } },
  dance: { text: '跟着音乐跳完一支舞', go: { mode: 'dance', routine: 'twinkle', from: 'dance' }, test: function (c) { return any(c.list, function (r) { return r.type === 'dance'; }); } },
  learn: { text: '学一支舞的舞步', go: { mode: 'dance', routine: 'beat', learn: true, from: 'dance' }, test: function (c) { return any(c.list, function (r) { return r.type === 'dancelearn'; }); } },
  balance: { text: '金鸡独立每条腿站够 10 秒', go: { mode: 'balance', from: 'train' }, test: function (c) {
    var l = false, r = false;
    for (var i = 0; i < c.list.length; i++) {
      var x = c.list[i];
      if (x.type !== 'balance' || x.players === 2) continue;
      if (x.stand === 'left' && x.holdMs >= 10000) l = true;
      if (x.stand === 'right' && x.holdMs >= 10000) r = true;
    }
    return l && r;
  } },
  coord: { text: '做一次协调训练', go: { mode: 'exercise', course: 'coord', from: 'train' }, test: function (c) { return any(c.list, function (r) { return r.type === 'exercise' && r.course === 'coord'; }); } },
  yoga: { text: '做一次瑜伽小课', go: { mode: 'exercise', course: 'yoga', from: 'train' }, test: function (c) { return any(c.list, function (r) { return r.type === 'exercise' && r.course === 'yoga'; }); } },
  wushu: { text: '练一次武术基本功', go: { mode: 'exercise', course: 'wushu', from: 'train' }, test: function (c) { return any(c.list, function (r) { return r.type === 'exercise' && r.course === 'wushu'; }); } },
  squat: { text: '做一组深蹲', go: { mode: 'exercise', course: 'squat', from: 'train' }, test: function (c) { return any(c.list, function (r) { return r.type === 'exercise' && r.course === 'squat'; }); } },
  star3: { text: '任意一项拿到三颗星', test: function (c) { return any(c.list, function (r) { return (r.rating || 0) >= 3; }); } },
  duo: { text: '和家人一起玩一局双人', go: { mode: 'fruit', from: 'games', players: 2 }, test: function (c) { return any(c.list, function (r) { return r.players === 2; }); } }
};

var PLAY_POOL = ['fruit', 'mole', 'dodge', 'space', 'dance', 'fruit', 'mole'];
var BODY_POOL = ['balance', 'coord', 'yoga', 'wushu', 'squat', 'learn', 'star3', 'duo'];

function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 每天三个任务：固定一个「运动满 10 分钟」，再从游戏、训练里各抽一个（同一天抽到的总是一样的）
export function dailyTasks(key) {
  var r = rng(hash(key || dayKey()));
  return ['move10', PLAY_POOL[Math.floor(r() * PLAY_POOL.length)], BODY_POOL[Math.floor(r() * BODY_POOL.length)]];
}

export function taskStatus(st, key, todaySec) {
  key = key || dayKey();
  var c = { list: todays(st, key), sec: todaySec || 0 };
  return dailyTasks(key).map(function (id) {
    var t = TASKS[id];
    return { id: id, text: t.text, done: !!t.test(c), go: t.go || null };
  });
}

// ---------- 连续运动天数 ----------
export function streaks(days, today) {
  // days: {日期: {sec}}，只保留最近 60 天
  var cur = 0, best = 0, run = 0;
  var d = today ? new Date(today + 'T12:00:00') : new Date();
  var keys = [];
  for (var i = 0; i < 60; i++) {
    var dt = new Date(d.getTime() - i * 86400000);
    keys.push(dayKey(dt));
  }
  // 当前连续：从今天（今天还没动就从昨天）往前数
  var start = days[keys[0]] && days[keys[0]].sec >= 60 ? 0 : 1;
  for (var j = start; j < keys.length; j++) {
    if (days[keys[j]] && days[keys[j]].sec >= 60) cur++;
    else break;
  }
  for (var k = keys.length - 1; k >= 0; k--) {
    if (days[keys[k]] && days[keys[k]].sec >= 60) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  return { current: cur, best: best };
}

// ---------- 勋章 ----------
function bestOf(st, prefix) {
  var b = 0;
  for (var k in st.best.other) if (k.indexOf(prefix) === 0) b = Math.max(b, st.best.other[k]);
  return b;
}

function prog(st, key) { return st.progress[key] || { n: 0, stars: 0 }; }

export var BADGES = [
  { id: 'first', mark: '始', name: '第一步', desc: '完成第一次运动', test: function (st) { return st.totals.sessions >= 1; } },
  { id: 'streak3', mark: '三', name: '三天不断', desc: '连续 3 天都运动', test: function (st) { return st.growth.bestStreak >= 3; } },
  { id: 'streak7', mark: '七', name: '一周坚持', desc: '连续 7 天都运动', test: function (st) { return st.growth.bestStreak >= 7; } },
  { id: 'min60', mark: '时', name: '一小时', desc: '累计运动 60 分钟', test: function (st) { return st.totals.sec >= 3600; } },
  { id: 'min300', mark: '久', name: '五小时', desc: '累计运动 5 个小时', test: function (st) { return st.totals.sec >= 18000; } },
  { id: 'tasks', mark: '任', name: '任务小能手', desc: '有一天把三个任务全做完', test: function (st) { return st.growth.perfectDays >= 1; } },
  { id: 'fruit', mark: '瓜', name: '水果忍者', desc: '西瓜切切切拿到 40 分', test: function (st) { return Math.max(st.best.fruit['6-8'] || 0, st.best.fruit['9-12'] || 0) >= 40; } },
  { id: 'balance', mark: '鸡', name: '小金鸡', desc: '金鸡独立站够 20 秒', test: function (st) { return Math.max(st.best.balance.left || 0, st.best.balance.right || 0) >= 20000; } },
  { id: 'mole', mark: '摸', name: '快手', desc: '敏捷摸球一局 300 分', test: function (st) { return bestOf(st, 'mole-') >= 300; } },
  { id: 'dodge', mark: '闪', name: '闪避高手', desc: '左右闪避一次都没被撞到', test: function (st) { return prog(st, 'dodge').stars >= 3; } },
  { id: 'space', mark: '飞', name: '太空飞行员', desc: '太空躲障碍坚持到最后', test: function (st) { return prog(st, 'space').stars >= 1; } },
  { id: 'coord', mark: '协', name: '协调小能手', desc: '协调训练拿到两颗星', test: function (st) { return prog(st, 'ex:coord').stars >= 2; } },
  { id: 'yoga', mark: '瑜', name: '瑜伽小达人', desc: '瑜伽小课拿到两颗星', test: function (st) { return prog(st, 'ex:yoga').stars >= 2; } },
  { id: 'wushu', mark: '武', name: '武术小侠', desc: '武术基本功拿到两颗星', test: function (st) { return prog(st, 'ex:wushu').stars >= 2; } },
  { id: 'dancer', mark: '舞', name: '小舞星', desc: '跟跳拿到两颗星', test: function (st) { return Math.max(prog(st, 'dance:twinkle').stars, prog(st, 'dance:beat').stars, prog(st, 'dance:kungfu').stars) >= 2; } },
  { id: 'dance3', mark: '曲', name: '三支舞', desc: '三支舞都跳过', test: function (st) { return prog(st, 'dance:twinkle').n > 0 && prog(st, 'dance:beat').n > 0 && prog(st, 'dance:kungfu').n > 0; } },
  { id: 'duo', mark: '伴', name: '好搭档', desc: '和家人玩一局双人', test: function (st) { return st.totals.duo >= 1; } }
];

// ---------- 成长星球：星星越多，星球上东西越多 ----------
export var PLANET = [
  { stars: 0, name: '光秃秃的小星球' },
  { stars: 8, name: '长出了小草' },
  { stars: 20, name: '开出了小花' },
  { stars: 40, name: '流过一条小河' },
  { stars: 65, name: '长出一片小树林' },
  { stars: 95, name: '小动物搬来了' },
  { stars: 130, name: '天上挂起彩虹' },
  { stars: 175, name: '盖起了小房子' },
  { stars: 230, name: '建好了火箭发射台' },
  { stars: 300, name: '变成了宇宙乐园' }
];

export function planet(stars) {
  var lv = 0;
  for (var i = 0; i < PLANET.length; i++) if (stars >= PLANET[i].stars) lv = i;
  var next = PLANET[lv + 1];
  return {
    level: lv + 1,
    name: PLANET[lv].name,
    stars: stars,
    next: next ? next.stars : null,
    frac: next ? (stars - PLANET[lv].stars) / (next.stars - PLANET[lv].stars) : 1
  };
}

// ---------- 课程进度 ----------
export var COURSE_LIST = [
  { key: 'ex:coord', name: '协调训练', go: { mode: 'exercise', course: 'coord', from: 'train' } },
  { key: 'ex:yoga', name: '瑜伽小课', go: { mode: 'exercise', course: 'yoga', from: 'train' } },
  { key: 'ex:wushu', name: '武术基本功', go: { mode: 'exercise', course: 'wushu', from: 'train' } },
  { key: 'learn:twinkle', name: '舞蹈教学：小星星', go: { mode: 'dance', routine: 'twinkle', learn: true, from: 'dance' } },
  { key: 'dance:twinkle', name: '跟跳：小星星', go: { mode: 'dance', routine: 'twinkle', from: 'dance' } },
  { key: 'learn:beat', name: '舞蹈教学：动感节拍', go: { mode: 'dance', routine: 'beat', learn: true, from: 'dance' } },
  { key: 'dance:beat', name: '跟跳：动感节拍', go: { mode: 'dance', routine: 'beat', from: 'dance' } },
  { key: 'learn:kungfu', name: '舞蹈教学：功夫小子', go: { mode: 'dance', routine: 'kungfu', learn: true, from: 'dance' } },
  { key: 'dance:kungfu', name: '跟跳：功夫小子', go: { mode: 'dance', routine: 'kungfu', from: 'dance' } }
];

export function courses(st) {
  return COURSE_LIST.map(function (c) {
    var p = prog(st, c.key);
    return { key: c.key, name: c.name, go: c.go, n: p.n, stars: p.stars };
  });
}

// 一局结束后：检查新完成的任务、新拿到的勋章、星球升级。返回要在结算页上显示的消息
export function afterSession(store) {
  var st = store.get();
  var g = st.growth;
  var news = [];
  var key = dayKey();
  var sk = streaks(st.days, key);
  if (sk.best > g.bestStreak) g.bestStreak = sk.best;
  var tasks = taskStatus(st, key, store.todaySeconds());
  var done = g.tasks[key] || [];
  var allDone = true;
  for (var i = 0; i < tasks.length; i++) {
    if (!tasks[i].done) { allDone = false; continue; }
    if (done.indexOf(tasks[i].id) < 0) {
      done.push(tasks[i].id);
      st.totals.stars += 2;
      news.push('完成任务：' + tasks[i].text + '（+2 星）');
    }
  }
  g.tasks[key] = done;
  // 只留最近 30 天的任务记录
  var keys = Object.keys(g.tasks).sort();
  while (keys.length > 30) delete g.tasks[keys.shift()];
  if (allDone && g.perfectDay !== key) {
    g.perfectDay = key;
    g.perfectDays += 1;
  }
  for (var b = 0; b < BADGES.length; b++) {
    var bd = BADGES[b];
    if (!g.badges[bd.id] && bd.test(st)) {
      g.badges[bd.id] = Date.now();
      news.push('获得勋章：' + bd.name);
    }
  }
  var pl = planet(st.totals.stars);
  if (pl.level > (g.level || 1)) news.push('成长星球升到 ' + pl.level + ' 级：' + pl.name);
  g.level = pl.level;
  store.save();
  return news;
}
