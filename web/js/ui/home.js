// 首页：一条五道的跑道，每道一个入口（体感游戏、跟跳练舞、AI 动作训练、遥控游戏、成长中心）；
// 下面草坪上是今天的运动量和工具（设备测试、家长设置）。
import * as store from '../core/store.js';
import { minutesText, dayKey } from '../core/util.js';
import { setScope } from '../core/nav.js';
import { taskStatus } from '../core/growth.js';

function $(id) { return document.getElementById(id); }

var lastFocus = null;
var LANE = { games: 'lane-games', dance: 'lane-dance', train: 'lane-train', remote: 'lane-remote', growth: 'lane-growth' };

function count(types) {
  var d = store.get().days[dayKey()];
  if (!d || !d.n) return 0;
  var n = 0;
  for (var i = 0; i < types.length; i++) n += d.n[types[i]] || 0;
  return n;
}

export var homeScreen = {
  manageFocus: true,
  enter: function (params) {
    var s = store.get();
    var g = count(['fruit', 'mole', 'dodge', 'space']);
    $('meta-games').textContent = g ? '今天玩了 ' + g + ' 局' : '5 个游戏';
    var dn = count(['dance', 'dancelearn']);
    $('meta-dance').textContent = dn ? '今天跳了 ' + dn + ' 次' : '3 支舞';
    var tr = count(['exercise']) + Math.ceil(count(['balance']) / 2);
    $('meta-train').textContent = tr ? '今天练了 ' + tr + ' 次' : '7 种练法';
    $('meta-remote').textContent = '8 个网站';
    var tasks = taskStatus(s, dayKey(), store.todaySeconds());
    var done = tasks.filter(function (t) { return t.done; }).length;
    $('meta-growth').textContent = '今日任务 ' + done + ' / ' + tasks.length;
    $('stat-today').textContent = minutesText(store.todaySeconds());
    $('stat-week').textContent = String(store.activeDaysThisWeek());
    $('badge-day0').style.display = s.day0 ? 'none' : '';
    var target = null;
    if (params && params.from && LANE[params.from]) target = $(LANE[params.from]);
    else if (lastFocus && document.body.contains(lastFocus)) target = lastFocus;
    setScope($('screen-home'), target || $('lane-games'));
  },
  exit: function () {
    if (document.activeElement && document.activeElement.classList.contains('focusable')) lastFocus = document.activeElement;
  }
};
