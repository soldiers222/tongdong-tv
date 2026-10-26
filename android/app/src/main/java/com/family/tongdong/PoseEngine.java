package com.family.tongdong;

import android.annotation.SuppressLint;
import android.content.Context;
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
import android.os.SystemClock;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import org.json.JSONArray;
import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 原生姿态识别：Camera2 取帧 → MoveNet Lightning（TensorFlow Lite，多线程 CPU）→ 17 个关键点。
 *
 * 网页里的识别只能用单核（电视的网页内核不支持多线程 WASM），这里直接用安卓原生代码跑，
 * 能用上多个 CPU 核心。摄像头画面同时送到一个 SurfaceTexture，由 MainActivity 显示在网页下层。
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
    }

    static final String MODEL = "models/movenet_lightning_int8.tflite";
    private static final int IN = 192;      // MoveNet Lightning 输入边长
    private static final int THREADS = 4;   // 8 核电视留一半给画面和系统
    private static final String TAG = "Tongdong"; // 电脑上看日志：adb logcat -s Tongdong

    private final Context ctx;
    private final Listener listener;

    private HandlerThread camThread;
    private Handler camHandler;
    private HandlerThread inferThread;
    private Handler inferHandler;

    private volatile CameraDevice camera;
    private volatile CameraCaptureSession session;
    private CountDownLatch openLatch;   // 摄像头打开（或失败）后放行
    private CountDownLatch closeLatch;  // 摄像头完全关掉后放行
    private ImageReader reader;
    private Surface previewSurface;
    private SurfaceTexture previewTexture;

    private Interpreter interpreter;
    private ByteBuffer input;
    private DataType inputType;
    private final float[][][][] output = new float[1][1][17][3];

    private volatile boolean running;
    private volatile boolean busy;
    private volatile int generation;     // 每次 start() 加 1，出错后的清理只清理那一次的
    // 跟踪裁剪区域（摄像头画面归一化坐标 {y0, x0, y1, x1}，可以超出 0–1，超出部分补黑）。
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

    // 统计
    private final float[] recentMs = new float[60];
    private int recentCount;
    private long frames;
    private long statStart;
    private String lastError = "";

    PoseEngine(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
    }

    /** APK 里有模型、设备有摄像头才算可用 */
    static boolean available(Context ctx) {
        try (InputStream in = ctx.getAssets().open(MODEL)) {
            if (in.read() < 0) return false;
        } catch (IOException e) {
            return false;
        }
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            return cm != null && cm.getCameraIdList().length > 0;
        } catch (Exception e) {
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
            Rect active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
            analysisSize = pickAnalysis(yuv, active);
            previewSize = largestSameAspect(prev != null && prev.length > 0 ? prev : yuv, analysisSize, 1920, 1080);
            Integer so = ch.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 0 : ((so % 360) + 360) % 360 / 90 * 90;
            Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
            front = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
            Integer ts = ch.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
            realtimeTimestamps = ts != null && ts == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
            Integer lv = ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
            hwLevel = levelName(lv == null ? -1 : lv);
            cameraId = chosen;
            Log.i(TAG, "摄像头 " + chosen + "（共 " + ids.length + " 个）" + (front ? " 前置" : " 后置")
                    + " 等级 " + hwLevel + " 传感器 " + sensorOrientation + "° " + (active == null ? "" : active.width() + "x" + active.height())
                    + " 识别 " + analysisSize + " 预览 " + previewSize
                    + " 可用 YUV " + Arrays.toString(yuv));
            return null;
        } catch (Exception e) {
            return "摄像头信息读取失败：" + e.getMessage();
        }
    }

    /** 打开摄像头开始识别。previewTexture 可以为 null（只识别不显示）。需要已经有摄像头权限。 */
    @SuppressLint("MissingPermission")
    synchronized String start(SurfaceTexture previewTexture) {
        if (running) return null;
        String why = cameraId == null ? prepare() : null;
        if (why != null) return why;
        try {
            loadInterpreter();
        } catch (Throwable t) {
            return "识别模型加载失败：" + t.getMessage();
        }
        camThread = new HandlerThread("td-camera");
        camThread.start();
        camHandler = new Handler(camThread.getLooper());
        inferThread = new HandlerThread("td-infer");
        inferThread.start();
        inferHandler = new Handler(inferThread.getLooper());

        reader = ImageReader.newInstance(analysisSize.getWidth(), analysisSize.getHeight(), ImageFormat.YUV_420_888, 2);
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
        busy = false;
        crop = null;
        frames = 0;
        recentCount = 0;
        statStart = SystemClock.elapsedRealtime();
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
                        Log.i(TAG, "开始取帧 帧率范围 " + fpsRange + " 预览 " + previewSize);
                        s.setRepeatingRequest(b.build(), null, camHandler);
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

    private void onImage(ImageReader r) {
        Image img = null;
        try {
            img = r.acquireLatestImage();
            if (img == null) return;
            if (!running || busy) return;
            busy = true;
            final long ts = img.getTimestamp();
            final long acquired = SystemClock.elapsedRealtimeNanos();
            // 转正后的宽高：裁剪区域和关键点都用这个坐标系
            final boolean swap = sensorOrientation % 180 != 0;
            final int fw = swap ? img.getHeight() : img.getWidth();
            final int fh = swap ? img.getWidth() : img.getHeight();
            float[] c = crop;
            if (c == null) c = initCrop(fw, fh);
            final float[] used = c;
            fill(img, used);
            img.close();
            img = null;
            inferHandler.post(() -> infer(fw, fh, used, ts, acquired));
        } catch (Throwable t) {
            busy = false;
            lastError = String.valueOf(t.getMessage());
        } finally {
            if (img != null) img.close();
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

    /** 把裁剪区域里的 YUV 画面取样成 192×192 RGB 放进输入（区域超出画面的部分补黑） */
    private void fill(Image img, float[] c) {
        Image.Plane[] p = img.getPlanes();
        sampleYuv(p[0].getBuffer(), p[1].getBuffer(), p[2].getBuffer(),
                p[0].getRowStride(), p[0].getPixelStride(), p[1].getRowStride(), p[1].getPixelStride(),
                img.getWidth(), img.getHeight(), sensorOrientation, c, input, inputType);
    }

    /**
     * 纯计算部分单独拿出来，方便在电脑上测试。
     * sw×sh 是传感器原始画面；rot 是画面要顺时针转多少度才正（0/90/180/270）；
     * c 是转正后画面里的裁剪区域。
     */
    static void sampleYuv(ByteBuffer yb, ByteBuffer ub, ByteBuffer vb, int yRow, int yPix, int uvRow, int uvPix,
                          int sw, int sh, int rot, float[] c, ByteBuffer input, DataType inputType) {
        boolean swap = rot % 180 != 0;
        int fw = swap ? sh : sw, fh = swap ? sw : sh; // 转正后的宽高
        float sy = (c[2] - c[0]) / IN, sx = (c[3] - c[1]) / IN;
        int[] xs = new int[IN];
        for (int ox = 0; ox < IN; ox++) xs[ox] = (int) Math.floor((c[1] + (ox + 0.5f) * sx) * fw);
        input.rewind();
        boolean u8 = inputType == DataType.UINT8;
        boolean s8 = inputType == DataType.INT8;
        boolean i32 = inputType == DataType.INT32;
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
                if (u8) {
                    input.put((byte) r).put((byte) g).put((byte) b);
                } else if (s8) {
                    input.put((byte) (r - 128)).put((byte) (g - 128)).put((byte) (b - 128));
                } else if (i32) {
                    input.putInt(r).putInt(g).putInt(b);
                } else {
                    input.putFloat(r).putFloat(g).putFloat(b);
                }
            }
        }
    }

    private static int clamp(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    private void infer(int fw, int fh, float[] c, long ts, long acquired) {
        try {
            if (!running || interpreter == null) return;
            long t0 = SystemClock.elapsedRealtimeNanos();
            input.rewind();
            interpreter.run(input, output);
            long t1 = SystemClock.elapsedRealtimeNanos();
            float ms = (t1 - t0) / 1e6f;
            recentMs[recentCount % recentMs.length] = ms;
            recentCount++;
            frames++;
            // 画面拍下到现在过了多久（网页据此做延迟补偿）
            long base = realtimeTimestamps ? ts : acquired;
            float age = Math.max(0, (t1 - base) / 1e6f);
            // 裁剪区域内的坐标 → 摄像头画面归一化坐标
            float[] k = new float[17 * 3];
            for (int i = 0; i < 17; i++) {
                k[i * 3] = c[1] + output[0][0][i][1] * (c[3] - c[1]);
                k[i * 3 + 1] = c[0] + output[0][0][i][0] * (c[2] - c[0]);
                k[i * 3 + 2] = output[0][0][i][2];
            }
            crop = nextCrop(k, fw, fh);
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
            busy = false;
        }
    }

    private void loadInterpreter() throws IOException {
        if (interpreter != null) return;
        byte[] bytes;
        try (InputStream in = ctx.getAssets().open(MODEL); ByteArrayOutputStream out = new ByteArrayOutputStream(4 << 20)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            bytes = out.toByteArray();
        }
        ByteBuffer model = ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
        model.put(bytes);
        model.rewind();
        Interpreter.Options opt = new Interpreter.Options();
        opt.setNumThreads(THREADS);
        opt.setUseXNNPACK(true);
        long t0 = SystemClock.elapsedRealtime();
        interpreter = new Interpreter(model, opt);
        Log.i(TAG, "识别模型已加载，" + THREADS + " 线程，用时 " + (SystemClock.elapsedRealtime() - t0) + " 毫秒");
        inputType = interpreter.getInputTensor(0).dataType();
        int bytesPer = (inputType == DataType.UINT8 || inputType == DataType.INT8) ? 1 : 4;
        input = ByteBuffer.allocateDirect(IN * IN * 3 * bytesPer).order(ByteOrder.nativeOrder());
    }

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
        // 先等取帧和识别线程停下，再释放画面缓冲，避免线程还在读已经释放的内存
        quitAndJoin(camThread);
        camThread = null;
        quitAndJoin(inferThread);
        inferThread = null;
        if (reader != null) {
            reader.close();
            reader = null;
        }
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
    }

    private static void await(CountDownLatch l, long ms) {
        if (l == null) return;
        try {
            l.await(ms, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
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

    void close() {
        stop();
        if (interpreter != null) {
            interpreter.close();
            interpreter = null;
        }
    }

    /** 给网页的「设备测试」看 */
    String infoJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("camera", cameraId == null ? "" : cameraId);
            o.put("facing", front ? "front" : "back");
            Size a = getAnalysisSize(), p = getPreviewSize();
            if (a != null) {
                o.put("w", a.getWidth());
                o.put("h", a.getHeight());
            }
            if (p != null) {
                o.put("pw", p.getWidth());
                o.put("ph", p.getHeight());
            }
            o.put("rotation", sensorOrientation);
            o.put("threads", THREADS);
            o.put("level", hwLevel);
            o.put("fpsRange", fpsRange);
            o.put("input", inputType == null ? "" : inputType.toString());
            o.put("running", running);
            int n = Math.min(recentCount, recentMs.length);
            if (n > 0) {
                float[] copy = Arrays.copyOf(recentMs, n);
                Arrays.sort(copy);
                o.put("p50", copy[n / 2]);
                o.put("p95", copy[Math.min(n - 1, (int) (n * 0.95f))]);
            }
            long el = SystemClock.elapsedRealtime() - statStart;
            if (running && el > 0) o.put("fps", frames * 1000.0 / el);
            o.put("error", lastError);
            return o.toString();
        } catch (Exception e) {
            return "{}";
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
                o.put("id", id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                o.put("facing", facing == null ? -1 : facing);
                JSONArray yuv = new JSONArray();
                if (map != null && map.getOutputSizes(ImageFormat.YUV_420_888) != null) {
                    for (Size s : map.getOutputSizes(ImageFormat.YUV_420_888)) yuv.put(s.getWidth() + "x" + s.getHeight());
                }
                o.put("yuv", yuv);
                arr.put(o);
            }
            return arr.toString();
        } catch (Exception e) {
            return "[]";
        }
    }
}
