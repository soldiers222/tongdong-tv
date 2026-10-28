// 舞步和整支舞。舞步是示范小人的关键帧（参数见 core/figure.js，坐标是摄像头原始画面：
// 孩子的左手在画面右边，x 大于 0.5）。at 是相对这一步开始的拍数；score 为 true 的关键帧要打分。
import { TWINKLE, BEAT, KUNGFU } from './songs.js';

function m(name, cue, keys) { return { name: name, cue: cue, beats: 2, keys: keys }; }
function k(at, pose, score) { return { at: at, pose: pose, score: score !== false }; }

// 左右对称的舞步：右边由左边镜像得到
function mirror(o) {
  var out = {};
  for (var key in o) {
    var v = o[key];
    var to = key.replace('Left', '#').replace('Right', 'Left').replace('#', 'Right');
    if (key === 'leftHand') to = 'rightHand';
    if (key === 'rightHand') to = 'leftHand';
    if (v && typeof v === 'object' && v.x != null) v = { x: 1 - v.x, y: v.y };
    if (key === 'sway') v = -v;
    out[to] = v;
  }
  return out;
}

var L = {
  point: m('左手指天', '左手斜着指向天空，右手叉腰', [k(0, { arms: 'waist', leftHand: { x: 0.65, y: 0.1 } }), k(1, { arms: 'waist' }, false)]),
  sway: m('向左摆', '身体往左摆，两手侧平举', [k(0, { arms: 'out', sway: 0.035 }), k(1, { arms: 'down' }, false)]),
  knee: m('左膝上抬', '左膝盖抬起来，两手打开', [k(0, { arms: 'out', liftLeft: 1 }), k(1, { arms: 'down' }, false)]),
  clapSide: m('左边拍手', '两只手在身体左边拍一下', [k(0, { leftHand: { x: 0.62, y: 0.43 }, rightHand: { x: 0.585, y: 0.43 } }), k(1, { arms: 'down' }, false)]),
  disco: m('迪斯科', '左手斜上指，右手斜下指，变成一条斜线', [k(0, { leftHand: { x: 0.65, y: 0.09 }, rightHand: { x: 0.4, y: 0.56 } }), k(1, { arms: 'waist' }, false)]),
  kick: m('左脚侧踢', '左脚往旁边轻轻踢出去，两手打开保持平衡', [k(0, { arms: 'out', kickLeft: 0.6 }), k(1, { arms: 'out' }, false)]),
  punch: m('左冲拳', '扎好马步，左拳往前冲出去', [k(0, { arms: 'waist', spread: 1, squat: 0.3, punchLeft: 1 }), k(1, { arms: 'waist', spread: 1, squat: 0.3 }, false)]),
  block: m('左手上架', '双手护脸，左小臂往上架过头顶', [k(0, { arms: 'guard', leftHand: { x: 0.56, y: 0.12 } }), k(1, { arms: 'guard' }, false)]),
  guardKnee: m('左提膝', '双手护脸，左膝往上提', [k(0, { arms: 'guard', liftLeft: 1 }), k(1, { arms: 'guard' }, false)])
};

export var MOVES = {
  sparkle: m('小星星闪闪', '两手举高，像星星一闪一闪', [k(0, { arms: 'up' }), k(1, { arms: 'chest' }, false)]),
  star: m('大星星', '两脚分开，两手斜着往上伸，变成大星星', [k(0, { arms: 'wide', spread: 0.8 }), k(1, { arms: 'down' }, false)]),
  heart: m('头顶比心', '两手在头顶合起来，比一个大爱心', [k(0, { arms: 'top' }), k(1, { arms: 'chest' }, false)]),
  upHigh: m('够天空', '两手使劲往上伸，够到天空', [k(0, { arms: 'up' }), k(1, { arms: 'down' }, false)]),
  squatPush: m('蹲下推', '蹲下去，两手往两边推开', [k(0, { arms: 'out', squat: 0.5 }), k(1, { arms: 'down' }, false)]),
  jackOpen: m('开合跳', '跳开，两手举过头顶', [k(0, { arms: 'up', spread: 1 }), k(1, { arms: 'down' }, false)]),
  swim: m('自由泳', '两只手轮流往上划，像在游泳', [k(0, { leftHand: { x: 0.56, y: 0.08 }, rightHand: { x: 0.44, y: 0.5 } }), k(1, { leftHand: { x: 0.56, y: 0.5 }, rightHand: { x: 0.44, y: 0.08 } })]),
  wave: m('大波浪', '两手先侧平举，再举过头顶', [k(0, { arms: 'out' }), k(1, { arms: 'up' })]),
  bow: m('抱拳礼', '两脚并拢，右拳左掌在胸前合起来', [k(0, { arms: 'chest' }), k(1, { arms: 'chest' }, false)]),
  horse: m('马步', '两脚分开，屈膝下蹲，两拳抱在腰间', [k(0, { arms: 'waist', spread: 1.2, squat: 0.5 }), k(1, { arms: 'waist', spread: 1.2, squat: 0.5 }, false)]),
  crane: m('白鹤亮翅', '右脚站稳，左膝抬起，两手展开像翅膀', [k(0, { arms: 'wide', liftLeft: 0.7 }), k(1, { arms: 'wide', liftLeft: 0.7 }, false)])
};

// 生成左右两个版本
for (var key in L) {
  var mv = L[key];
  MOVES[key + 'L'] = mv;
  MOVES[key + 'R'] = {
    name: mv.name.replace(/左/g, '#').replace(/右/g, '左').replace(/#/g, '右'),
    cue: mv.cue.replace(/左/g, '#').replace(/右/g, '左').replace(/#/g, '右'),
    beats: mv.beats,
    keys: mv.keys.map(function (kk) { return { at: kk.at, pose: mirror(kk.pose), score: kk.score }; })
  };
}

var TW1 = [
  'sparkle', 'sparkle', 'star', 'star',
  'pointL', 'pointR', 'heart', 'heart',
  'swayL', 'swayR', 'upHigh', 'upHigh',
  'kneeL', 'kneeR', 'star', 'star',
  'sparkle', 'sparkle', 'star', 'star',
  'pointL', 'pointR', 'heart', 'heart'
];
var TW2 = [
  'sparkle', 'sparkle', 'jackOpen', 'jackOpen',
  'clapSideL', 'clapSideR', 'heart', 'heart',
  'swayL', 'swayR', 'squatPush', 'squatPush',
  'kneeL', 'kneeR', 'kneeL', 'kneeR',
  'sparkle', 'sparkle', 'jackOpen', 'jackOpen',
  'pointL', 'pointR', 'heart', 'heart'
];
var BT_A = [
  'pointL', 'pointR', 'pointL', 'pointR', 'discoL', 'discoR', 'discoL', 'discoR',
  'clapSideL', 'clapSideR', 'squatPush', 'squatPush', 'swim', 'swim', 'jackOpen', 'jackOpen'
];
var BT_B = [
  'kneeL', 'kneeR', 'kneeL', 'kneeR', 'wave', 'wave', 'star', 'star',
  'kickL', 'kickR', 'kickL', 'kickR', 'clapSideL', 'clapSideR', 'heart', 'heart'
];
var KF_A = [
  'bow', 'bow', 'horse', 'horse', 'punchL', 'punchR', 'punchL', 'punchR',
  'blockL', 'blockR', 'blockL', 'blockR', 'guardKneeL', 'guardKneeR', 'horse', 'horse'
];
var KF_B = [
  'punchL', 'punchR', 'punchL', 'punchR', 'kickL', 'kickR', 'kickL', 'kickR',
  'blockL', 'blockR', 'guardKneeL', 'guardKneeR', 'crane', 'crane', 'bow', 'bow'
];

export var ROUTINES = {
  twinkle: { id: 'twinkle', name: '小星星', level: '入门', desc: '跟着童谣慢慢跳，动作简单', song: TWINKLE, moves: TW1.concat(TW2), end: 'star' },
  beat: { id: 'beat', name: '动感节拍', level: '进阶', desc: '节奏更快，左右手轮流换', song: BEAT, moves: BT_A.concat(BT_B, BT_A), end: 'star' },
  kungfu: { id: 'kungfu', name: '功夫小子', level: '进阶', desc: '冲拳、上架、提膝，跳一支武术操', song: KUNGFU, moves: KF_A.concat(KF_B, KF_A), end: 'bow' }
};

// 整支舞展开成关键帧时间表（拍）：[{beat, pose, score, move}]
export function timeline(routine) {
  var song = routine.song;
  var b = song.intro * 4;
  var out = [];
  for (var i = 0; i < routine.moves.length; i++) {
    var mv = MOVES[routine.moves[i]];
    for (var j = 0; j < mv.keys.length; j++) {
      out.push({ beat: b + mv.keys[j].at, pose: mv.keys[j].pose, score: mv.keys[j].score, move: routine.moves[i], idx: i });
    }
    b += mv.beats;
  }
  // 结束造型
  var end = MOVES[routine.end];
  if (end) out.push({ beat: b, pose: end.keys[0].pose, score: false, move: routine.end, idx: routine.moves.length });
  return out;
}

// 教学用：按第一次出现的顺序列出用到的舞步
export function uniqueMoves(routine) {
  var seen = {}, out = [];
  for (var i = 0; i < routine.moves.length; i++) {
    var id = routine.moves[i];
    if (!seen[id]) { seen[id] = true; out.push(id); }
  }
  return out;
}
