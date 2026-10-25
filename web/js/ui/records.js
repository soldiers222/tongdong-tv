// 运动记录：最近 7 天运动分钟数 + 各项最好成绩
import * as store from '../core/store.js';
import { fmtSec, minutesText } from '../core/util.js';

function $(id) { return document.getElementById(id); }

export var recordsScreen = {
  enter: function () {
    var days = store.lastDays(7);
    var max = 600; // 至少按 10 分钟画满，几十秒不会撑满整条
    for (var i = 0; i < days.length; i++) max = Math.max(max, days[i].sec);
    var html = '';
    for (var j = 0; j < days.length; j++) {
      var d = days[j];
      var w = d.sec > 0 ? Math.max(12, Math.round(560 * d.sec / max)) : 6;
      html += '<li><span class="d">' + d.label + '</span><span class="bar' + (d.today ? ' today' : '') + '" style="width:' + w + 'px"></span><span class="m">' + minutesText(d.sec) + ' 分钟</span></li>';
    }
    $('rec-bars').innerHTML = html;
    var s = store.get();
    var b = s.best;
    var rows = [
      ['西瓜切切切（6–8 岁）', (b.fruit['6-8'] || 0) + ' 分'],
      ['西瓜切切切（9–12 岁）', (b.fruit['9-12'] || 0) + ' 分'],
      ['金鸡独立 · 左脚站', b.balance.left ? fmtSec(b.balance.left) + ' 秒' : '还没站过'],
      ['金鸡独立 · 右脚站', b.balance.right ? fmtSec(b.balance.right) + ' 秒' : '还没站过']
    ];
    var out = '';
    for (var k = 0; k < rows.length; k++) out += '<li><span>' + rows[k][0] + '</span><b>' + rows[k][1] + '</b></li>';
    out += '<li><span>累计运动</span><b>' + s.sessions.length + ' 局</b></li>';
    $('rec-bests').innerHTML = out;
  }
};
