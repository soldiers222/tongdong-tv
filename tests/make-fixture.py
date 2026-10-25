#!/usr/bin/env python3
"""把一张全身照做成 Chrome 假摄像头用的 y4m 视频（人物轻微左右移动）。
用法：python3 make-fixture.py 输入.jpg 输出.y4m [裁剪 x0,y0,x1,y1]
测试照片不随仓库提供，任意一张单人全身照即可。"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
crop = tuple(int(v) for v in sys.argv[3].split(',')) if len(sys.argv) > 3 else None
W, H, N = 960, 540, 24
im = Image.open(src).convert('RGB')
person = im.crop(crop) if crop else im
scale = (H * 0.86) / person.height
person = person.resize((max(1, int(person.width * scale)), int(person.height * scale)), Image.LANCZOS)
bg = im.resize((W, H)).filter(ImageFilter.GaussianBlur(18))
frames = []
for i in range(N):
    f = bg.copy()
    dx = int(10 * np.sin(i / N * 2 * np.pi))
    f.paste(person, ((W - person.width) // 2 + dx, H - person.height - 12))
    frames.append(f)
with open(out, 'wb') as fh:
    fh.write(f'YUV4MPEG2 W{W} H{H} F15:1 Ip A1:1 C420jpeg\n'.encode())
    for f in frames:
        ycc = np.asarray(f.convert('YCbCr'), dtype=np.uint8)
        y = ycc[:, :, 0]
        u = ycc[::2, ::2, 1]
        v = ycc[::2, ::2, 2]
        fh.write(b'FRAME\n')
        fh.write(y.tobytes()); fh.write(u.tobytes()); fh.write(v.tobytes())
print('写出', out, W, 'x', H, N, '帧')
