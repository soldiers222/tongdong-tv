# 第三方组件

童动乐园打包了以下第三方组件，全部放在本仓库里离线使用，运行时不访问外网。

| 组件 | 位置 | 许可 |
|---|---|---|
| TensorFlow.js 4.22（tfjs、WebGL 后端、WASM 后端） | `web/vendor/tfjs/` | Apache License 2.0，Google LLC |
| TensorFlow.js Pose Detection（`@tensorflow-models/pose-detection`） | `web/vendor/tfjs/pose-detection.min.js` | Apache License 2.0，Google LLC |
| MediaPipe Pose（旧版 Solutions API，含 WASM 与 lite/full 模型） | `web/vendor/mediapipe-pose/` | Apache License 2.0，Google LLC |
| MoveNet SinglePose Lightning v4 模型（TF.js graph model） | `web/models/` | 模型 Apache License 2.0，Google LLC；格式转换由 Vladimir Mandic（MIT） |
| 站酷庆科黄油体（ZCOOL QingKe HuangYou），按界面用字裁剪的子集 | `web/fonts/display.woff2` | SIL Open Font License 1.1，见 `web/fonts/OFL.txt` |

Apache License 2.0 全文：https://www.apache.org/licenses/LICENSE-2.0
