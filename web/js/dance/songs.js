// 舞曲。「小星星」用的是传统童谣旋律（公有领域），另外两首是为这个应用写的原创旋律。
// 写法见 core/music.js：每小节 8 个八分音符，和弦每个占两拍。

function bars(list, opts) {
  return list.map(function (b) {
    var o = { mel: b[0], chords: b[1] };
    for (var k in opts) o[k] = opts[k];
    return o;
  });
}

// ---------- 小星星（传统童谣，96 拍/分） ----------
var TW_A = [
  ['C5 - C5 - G5 - G5 -', ['C']],
  ['A5 - A5 - G5 - - -', ['F', 'C']],
  ['F5 - F5 - E5 - E5 -', ['F', 'C']],
  ['D5 - D5 - C5 - - -', ['G', 'C']],
  ['G5 - G5 - F5 - F5 -', ['C', 'F']],
  ['E5 - E5 - D5 - - -', ['C', 'G']],
  ['G5 - G5 - F5 - F5 -', ['C', 'F']],
  ['E5 - E5 - D5 - - -', ['C', 'G']],
  ['C5 - C5 - G5 - G5 -', ['C']],
  ['A5 - A5 - G5 - - -', ['F', 'C']],
  ['F5 - F5 - E5 - E5 -', ['F', 'C']],
  ['D5 - D5 - C5 - - -', ['G', 'C']]
];

export var TWINKLE = {
  id: 'twinkle',
  bpm: 96,
  intro: 2,
  outro: 2,
  bars: [].concat(
    bars([['', ['C']], ['', ['G']]], { drums: 'count' }),
    bars(TW_A, { drums: 'four' }),
    bars(TW_A, { drums: 'pop' }),
    bars([['C5 - - - E5 - G5 -', ['C']], ['C6 - - - - - . .', ['C']]], { drums: 'half' })
  )
};

// ---------- 动感节拍（原创，112 拍/分，A 小调：Am F C G） ----------
var BT_A = [
  ['A4 . C5 . E5 - D5 C5', ['Am']],
  ['D5 - - . C5 . A4 .', ['F']],
  ['G4 . C5 . E5 - D5 C5', ['C']],
  ['D5 - - - . . . .', ['G']],
  ['A4 . C5 . E5 - G5 -', ['Am']],
  ['A5 - G5 - E5 - D5 .', ['F']],
  ['C5 . D5 . E5 - D5 C5', ['G']],
  ['A4 - - - . . . .', ['Am']]
];
var BT_B = [
  ['E5 . E5 . D5 . C5 .', ['F']],
  ['D5 - C5 - A4 - - .', ['C']],
  ['E5 . E5 . G5 . E5 .', ['G']],
  ['D5 - - - . . . .', ['Am']],
  ['C5 . C5 . D5 . E5 .', ['F']],
  ['G5 - E5 - D5 - C5 .', ['C']],
  ['D5 . C5 . A4 - C5 .', ['G']],
  ['A4 - - - . . . .', ['Am']]
];

export var BEAT = {
  id: 'beat',
  bpm: 112,
  intro: 4,
  outro: 2,
  bars: [].concat(
    bars([['', ['Am']], ['', ['F']]], { drums: 'count' }),
    bars([['', ['C']], ['', ['G']]], { drums: 'drive' }),
    bars(BT_A, { drums: 'pop' }),
    bars(BT_B, { drums: 'drive' }),
    bars(BT_A, { drums: 'drive' }),
    bars([['A4 . C5 . E5 . A5 .', ['Am']], ['A5 - - - . . . .', ['Am']]], { drums: 'half' })
  )
};

// ---------- 功夫小子（原创，100 拍/分，五声音阶） ----------
var KF_A = [
  ['E5 . G5 . A5 - G5 E5', ['Am']],
  ['D5 . E5 . G5 - - .', ['G']],
  ['A5 . G5 . E5 - D5 C5', ['Am']],
  ['D5 - - - . . . .', ['Em']],
  ['C5 . D5 . E5 - G5 .', ['C']],
  ['A5 . C6 . A5 - G5 .', ['Am']],
  ['E5 . D5 . C5 - D5 E5', ['G']],
  ['A4 - - - . . . .', ['Am']]
];

export var KUNGFU = {
  id: 'kungfu',
  bpm: 100,
  intro: 2,
  outro: 2,
  bars: [].concat(
    bars([['', ['Am']], ['', ['Em']]], { drums: 'count' }),
    bars(KF_A, { drums: 'gong' }),
    bars(KF_A, { drums: 'drive' }),
    bars(KF_A, { drums: 'gong' }),
    bars([['A4 . C5 . D5 . E5 .', ['Am']], ['A5 - - - . . . .', ['Am']]], { drums: 'half' })
  )
};
