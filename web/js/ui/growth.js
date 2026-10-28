// 成长中心：成长星球（星星越多，星球上长出的东西越多）、今日任务、勋章、课程进度；家长从这里看训练记录。
import * as store from '../core/store.js';
import { setScope } from '../core/nav.js';
import { go } from '../router.js';
import { taskStatus, BADGES, planet, PLANET, courses, afterSession } from '../core/growth.js';
import { dayKey, rng } from '../core/util.js';

function $(id) { return document.getElementById(id); }

function starsText(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆'; return s; }

function launch(p) {
  var q = {};
  for (var k in p) q[k] = p[k];
  if (q.players === 2) store.setSetting('players', 2);
  delete q.players;
  q.from = 'growth';
  go('play', q);
}

// ---------- 画星球 ----------
function drawPlanet(cv, level, t) {
  var c = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var cx = W / 2, cy = H * 0.58, R = 180;
  c.clearRect(0, 0, W, H);
  var r = rng(11);
  // 远处的星星
  for (var i = 0; i < 40; i++) {
    c.fillStyle = 'rgba(247,245,239,' + (0.25 + r() * 0.5) + ')';
    var s = 1 + r() * 2.5;
    c.fillRect(r() * W, r() * H * 0.9, s, s);
  }
  // 彩虹（7 级）
  if (level >= 7) {
    var cols = ['#E5484D', '#FF8A5B', '#FFC928', '#3FBF6A', '#5BC0FF', '#7C6CF2'];
    for (var k = 0; k < cols.length; k++) {
      c.strokeStyle = cols[k];
      c.lineWidth = 9;
      c.beginPath();
      c.arc(cx, cy, R + 120 - k * 9, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
    }
  }
  // 星球本体
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.fillStyle = level >= 2 ? '#2E7D4F' : '#8A7A6A';
  c.fill();
  c.lineWidth = 8;
  c.strokeStyle = '#13213C';
  c.stroke();
  // 坑或草地斑块
  c.save();
  c.beginPath();
  c.arc(cx, cy, R - 4, 0, Math.PI * 2);
  c.clip();
  for (var j = 0; j < 7; j++) {
    var a = r() * Math.PI * 2, d = r() * R * 0.75;
    c.fillStyle = level >= 2 ? 'rgba(35,99,62,0.8)' : 'rgba(10,18,36,0.25)';
    c.beginPath();
    c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 18 + r() * 26, 12 + r() * 16, a, 0, Math.PI * 2);
    c.fill();
  }
  // 小河（4 级）
  if (level >= 4) {
    c.strokeStyle = '#5BC0FF';
    c.lineWidth = 22;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - R, cy + 40);
    c.bezierCurveTo(cx - 60, cy - 10, cx + 40, cy + 110, cx + R, cy + 50);
    c.stroke();
  }
  c.restore();
  // 星球表面上的东西：沿着上半圈摆，朝外立着
  function onSurface(angleDeg, draw) {
    var ang = angleDeg * Math.PI / 180;
    c.save();
    c.translate(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    c.rotate(ang + Math.PI / 2);
    draw();
    c.restore();
  }
  var spots = [-160, -140, -122, -105, -90, -75, -58, -40, -20];
  if (level >= 2) {
    spots.forEach(function (sa, idx) {
      onSurface(sa + 6, function () {
        c.strokeStyle = '#7BD389';
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(-6, 0); c.lineTo(-9, -14);
        c.moveTo(0, 0); c.lineTo(0, -18);
        c.moveTo(6, 0); c.lineTo(9, -14);
        c.stroke();
      });
      if (level >= 3 && idx % 2 === 0) {
        onSurface(sa - 4, function () {
          c.strokeStyle = '#3FBF6A';
          c.lineWidth = 3;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -16); c.stroke();
          c.fillStyle = idx % 4 === 0 ? '#FF8AB3' : '#FFC928';
          c.beginPath(); c.arc(0, -20, 7, 0, Math.PI * 2); c.fill();
        });
      }
    });
  }
  if (level >= 5) {
    [-150, -128, -52, -30].forEach(function (sa) {
      onSurface(sa, function () {
        c.fillStyle = '#7A4E2D';
        c.fillRect(-5, -26, 10, 26);
        c.fillStyle = '#3FBF6A';
        c.beginPath(); c.arc(0, -38, 20, 0, Math.PI * 2); c.fill();
        c.lineWidth = 3; c.strokeStyle = '#13213C'; c.stroke();
      });
    });
  }
  if (level >= 6) {
    onSurface(-115, function () {
      // 小兔子
      c.fillStyle = '#F7F5EF';
      c.beginPath(); c.ellipse(0, -14, 16, 12, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(12, -26, 9, 0, Math.PI * 2); c.fill();
      c.fillRect(8, -48, 5, 18); c.fillRect(15, -46, 5, 16);
      c.fillStyle = '#13213C';
      c.beginPath(); c.arc(15, -27, 2, 0, Math.PI * 2); c.fill();
    });
  }
  if (level >= 8) {
    onSurface(-82, function () {
      c.fillStyle = '#F7F5EF';
      c.fillRect(-26, -40, 52, 40);
      c.fillStyle = '#E5484D';
      c.beginPath(); c.moveTo(-34, -40); c.lineTo(0, -68); c.lineTo(34, -40); c.closePath(); c.fill();
      c.fillStyle = '#1F4FA8';
      c.fillRect(-8, -22, 16, 22);
      c.lineWidth = 3; c.strokeStyle = '#13213C'; c.strokeRect(-26, -40, 52, 40);
    });
  }
  if (level >= 9) {
    onSurface(-66, function () {
      c.fillStyle = '#F7F5EF';
      c.beginPath(); c.moveTo(0, -84); c.lineTo(12, -60); c.lineTo(12, -18); c.lineTo(-12, -18); c.lineTo(-12, -60); c.closePath(); c.fill();
      c.fillStyle = '#E5484D';
      c.beginPath(); c.moveTo(-12, -30); c.lineTo(-22, -12); c.lineTo(-12, -18); c.fill();
      c.beginPath(); c.moveTo(12, -30); c.lineTo(22, -12); c.lineTo(12, -18); c.fill();
      c.fillStyle = '#5BC0FF';
      c.beginPath(); c.arc(0, -56, 5, 0, Math.PI * 2); c.fill();
    });
  }
  if (level >= 10) {
    onSurface(-98, function () {
      // 摩天轮
      c.strokeStyle = '#FFC928';
      c.lineWidth = 4;
      c.beginPath(); c.arc(0, -70, 34, 0, Math.PI * 2); c.stroke();
      for (var q = 0; q < 6; q++) {
        var aa = q * Math.PI / 3 + t / 2000;
        c.beginPath(); c.moveTo(0, -70); c.lineTo(Math.cos(aa) * 34, -70 + Math.sin(aa) * 34); c.stroke();
        c.fillStyle = q % 2 ? '#FF8AB3' : '#5BC0FF';
        c.beginPath(); c.arc(Math.cos(aa) * 34, -70 + Math.sin(aa) * 34, 6, 0, Math.PI * 2); c.fill();
      }
      c.beginPath(); c.moveTo(-18, 0); c.lineTo(0, -70); c.lineTo(18, 0); c.stroke();
    });
  }
  // 小月亮绕着转
  var ma = t / 3000;
  c.fillStyle = '#FFC928';
  c.beginPath();
  c.arc(cx + Math.cos(ma) * (R + 70), cy + Math.sin(ma) * (R + 40) * 0.45 - 20, 16, 0, Math.PI * 2);
  c.fill();
}

var raf = 0;

function animatePlanet(level) {
  cancelAnimationFrame(raf);
  var cv = $('planet');
  var start = performance.now();
  function step(t) {
    drawPlanet(cv, level, t);
    // 只转几秒，省电
    if (t - start < 6000) raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
}

export var growthScreen = {
  manageFocus: true,
  enter: function () {
    // 进来先结算一下（比如今天运动满了 10 分钟）
    afterSession(store);
    var st = store.get();
    var pl = planet(st.totals.stars);
    $('planet-name').textContent = '第 ' + pl.level + ' 级：' + pl.name;
    $('planet-fill').style.width = Math.round(pl.frac * 100) + '%';
    $('planet-sub').textContent = pl.next
      ? '已经攒了 ' + pl.stars + ' 颗星，再攒 ' + (pl.next - pl.stars) + ' 颗升到第 ' + (pl.level + 1) + ' 级：' + PLANET[pl.level].name
      : '已经攒了 ' + pl.stars + ' 颗星，星球已经升到最高级！';
    animatePlanet(pl.level);

    // 今日任务
    var tasks = taskStatus(st, dayKey(), store.todaySeconds());
    var ul = $('tasks');
    ul.innerHTML = '';
    var firstBtn = null;
    tasks.forEach(function (tk) {
      var li = document.createElement('li');
      li.className = tk.done ? 'done' : '';
      li.innerHTML = '<span class="chk">' + (tk.done ? '✓' : '') + '</span><span class="tt">' + tk.text + '</span>';
      if (tk.done) {
        var sp = document.createElement('span');
        sp.className = 'got';
        sp.textContent = '+2 星';
        li.appendChild(sp);
      } else if (tk.go) {
        var b = document.createElement('button');
        b.className = 'btn small focusable';
        b.textContent = '去完成';
        b.addEventListener('click', function () { launch(tk.go); });
        li.appendChild(b);
        if (!firstBtn) firstBtn = b;
      }
      ul.appendChild(li);
    });

    // 勋章
    var got = 0;
    var md = $('medals');
    md.innerHTML = '';
    BADGES.forEach(function (bd) {
      var has = !!st.growth.badges[bd.id];
      if (has) got++;
      var b = document.createElement('button');
      b.className = 'medal focusable' + (has ? ' on' : '');
      b.innerHTML = '<span class="m">' + (bd.mark || bd.name.charAt(0)) + '</span><span class="n">' + bd.name + '</span>';
      b.addEventListener('focus', function () {
        $('medal-desc').textContent = bd.name + '：' + bd.desc + (has ? '（已经得到了）' : '（还没得到）');
      });
      md.appendChild(b);
    });
    $('badge-count').textContent = got + ' / ' + BADGES.length;
    $('medal-desc').textContent = '用方向键选一枚勋章，看看怎么得到它';

    // 课程进度
    var cc = $('course-chips');
    cc.innerHTML = '';
    courses(st).forEach(function (co) {
      var b = document.createElement('button');
      b.className = 'chip focusable';
      b.innerHTML = '<span class="cn">' + co.name + '</span><span class="cs">' + (co.n ? starsText(co.stars) + ' ×' + co.n : '还没练') + '</span>';
      b.addEventListener('click', function () { launch(co.go); });
      cc.appendChild(b);
    });
    setScope($('screen-growth'), firstBtn || cc.querySelector('.chip'));
  },
  exit: function () { cancelAnimationFrame(raf); },
  backTo: function () { return ['home', { from: 'growth' }]; }
};
