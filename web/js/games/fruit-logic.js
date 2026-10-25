// 西瓜切切切 · 规则与物理（纯逻辑，不碰画面，可在 Node 里测试）
// 坐标：画布 1280×720；时间：游戏世界毫秒（暂停时不走）。
import { rng, clamp } from '../core/util.js';
import { distToSegment } from '../core/geometry.js';

export var FRUIT = {
  melon: { r: 80, juice: '#E8414B' },
  orange: { r: 60, juice: '#F7931E' },
  apple: { r: 60, juice: '#FFF2D0' },
  kiwi: { r: 56, juice: '#9BD14A' },
  star: { r: 62, juice: '#FFC928', golden: true },
  bomb: { r: 58, bomb: true }
};

var PLAIN = ['melon', 'orange', 'apple', 'kiwi', 'melon'];

// 分龄参数。speedMin：挥手速度门槛（像素/秒）；hitScale：判定圈放大倍数
export var AGE = {
  '6-8': { flightSec: 2.8, spawnMs: 1500, multiMax: 1, hitScale: 1.4, speedMin: 620, sizeScale: 1.15, bombs: false, starMs: 9000, durationMs: 60000 },
  '9-12': { flightSec: 2.3, spawnMs: 1100, multiMax: 3, hitScale: 1.15, speedMin: 820, sizeScale: 1.0, bombs: true, starMs: 8000, durationMs: 60000 }
};

export var MAX_LEVEL = 8;
var STROKE_GAP_MS = 350;   // 两段刀光间隔超过它就算新的一刀
var WINDOW = 8;            // 难度自适应看最近 8 个水果

export function FruitWorld(opts) {
  opts = opts || {};
  this.W = opts.W || 1280;
  this.H = opts.H || 720;
  this.age = AGE[opts.age] ? opts.age : '6-8';
  this.cfg = AGE[this.age];
  this.slow = !!opts.slow;
  this.rand = rng(opts.seed || 20261025);
  this.durationMs = opts.durationMs || this.cfg.durationMs;
  this.t = 0;
  this.items = [];
  this.events = [];
  this.score = 0;
  this.sliced = 0;
  this.missed = 0;
  this.bombsHit = 0;
  this.stars = 0;
  this.maxCombo = 0;
  this.level = 0;
  this.recent = [];
  this.nextSpawn = 900;
  this.nextStar = this.cfg.starMs;
  this.over = false;
  this.nextId = 1;
  this.strokes = { left: { t: -1e9, hits: 0 }, right: { t: -1e9, hits: 0 } };
}

FruitWorld.prototype.setSlow = function (v) { this.slow = !!v; };

FruitWorld.prototype.gravity = function () {
  var T = this.cfg.flightSec * (this.slow ? 1.3 : 1) / (1 + 0.04 * this.level);
  var h = 0.62 * this.H;
  return 8 * h / (T * T); // T = 2√(2h/g)
};

FruitWorld.prototype.spawnInterval = function () {
  var base = this.cfg.spawnMs * (this.slow ? 1.25 : 1) / (1 + 0.08 * this.level);
  return Math.max(560, base);
};

FruitWorld.prototype.hitRadius = function (it) {
  return it.r * this.cfg.hitScale * (this.slow ? 1.15 : 1);
};

FruitWorld.prototype.speedNeeded = function () {
  return this.cfg.speedMin * (this.slow ? 0.75 : 1);
};

FruitWorld.prototype.spawn = function (type, side) {
  var r = this.rand;
  var g = this.gravity();
  var R = FRUIT[type].r * this.cfg.sizeScale;
  var x0;
  if (side === 'left') x0 = this.W * (0.1 + 0.15 * r());
  else if (side === 'right') x0 = this.W * (0.75 + 0.15 * r());
  else x0 = this.W * (0.15 + 0.7 * r());
  var y0 = this.H + R;
  var apex = this.H * (0.13 + 0.25 * r());
  var vy = -Math.sqrt(2 * g * (y0 - apex));
  var T = 2 * (-vy) / g;
  var xTarget;
  if (side === 'left') xTarget = x0 + this.W * (0.02 + 0.06 * r());
  else if (side === 'right') xTarget = x0 - this.W * (0.02 + 0.06 * r());
  else xTarget = this.W * (0.2 + 0.6 * r());
  var it = {
    id: this.nextId++,
    type: type,
    x0: x0, y0: y0,
    vx: (xTarget - x0) / T,
    vy: vy,
    g: g,
    t0: this.t,
    r: R,
    spin: (r() - 0.5) * 4,
    golden: !!FRUIT[type].golden,
    bomb: !!FRUIT[type].bomb,
    needHand: null,
    sliced: false,
    gone: false,
    warned: false
  };
  this.items.push(it);
  return it;
};

FruitWorld.prototype.posAt = function (it, tMs) {
  var dt = (tMs - it.t0) / 1000;
  return { x: it.x0 + it.vx * dt, y: it.y0 + it.vy * dt + 0.5 * it.g * dt * dt };
};

FruitWorld.prototype.velAt = function (it, tMs) {
  var dt = (tMs - it.t0) / 1000;
  return { x: it.vx, y: it.vy + it.g * dt };
};

FruitWorld.prototype._spawnWave = function () {
  var r = this.rand;
  var maxN = Math.min(this.cfg.multiMax, 1 + Math.floor(this.level / 2));
  var n = 1 + Math.floor(r() * maxN);
  var bombUsed = false;
  for (var i = 0; i < n; i++) {
    var pBomb = this.cfg.bombs ? Math.min(0.25, 0.12 + 0.015 * this.level) : 0;
    if (!bombUsed && n > 1 && i === n - 1 && r() < pBomb) {
      this.spawn('bomb');
      bombUsed = true;
    } else if (!bombUsed && n === 1 && r() < pBomb * 0.6) {
      this.spawn('bomb');
      bombUsed = true;
    } else {
      this.spawn(PLAIN[Math.floor(r() * PLAIN.length)]);
    }
  }
};

FruitWorld.prototype._resolve = function (hit) {
  this.recent.push(hit ? 1 : 0);
  if (this.recent.length < WINDOW) return;
  var s = 0;
  for (var i = 0; i < this.recent.length; i++) s += this.recent[i];
  var rate = s / this.recent.length;
  if (rate >= 0.8 && this.level < MAX_LEVEL) {
    this.level += 1;
    this.recent = [];
    this.events.push({ type: 'level', level: this.level, up: true });
  } else if (rate <= 0.35 && this.level > 0) {
    this.level -= 1;
    this.recent = [];
    this.events.push({ type: 'level', level: this.level, up: false });
  } else {
    this.recent.shift();
  }
};

FruitWorld.prototype._closeStrokes = function () {
  for (var hand in this.strokes) {
    var st = this.strokes[hand];
    if (st.hits > 0 && this.t - st.t > STROKE_GAP_MS) {
      if (st.hits >= 3) {
        this.score += st.hits;
        this.events.push({ type: 'combo', hand: hand, n: st.hits, bonus: st.hits });
      }
      if (st.hits > this.maxCombo) this.maxCombo = st.hits;
      st.hits = 0;
    }
  }
};

FruitWorld.prototype.update = function (dtMs) {
  if (this.over) return;
  this.t += dtMs;
  if (this.t >= this.nextSpawn) {
    this._spawnWave();
    this.nextSpawn = this.t + this.spawnInterval();
  }
  if (this.t >= this.nextStar) {
    var side = this.rand() < 0.5 ? 'left' : 'right';
    var st = this.spawn('star', side);
    // 屏幕左边的星星要用右手切（交叉过身体中线）。画面是镜像的，屏幕左边就是孩子的左边
    st.needHand = side === 'left' ? 'right' : 'left';
    this.nextStar = this.t + this.cfg.starMs * (0.8 + 0.4 * this.rand());
  }
  for (var i = 0; i < this.items.length; i++) {
    var it = this.items[i];
    if (it.sliced || it.gone) continue;
    var p = this.posAt(it, this.t);
    if (p.y > this.H + it.r + 12 && this.t - it.t0 > 600) {
      it.gone = true;
      if (!it.bomb && !it.golden) {
        this.missed += 1;
        this._resolve(false);
        this.events.push({ type: 'miss', id: it.id, x: p.x });
      }
    }
  }
  var keep = [];
  for (var j = 0; j < this.items.length; j++) {
    if (!this.items[j].sliced && !this.items[j].gone) keep.push(this.items[j]);
  }
  this.items = keep;
  this._closeStrokes();
  if (this.t >= this.durationMs) {
    for (var h in this.strokes) this.strokes[h].t = -1e9;
    this._closeStrokes();
    this.over = true;
    this.events.push({ type: 'end' });
  }
};

// 一段刀光：hand = 'left' | 'right'（孩子的左右手）；a、b = {x, y, t}，t 为世界时间
// 用水果在 a、b 两个时刻（以及中点时刻）的真实位置做判定，补偿识别延迟
FruitWorld.prototype.blade = function (hand, a, b) {
  if (this.over) return [];
  var dt = (b.t - a.t) / 1000;
  if (!(dt > 0) || dt > 0.6) return [];
  var dx = b.x - a.x, dy = b.y - a.y;
  var speed = Math.sqrt(dx * dx + dy * dy) / dt;
  if (speed < this.speedNeeded()) return [];
  var hits = [];
  var angle = Math.atan2(dy, dx);
  for (var i = 0; i < this.items.length; i++) {
    var it = this.items[i];
    if (it.sliced || it.gone) continue;
    var R = this.hitRadius(it);
    var pa = this.posAt(it, a.t), pb = this.posAt(it, b.t), pm = this.posAt(it, (a.t + b.t) / 2);
    var d = Math.min(
      distToSegment(pa.x, pa.y, a.x, a.y, b.x, b.y),
      distToSegment(pm.x, pm.y, a.x, a.y, b.x, b.y),
      distToSegment(pb.x, pb.y, a.x, a.y, b.x, b.y)
    );
    if (d > R) continue;
    if (it.needHand && it.needHand !== hand) {
      if (!it.warned) {
        it.warned = true;
        this.events.push({ type: 'wrongHand', id: it.id, need: it.needHand, x: pb.x, y: pb.y });
      }
      continue;
    }
    it.sliced = true;
    var v = this.velAt(it, b.t);
    if (it.bomb) {
      this.bombsHit += 1;
      this.score = Math.max(0, this.score - 5);
      this.events.push({ type: 'bomb', id: it.id, x: pb.x, y: pb.y });
      hits.push(it);
      continue;
    }
    var pts = it.golden ? 3 : 1;
    this.score += pts;
    this.sliced += 1;
    if (it.golden) this.stars += 1;
    else this._resolve(true);
    this.events.push({
      type: 'slice', id: it.id, fruit: it.type, golden: it.golden, pts: pts, hand: hand,
      x: pb.x, y: pb.y, r: it.r, angle: angle, vx: v.x, vy: v.y, spin: it.spin
    });
    hits.push(it);
  }
  var st = this.strokes[hand];
  if (b.t - st.t > STROKE_GAP_MS && st.hits > 0) this._closeStrokes();
  st.t = b.t;
  for (var k = 0; k < hits.length; k++) if (!hits[k].bomb) st.hits += 1;
  return hits;
};

FruitWorld.prototype.drainEvents = function () {
  var e = this.events;
  this.events = [];
  return e;
};

FruitWorld.prototype.accuracy = function () {
  var total = this.sliced - this.stars + this.missed;
  return total > 0 ? clamp((this.sliced - this.stars) / total, 0, 1) : 0;
};
