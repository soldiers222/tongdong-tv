# 童动乐园（家庭版）

给 6–12 岁孩子在华为智慧屏 V75 上玩的体感运动。电视顶上的升降摄像头看孩子的动作，识别全部在电视（或手机）本机完成，不联网、不上传画面。

## 现在能玩什么（0.2.0）

- **西瓜切切切**：挥手切水果，别碰炸弹，手划过身体中线能拿金星。按 6–8 / 9–12 岁调难度，切得准会自动加快；识别慢的设备自动放慢节奏。
- **金鸡独立**：左右脚各站一次，计时、星级、身体晃动曲线，告诉孩子哪条腿弱一些。脚落地或晃得太大算失稳。
- **设备测试**：测摄像头和各识别引擎的速度，给出结论：电视直接玩（路线 A），还是用手机当摄像头（路线 B）。
- **原生识别**（0.2.0 起，只在电视版 APK 里）：摄像头和识别模型直接在安卓里跑，用上电视的多个 CPU 核心，网页只负责画面。V75 上网页里的识别最快每秒 10 次左右，原生识别目标是跟上摄像头（每秒 25–30 次），画面保持 60 帧。
- **运动记录**、**家长设置**（年龄段、多久提醒休息、识别引擎、镜像、骨架线、音效、语音提示等）。

结算页上举起双手 2 秒就能再来一局，不用找遥控器。

## 装到电视上

1. 用电脑下载 APK：<https://github.com/soldiers222/tongdong-tv/releases/latest/download/tongdong-tv.apk>
2. 拷到 U 盘**根目录**，U 盘插到电视的 USB 口。
3. 电视上打开「文件管理」（或「媒体中心」里的 U 盘），选中 `tongdong-tv.apk` 安装。第一次会提示不允许安装外部来源应用，按提示到设置里打开。
4. 在「我的应用」里打开「童动乐园」。第一次进运动时电视会问摄像头权限，选允许。

以后有新版本，同样的方法覆盖安装，运动记录不会丢。

### 用电脑无线安装（ADB，可选）

电视和电脑在同一个局域网时，不用 U 盘也能装，还能截屏：

1. 电视上打开开发者选项（一般是在「关于」里连续按「版本号」7 次），再打开「USB 调试」。
2. 电脑上装 [Android platform-tools](https://developer.android.com/tools/releases/platform-tools)，在它的目录里打开命令行：

```
adb connect 电视IP:5555                            # 第一次电视上会弹窗，选「允许」
adb install -r "下载目录\tongdong-tv.apk"          # 覆盖安装，记录不丢
adb exec-out screencap -p > tv.png                 # 截电视屏幕
```

电视 IP 在电视的「网络」设置里能看到。电视重启后 IP 可能会变，`adb connect` 报 10061 时先确认 IP 和「USB 调试」开关。

### 遥控器

| 按键 | 作用 |
|---|---|
| 上下左右、确定 | 选择、开始 |
| 返回 | 游戏中暂停；其他页面回首页；首页连按两次退出 |
| 菜单（≡） | 重新加载；在「内置版本」和「网页版」之间切换 |

切到别的应用或回电视主页时，摄像头会马上关掉（升降摄像头缩回去），回来后这一局重新开始。

## 第一次先做「设备测试」

1. 首页选「设备测试」，人站到电视前 2–3 米，让全身出现在画面里。
2. 按「开始测速」，大约 2 分钟，各识别引擎轮流测（电视版 APK 先测原生识别，再测网页里的 6 个）。期间人一直站在画面里，可以轻轻动一动。
3. 看右下角结论：
   - **路线 A：电视直接玩，全部功能**：最快的引擎每秒识别 15 次以上。
   - **路线 A：慢节奏**：每秒 8–15 次。切水果会自动放慢，金鸡独立不受影响。
   - **路线 B：用手机当摄像头**：不到 8 次，或者摄像头打不开。
4. 按「结果摘要」，把屏幕拍照发给开发者，用来决定下一步怎么做。

游戏会自动选最快的引擎（电视版 APK 优先用原生识别，启动不了再用网页里的）；也可以在家长设置里手动指定。

## 网页版

<https://soldiers222.github.io/tongdong-tv/>，每次推代码自动更新。

第一次要在仓库 Settings → Pages 里把 Source 选成「GitHub Actions」，然后到 Actions → 网页版 → Run workflow 运行一次。也可以改用 Netlify：导入这个仓库即可，`netlify.toml` 已经配好。

- 电脑上用 Chrome 打开可以直接看效果、玩一玩（用电脑摄像头）。
- 路线 B：手机横放在电视下方，用 Chrome 或系统浏览器打开网页版，再用「无线投屏」投到电视。
- 网页版和 APK 内置版本的运动记录分开保存。

调试用的地址参数：

| 参数 | 作用 |
|---|---|
| `?mock=fruit` / `balance` / `handsup` / `still` | 不开摄像头，用模拟骨架演示 |
| `?screen=fruit` / `balance` / `day0` / `records` / `settings` | 直接进某个页面 |
| `?age=6-8` / `9-12` | 设定年龄段 |
| `?dur=30` | 切水果一局的秒数 |
| `?target=20` | 金鸡独立的目标秒数 |
| `?bench=fast` | 设备测试用短时测速（自动化测试用） |
| `?engines=native,mn-wasm` | 设备测试只测这几个引擎 |

## 开发

```
web/                 网页本体（纯静态，ES2017 + ES 模块，无构建步骤）
  index.html, css/   界面；1920×1080 设计画布，按屏幕等比缩放
  js/core/           遥控器导航、几何、滤波、骨架绘制、站位检查、存储、音效、语音
  js/pose/           摄像头、识别引擎（MediaPipe / MoveNet，WebGL / WASM / 后台线程）、模拟骨架
  js/games/          西瓜切切切（逻辑与画面分开）
  js/training/       金鸡独立（判定逻辑与画面分开）
  js/diag/day0.js    设备测试
  js/ui/             首页、运动页、记录、设置
  vendor/, models/   第三方库和模型，离线使用
android/             电视外壳：全屏 WebView，加载打包进 APK 的 web/；
                     PoseEngine.java 是原生识别（Camera2 取帧 + TensorFlow Lite MoveNet，多线程 CPU），
                     摄像头画面显示在网页下层，网页把画面区域做成透明
tests/               单元测试、语法兼容检查、无头 Chrome 端到端测试
tools/               字体子集裁剪、APK 图标生成
```

本地运行：

```bash
cd web && python3 -m http.server 8000     # 打开 http://localhost:8000
```

测试（推送后 GitHub Actions 也会自动跑）：

```bash
cd tests && npm ci
node syntax-check.mjs                     # 只允许 ES2017 语法，照顾老电视浏览器
node --test unit/*.test.mjs               # 切水果、金鸡独立的判定逻辑
node e2e.mjs                              # 无头 Chrome 跑完整流程（CHROME= 指定 Chrome 路径；默认带跨源隔离头，同 APK，ISOLATE=0 同网页版）
FAKE_CAMERA=person.y4m node e2e.mjs       # 加上假摄像头视频，连真实识别模型一起测（见 make-fixture.py）
```

改了界面文字后重新裁剪展示字体（完整字体放在 `tools/fonts/`，不进仓库）：

```bash
python3 tools/build-font.py
```

### APK 怎么构建

推送到 `main` 后，GitHub Actions 的「电视版 APK」会把 `web/` 复制进 `android/` 的 assets，下载原生识别用的 MoveNet Lightning 模型（TensorFlow Lite int8，约 2.9 MB，不进仓库），构建后发布到 Releases（上面的固定下载地址）。版本号取自 `web/js/version.js`。

APK 用仓库里固定的调试证书 `android/app/debug.keystore` 签名（密码是安卓惯例的 `android`），每次构建都能直接覆盖安装。**不要换掉或删除它**：证书一变，电视上只能卸载重装，运动记录会丢。

本地构建：用 Android Studio 打开 `android/` 目录（需要 JDK 17，Gradle 8.7 以上）。

## 下一步

- 在 V75 上测原生识别的速度；不够快再试 GPU 或 NNAPI 加速。
- 跟着 MV 跳舞：视频上叠加线框提示，识别动作并纠正。
- 更多动作训练：武术招式，对比标准动作给出指导。
