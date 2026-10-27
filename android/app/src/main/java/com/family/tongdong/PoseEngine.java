package com.family.tongdong;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import org.json.JSONArray;
import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Delegate;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.gpu.CompatibilityList;
import org.tensorflow.lite.gpu.GpuDelegate;
import org.tensorflow.lite.nnapi.NnApiDelegate;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 原生姿态识别：Camera2 取帧 → MoveNet Lightning（TensorFlow Lite）→ 17 个关键点。
 *
 * 网页里的识别只能用单核（电视的网页内核不支持多线程 WASM），这里直接用安卓原生代码跑。
 * 为了把多核都用上，可以同时开几个「识别器」：每个识别器有自己的线程（和线程池），
 * 摄像头的帧轮流交给空闲的识别器，几帧同时在算。识别器的个数、每个几线程、用 CPU / GPU / NNAPI，
 * 由网页的「设备测试」在这台电视上实测后选最快的（见 bench）。
 *
 * 摄像头画面同时送到一个 SurfaceTexture，由 MainActivity 显示在网页下层。
 *
 * 输出的关键点坐标是相对摄像头画面的 0–1 归一化坐标（未镜像），顺序同 MoveNet：
 * 鼻、左眼、右眼、左耳、右耳、左肩、右肩、左肘、右肘、左腕、右腕、左髋、右髋、左膝、右膝、左踝、右踝。
 *
 * 「画面」指摆正以后的画面（和预览层显示的一致）：传感器装歪了（SENSOR_ORIENTATION 是 90/180/270）
 * 时，取样时转正再送进模型，宽高也按转正后的算。
 */
final class PoseEngine {
    interface Listener {
        /** 在后台线程调用；json 形如 {"k":[x,y,s,…51个],"w":640,"h":480,"age":35,"ms":22} */
        void onPose(String json);

        void onError(String message);

        /** 测速结束（后台线程调用），json 见 runBench */
        void onBench(String json);
    }

    static final String MODEL = "models/movenet_lightning_int8.tflite";
    /** GPU 用的半精度模型（构建时没下载到就没有，GPU 退回用 int8 模型） */
    static final String MODEL_F16 = "models/movenet_lightning_f16.tflite";
    private static final int IN = 192;            // MoveNet Lightning 输入边长
    private static final String TAG = "Tongdong";  // 电脑上看日志：adb logcat -s Tongdong

    /** 识别方式：用什么算（cpu / gpu / nnapi）、每个识别器几个线程、同时开几个识别器 */
    static final class Config {
        final String accel;
        final int threads;
        final int workers;

        Config(String accel, int threads, int workers) {
            this.accel = "gpu".equals(accel) || "nnapi".equals(accel) ? accel : "cpu";
            this.threads = Math.max(1, Math.min(8, threads));
            this.workers = Math.max(1, Math.min(4, workers));
        }

        /** 还没在这台设备上调优时：核多就两路并行，留两个核给画面和摄像头 */
        static Config defaults() {
            int cores = Runtime.getRuntime().availableProcessors();
            if (cores >= 6) return new Config("cpu", Math.max(2, (cores - 2) / 2), 2);
            return new Config("cpu", Math.max(1, Math.min(4, cores)), 1);
        }

        static Config parse(String json, Config def) {
            try {
                if (json == null || json.trim().length() == 0) return def;
                JSONObject o = new JSONObject(json);
                if (!o.has("accel") && !o.has("threads") && !o.has("workers")) return def;
                return new Config(o.optString("accel", def.accel), o.optInt("threads", def.threads), o.optInt("workers", def.workers));
            } catch (Exception e) {
                return def;
            }
        }

        boolean same(Config o) {
            return o != null && accel.equals(o.accel) && threads == o.threads && workers == o.workers;
        }

        JSONObject json() {
            JSONObject o = new JSONObject();
            put(o, "accel", accel);
            put(o, "threads", threads);
            put(o, "workers", workers);
            return o;
        }

        @Override
        public String toString() {
            return accel + " " + workers + "x" + threads;
        }
    }

    /** 一个识别器：自己的线程、模型、输入缓冲 */
    private static final class Worker {
        final HandlerThread thread;
        final Handler handler;
        volatile Interpreter interpreter;
        Delegate delegate;
        ByteBuffer input;
        DataType inputType;
        String model = "";
        final float[][][][] output = new float[1][1][17][3];
        volatile boolean busy;

        Worker(int index) {
            // 显示级优先级：识别线程（和继承它优先级的线程池）别被后台任务挤掉
            thread = new HandlerThread("td-infer-" + index, Process.THREAD_PRIORITY_DISPLAY);
            thread.start();
            handler = new Handler(thread.getLooper());
        }
    }

    private final Context ctx;
    private final Listener listener;
    private final SharedPreferences prefs;
    private final Set<String> bad = new HashSet<>(); // 在这台设备上让应用崩溃过的加速方式，不再试

    private HandlerThread camThread;
    private volatile Handler camHandler;

    private volatile CameraDevice camera;
    private volatile CameraCaptureSession session;
    private CountDownLatch openLatch;   // 摄像头打开（或失败）后放行
    private CountDownLatch closeLatch;  // 摄像头完全关掉后放行
    private ImageReader reader;
    private Surface previewSurface;
    private SurfaceTexture previewTexture;
    private Image pending;              // 识别器都在忙时留着的最新一帧，谁先空下来谁接（只在摄像头线程里读写）

    private volatile List<Worker> workers = Collections.emptyList();
    private volatile Config config;
    private final byte[] rgb = new byte[IN * IN * 3]; // 最近一帧的取样结果（摄像头线程写，测速时拿来当输入）

    private volatile boolean running;
    private volatile boolean benching;  // 测速或换识别方式中：摄像头照常出帧，但不派给识别器
    private volatile int generation;    // 每次 start() 加 1，出错后的清理只清理那一次的
    // 跟踪裁剪区域（画面归一化坐标 {y0, x0, y1, x1}，可以超出 0–1，超出部分补黑）。
    // 同 MoveNet 官方做法：上一帧找到人后，这一帧只看人周围的正方形区域，小个子、远一点也认得准。
    private volatile float[] crop;

    private String cameraId;
    private Size analysisSize;
    private volatile Size previewSize;
    private int sensorOrientation;
    private boolean front;               // 前置摄像头：系统给预览画面做了左右翻转，识别用的画面没翻
    private boolean realtimeTimestamps;
    private String hwLevel = "";
    private volatile String fpsRange = "";
    private volatile String gpuCheck;    // null：还没查；""：可以用；其他：不能用的原因

    // 统计（statLock 保护）
    private final Object statLock = new Object();
    private final float[] inferMs = new float[90];
    private int inferCount;
    private final float[] sampleMs = new float[90];
    private int sampleCount;
    private final long[] camTimes = new long[61];
    private int camCount;
    private final long[] emitTimes = new long[61];
    private int emitCount;
    private long lastEmitTs = Long.MIN_VALUE;
    private volatile String lastError = "";

    PoseEngine(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        prefs = this.ctx.getSharedPreferences("pose", Context.MODE_PRIVATE);
        bad.addAll(prefs.getStringSet("bad", Collections.<String>emptySet()));
        // 上次试某种加速方式时应用崩了（没来得及清掉标记）：记下来，以后不再试
        String trying = prefs.getString("trying", null);
        if (trying != null) {
            bad.add(trying);
            prefs.edit().putStringSet("bad", new HashSet<>(bad)).remove("trying").commit();
            Log.w(TAG, trying + " 上次让应用崩溃，以后跳过");
        }
    }

    /** APK 里有模型、设备有摄像头才算可用 */
    static boolean available(Context ctx) {
        if (!assetExists(ctx, MODEL)) return false;
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            return cm != null && cm.getCameraIdList().length > 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean assetExists(Context ctx, String name) {
        try (InputStream in = ctx.getAssets().open(name)) {
            return in.read() >= 0;
        } catch (IOException e) {
            return false;
        }
    }

    boolean isRunning() {
        return running;
    }

    /** 识别画面的宽高（转正后） */
    Size getAnalysisSize() {
        return upright(analysisSize);
    }

    /** 预览画面的宽高（转正后，和预览层里看到的一致） */
    Size getPreviewSize() {
        return upright(previewSize);
    }

    int getSensorOrientation() {
        return sensorOrientation;
    }

    /** 预览层里的画面已经被系统左右翻转过（前置摄像头） */
    boolean isPreviewMirrored() {
        return front;
    }

    private Size upright(Size s) {
        if (s == null) return null;
        return sensorOrientation % 180 == 0 ? s : new Size(s.getHeight(), s.getWidth());
    }

    // ---------- 摄像头 ----------

    /** 选摄像头和分辨率（不打开摄像头）。返回 null 表示成功，否则是原因。 */
    String prepare() {
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            String[] ids = cm.getCameraIdList();
            if (ids.length == 0) return "没有找到摄像头";
            String chosen = ids[0];
            for (String id : ids) {
                Integer facing = cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                    chosen = id;
                    break;
                }
            }
            CameraCharacteristics ch = cm.getCameraCharacteristics(chosen);
            StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (map == null) return "摄像头没有可用的分辨率";
            Size[] yuv = map.getOutputSizes(ImageFormat.YUV_420_888);
            Size[] prev = map.getOutputSizes(SurfaceTexture.class);
            if (yuv == null || yuv.length == 0) return "摄像头不支持 YUV 取帧";
            Integer lv = ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
            hwLevel = levelName(lv == null ? -1 : lv);
            Rect active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
            analysisSize = pickAnalysis(yuv, active);
            // USB 摄像头（EXTERNAL）的画面是 CPU 解码、缩放出来的：预览和识别用同一个大小，少占 CPU
            previewSize = "EXTERNAL".equals(hwLevel) ? analysisSize
                    : largestSameAspect(prev != null && prev.length > 0 ? prev : yuv, analysisSize, 1920, 1080);
            Integer so = ch.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 0 : ((so % 360) + 360) % 360 / 90 * 90;
            Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
            front = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
            Integer ts = ch.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
            realtimeTimestamps = ts != null && ts == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
            cameraId = chosen;
            Log.i(TAG, "摄像头 " + chosen + "（共 " + ids.length + " 个）" + (front ? " 前置" : " 后置")
                    + " 等级 " + hwLevel + " 传感器 " + sensorOrientation + "° " + (active == null ? "" : active.width() + "x" + active.height())
                    + " 识别 " + analysisSize + " 预览 " + previewSize + " 可用 YUV " + Arrays.toString(yuv));
            return null;
        } catch (Exception e) {
            return "摄像头信息读取失败：" + e.getMessage();
        }
    }

    /**
     * 打开摄像头开始识别。previewTexture 可以为 null（只识别不显示）。需要已经有摄像头权限。
     * options 是识别方式（见 Config），空的就用上次的或默认的。已经在跑时只换识别方式。
     */
    @SuppressLint("MissingPermission")
    synchronized String start(SurfaceTexture previewTexture, String options) {
        Config want = Config.parse(options, config != null ? config : Config.defaults());
        if (running) return want.same(config) ? null : reconfigure(want);
        String why = cameraId == null ? prepare() : null;
        if (why != null) return why;
        String err = applyConfig(want);
        if (err != null && !Config.defaults().same(want)) {
            // 选的方式这次建不起来（比如 GPU 出错）：先用默认方式，别让孩子玩不了
            Log.w(TAG, want + " 不可用：" + err + "，改用默认方式");
            err = applyConfig(Config.defaults());
        }
        if (err != null) return "识别模型加载失败：" + err;

        camThread = new HandlerThread("td-camera");
        camThread.start();
        camHandler = new Handler(camThread.getLooper());
        // 最多同时拿着 4 帧：1 帧在等识别器（pending），其余给摄像头轮转
        reader = ImageReader.newInstance(analysisSize.getWidth(), analysisSize.getHeight(), ImageFormat.YUV_420_888, 4);
        reader.setOnImageAvailableListener(this::onImage, camHandler);
        this.previewTexture = previewTexture;
        if (previewTexture != null) {
            previewTexture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            previewSurface = new Surface(previewTexture);
        } else {
            previewSurface = null;
        }
        generation++;
        running = true;
        benching = false;
        crop = null;
        synchronized (statLock) {
            lastEmitTs = Long.MIN_VALUE;
            inferCount = 0;
            sampleCount = 0;
            camCount = 0;
            emitCount = 0;
        }
        final CountDownLatch opened = new CountDownLatch(1);
        final CountDownLatch closed = new CountDownLatch(1);
        openLatch = opened;
        closeLatch = closed;
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            cm.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice device) {
                    // 先记下来再放行：stop() 等到这里之后会负责关掉
                    camera = device;
                    opened.countDown();
                    if (running) createSession();
                }

                @Override
                public void onDisconnected(CameraDevice device) {
                    opened.countDown();
                    device.close();
                    if (running) fail("摄像头被断开（可能被别的应用占用）");
                }

                @Override
                public void onError(CameraDevice device, int error) {
                    opened.countDown();
                    device.close();
                    if (running) fail("摄像头打开失败（错误 " + error + "）");
                }

                @Override
                public void onClosed(CameraDevice device) {
                    closed.countDown();
                }
            }, camHandler);
        } catch (Exception e) {
            // 没打开成功，不用等摄像头的回调
            opened.countDown();
            closed.countDown();
            running = false;
            releaseCamera();
            return "摄像头打开失败：" + e.getMessage();
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private void createSession() {
        try {
            List<Surface> targets = new ArrayList<>();
            targets.add(reader.getSurface());
            if (previewSurface != null) targets.add(previewSurface);
            //noinspection deprecation
            camera.createCaptureSession(targets, new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession s) {
                    if (!running || camera == null) {
                        s.close();
                        return;
                    }
                    session = s;
                    try {
                        CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        for (Surface t : targets) b.addTarget(t);
                        b.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                        Range<Integer> fps = bestFpsRange();
                        if (fps != null) b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fps);
                        fpsRange = fps == null ? "" : fps.toString();
                        s.setRepeatingRequest(b.build(), null, camHandler);
                        Log.i(TAG, "开始取帧 帧率范围 " + fpsRange + " 预览 " + previewSize);
                    } catch (CameraAccessException | IllegalStateException e) {
                        fail("摄像头取帧失败：" + e.getMessage());
                    }
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession s) {
                    if (!running) return;
                    // 有的摄像头（比如 USB 摄像头）同时出两种分辨率不行：预览改成和识别一样大再试一次
                    if (previewSurface != null && previewTexture != null && !previewSize.equals(analysisSize)) {
                        Log.w(TAG, "两种分辨率配置失败，预览改成 " + analysisSize + " 再试");
                        previewSize = analysisSize;
                        previewTexture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
                        createSession();
                        return;
                    }
                    fail("摄像头配置失败");
                }
            }, camHandler);
        } catch (CameraAccessException | IllegalStateException | IllegalArgumentException e) {
            fail("摄像头配置失败：" + e.getMessage());
        }
    }

    private Range<Integer> bestFpsRange() {
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            Range<Integer>[] ranges = cm.getCameraCharacteristics(cameraId).get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
            if (ranges == null) return null;
            Range<Integer> best = null;
            for (Range<Integer> r : ranges) {
                // 优先上限 30、下限尽量高（光线暗时也别掉到很低的帧率）
                if (r.getUpper() > 30) continue;
                if (best == null || r.getUpper() > best.getUpper()
                        || (r.getUpper().equals(best.getUpper()) && r.getLower() > best.getLower())) best = r;
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- 流水线：摄像头线程取样，识别器线程识别 ----------

    private void onImage(ImageReader r) {
        Image img;
        try {
            img = r.acquireLatestImage();
        } catch (Throwable t) {
            return;
        }
        if (img == null) return;
        synchronized (statLock) {
            camTimes[camCount % camTimes.length] = SystemClock.elapsedRealtime();
            camCount++;
        }
        if (!running || benching) {
            img.close();
            return;
        }
        Worker w = freeWorker();
        if (w == null) {
            // 识别器都在忙：留着最新的一帧，谁先空下来谁接（不用再等下一帧）
            if (pending != null) pending.close();
            pending = img;
            return;
        }
        dispatch(w, img);
    }

    private Worker freeWorker() {
        for (Worker w : workers) {
            if (!w.busy && w.interpreter != null) return w;
        }
        return null;
    }

    /** 在摄像头线程里取样，交给识别器（img 用完就关） */
    private void dispatch(final Worker w, Image img) {
        try {
            final boolean swap = sensorOrientation % 180 != 0;
            final int fw = swap ? img.getHeight() : img.getWidth();
            final int fh = swap ? img.getWidth() : img.getHeight();
            float[] c = crop;
            if (c == null) c = initCrop(fw, fh);
            final float[] used = c;
            final long ts = img.getTimestamp();
            final long acquired = SystemClock.elapsedRealtimeNanos();
            long s0 = System.nanoTime();
            Image.Plane[] p = img.getPlanes();
            sampleYuv(p[0].getBuffer(), p[1].getBuffer(), p[2].getBuffer(),
                    p[0].getRowStride(), p[0].getPixelStride(), p[1].getRowStride(), p[1].getPixelStride(),
                    img.getWidth(), img.getHeight(), sensorOrientation, used, rgb);
            pack(rgb, w.input, w.inputType);
            float ms = (System.nanoTime() - s0) / 1e6f;
            synchronized (statLock) {
                sampleMs[sampleCount % sampleMs.length] = ms;
                sampleCount++;
            }
            w.busy = true;
            if (!w.handler.post(() -> infer(w, fw, fh, used, ts, acquired))) w.busy = false;
        } catch (Throwable t) {
            w.busy = false;
            lastError = String.valueOf(t.getMessage());
        } finally {
            img.close();
        }
    }

    /** 识别器空下来后：有留着的帧就马上接着算（在摄像头线程里） */
    private void drainPending() {
        Image img = pending;
        if (img == null) return;
        if (!running || benching) {
            pending = null;
            img.close();
            return;
        }
        Worker w = freeWorker();
        if (w == null) return;
        pending = null;
        dispatch(w, img);
    }

    private void infer(Worker w, int fw, int fh, float[] c, long ts, long acquired) {
        try {
            Interpreter it = w.interpreter;
            if (!running || benching || it == null) return;
            long t0 = SystemClock.elapsedRealtimeNanos();
            w.input.rewind();
            it.run(w.input, w.output);
            long t1 = SystemClock.elapsedRealtimeNanos();
            float ms = (t1 - t0) / 1e6f;
            // 画面拍下到现在过了多久（网页据此做延迟补偿）
            long base = realtimeTimestamps ? ts : acquired;
            float age = Math.max(0, (t1 - base) / 1e6f);
            // 裁剪区域内的坐标 → 画面归一化坐标
            float[] k = new float[17 * 3];
            for (int i = 0; i < 17; i++) {
                k[i * 3] = c[1] + w.output[0][0][i][1] * (c[3] - c[1]);
                k[i * 3 + 1] = c[0] + w.output[0][0][i][0] * (c[2] - c[0]);
                k[i * 3 + 2] = w.output[0][0][i][2];
            }
            boolean newest;
            synchronized (statLock) {
                inferMs[inferCount % inferMs.length] = ms;
                inferCount++;
                // 几个识别器同时算，后拍的帧可能先算完：只发比已发出的更新的
                newest = ts > lastEmitTs;
                if (newest) {
                    lastEmitTs = ts;
                    crop = nextCrop(k, fw, fh);
                    emitTimes[emitCount % emitTimes.length] = SystemClock.elapsedRealtime();
                    emitCount++;
                }
            }
            if (!newest) return;
            StringBuilder sb = new StringBuilder(640);
            sb.append("{\"k\":[");
            for (int i = 0; i < 17; i++) {
                if (i > 0) sb.append(',');
                sb.append(String.format(Locale.ROOT, "%.4f,%.4f,%.3f", k[i * 3], k[i * 3 + 1], k[i * 3 + 2]));
            }
            sb.append("],\"w\":").append(fw).append(",\"h\":").append(fh)
                    .append(",\"age\":").append(Math.round(age))
                    .append(",\"ms\":").append(String.format(Locale.ROOT, "%.1f", ms)).append('}');
            listener.onPose(sb.toString());
        } catch (Throwable t) {
            lastError = String.valueOf(t.getMessage());
            listener.onError("识别出错：" + t.getMessage());
        } finally {
            w.busy = false;
            Handler h = camHandler;
            if (h != null) h.post(this::drainPending);
        }
    }

    /** 整幅画面放进正方形（长边铺满，短边两侧留黑），等同于没有跟踪时的裁剪区域 */
    static float[] initCrop(int fw, int fh) {
        if (fw > fh) {
            float y0 = (fh / 2f - fw / 2f) / fh;
            return new float[]{y0, 0f, y0 + (float) fw / fh, 1f};
        }
        float x0 = (fw / 2f - fh / 2f) / fw;
        return new float[]{0f, x0, 1f, x0 + (float) fh / fw};
    }

    /** 由这一帧的关键点算下一帧的裁剪区域（MoveNet 官方教程的 determine_crop_region） */
    static float[] nextCrop(float[] k, int fw, int fh) {
        final float th = 0.2f;
        // 5/6 = 左右肩，11/12 = 左右髋
        boolean torso = (k[11 * 3 + 2] > th || k[12 * 3 + 2] > th) && (k[5 * 3 + 2] > th || k[6 * 3 + 2] > th);
        if (!torso) return initCrop(fw, fh);
        float cx = (k[11 * 3] + k[12 * 3]) / 2f * fw, cy = (k[11 * 3 + 1] + k[12 * 3 + 1]) / 2f * fh;
        float ty = 0, tx = 0, by = 0, bx = 0;
        int[] torsoJoints = {5, 6, 11, 12};
        for (int j : torsoJoints) {
            ty = Math.max(ty, Math.abs(cy - k[j * 3 + 1] * fh));
            tx = Math.max(tx, Math.abs(cx - k[j * 3] * fw));
        }
        for (int j = 0; j < 17; j++) {
            if (k[j * 3 + 2] < th) continue;
            by = Math.max(by, Math.abs(cy - k[j * 3 + 1] * fh));
            bx = Math.max(bx, Math.abs(cx - k[j * 3] * fw));
        }
        float half = Math.max(Math.max(tx * 1.9f, ty * 1.9f), Math.max(by * 1.2f, bx * 1.2f));
        half = Math.min(half, Math.max(Math.max(cx, fw - cx), Math.max(cy, fh - cy)));
        if (half > Math.max(fw, fh) / 2f || half < 8) return initCrop(fw, fh);
        float len = half * 2;
        return new float[]{(cy - half) / fh, (cx - half) / fw, (cy - half + len) / fh, (cx - half + len) / fw};
    }

    /**
     * 把裁剪区域里的 YUV 画面取样成 192×192 RGB（区域超出画面的部分补黑）。纯计算，方便在电脑上测试。
     * sw×sh 是传感器原始画面；rot 是画面要顺时针转多少度才正（0/90/180/270）；
     * c 是转正后画面里的裁剪区域；out 长度 192×192×3。
     */
    static void sampleYuv(ByteBuffer yb, ByteBuffer ub, ByteBuffer vb, int yRow, int yPix, int uvRow, int uvPix,
                          int sw, int sh, int rot, float[] c, byte[] out) {
        boolean swap = rot % 180 != 0;
        int fw = swap ? sh : sw, fh = swap ? sw : sh; // 转正后的宽高
        float sy = (c[2] - c[0]) / IN, sx = (c[3] - c[1]) / IN;
        int[] xs = new int[IN];
        for (int ox = 0; ox < IN; ox++) xs[ox] = (int) Math.floor((c[1] + (ox + 0.5f) * sx) * fw);
        int o = 0;
        for (int oy = 0; oy < IN; oy++) {
            int fy = (int) Math.floor((c[0] + (oy + 0.5f) * sy) * fh);
            boolean rowIn = fy >= 0 && fy < fh;
            for (int ox = 0; ox < IN; ox++) {
                int r = 0, g = 0, b = 0;
                int fx = xs[ox];
                if (rowIn && fx >= 0 && fx < fw) {
                    // 转正后的 (fx, fy) → 传感器画面里的 (px, py)
                    int px, py;
                    if (rot == 90) {
                        px = fy;
                        py = sh - 1 - fx;
                    } else if (rot == 180) {
                        px = sw - 1 - fx;
                        py = sh - 1 - fy;
                    } else if (rot == 270) {
                        px = sw - 1 - fy;
                        py = fx;
                    } else {
                        px = fx;
                        py = fy;
                    }
                    int y = (yb.get(py * yRow + px * yPix) & 0xff);
                    int uvi = (py >> 1) * uvRow + (px >> 1) * uvPix;
                    int u = (ub.get(uvi) & 0xff) - 128;
                    int v = (vb.get(uvi) & 0xff) - 128;
                    r = clamp(y + ((1436 * v) >> 10));
                    g = clamp(y - ((352 * u + 731 * v) >> 10));
                    b = clamp(y + ((1815 * u) >> 10));
                }
                out[o++] = (byte) r;
                out[o++] = (byte) g;
                out[o++] = (byte) b;
            }
        }
    }

    /** RGB 字节按模型要的输入类型放进输入缓冲 */
    static void pack(byte[] rgb, ByteBuffer input, DataType type) {
        input.rewind();
        if (type == DataType.UINT8) {
            input.put(rgb);
        } else if (type == DataType.INT8) {
            for (byte v : rgb) input.put((byte) ((v & 0xff) - 128));
        } else if (type == DataType.INT32) {
            for (byte v : rgb) input.putInt(v & 0xff);
        } else {
            for (byte v : rgb) input.putFloat(v & 0xff);
        }
        input.rewind();
    }

    private static int clamp(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    // ---------- 识别器：建、换、关 ----------

    /** 按 cfg 建好识别器再换上（建失败时原来的照常用）；调用时不能有帧在派给识别器 */
    private String applyConfig(Config cfg) {
        if (cfg.same(config) && !workers.isEmpty()) return null;
        if (bad.contains(cfg.accel)) return "上次在这台电视上让应用崩溃过，已跳过";
        if ("gpu".equals(cfg.accel)) {
            String why = gpuUnsupported();
            if (why != null) return why;
        }
        List<Worker> made = new ArrayList<>();
        for (int i = 0; i < cfg.workers; i++) {
            Worker w = new Worker(i);
            made.add(w);
            String err = build(w, cfg);
            if (err != null) {
                for (Worker x : made) closeWorker(x);
                return err;
            }
        }
        List<Worker> old = workers;
        workers = Collections.unmodifiableList(made);
        config = cfg;
        for (Worker x : old) closeWorker(x);
        Log.i(TAG, "识别方式 " + cfg + "，模型 " + made.get(0).model + "，输入 " + made.get(0).inputType);
        return null;
    }

    /** 运行中换识别方式：先停下派活，等识别器都空下来，换好再接着派 */
    private String reconfigure(Config want) {
        benching = true;
        try {
            waitIdle(3000);
            String err = applyConfig(want);
            if (err != null) Log.w(TAG, "换成 " + want + " 失败：" + err);
            return err;
        } finally {
            benching = false;
        }
    }

    /** 网页指定识别方式（设备测试调优后）；没在识别时先建好，下次开始时直接用 */
    synchronized String configure(String json) {
        Config want = Config.parse(json, config != null ? config : Config.defaults());
        if (!running) return applyConfig(want);
        return want.same(config) ? null : reconfigure(want);
    }

    /** 在识别器自己的线程里建模型（GPU 要求建和用在同一个线程；线程池也继承这个线程的优先级） */
    private String build(final Worker w, final Config cfg) {
        final String[] err = {null};
        final CountDownLatch done = new CountDownLatch(1);
        boolean posted = w.handler.post(() -> {
            try {
                buildOnThread(w, cfg);
            } catch (Throwable t) {
                err[0] = t.getClass().getSimpleName() + "：" + t.getMessage();
            } finally {
                done.countDown();
            }
        });
        if (!posted) return "识别线程没启动";
        if (!await(done, 30000)) return "建识别器超时";
        return err[0];
    }

    private void buildOnThread(Worker w, Config cfg) throws IOException {
        String model = "gpu".equals(cfg.accel) && assetExists(ctx, MODEL_F16) ? MODEL_F16 : MODEL;
        ByteBuffer buf = loadModel(model);
        Interpreter.Options opt = new Interpreter.Options();
        opt.setNumThreads(cfg.threads);
        boolean risky = !"cpu".equals(cfg.accel);
        // GPU / NNAPI 的驱动可能直接让应用崩掉：先记下「正在试」，跑通了再清掉
        if (risky) prefs.edit().putString("trying", cfg.accel).commit();
        Delegate d = null;
        try {
            if ("gpu".equals(cfg.accel)) {
                GpuDelegate.Options go = new GpuDelegate.Options();
                go.setPrecisionLossAllowed(true);
                go.setInferencePreference(GpuDelegate.Options.INFERENCE_PREFERENCE_SUSTAINED_SPEED);
                d = new GpuDelegate(go);
                opt.addDelegate(d);
            } else if ("nnapi".equals(cfg.accel)) {
                NnApiDelegate.Options no = new NnApiDelegate.Options();
                no.setAllowFp16(true);
                no.setUseNnapiCpu(false); // 不要 NNAPI 自带的参考 CPU 实现（很慢）
                no.setExecutionPreference(NnApiDelegate.Options.EXECUTION_PREFERENCE_SUSTAINED_SPEED);
                d = new NnApiDelegate(no);
                opt.addDelegate(d);
            } else {
                opt.setUseXNNPACK(true);
            }
            Interpreter it = new Interpreter(buf, opt);
            DataType type = it.getInputTensor(0).dataType();
            int bytesPer = (type == DataType.UINT8 || type == DataType.INT8) ? 1 : 4;
            ByteBuffer in = ByteBuffer.allocateDirect(IN * IN * 3 * bytesPer).order(ByteOrder.nativeOrder());
            // 先空跑一次：第一次运行最容易出问题，跑通了才算可用
            it.run(in, w.output);
            w.delegate = d;
            w.inputType = type;
            w.input = in;
            w.model = model;
            w.interpreter = it;
        } catch (Throwable t) {
            closeQuietly(d);
            throw t;
        } finally {
            if (risky) prefs.edit().remove("trying").commit();
        }
    }

    private String gpuUnsupported() {
        if (gpuCheck == null) {
            prefs.edit().putString("trying", "gpu").commit();
            CompatibilityList cl = null;
            try {
                cl = new CompatibilityList();
                gpuCheck = cl.isDelegateSupportedOnThisDevice() ? "" : "GPU 不在 TensorFlow Lite 的兼容列表里";
            } catch (Throwable t) {
                gpuCheck = "GPU 检查出错：" + t.getMessage();
            } finally {
                if (cl != null) {
                    try {
                        cl.close();
                    } catch (Throwable ignored) {
                        // 忽略
                    }
                }
                prefs.edit().remove("trying").commit();
            }
        }
        return gpuCheck.length() == 0 ? null : gpuCheck;
    }

    /** 在识别器线程里关模型（GPU 要求同一个线程），再停线程 */
    private void closeWorker(final Worker w) {
        final CountDownLatch done = new CountDownLatch(1);
        boolean posted = w.handler.post(() -> {
            Interpreter it = w.interpreter;
            w.interpreter = null;
            try {
                if (it != null) it.close();
            } catch (Throwable ignored) {
                // 忽略
            }
            closeQuietly(w.delegate);
            w.delegate = null;
            done.countDown();
        });
        if (posted) await(done, 3000);
        quitAndJoin(w.thread);
    }

    private static void closeQuietly(Object o) {
        if (o instanceof AutoCloseable) {
            try {
                ((AutoCloseable) o).close();
            } catch (Throwable ignored) {
                // 忽略
            }
        }
    }

    private void waitIdle(long ms) {
        long end = SystemClock.elapsedRealtime() + ms;
        while (SystemClock.elapsedRealtime() < end) {
            boolean idle = true;
            for (Worker w : workers) {
                if (w.busy) idle = false;
            }
            if (idle) return;
            SystemClock.sleep(5);
        }
    }

    private ByteBuffer loadModel(String name) throws IOException {
        byte[] bytes;
        try (InputStream in = ctx.getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream(6 << 20)) {
            byte[] b = new byte[1 << 16];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            bytes = out.toByteArray();
        }
        ByteBuffer model = ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
        model.put(bytes);
        model.rewind();
        return model;
    }

    // ---------- 测速：不等摄像头，用最近一帧反复识别，量这种方式最快能算多快 ----------

    /** 异步测速，结果从 listener.onBench 回来。json：{accel, threads, workers, ms} */
    void bench(final String json) {
        new Thread(() -> listener.onBench(runBench(json)), "td-bench").start();
    }

    private String runBench(String json) {
        JSONObject out = new JSONObject();
        synchronized (this) {
            Config cfg = Config.parse(json, config != null ? config : Config.defaults());
            int ms = 2500;
            try {
                ms = Math.max(300, Math.min(15000, new JSONObject(json).optInt("ms", 2500)));
            } catch (Exception ignored) {
                // 用默认时长
            }
            put(out, "accel", cfg.accel);
            put(out, "threads", cfg.threads);
            put(out, "workers", cfg.workers);
            // 摄像头照常出帧（真实负载），但不派给识别器
            benching = true;
            try {
                waitIdle(3000);
                String err = applyConfig(cfg);
                if (err != null) {
                    put(out, "ok", false);
                    put(out, "error", err);
                    return out.toString();
                }
                List<Worker> ws = workers;
                byte[] img = rgb.clone();
                for (Worker w : ws) pack(img, w.input, w.inputType);
                put(out, "model", ws.get(0).model.replace("models/", ""));
                put(out, "input", String.valueOf(ws.get(0).inputType));
                float[][] lat = new float[ws.size()][];
                int[] counts = new int[ws.size()];
                long[] span = new long[2];
                String loopErr = runLoops(ws, ms, lat, counts, span);
                if (loopErr != null) {
                    put(out, "ok", false);
                    put(out, "error", loopErr);
                    return out.toString();
                }
                long wallMs = Math.max(1, span[0]);
                int total = 0, n = 0;
                for (int c : counts) total += c;
                for (float[] l : lat) n += l.length;
                float[] all = new float[n];
                int o = 0;
                for (float[] l : lat) {
                    System.arraycopy(l, 0, all, o, l.length);
                    o += l.length;
                }
                Arrays.sort(all);
                put(out, "ok", true);
                put(out, "fps", total * 1000.0 / wallMs);
                put(out, "p50", n > 0 ? all[n / 2] : 0);
                put(out, "p95", n > 0 ? all[Math.min(n - 1, (int) (n * 0.95f))] : 0);
                put(out, "cpu", span[1] / (double) wallMs); // 这段时间本进程平均用了几个核
                put(out, "runs", total);
            } catch (Throwable t) {
                put(out, "ok", false);
                put(out, "error", t.getClass().getSimpleName() + "：" + t.getMessage());
            } finally {
                benching = false;
            }
        }
        return out.toString();
    }

    /**
     * 每个识别器在自己的线程里反复识别：先各跑 2 次预热，再一起跑 ms 毫秒。
     * span[0] = 计时的墙钟毫秒，span[1] = 这段时间本进程用掉的 CPU 毫秒。返回出错信息，没错返回 null。
     */
    private String runLoops(List<Worker> ws, int ms, final float[][] lat, final int[] counts, long[] span) {
        final String[] err = {null};
        final CountDownLatch warm = new CountDownLatch(ws.size());
        final CountDownLatch go = new CountDownLatch(1);
        final CountDownLatch done = new CountDownLatch(ws.size());
        final long[] deadline = {0};
        for (int i = 0; i < ws.size(); i++) {
            final int idx = i;
            final Worker w = ws.get(i);
            w.busy = true;
            boolean posted = w.handler.post(() -> {
                float[] l = new float[4096];
                int n = 0;
                boolean warmed = false;
                try {
                    Interpreter it = w.interpreter;
                    for (int k = 0; k < 2; k++) {
                        w.input.rewind();
                        it.run(w.input, w.output);
                    }
                    warmed = true;
                    warm.countDown();
                    if (go.await(60, TimeUnit.SECONDS)) {
                        while (SystemClock.elapsedRealtimeNanos() < deadline[0]) {
                            long a = SystemClock.elapsedRealtimeNanos();
                            w.input.rewind();
                            it.run(w.input, w.output);
                            if (n < l.length) l[n] = (SystemClock.elapsedRealtimeNanos() - a) / 1e6f;
                            n++;
                        }
                    }
                } catch (Throwable t) {
                    err[0] = t.getClass().getSimpleName() + "：" + t.getMessage();
                    if (!warmed) warm.countDown();
                } finally {
                    lat[idx] = Arrays.copyOf(l, Math.min(n, l.length));
                    counts[idx] = n;
                    w.busy = false;
                    done.countDown();
                }
            });
            if (!posted) {
                w.busy = false;
                warm.countDown();
                done.countDown();
                lat[idx] = new float[0];
                err[0] = "识别线程没启动";
            }
        }
        if (!await(warm, 30000)) err[0] = "预热超时";
        long cpu0 = Process.getElapsedCpuTime(), wall0 = SystemClock.elapsedRealtime();
        deadline[0] = SystemClock.elapsedRealtimeNanos() + ms * 1000000L;
        go.countDown();
        if (!await(done, ms + 30000)) return "测速超时";
        span[0] = SystemClock.elapsedRealtime() - wall0;
        span[1] = Process.getElapsedCpuTime() - cpu0;
        return err[0];
    }

    // ---------- 停止、出错 ----------

    /** 摄像头回调里出错：通知网页，再换个线程清理（清理要等摄像头线程里的回调，不能在摄像头线程里等） */
    private void fail(String msg) {
        lastError = msg;
        running = false;
        Log.w(TAG, msg);
        listener.onError(msg);
        final int g = generation;
        new Thread(() -> {
            synchronized (PoseEngine.this) {
                if (generation == g && !running) releaseCamera();
            }
        }, "td-camera-fail").start();
    }

    /** 关摄像头（识别器留着，下次开始不用重新加载模型） */
    synchronized void stop() {
        running = false;
        releaseCamera();
    }

    private void releaseCamera() {
        // 在摄像头线程里（出错回调）不能等，否则自己等自己
        boolean onCamThread = camThread != null && Thread.currentThread() == camThread;
        // 摄像头还在打开中：等它打开（或失败），再关掉，不然会一直占着
        if (!onCamThread) await(openLatch, 2000);
        CameraCaptureSession s = session;
        session = null;
        try {
            if (s != null) s.close();
        } catch (Exception ignored) {
            // 忽略
        }
        CameraDevice c = camera;
        camera = null;
        if (c != null) {
            try {
                c.close();
            } catch (Exception ignored) {
                // 忽略
            }
            // 等摄像头真正关掉，网页摄像头紧接着打开时才不会撞上
            if (!onCamThread) await(closeLatch, 1500);
        }
        openLatch = null;
        closeLatch = null;
        quitAndJoin(camThread);
        camThread = null;
        camHandler = null;
        if (!onCamThread && pending != null) {
            try {
                pending.close();
            } catch (Throwable ignored) {
                // 忽略
            }
            pending = null;
        }
        if (reader != null) {
            reader.close();
            reader = null;
        }
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
    }

    private static boolean await(CountDownLatch l, long ms) {
        if (l == null) return true;
        try {
            return l.await(ms, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static void quitAndJoin(HandlerThread t) {
        if (t == null) return;
        t.quitSafely();
        if (Thread.currentThread() == t) return;
        try {
            t.join(800);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    /** 应用退出：关摄像头，释放全部识别器 */
    synchronized void close() {
        stop();
        List<Worker> old = workers;
        workers = Collections.emptyList();
        config = null;
        for (Worker w : old) closeWorker(w);
    }

    // ---------- 给网页看的信息 ----------

    /** 给网页的「设备测试」看 */
    String infoJson() {
        JSONObject o = new JSONObject();
        put(o, "camera", cameraId == null ? "" : cameraId);
        put(o, "facing", front ? "front" : "back");
        Size a = getAnalysisSize(), p = getPreviewSize();
        if (a != null) {
            put(o, "w", a.getWidth());
            put(o, "h", a.getHeight());
        }
        if (p != null) {
            put(o, "pw", p.getWidth());
            put(o, "ph", p.getHeight());
        }
        put(o, "rotation", sensorOrientation);
        put(o, "level", hwLevel);
        put(o, "fpsRange", fpsRange);
        Config c = config;
        if (c != null) {
            put(o, "config", c.json());
            put(o, "threads", c.threads * c.workers);
        }
        List<Worker> ws = workers;
        if (!ws.isEmpty()) {
            put(o, "input", String.valueOf(ws.get(0).inputType));
            put(o, "model", ws.get(0).model.replace("models/", ""));
        }
        put(o, "f16", assetExists(ctx, MODEL_F16));
        put(o, "bad", new JSONArray(bad));
        put(o, "running", running);
        synchronized (statLock) {
            int n = Math.min(inferCount, inferMs.length);
            if (n > 0) {
                float[] copy = Arrays.copyOf(inferMs, n);
                Arrays.sort(copy);
                put(o, "p50", copy[n / 2]);
                put(o, "p95", copy[Math.min(n - 1, (int) (n * 0.95f))]);
            }
            int m = Math.min(sampleCount, sampleMs.length);
            if (m > 0) {
                float[] copy = Arrays.copyOf(sampleMs, m);
                Arrays.sort(copy);
                put(o, "sampleMs", copy[m / 2]);
            }
            put(o, "camFps", rate(camTimes, camCount)); // 摄像头实际出帧
            put(o, "fps", rate(emitTimes, emitCount));  // 识别出结果
        }
        // 本进程到现在用掉的 CPU 毫秒和墙钟毫秒：网页取两次相减，就知道这段时间平均用了几个核
        put(o, "cpuMs", Process.getElapsedCpuTime());
        put(o, "wallMs", SystemClock.elapsedRealtime());
        put(o, "error", lastError);
        return o.toString();
    }

    private static float rate(long[] ring, int count) {
        int n = Math.min(count, ring.length);
        if (n < 2) return 0;
        long newest = ring[(count - 1) % ring.length];
        long oldest = ring[(count - n) % ring.length];
        if (newest <= oldest || SystemClock.elapsedRealtime() - newest > 2000) return 0;
        return (n - 1) * 1000f / (newest - oldest);
    }

    private static void put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v);
        } catch (Exception ignored) {
            // 忽略
        }
    }

    /** CPU 每个核的型号和最高频率（读不到的就空着） */
    static JSONArray cpuJson() {
        JSONArray arr = new JSONArray();
        int n = Runtime.getRuntime().availableProcessors();
        String[] parts = new String[Math.max(n, 16)];
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/cpuinfo"))) {
            String line;
            int cur = -1;
            while ((line = r.readLine()) != null) {
                int i = line.indexOf(':');
                if (i < 0) continue;
                String k = line.substring(0, i).trim(), v = line.substring(i + 1).trim();
                if (k.equals("processor")) {
                    try {
                        cur = Integer.parseInt(v);
                    } catch (NumberFormatException e) {
                        cur = -1;
                    }
                } else if (k.equals("CPU part") && cur >= 0 && cur < parts.length) {
                    parts[cur] = partName(v);
                }
            }
        } catch (Exception ignored) {
            // 读不到就不写型号
        }
        for (int i = 0; i < n; i++) {
            JSONObject o = new JSONObject();
            put(o, "i", i);
            String f = readLine("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq");
            if (f != null) {
                try {
                    put(o, "mhz", Long.parseLong(f.trim()) / 1000);
                } catch (NumberFormatException ignored) {
                    // 忽略
                }
            }
            if (parts[i] != null) put(o, "part", parts[i]);
            arr.put(o);
        }
        return arr;
    }

    private static String readLine(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            return r.readLine();
        } catch (Exception e) {
            return null;
        }
    }

    private static String partName(String hex) {
        switch (hex.toLowerCase(Locale.ROOT)) {
            case "0xd03": return "A53";
            case "0xd04": return "A35";
            case "0xd05": return "A55";
            case "0xd07": return "A57";
            case "0xd08": return "A72";
            case "0xd09": return "A73";
            case "0xd0a": return "A75";
            case "0xd0b": return "A76";
            case "0xd0d": return "A77";
            case "0xd41": return "A78";
            case "0xd44": return "X1";
            case "0xd46": return "A510";
            case "0xd47": return "A710";
            case "0xd48": return "X2";
            case "0xd4d": return "A715";
            case "0xd4e": return "X3";
            default: return hex;
        }
    }

    private static String levelName(int lv) {
        switch (lv) {
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY: return "LEGACY";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED: return "LIMITED";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL: return "FULL";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3: return "LEVEL_3";
            case CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL: return "EXTERNAL";
            default: return String.valueOf(lv);
        }
    }

    /**
     * 识别用的分辨率：和传感器本身同样的宽高比（不裁视野，孩子跑到边上也看得见），高度接近 480。
     * 识别只取人周围 192×192 的区域，分辨率再高也没用，反而让摄像头多干活。
     */
    static Size pickAnalysis(Size[] sizes, Rect active) {
        if (active != null && active.width() > 0 && active.height() > 0) {
            float aspect = (float) active.width() / active.height();
            Size best = null;
            for (Size s : sizes) {
                float a = (float) s.getWidth() / s.getHeight();
                if (Math.abs(a - aspect) / aspect > 0.03f) continue;
                if (s.getHeight() < 360 || s.getWidth() > 1280) continue;
                int d = Math.abs(s.getHeight() - 480);
                int bd = best == null ? Integer.MAX_VALUE : Math.abs(best.getHeight() - 480);
                if (d < bd || (d == bd && s.getHeight() < best.getHeight())) best = s;
            }
            if (best != null) return best;
        }
        return closest(sizes, 640, 480);
    }

    private static Size closest(Size[] sizes, int w, int h) {
        Size best = sizes[0];
        long bestScore = Long.MAX_VALUE;
        for (Size s : sizes) {
            long score = Math.abs((long) s.getWidth() * s.getHeight() - (long) w * h)
                    + Math.abs(s.getWidth() * h - s.getHeight() * w) * 4L;
            if (score < bestScore) {
                bestScore = score;
                best = s;
            }
        }
        return best;
    }

    /** 预览用和识别同样宽高比、不超过 maxW×maxH 的最大分辨率（宽高比不同会导致两路画面视野不一致、骨架对不上） */
    private static Size largestSameAspect(Size[] sizes, Size ref, int maxW, int maxH) {
        Size best = ref;
        for (Size s : sizes) {
            if ((long) s.getWidth() * ref.getHeight() != (long) s.getHeight() * ref.getWidth()) continue;
            if (s.getWidth() > maxW || s.getHeight() > maxH) continue;
            if ((long) s.getWidth() * s.getHeight() > (long) best.getWidth() * best.getHeight()) best = s;
        }
        return best;
    }

    static String sizesJson(Context ctx) {
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            JSONArray arr = new JSONArray();
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics ch = cm.getCameraCharacteristics(id);
                StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                JSONObject o = new JSONObject();
                put(o, "id", id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                put(o, "facing", facing == null ? -1 : facing);
                JSONArray yuv = new JSONArray();
                if (map != null && map.getOutputSizes(ImageFormat.YUV_420_888) != null) {
                    for (Size s : map.getOutputSizes(ImageFormat.YUV_420_888)) yuv.put(s.getWidth() + "x" + s.getHeight());
                }
                put(o, "yuv", yuv);
                arr.put(o);
            }
            return arr.toString();
        } catch (Exception e) {
            return "[]";
        }
    }
}
