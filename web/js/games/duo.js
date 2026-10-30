// 双人共用：屏幕左右各一个人。识别结果按屏幕左右分给两个人，名字、颜色、胜负说法。
import { W } from '../core/stage.js';
import { fmtSec } from '../core/util.js';

export var HALF = W / 2;

// region：这个人该站的屏幕区域（0–1），x0：这半边在画布上的起点
export var DUO = [
  { side: 'left', name: '左边', color: '#5BC0FF', x0: 0, region: { x0: 0, x1: 0.5 } },
  { side: 'right', name: '右边', color: '#FF8A5B', x0: HALF, region: { x0: 0.5, x1: 1 } }
];

// frame.kps 是摄像头画面的 [左半边的人, 右半边的人]；画面镜像时，屏幕左边是摄像头画面的右半边
export function screenPlayers(frame, mirror) {
  var k = frame && frame.kps;
  if (!k) return [null, null];
  return mirror ? [k[1] || null, k[0] || null] : [k[0] || null, k[1] || null];
}

export function winnerOf(a, b) {
  if (a > b) return 'left';
  if (b > a) return 'right';
  return 'tie';
}

// 计时比赛按屏幕上显示的数比（fmtSec 保留一位小数，单位 0.1 秒）：两边显示一样就是平局，
// 不会出现两边都显示 8.7 秒却判一边赢
export function shownTenths(ms) { return Math.round(Number(fmtSec(ms)) * 10); }

export function winnerText(w) {
  if (w === 'tie') return '平局！两个人一样厉害';
  return (w === 'left' ? '左边' : '右边') + '赢了！';
}
