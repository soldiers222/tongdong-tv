// 本地存储：设置、最好成绩、每日运动时长、设备测试结果。全部存在本机浏览器，不上传。
import { dayKey, keepLast } from './util.js';

var KEY = 'tongdong.v1';

var DEFAULTS = {
  settings: {
    age: '6-8',        // 6-8 | 9-12
    limitMin: 15,      // 单次运动提醒（分钟），0 = 不提醒
    engine: 'auto',    // auto 或具体引擎 id
    mirror: true,
    skeleton: true,
    sound: true,
    voice: true,
    perf: false,
    hd: false,
    players: 1         // 1 = 单人，2 = 双人（首页游戏上按左右键切换）
  },
  best: {
    fruit: { '6-8': 0, '9-12': 0 },
    balance: { left: 0, right: 0 },
    other: {}          // 其他玩法：键如 mole-6-8、dodge-9-12、dance-twinkle
  },
  totals: { sessions: 0, stars: 0, sec: 0, duo: 0 },
  progress: {},        // 课程和玩法进度：{键: {n 次数, stars 最好星级, at}}
  growth: { tasks: {}, badges: {}, perfectDays: 0, perfectDay: null, bestStreak: 0, level: 1 },
  // 跟着视频跳：家长添加的视频、隐藏的视频、画面要不要镜像
  videos: { mine: [], hidden: {}, mirror: false },
  days: {},
  sessions: [],
  day0: null
};

var state = null;
var sessionSec = 0; // 本次连续运动秒数（用于休息提醒，不持久化）

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function merge(base, saved) {
  if (!isObj(saved)) return base;
  for (var k in saved) {
    if (!Object.prototype.hasOwnProperty.call(saved, k)) continue;
    if (isObj(base[k]) && isObj(saved[k])) base[k] = merge(base[k], saved[k]);
    else if (base[k] === undefined || typeof base[k] === typeof saved[k] || base[k] === null) base[k] = saved[k];
  }
  return base;
}

export function load() {
  var saved = {};
  try {
    var raw = window.localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = {}; }
  state = merge(clone(DEFAULTS), saved);
  return state;
}

export function save() {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 存储满或被禁用时忽略 */ }
}

export function get() {
  if (!state) load();
  return state;
}

export function settings() { return get().settings; }

export function setSetting(k, v) {
  get().settings[k] = v;
  save();
}

function today() {
  var s = get();
  var k = dayKey();
  if (!s.days[k]) s.days[k] = { sec: 0, fruit: 0, balance: 0, n: {} };
  if (!s.days[k].n) s.days[k].n = {};
  return s.days[k];
}

function pruneDays() {
  var s = get();
  var keys = Object.keys(s.days).sort();
  while (keys.length > 60) {
    delete s.days[keys.shift()];
  }
}

export function addActiveSeconds(sec) {
  if (!(sec > 0)) return;
  today().sec += sec;
  get().totals.sec += sec;
  sessionSec += sec;
  pruneDays();
  save();
}

export function sessionSeconds() { return sessionSec; }
export function resetSession() { sessionSec = 0; }

// 进度记在哪个键上
function progressKey(rec) {
  if (rec.type === 'exercise') return 'ex:' + rec.course;
  if (rec.type === 'dance') return 'dance:' + rec.routine + (rec.players === 2 ? ':2' : '');
  if (rec.type === 'dancelearn') return 'learn:' + rec.routine;
  if (rec.type === 'video') return 'video:' + rec.video;
  return rec.type + (rec.players === 2 ? ':2' : '');
}

// 记一局；返回 {newBest 是否破纪录, best 现在的最好成绩（金鸡独立和切水果由调用方自己取）}
export function recordSession(rec) {
  var s = get();
  rec.at = Date.now();
  s.sessions.push(rec);
  keepLast(s.sessions, 300);
  var d = today();
  d.n[rec.type] = (d.n[rec.type] || 0) + 1;
  s.totals.sessions += 1;
  s.totals.stars += rec.rating || 0;
  if (rec.players === 2) s.totals.duo += 1;
  var newBest = false, best = null;
  if (rec.players === 2) {
    // 双人一局：算运动次数，不算个人最好成绩
    if (rec.type === 'fruit') d.fruit += 1;
    else if (rec.type === 'balance') d.balance += 1;
  } else if (rec.type === 'fruit') {
    d.fruit += 1;
    var age = rec.age === '9-12' ? '9-12' : '6-8';
    if (rec.score > (s.best.fruit[age] || 0)) {
      s.best.fruit[age] = rec.score;
      newBest = true;
    }
  } else if (rec.type === 'balance') {
    d.balance += 1;
    var leg = rec.stand === 'right' ? 'right' : 'left';
    if (rec.holdMs > (s.best.balance[leg] || 0)) {
      s.best.balance[leg] = rec.holdMs;
      newBest = true;
    }
  } else if (rec.bestKey) {
    var cur = s.best.other[rec.bestKey] || 0;
    if ((rec.bestValue || 0) > cur) {
      s.best.other[rec.bestKey] = rec.bestValue;
      newBest = true;
    }
    best = Math.max(cur, rec.bestValue || 0);
  }
  var pk = progressKey(rec);
  var pg = s.progress[pk] || { n: 0, stars: 0 };
  pg.n += 1;
  pg.stars = Math.max(pg.stars, rec.rating || 0);
  pg.at = rec.at;
  s.progress[pk] = pg;
  save();
  return { newBest: newBest, best: best };
}

export function todaySeconds() {
  var d = get().days[dayKey()];
  return d ? d.sec : 0;
}

export function lastDays(n) {
  var out = [];
  var names = ['日', '一', '二', '三', '四', '五', '六'];
  for (var i = n - 1; i >= 0; i--) {
    var dt = new Date();
    dt.setDate(dt.getDate() - i);
    var k = dayKey(dt);
    var d = get().days[k];
    out.push({
      key: k,
      label: i === 0 ? '今天' : '周' + names[dt.getDay()],
      sec: d ? d.sec : 0,
      today: i === 0
    });
  }
  return out;
}

export function activeDaysThisWeek() {
  var n = 0;
  var list = lastDays(7);
  for (var i = 0; i < list.length; i++) if (list[i].sec >= 60) n++;
  return n;
}

export function clearRecords() {
  var s = get();
  s.best = clone(DEFAULTS.best);
  s.totals = clone(DEFAULTS.totals);
  s.progress = {};
  s.growth = clone(DEFAULTS.growth);
  s.days = {};
  s.sessions = [];
  save();
}

// 最近 n 局（新的在前）
export function recentSessions(n) {
  var list = get().sessions;
  return list.slice(Math.max(0, list.length - (n || 20))).reverse();
}

export function setDay0(result) {
  get().day0 = result;
  save();
}
