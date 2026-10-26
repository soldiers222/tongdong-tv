package com.family.tongdong;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.ImageFormat;
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

/**
 * 原生姿态识别：Camera2 取帧 → MoveNet Lightning（TensorFlow Lite，多线程 CPU）→ 17 个关键点。
 *
 * 网页里的识别只能用单核（电视的网页内核不支持多线程 WASM），这里直接用安卓原生代码跑，
 * 能用上多个 CPU 核心。摄像头画面同时送到一个 SurfaceTexture，由 MainActivity 显示在网页下层。
 *
 * 输出的关键点坐标是相对摄像头画面的 0–1 归一化坐标（未镜像），顺序同 MoveNet：
 * 鼻、左眼、右眼、左耳、右耳、左肩、右肩、左肘、右肘、左腕、右腕、左髋、右髋、左膝、右膝、左踝、右踝。
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

    private final Context ctx;
    private final Listener listener;

    private HandlerThread camThread;
    private Handler camHandler;
    private HandlerThread inferThread;
    private Handler inferHandler;

    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private Surface previewSurface;

    private Interpreter interpreter;
    private ByteBuffer input;
    private DataType inputType;
    private final float[][][][] output = new float[1][1][17][3];

    private volatile boolean running;
    private volatile boolean busy;
    private String cameraId;
    private Size analysisSize;
    private Size previewSize;
    private int sensorOrientation;
    private boolean realtimeTimestamps;

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

    Size getAnalysisSize() {
        return analysisSize;
    }

    Size getPreviewSize() {
        return previewSize;
    }

    int getSensorOrientation() {
        return sensorOrientation;
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
            analysisSize = closest(yuv, 640, 480);
            previewSize = largestSameAspect(prev != null && prev.length > 0 ? prev : yuv, analysisSize, 1920, 1080);
            Integer so = ch.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 0 : so;
            Integer ts = ch.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
            realtimeTimestamps = ts != null && ts == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
            cameraId = chosen;
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
        if (previewTexture != null) {
            previewTexture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            previewSurface = new Surface(previewTexture);
        } else {
            previewSurface = null;
        }
        running = true;
        busy = false;
        frames = 0;
        recentCount = 0;
        statStart = SystemClock.elapsedRealtime();
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            cm.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice device) {
                    if (!running) {
                        device.close();
                        return;
                    }
                    camera = device;
                    createSession();
                }

                @Override
                public void onDisconnected(CameraDevice device) {
                    device.close();
                    fail("摄像头被断开（可能被别的应用占用）");
                }

                @Override
                public void onError(CameraDevice device, int error) {
                    device.close();
                    fail("摄像头打开失败（错误 " + error + "）");
                }
            }, camHandler);
        } catch (Exception e) {
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
                        s.setRepeatingRequest(b.build(), null, camHandler);
                    } catch (CameraAccessException | IllegalStateException e) {
                        fail("摄像头取帧失败：" + e.getMessage());
                    }
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession s) {
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
            final int fw = img.getWidth(), fh = img.getHeight();
            final float[] box = fill(img);
            img.close();
            img = null;
            inferHandler.post(() -> infer(fw, fh, box, ts, acquired));
        } catch (Throwable t) {
            busy = false;
            lastError = String.valueOf(t.getMessage());
        } finally {
            if (img != null) img.close();
        }
    }

    /** YUV 画面按比例缩放、上下（或左右）留黑边放进 192×192 输入。返回内容区 {左, 上, 宽, 高}（输入像素）。 */
    private float[] fill(Image img) {
        Image.Plane[] p = img.getPlanes();
        ByteBuffer yb = p[0].getBuffer(), ub = p[1].getBuffer(), vb = p[2].getBuffer();
        int yRow = p[0].getRowStride(), yPix = p[0].getPixelStride();
        int uvRow = p[1].getRowStride(), uvPix = p[1].getPixelStride();
        int fw = img.getWidth(), fh = img.getHeight();
        boolean flip = sensorOrientation == 180;
        float scale = Math.min((float) IN / fw, (float) IN / fh);
        int cw = Math.round(fw * scale), ch = Math.round(fh * scale);
        int px = (IN - cw) / 2, py = (IN - ch) / 2;
        input.rewind();
        boolean u8 = inputType == DataType.UINT8;
        boolean s8 = inputType == DataType.INT8;
        boolean i32 = inputType == DataType.INT32;
        for (int oy = 0; oy < IN; oy++) {
            int cy = oy - py;
            boolean rowIn = cy >= 0 && cy < ch;
            int fy = rowIn ? Math.min(fh - 1, (int) ((cy + 0.5f) / scale)) : 0;
            if (flip) fy = fh - 1 - fy;
            int yRowOff = fy * yRow;
            int uvRowOff = (fy >> 1) * uvRow;
            for (int ox = 0; ox < IN; ox++) {
                int cx = ox - px;
                int r = 0, g = 0, b = 0;
                if (rowIn && cx >= 0 && cx < cw) {
                    int fx = Math.min(fw - 1, (int) ((cx + 0.5f) / scale));
                    if (flip) fx = fw - 1 - fx;
                    int y = (yb.get(yRowOff + fx * yPix) & 0xff);
                    int uvi = uvRowOff + (fx >> 1) * uvPix;
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
        return new float[]{px, py, cw, ch};
    }

    private static int clamp(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    private void infer(int fw, int fh, float[] box, long ts, long acquired) {
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
            StringBuilder sb = new StringBuilder(640);
            sb.append("{\"k\":[");
            for (int i = 0; i < 17; i++) {
                float ny = output[0][0][i][0], nx = output[0][0][i][1], s = output[0][0][i][2];
                // 192×192 输入坐标 → 摄像头画面归一化坐标
                float fx = (nx * IN - box[0]) / box[2];
                float fy = (ny * IN - box[1]) / box[3];
                if (i > 0) sb.append(',');
                sb.append(String.format(Locale.ROOT, "%.4f,%.4f,%.3f", fx, fy, s));
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
        interpreter = new Interpreter(model, opt);
        inputType = interpreter.getInputTensor(0).dataType();
        int bytesPer = (inputType == DataType.UINT8 || inputType == DataType.INT8) ? 1 : 4;
        input = ByteBuffer.allocateDirect(IN * IN * 3 * bytesPer).order(ByteOrder.nativeOrder());
    }

    private void fail(String msg) {
        lastError = msg;
        running = false;
        releaseCamera();
        listener.onError(msg);
    }

    synchronized void stop() {
        running = false;
        releaseCamera();
    }

    private void releaseCamera() {
        try {
            if (session != null) session.close();
        } catch (Exception ignored) {
            // 忽略
        }
        session = null;
        try {
            if (camera != null) camera.close();
        } catch (Exception ignored) {
            // 忽略
        }
        camera = null;
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
            if (analysisSize != null) {
                o.put("w", analysisSize.getWidth());
                o.put("h", analysisSize.getHeight());
            }
            if (previewSize != null) {
                o.put("pw", previewSize.getWidth());
                o.put("ph", previewSize.getHeight());
            }
            o.put("rotation", sensorOrientation);
            o.put("threads", THREADS);
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
