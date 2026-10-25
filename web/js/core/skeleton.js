// 骨架线框绘制。pts 为画布坐标的关键点表。
// colorFor(a, b) 返回某根骨头的颜色，用来做「绿 = 到位、黄 = 接近、红 = 偏差大」。

export var BONES = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
];

export var COLORS = {
  good: '#3FBF6A',
  warn: '#FFC928',
  bad: '#E5484D',
  plain: 'rgba(247, 245, 239, 0.85)'
};

export function drawSkeleton(c, pts, opts) {
  opts = opts || {};
  var thr = opts.thr == null ? 0.35 : opts.thr;
  var width = opts.width || 8;
  var alpha = opts.alpha == null ? 1 : opts.alpha;
  c.save();
  c.globalAlpha = alpha;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (var i = 0; i < BONES.length; i++) {
    var a = pts[BONES[i][0]], b = pts[BONES[i][1]];
    if (!a || !b || a.s < thr || b.s < thr) continue;
    c.strokeStyle = 'rgba(10, 18, 36, 0.55)';
    c.lineWidth = width + 6;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.strokeStyle = opts.colorFor ? opts.colorFor(BONES[i][0], BONES[i][1]) : (opts.color || COLORS.plain);
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  var head = pts.nose;
  if (head && head.s >= thr) {
    var ls = pts.left_shoulder, rs = pts.right_shoulder;
    var r = (ls && rs) ? Math.max(18, Math.abs(ls.x - rs.x) * 0.32) : 26;
    c.strokeStyle = opts.color || COLORS.plain;
    c.lineWidth = width * 0.75;
    c.beginPath();
    c.arc(head.x, head.y, r, 0, Math.PI * 2);
    c.stroke();
  }
  if (opts.joints !== false) {
    c.fillStyle = '#F7F5EF';
    var names = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
    for (var j = 0; j < names.length; j++) {
      var p = pts[names[j]];
      if (!p || p.s < thr) continue;
      c.beginPath();
      c.arc(p.x, p.y, width * 0.7, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}
