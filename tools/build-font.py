#!/usr/bin/env python3
"""从源码收集用到的字符，裁出「站酷庆科黄油体」子集 → web/fonts/display.woff2

用法：python3 tools/build-font.py [字体文件路径]
字体文件默认 tools/fonts/ZCOOLQingKeHuangYou-Regular.ttf（SIL OFL 1.1，不提交到仓库，体积 8MB）。
没有时可从 https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou 下载。
改了界面文字后重新运行一次即可。
"""
import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tools' / 'fonts' / 'ZCOOLQingKeHuangYou-Regular.ttf'
OUT = WEB / 'fonts' / 'display.woff2'

chars = set()
for p in WEB.rglob('*'):
    if p.suffix not in ('.html', '.js', '.css') or 'vendor' in p.parts:
        continue
    text = p.read_text(encoding='utf-8')
    for ch in text:
        if ord(ch) > 0x2000:
            chars.add(ch)
# ASCII 可见字符 + 常用全角符号
chars.update(chr(c) for c in range(0x20, 0x7F))
chars.update('，。！？：；、（）「」《》—–…·％＋－×★☆')

options = subset.Options()
options.flavor = 'woff2'
options.layout_features = ['*']
options.name_IDs = ['*']
options.notdef_outline = True
font = subset.load_font(str(SRC), options)
subsetter = subset.Subsetter(options)
subsetter.populate(text=''.join(sorted(chars)))
subsetter.subset(font)
OUT.parent.mkdir(parents=True, exist_ok=True)
subset.save_font(font, str(OUT), options)

cmap = font.getBestCmap()
missing = sorted(c for c in chars if ord(c) not in cmap and not c.isspace())
cjk = [c for c in chars if '一' <= c <= '鿿']
print(f'字符 {len(chars)} 个（汉字 {len(cjk)} 个）→ {OUT.relative_to(ROOT)}，{OUT.stat().st_size // 1024} KB')
if missing:
    print('字体里没有、会用系统字体显示的字符：', ''.join(missing))
