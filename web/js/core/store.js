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
    balance: { left: 0, right: 0 }
  },
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
  if (!s.days[k]) s.days[k] = { sec: 0, fruit: 0, balance: 0 };
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
  sessionSec += sec;
  pruneDays();
  save();
}

export function sessionSeconds() { return sessionSec; }
export function resetSession() { sessionSec = 0; }

// 记一局；返回是否破纪录
export function recordSession(rec) {
  var s = get();
  rec.at = Date.now();
  s.sessions.push(rec);
  keepLast(s.sessions, 60);
  var d = today();
  var newBest = false;
  if (rec.players === 2) {
    // 双人一局：算运动次数，不算个人最好成绩
    if (rec.type === 'fruit') d.fruit += 1;
    else d.balance += 1;
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
  }
  save();
  return { newBest: newBest };
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
  s.days = {};
  s.sessions = [];
  save();
}

export function setDay0(result) {
  get().day0 = result;
  save();
}
