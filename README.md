# 童动乐园（家庭版）

给 6–12 岁孩子在华为智慧屏 V75 上玩的体感运动。电视顶上的升降摄像头看孩子的动作，识别全部在电视（或手机）本机完成，不上传画面。
只有「跟着视频跳」（放B站视频）和「遥控游戏」（打开外部网站）要联网，其他都不联网。

## 现在能玩什么（0.5.1）

首页是一条五道的跑道，每道一个入口：

1. **体感游戏**（单人 / 双人）
   - **西瓜切切切**：挥手切水果，别碰炸弹；交叉手切星星加分。按年龄调难度，切得准会自动加快。
   - **太空躲障碍**：三条道的太空隧道，陨石往旁边躲，激光要蹲下，能量栏要跳过去。
   - **敏捷摸球**：球在身边伸手够得到的地方冒出来，越快摸到分越高；写着「左」「右」的要用那只手，两个连着的要两只手一起摸，9–12 岁还有不能碰的炸弹球。
   - **左右闪避**：大球从跑道远处滚过来，往旁边跨一步躲开，顺手吃空道上的星星。
   - 双人闯关：下一版。
2. **跟跳练舞**（跟跳可单人 / 双人）
   - **跟着视频跳**（0.5.0 新加）：网上的广播体操、武术操、儿童律动舞、居家健身操，一共 45 个B站视频，家长还能自己添加，也能放电视里存的视频。
     视频放在左边一大块，孩子自己在右边小框里；AI 一边看视频里的老师、一边看孩子，每 2 秒评一次「完美 / 很棒 / 不错 / 加油」，
     并提示最该改的地方，最后算出孩子比老师慢多少秒、是不是照镜子跳的。详见下面的[跟着视频跳](#跟着视频跳)。
   - 三支舞：「小星星」（入门）、「动感节拍」、「功夫小子」（武术操）。左边是示范的小老师，底下的节奏条提前显示接下来的动作和拍子。
   - 孩子自己的骨架线框按「像不像」逐段变绿 / 黄 / 红，身上叠一层黄色虚线的标准动作；每一拍给「完美 / 很棒 / 不错 / 加油」，并提示最该改的地方（如「左手再举高一点」）。
   - **舞蹈教学**：把一支舞用到的舞步一个一个教：先看慢动作，再自己摆出每个关键动作，摆像了才往下学；学完一键跟着音乐跳。
   - 音乐都是现场合成的，不用音频文件：「小星星」用的是传统童谣旋律（公有领域），另外两首是原创。不内置任何版权 MV。
3. **AI 动作训练**
   - 金鸡独立（单人 / 双人）、单脚平衡（飞机式）、深蹲、弓步蹲。
   - 协调训练（开合跳、高抬腿、交叉摸膝）、瑜伽小课（山式、树式、战士二式、星星式、椅子式）。
   - 武术基本功：马步、冲拳、上架格挡、护头提膝、侧踹、太极起势。取太极拳（慢、稳、立身中正）、泰拳（护头、提膝）、散打（侧踹、快出快收）里适合孩子的基本功，只对空气练、不对人练，开始前先讲安全规则。
   - 每个动作先看示范（要动的部位标黄），做的时候自动数次数或计时，做得不标准会说怎么改（比如「膝盖朝着脚尖，别往里扣」「慢一点，像在水里推」）。做不来的动作可以暂停后跳过。
4. **遥控游戏**：Scratch、Code.org、Blockly Games、CodeCombat、MakeCode、编程一小时（CSforALL）、ChessKid、Lichess。
   电视版 APK 用自带的带光标浏览器打开：方向键移动光标，确定键点击，按住确定再按方向键拖动，返回键后退，菜单键放大缩小。下棋点一点就能玩；拖积木的网站插一个无线鼠标会好用很多。这些都是外部网站，要联网，有的在国内打开会慢。
5. **成长中心**：每日三个运动任务（固定一个「运动满 10 分钟」）、18 枚勋章、成长星球（每局的星星和完成任务攒能量，星球上一级级长出草、花、河、树林、小动物、彩虹……）、课程进度；**家长查看记录**里有每天的运动时间、最近每一局的成绩和要注意的地方、各项最好成绩。

另外：**设备测试**（测摄像头和各识别引擎的速度，电视版 APK 会给原生识别调优）、**家长设置**（年龄段、多久提醒休息、识别引擎、镜像、骨架线、音效、语音提示等）。

结算页上举起双手 2 秒就能再来一局（要先把手放下来一次，跳舞结束时手正举着不会误触发）。

双人要用电视版 APK 的原生识别（画面左右两半各认一个人）；网页版一次只认一个人，会自动按单人玩。双人的成绩不算个人最好成绩。

0.5.1 只改显示：电视上 2–3 米外看的小字放大（最小 22px，说明文字 24–26px）、中文说明只在标点处折行；结算卡片按内容收窄居中；训练记录的「最近的训练」和「最好成绩」不再挤出框；勋章选中和别的按钮一样整块变黄；设置里的左右箭头、任务的勾改成线画的；双人金鸡独立按屏幕上显示的 0.1 秒比输赢（两边显示一样就是平局）。

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
| 确定（入口页右上角的「单人 / 双人」） | 切换单人 / 双人 |
| 返回 | 游戏中暂停（训练和舞蹈教学的暂停菜单里可以跳过做不来的动作；跟着视频跳的暂停菜单里可以镜像画面、提前结束）；其他页面回上一页；首页连按两次退出 |
| 左、右（跟着视频跳的时候） | 快退、快进 10 秒 |
| 菜单（≡） | 重新加载；在「内置版本」和「网页版」之间切换；在遥控游戏的网站里是放大、缩小、刷新 |

切到别的应用或回电视主页时，摄像头会马上关掉（升降摄像头缩回去），回来后这一局重新开始。

## 跟着视频跳

**怎么玩**：首页 →「跟跳练舞」→ 第一格「跟着视频跳」→ 选类别和视频 → 确定看详情 → 再按确定开始。
站到电视前、全身出现在右边的小框里就倒数开始（按确定可以直接开始）。放完出成绩；中途按返回键暂停。

**视频从哪来**：B站（bilibili.com）。电视版用B站官方的外链播放器（`player.bilibili.com`）放在网页下层的「视频层」里播放，
和在网页上嵌B站视频是同一个播放器；童动乐园不下载、不保存、不转发视频，所以要联网，没登录B站时画质一般是 360P–480P。
视频库里的视频是按标题从网上搜的公开视频，可能被作者删掉或改成不公开：电视版会联网查每个视频的标题、时长和封面，
查不到的标成「视频没了」，可以在详情里「隐藏这个视频」。视频的版权归原作者。

**AI 怎么打分**：安卓把视频画面截下来（截不到时让播放器页面把画面画好送过来），用和摄像头同一个 MoveNet 模型识别视频里老师的姿势，
再和孩子的姿势比四肢方向。孩子总比视频慢一点，所以同时试「慢 -0.3 到 1.6 秒」「照镜子跳 / 同一边跳」几十种对法，选最像的那种；
老师站着说话、等前奏的时候不评。站着不动、跳别的动作，分数会很低。看不清老师（视频里没有人、画面截不到）的时候改成按孩子动得多不多打分，
成绩页上会写明。家长设置里打开「性能信息」，运动页左下角会显示老师识别的方式和帧数。

**添加视频**：视频库右上角「添加视频」，输入视频网址里 BV 开头的 12 位（比如 `BV1xx411c7mD`，大小写要一样），
或者 b23.tv 的分享短链接。可以用屏幕上的键盘一个一个输，也可以选中输入框用电视的输入法，或者在电脑上：

```
adb shell input text BV1xx411c7mD         # 先在电视上选中输入框
```

**电视里存的视频**：视频库里「电视里的视频」。最简单的是用电脑放到应用自己的文件夹（不用任何权限）：

```
adb push 舞蹈.mp4 /sdcard/Android/data/com.family.tongdong/files/Movies/
```

U 盘里、下载的视频要在这一页按「允许读取电视里的视频」。网页版可以选手机或电脑里的视频文件（只在网页里放，不上传）。

**网页版**：B站视频放在网页里（iframe），网页看不到视频里的老师，只能按运动量打分，也不能暂停、跳转；要 AI 看着老师打分请用电视版 APK。

### 视频库

| 类别 | 视频（BV 号） |
|---|---|
| 学校里的操 | 七彩阳光（[BV1iPH8zmEyB](https://www.bilibili.com/video/BV1iPH8zmEyB)）、七彩阳光（宽屏）（[BV1eY4y1h7wU](https://www.bilibili.com/video/BV1eY4y1h7wU)）、七彩阳光（原版）（[BV1T44y1K7fb](https://www.bilibili.com/video/BV1T44y1K7fb)）、七彩阳光（分节）（[BV1F44y1P7Ug](https://www.bilibili.com/video/BV1F44y1P7Ug)）、希望风帆（[BV1cAt6eGEJP](https://www.bilibili.com/video/BV1cAt6eGEJP)）、希望风帆（镜面）（[BV1G441127qx](https://www.bilibili.com/video/BV1G441127qx)）、希望风帆（一年级）（[BV15v411u7gg](https://www.bilibili.com/video/BV15v411u7gg)）、希望风帆（完整）（[BV1DB4y117Vv](https://www.bilibili.com/video/BV1DB4y117Vv)）、世界真美好（[BV1RE411576o](https://www.bilibili.com/video/BV1RE411576o)）、旭日东升（[BV1zd4y1r7ua](https://www.bilibili.com/video/BV1zd4y1r7ua)）、精忠报国（第一节）（[BV1vL4y1P7tU](https://www.bilibili.com/video/BV1vL4y1P7tU)）、少年中国说（[BV19G4y1i7So](https://www.bilibili.com/video/BV19G4y1i7So)）、功夫（[BV1mL411Y7eR](https://www.bilibili.com/video/BV1mL411Y7eR)） |
| 儿童律动舞 | 海草舞·波波星球（[BV11J411i7ac](https://www.bilibili.com/video/BV11J411i7ac)）、隔壁泰山·波波星球（[BV1zJ411i7Wn](https://www.bilibili.com/video/BV1zJ411i7Wn)）、小小兵香蕉舞·波波星球（[BV1Pa41187wb](https://www.bilibili.com/video/BV1Pa41187wb)）、小马哒哒哒·波波星球（[BV1eCeBzTE87](https://www.bilibili.com/video/BV1eCeBzTE87)）、加油歌·波波星球（[BV1WJ411R7H5](https://www.bilibili.com/video/BV1WJ411R7H5)）、热爱105°C的你·波波星球（[BV13v411H7Ho](https://www.bilibili.com/video/BV13v411H7Ho)）、小毛驴（教程）·波波星球（[BV1hJ411e7hH](https://www.bilibili.com/video/BV1hJ411e7hH)）、小毛驴（[BV1uy4y1178S](https://www.bilibili.com/video/BV1uy4y1178S)）、无敌小可爱（[BV1da4y1e7Uw](https://www.bilibili.com/video/BV1da4y1e7Uw)）、科目三（幼儿版）（[BV1Su4y1V7rS](https://www.bilibili.com/video/BV1Su4y1V7rS)）、棒棒糖（[BV1754y1i7Eo](https://www.bilibili.com/video/BV1754y1i7Eo)）、爸爸去哪儿·甜果亲子（[BV1et411N7G5](https://www.bilibili.com/video/BV1et411N7G5)）、奇迹再现·甜果亲子（[BV1tt411M7Ri](https://www.bilibili.com/video/BV1tt411M7Ri)）、奇迹再现（动感版）（[BV1T5411M7oi](https://www.bilibili.com/video/BV1T5411M7oi)）、孤勇者（[BV1X24y1A7xQ](https://www.bilibili.com/video/BV1X24y1A7xQ)）、孤勇者（手势舞）（[BV1AF41147DA](https://www.bilibili.com/video/BV1AF41147DA)）、青春修炼手册（[BV1LQ4y1e74n](https://www.bilibili.com/video/BV1LQ4y1e74n)）、青春修炼手册（少儿）（[BV1QC4y1H742](https://www.bilibili.com/video/BV1QC4y1H742)）、小苹果（[BV1A741187Ha](https://www.bilibili.com/video/BV1A741187Ha)）、游啊游（[BV1vZF2eSEa4](https://www.bilibili.com/video/BV1vZF2eSEa4)）、听我说谢谢你（[BV18E411A74s](https://www.bilibili.com/video/BV18E411A74s)）、兔子舞（[BV1pLw9eJETy](https://www.bilibili.com/video/BV1pLw9eJETy)） |
| 健身操 | 10 分钟居家健身操·小小运动家（[BV1Ba4y1i7FW](https://www.bilibili.com/video/BV1Ba4y1i7FW)）、20 分钟全身燃脂操·小小运动家（[BV1pK411p7m2](https://www.bilibili.com/video/BV1pK411p7m2)）、15 分钟燃脂挑战·小小运动家（[BV1ce411W7rq](https://www.bilibili.com/video/BV1ce411W7rq)）、10 分钟全家欢有氧（[BV1n84y1q7iL](https://www.bilibili.com/video/BV1n84y1q7iL)）、亲子健身 25 分钟（[BV1ta4y147d7](https://www.bilibili.com/video/BV1ta4y147d7)）、15 分钟和孩子一起练（[BV1JE41157Yf](https://www.bilibili.com/video/BV1JE41157Yf)）、长高操（[BV18v4y1N7tB](https://www.bilibili.com/video/BV18v4y1N7tB)）、本草纲目毽子操（儿童）（[BV1ui4y1m7kp](https://www.bilibili.com/video/BV1ui4y1m7kp)）、本草纲目毽子操·刘畊宏（[BV1WS4y1c7ji](https://www.bilibili.com/video/BV1WS4y1c7ji)）、10 分钟亲子瑜伽（[BV1PU8vzaEKL](https://www.bilibili.com/video/BV1PU8vzaEKL)） |

## 第一次先做「设备测试」

1. 首页选「设备测试」，人站到电视前 2–3 米，让全身出现在画面里。
2. 按「开始测速」，各识别引擎轮流测（电视版 APK 大约 3 分钟：先给原生识别调优、测速，再测网页里的 6 个）。期间人一直站在画面里，可以轻轻动一动。开着灯测：光线暗时摄像头会自动降低帧率。
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
| `?mock=fruit` / `balance` / `handsup` / `still` | 不开摄像头，用模拟骨架演示（加 `2` 是两个人，如 `fruit2`） |
| `?mock=train` / `dance` / `mole` / `dodge` | 新玩法的模拟骨架：照着游戏的提示做动作、摆姿势、摸球、换道（自动化测试用） |
| `?players=1` / `2` | 单人 / 双人 |
| `?screen=fruit` / `balance` / `day0` / `records` / `settings` / `growth` | 直接进某个页面 |
| `?screen=hub&hub=games` / `dance` / `train` / `remote` | 直接进某个入口页 |
| `?screen=videos&cat=dance` | 直接进视频库（`cat` 是 `school` `dance` `fit` `mine` `local`） |
| `?screen=play&mode=video&bv=BV号&title=名字` | 直接跟着某个B站视频跳（`p=2` 第几集）；`demo=beat` 是不用联网的演示视频（画出来的小人当老师，测试用） |
| `?screen=play&mode=exercise&course=yoga` | 直接开始某个玩法：`mode` 是 `fruit` `balance` `exercise` `mole` `dodge` `dance`；训练用 `course`（`coord` `yoga` `wushu` `squat` `lunge` `balanceT`），闪避用 `variant`（`side` `space`），跳舞用 `routine`（`twinkle` `beat` `kungfu`），`learn=1` 是舞蹈教学 |
| `?age=6-8` / `9-12` | 设定年龄段 |
| `?dur=30` | 切水果、摸球、闪避一局的秒数 |
| `?target=20` | 金鸡独立的目标秒数 |
| `?reps=3` / `?hold=3` | 训练：每个计次动作做几次 / 每个保持动作几秒 |
| `?short=8` | 跳舞：只跳前几个舞步 |
| `?bench=fast` | 设备测试用短时测速（自动化测试用） |
| `?engines=native,mn-wasm` | 设备测试只测这几个引擎 |

## 开发

```
web/                 网页本体（纯静态，ES2017 + ES 模块，无构建步骤）
  index.html, css/   界面；1920×1080 设计画布，按屏幕等比缩放
  js/core/           遥控器导航、几何、滤波、骨架绘制、站位检查、存储、音效、语音、
                     示范小人（figure.js）、身体测量和站立基准（body.js）、舞曲合成（music.js）、成长中心（growth.js）
  js/pose/           摄像头、识别引擎（原生 / MediaPipe / MoveNet）、模拟骨架
  js/games/          西瓜切切切、敏捷摸球、左右闪避和太空躲障碍（逻辑 *-logic.js 与画面分开）；arena.js 是单人 / 双人共用的场地
  js/training/       金鸡独立；AI 动作训练（exercises.js 动作定义，exercise-logic.js 计次 / 计时判定，exercise.js 画面）
  js/dance/          跟跳练舞：舞曲（songs.js）、舞步和整支舞（routines.js）、打分纠错（dance-logic.js）、画面和教学（dance.js）
  js/video/          跟着视频跳：视频库数据（videos.js）、视频库页面（library.js）、视频从哪来（sources.js）、
                     老师的动作从哪来（coach.js）、和老师比动作的判定（video-logic.js）、画面和流程（video-mode.js）、
                     注入B站播放器页面的脚本（inject.js）
  js/diag/day0.js    设备测试
  js/ui/             首页、入口页、成长中心、运动页、训练记录、设置
  vendor/, models/   第三方库和模型，离线使用
android/             电视外壳：全屏 WebView，加载打包进 APK 的 web/；
                     PoseEngine.java 是原生识别（Camera2 取帧 + TensorFlow Lite MoveNet，多线程 CPU），
                     摄像头画面显示在网页下层，网页把画面区域做成透明；
                     BrowserActivity.java 是遥控游戏用的带光标浏览器；
                     VideoPanel.java 是网页下层的视频层（B站外链播放器），CoachEngine.java 识别视频里老师的动作（截屏 + MoveNet），
                     BiliApi.java 代网页查视频信息和封面，LocalMedia.java 读电视里存的视频
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
node --test unit/*.test.mjs               # 各玩法的判定逻辑、舞蹈打分、成长中心
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

## 下一步（0.6.0 计划）

- **双人闯关**：两个人合作，一关一关过（切水果、摸球、闪避、跳舞轮着来，两个人都过关才算）。
- **遥控器原生小游戏**：方向键下国际象棋（和电脑下）、编程迷宫（用方向键排指令让小人走出迷宫），不用鼠标、不用联网。
- 跟着视频跳：在 V75 上实测视频层截屏和老师识别，按实际视频再调打分口径；视频库按家里孩子喜欢的再增删。
- 在 V75 上实测各个新玩法的判定口径（下蹲深度、闪避跨步距离、跳舞相似度），按孩子的实际动作再调。
