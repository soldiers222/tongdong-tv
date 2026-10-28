// 训练记录（家长看）：最近 7 天运动分钟数、最近的训练（每一局做了什么、成绩怎样）、各项最好成绩
import * as store from '../core/store.js';
import { fmtSec, minutesText, pad2 } from '../core/util.js';
import { COURSES } from '../training/exercises.js';
import { ROUTINES } from '../dance/routines.js';

function $(id) { return document.getElementById(id); }

function stars(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < (n || 0) ? '★' : '☆'; return s; }

function when(at) {
  var d = new Date(at), now = new Date();
  var same = d.toDateString() === now.toDateString();
  var y = new Date(now.getTime() - 86400000);
  var day = same ? '今天' : (d.toDateString() === y.toDateString() ? '昨天' : (d.getMonth() + 1) + '月' + d.getDate() + '日');
  return day + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 一局记录 → [名字, 成绩]
export function describe(r) {
  var duo = r.players === 2;
  var win = duo ? (r.winner === 'tie' ? '平局' : (r.winner === 'left' ? '左边赢' : '右边赢')) : '';
  switch (r.type) {
    case 'fruit': return ['西瓜切切切' + (duo ? '（双人）' : ''), duo ? win : r.score + ' 分'];
    case 'balance': return ['金鸡独立' + (duo ? '（双人）' : '') + (r.stand ? (r.stand === 'left' ? ' · 左脚' : ' · 右脚') : ''), duo ? win : fmtSec(r.holdMs || 0) + ' 秒'];
    case 'mole': return ['敏捷摸球' + (duo ? '（双人）' : ''), duo ? win : r.score + ' 分，摸中 ' + r.hits];
    case 'dodge': return ['左右闪避' + (duo ? '（双人）' : ''), duo ? win : r.score + ' 分' + (r.survived ? '' : '（中途没命）')];
    case 'space': return ['太空躲障碍' + (duo ? '（双人）' : ''), duo ? win : r.score + ' 分' + (r.survived ? '' : '（中途没命）')];
    case 'exercise': {
      var c = COURSES[r.course];
      var done = (r.steps || []).filter(function (x) { return !x.skipped; }).length;
      return [(c ? c.name : '训练'), stars(r.rating) + '　' + done + ' 个动作' + (r.tip ? '，要注意：' + r.tip : '')];
    }
    case 'dance': {
      var ro = ROUTINES[r.routine];
      return ['跟跳：' + (ro ? ro.name : '') + (duo ? '（双人）' : ''), duo ? win : r.points + ' 分 ' + stars(r.rating)];
    }
    case 'dancelearn': {
      var rl = ROUTINES[r.routine];
      return ['舞蹈教学：' + (rl ? rl.name : ''), '摆像 ' + r.ok + ' / ' + r.total + ' 个动作'];
    }
    default: return [r.type, ''];
  }
}

export var recordsScreen = {
  enter: function () {
    var days = store.lastDays(7);
    var max = 600; // 至少按 10 分钟画满，几十秒不会撑满整条
    for (var i = 0; i < days.length; i++) max = Math.max(max, days[i].sec);
    var html = '';
    for (var j = 0; j < days.length; j++) {
      var d = days[j];
      var w = d.sec > 0 ? Math.max(12, Math.round(400 * d.sec / max)) : 6;
      html += '<li><span class="d">' + d.label + '</span><span class="bar' + (d.today ? ' today' : '') + '" style="width:' + w + 'px"></span><span class="m">' + minutesText(d.sec) + ' 分钟</span></li>';
    }
    $('rec-bars').innerHTML = html;
    var s = store.get();
    $('rec-total').textContent = '累计运动 ' + minutesText(s.totals.sec) + ' 分钟，一共 ' + s.totals.sessions + ' 局';
    var recent = store.recentSessions(9);
    var rh = '';
    for (var k = 0; k < recent.length; k++) {
      var ds = describe(recent[k]);
      rh += '<li><span class="w">' + when(recent[k].at) + '</span><span class="a">' + ds[0] + '</span><span class="r">' + ds[1] + '</span></li>';
    }
    $('rec-recent').innerHTML = rh || '<li class="empty-note">还没有训练记录。玩一局、练一次就会出现在这里。</li>';
    var b = s.best, o = b.other;
    var rows = [
      ['西瓜切切切', Math.max(b.fruit['6-8'] || 0, b.fruit['9-12'] || 0) + ' 分'],
      ['金鸡独立', (b.balance.left || b.balance.right) ? '左 ' + fmtSec(b.balance.left || 0) + ' · 右 ' + fmtSec(b.balance.right || 0) + ' 秒' : '还没站过'],
      ['敏捷摸球', Math.max(o['mole-6-8'] || 0, o['mole-9-12'] || 0) + ' 分'],
      ['左右闪避', Math.max(o['dodge-6-8'] || 0, o['dodge-9-12'] || 0) + ' 分'],
      ['太空躲障碍', Math.max(o['space-6-8'] || 0, o['space-9-12'] || 0) + ' 分'],
      ['跟跳最高', Math.max(o['dance-twinkle'] || 0, o['dance-beat'] || 0, o['dance-kungfu'] || 0) + ' 分']
    ];
    var out = '';
    for (var m = 0; m < rows.length; m++) out += '<li><span>' + rows[m][0] + '</span><b>' + rows[m][1] + '</b></li>';
    $('rec-bests').innerHTML = out;
  },
  backTo: function () { return ['growth', {}]; }
};
