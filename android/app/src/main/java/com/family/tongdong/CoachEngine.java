package com.family.tongdong;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.PixelCopy;
import android.view.Window;

import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;

/**
 * 「老师」的动作识别：看视频里做示范的人，网页拿去和孩子的动作比。
 *
 * 画面从哪来（自动选）：
 *   copy  直接从应用窗口里截视频所在的那一块（PixelCopy，安卓 8 以上）。什么视频都行，不用网页配合。
 *   push  放视频的网页自己把画面画到小画布上，转成 JPEG 送过来（视频层的 TdCoach.frame、主网页的 coachFrame）。
 * 先用 copy；截出来一直是黑的（有的电视把视频放在单独的硬件图层里，截不到），就换成 push；
 * push 也不行（跨域的视频画不到画布上）就告诉网页「看不到老师」，网页改成按运动量计分。
 *
 * 识别用和摄像头一样的 MoveNet Lightning（int8，CPU 一个线程，每秒八帧左右就够），
 * 自己一个线程、一个模型，跟踪裁剪区域（和 PoseEngine 同一套）。关键点坐标是相对视频画面的 0–1，
 * 通过 listener 交给 MainActivity，再转给网页（window.__tdCoachPose / __tdCoachEvent）。
 */
final class CoachEngine {
    interface Listener {
        /** 后台线程调用；json 形如 {"k":[x,y,s,…51个],"w":480,"h":270,"age":40,"ms":21,"vt":12.3,"src":"copy","luma":96} */
        void onCoachPose(String json);

        /** 后台线程调用；json 形如 {"type":"mode","mode":"push","why":"…"}、{"type":"error","msg":"…"} */
        void onCoachEvent(String json);
    }

    private static final String TAG = "TongdongCoach"; // 电脑上看日志：adb logcat -s TongdongCoach
    private static final int IN = 192;            // MoveNet Lightning 输入边长
    private static final int COPY_W = 480;        // 截图缩到这么大（长边），够识别用，读像素也快
    private static final int BLACK_FRAMES = 24;   // 视频在放、却连续这么多帧都是黑的（约 3 秒）：换 push
    private static final int FAIL_FRAMES = 20;    // 连续截图失败这么多次：换 push
    private static final float BLACK_LUMA = 6f;

    private final Activity activity;
    private final Listener listener;
    private HandlerThread thread;
    private volatile Handler handler;

    // 模型（只在 coach 线程里用）
    private Interpreter interpreter;
    private int builtThreads;
    private ByteBuffer input;
    private DataType inputType;
    private final float[][][][] output = new float[1][1][17][3];
    private final byte[] rgb = new byte[IN * IN * 3];
    private int[] pixels = new int[0];
    private float[] crop;
    private int cropW, cropH;

    // 设置（任意线程写）
    private volatile boolean running;
    private volatile String mode = "copy";   // copy / push / none
    private volatile String target = "video"; // video：视频层；main：主网页里的 <video>
    private volatile int fps = 8;
    private volatile int threads = 1;
    private volatile int generation;
    private final Rect copyRect = new Rect();
    private volatile boolean rectValid;
    private volatile boolean playing;
    private volatile double videoTime = -1;
    private volatile long videoTimeAt;

    // copy（coach 线程）
    private Bitmap copyBmp;
    private boolean copyBusy;
    private int blackRun, failRun;

    // push：只留最新的一帧
    private final Object pushLock = new Object();
    private byte[] pushData;
    private double pushVt;
    private long pushWall;
    private boolean pushPosted;
    private volatile long lastPushAt;

    // 统计
    private final Object statLock = new Object();
    private int frames, blacks, copyFails, pushes, pushDrops, decodeFails;
    private float copyMs, inferMs, luma;
    private String lastError = "";
    private long startedAt;

    CoachEngine(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    static boolean available(Context ctx) {
        return PoseEngine.available(ctx);
    }

    /**
     * 开始看老师。json：{target:"video"|"main", mode:"copy"|"push", fps, threads}。
     * 返回 null 表示开始了，否则是原因。
     */
    synchronized String start(String json) {
        if (!available(activity)) return "这个安装包里没有识别模型";
        JSONObject o = parse(json);
        target = "main".equals(o.optString("target")) ? "main" : "video";
        boolean wantPush = "push".equals(o.optString("mode"));
        mode = (wantPush || Build.VERSION.SDK_INT < 26) ? "push" : "copy";
        fps = clamp(o.optInt("fps", 8), 2, 15);
        threads = clamp(o.optInt("threads", 1), 1, 4);
        ensureThread();
        generation++;
        final int gen = generation;
        running = true;
        rectValid = false;
        playing = false;
        synchronized (pushLock) {
            pushData = null;
        }
        synchronized (statLock) {
            frames = blacks = copyFails = pushes = pushDrops = decodeFails = 0;
            copyMs = inferMs = luma = 0;
            lastError = "";
            startedAt = SystemClock.elapsedRealtime();
        }
        final String startMode = mode;
        handler.post(() -> {
            if (gen != generation) return;
            String err = ensureModel();
            if (err != null) {
                running = false;
                synchronized (statLock) {
                    lastError = err;
                }
                event("error", "msg", err);
                return;
            }
            crop = null;
            blackRun = 0;
            failRun = 0;
            copyBusy = false;
            event("mode", "mode", startMode);
            if ("copy".equals(startMode)) scheduleCopy(gen);
        });
        Log.i(TAG, "开始看老师：" + target + " " + mode + " " + fps + " 帧/秒");
        return null;
    }

    void stop() {
        running = false;
        generation++;
        rectValid = false;
        synchronized (pushLock) {
            pushData = null;
        }
    }

    void close() {
        stop();
        final HandlerThread t = thread;
        final Handler h = handler;
        thread = null;
        handler = null;
        if (h != null) {
            h.post(() -> {
                if (interpreter != null) {
                    try {
                        interpreter.close();
                    } catch (Throwable ignored) {
                        // 忽略
                    }
                    interpreter = null;
                }
                if (copyBmp != null) {
                    copyBmp.recycle();
                    copyBmp = null;
                }
            });
        }
        if (t != null) t.quitSafely();
    }

    boolean isRunning() {
        return running;
    }

    String mode() {
        return mode;
    }

    String target() {
        return target;
    }

    /** 视频在窗口里的位置（物理像素，null 表示不知道）、是不是正在放、放到第几秒 */
    void setVideo(Rect r, boolean isPlaying, double t) {
        synchronized (copyRect) {
            if (r != null && r.width() >= 16 && r.height() >= 16) {
                copyRect.set(r);
                rectValid = true;
            } else {
                rectValid = false;
            }
        }
        playing = isPlaying;
        videoTime = t;
        videoTimeAt = SystemClock.elapsedRealtime();
    }

    /** push 也拿不到画面：放弃，网页改成按运动量计分 */
    void giveUp(String why) {
        if (!running || "none".equals(mode)) return;
        mode = "none";
        synchronized (statLock) {
            lastError = why;
        }
        event("mode", "mode", "none", "why", why);
    }

    /** 网页（或视频层）送来一帧画面：data:image/jpeg;base64,…；vt 视频时间（秒），wall 拍下时的 Date.now() */
    void pushFrame(String dataUrl, double vt, double wall) {
        if (!running || !"push".equals(mode) || dataUrl == null) return;
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:image/") || comma < 0 || dataUrl.length() > 800000) return;
        byte[] bytes;
        try {
            bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            synchronized (statLock) {
                decodeFails++;
            }
            return;
        }
        Handler h = handler;
        if (h == null) return;
        lastPushAt = SystemClock.elapsedRealtime();
        boolean post;
        synchronized (pushLock) {
            if (pushData != null) {
                synchronized (statLock) {
                    pushDrops++;
                }
            }
            pushData = bytes;
            pushVt = vt;
            pushWall = (long) wall;
            post = !pushPosted;
            pushPosted = true;
        }
        if (post) {
            final int gen = generation;
            h.post(() -> drainPush(gen));
        }
    }

    private void drainPush(int gen) {
        byte[] data;
        double t;
        long wall;
        synchronized (pushLock) {
            data = pushData;
            t = pushVt;
            wall = pushWall;
            pushData = null;
            pushPosted = false;
        }
        if (data == null || gen != generation || !running) return;
        Bitmap b;
        try {
            b = BitmapFactory.decodeByteArray(data, 0, data.length);
        } catch (Throwable e) {
            b = null;
        }
        if (b == null) {
            synchronized (statLock) {
                decodeFails++;
            }
            return;
        }
        synchronized (statLock) {
            pushes++;
        }
        long ageMs = wall > 0 ? Math.max(0, Math.min(2000, System.currentTimeMillis() - wall)) : 0;
        process(b, SystemClock.elapsedRealtime() - ageMs, t, "push");
        b.recycle();
    }

    // ---------- copy：定时截视频所在的那块窗口 ----------

    private void scheduleCopy(final int gen) {
        Handler h = handler;
        if (h != null) h.postDelayed(() -> copyTick(gen), 1000 / Math.max(1, fps));
    }

    private void copyTick(final int gen) {
        if (gen != generation || !running || !"copy".equals(mode)) return;
        scheduleCopy(gen);
        if (copyBusy || !rectValid || !playing) return;
        if (Build.VERSION.SDK_INT < 26) {
            switchToPush("系统版本不支持截图");
            return;
        }
        final Rect r;
        synchronized (copyRect) {
            r = new Rect(copyRect);
        }
        int w = COPY_W, h = Math.max(16, Math.round(COPY_W * (float) r.height() / r.width()));
        if (h > COPY_W) {
            h = COPY_W;
            w = Math.max(16, Math.round(COPY_W * (float) r.width() / r.height()));
        }
        if (copyBmp == null || copyBmp.getWidth() != w || copyBmp.getHeight() != h) {
            if (copyBmp != null) copyBmp.recycle();
            copyBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        }
        final Bitmap dst = copyBmp;
        final Handler h2 = handler;
        if (h2 == null) return;
        copyBusy = true;
        final long t0 = SystemClock.elapsedRealtime();
        final double vt = estimateTime(t0);
        activity.runOnUiThread(() -> {
            try {
                Window win = activity.getWindow();
                if (win == null) throw new IllegalStateException("没有窗口");
                PixelCopy.request(win, r, dst, result -> onCopied(gen, dst, result, t0, vt), h2);
            } catch (Throwable e) {
                final String msg = String.valueOf(e.getMessage());
                h2.post(() -> {
                    copyBusy = false;
                    copyFailed(gen, msg);
                });
            }
        });
    }

    private void onCopied(int gen, Bitmap dst, int result, long t0, double vt) {
        copyBusy = false;
        if (gen != generation || !running || !"copy".equals(mode)) return;
        float ms = SystemClock.elapsedRealtime() - t0;
        synchronized (statLock) {
            copyMs = copyMs == 0 ? ms : copyMs * 0.9f + ms * 0.1f;
        }
        if (result != PixelCopy.SUCCESS) {
            copyFailed(gen, "截图失败（" + result + "）");
            return;
        }
        failRun = 0;
        process(dst, t0, vt, "copy");
    }

    private void copyFailed(int gen, String msg) {
        if (gen != generation) return;
        synchronized (statLock) {
            copyFails++;
            lastError = msg;
        }
        failRun++;
        if (failRun >= FAIL_FRAMES) switchToPush(msg);
    }

    private void switchToPush(String why) {
        if (!"copy".equals(mode)) return;
        mode = "push";
        blackRun = 0;
        failRun = 0;
        Log.i(TAG, "改成网页送画面：" + why);
        event("mode", "mode", "push", "why", why);
    }

    private double estimateTime(long at) {
        double t = videoTime;
        if (t < 0) return -1;
        return playing ? t + (at - videoTimeAt) / 1000.0 : t;
    }

    // ---------- 识别 ----------

    private void process(Bitmap b, long capturedAt, double vt, String src) {
        if (interpreter == null) return;
        int w = b.getWidth(), h = b.getHeight();
        if (pixels.length < w * h) pixels = new int[w * h];
        b.getPixels(pixels, 0, w, 0, 0, w, h);
        float lu = lumaOf(pixels, w, h);
        synchronized (statLock) {
            luma = lu;
        }
        if (lu < BLACK_LUMA) {
            synchronized (statLock) {
                blacks++;
            }
            blackRun++;
            if ("copy".equals(src) && blackRun >= BLACK_FRAMES) switchToPush("截到的视频画面是黑的");
            return;
        }
        blackRun = 0;
        if (crop == null || w != cropW || h != cropH) {
            crop = PoseEngine.initCrop(w, h);
            cropW = w;
            cropH = h;
        }
        float[] c = crop;
        sampleArgb(pixels, w, h, c, rgb);
        float ms;
        try {
            PoseEngine.pack(rgb, input, inputType);
            long n0 = SystemClock.elapsedRealtimeNanos();
            interpreter.run(input, output);
            ms = (SystemClock.elapsedRealtimeNanos() - n0) / 1e6f;
        } catch (Throwable e) {
            synchronized (statLock) {
                lastError = "识别出错：" + e.getMessage();
            }
            event("error", "msg", "识别出错：" + e.getMessage());
            return;
        }
        float[] k = new float[17 * 3];
        for (int i = 0; i < 17; i++) {
            k[i * 3] = c[1] + output[0][0][i][1] * (c[3] - c[1]);
            k[i * 3 + 1] = c[0] + output[0][0][i][0] * (c[2] - c[0]);
            k[i * 3 + 2] = output[0][0][i][2];
        }
        crop = PoseEngine.nextCrop(k, w, h);
        synchronized (statLock) {
            frames++;
            inferMs = inferMs == 0 ? ms : inferMs * 0.9f + ms * 0.1f;
        }
        long age = Math.max(0, SystemClock.elapsedRealtime() - capturedAt);
        StringBuilder sb = new StringBuilder(1100);
        sb.append("{\"k\":[");
        for (int i = 0; i < 17; i++) {
            if (i > 0) sb.append(',');
            sb.append(String.format(Locale.ROOT, "%.4f,%.4f,%.3f", k[i * 3], k[i * 3 + 1], k[i * 3 + 2]));
        }
        sb.append("],\"w\":").append(w).append(",\"h\":").append(h)
                .append(",\"age\":").append(age)
                .append(",\"ms\":").append(String.format(Locale.ROOT, "%.1f", ms))
                .append(",\"vt\":").append(String.format(Locale.ROOT, "%.3f", vt))
                .append(",\"src\":\"").append(src).append('"')
                .append(",\"luma\":").append(Math.round(lu)).append('}');
        listener.onCoachPose(sb.toString());
    }

    /** 整幅画面的平均亮度（隔几个像素取一个），判断是不是截到了黑屏 */
    static float lumaOf(int[] px, int w, int h) {
        long sum = 0;
        int n = 0;
        int step = Math.max(1, Math.min(w, h) / 40);
        for (int y = step / 2; y < h; y += step) {
            int row = y * w;
            for (int x = step / 2; x < w; x += step) {
                int p = px[row + x];
                sum += (((p >> 16) & 0xff) * 3 + ((p >> 8) & 0xff) * 6 + (p & 0xff)) / 10;
                n++;
            }
        }
        return n == 0 ? 0 : (float) sum / n;
    }

    /**
     * 把裁剪区域里的画面取样成 192×192 RGB（区域超出画面的部分补黑），每个输出像素取 2×2 个点平均，
     * 缩小时不那么毛糙。px 是 ARGB 像素，c 是 {上, 左, 下, 右}（0–1）。纯计算，方便在电脑上测试。
     */
    static void sampleArgb(int[] px, int w, int h, float[] c, byte[] out) {
        float sy = (c[2] - c[0]) / IN, sx = (c[3] - c[1]) / IN;
        int o = 0;
        for (int oy = 0; oy < IN; oy++) {
            float fy0 = (c[0] + (oy + 0.25f) * sy) * h, fy1 = (c[0] + (oy + 0.75f) * sy) * h;
            for (int ox = 0; ox < IN; ox++) {
                float fx0 = (c[1] + (ox + 0.25f) * sx) * w, fx1 = (c[1] + (ox + 0.75f) * sx) * w;
                int r = 0, g = 0, b = 0;
                for (int q = 0; q < 4; q++) {
                    int x = (int) Math.floor((q & 1) == 0 ? fx0 : fx1);
                    int y = (int) Math.floor((q & 2) == 0 ? fy0 : fy1);
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    int p = px[y * w + x];
                    r += (p >> 16) & 0xff;
                    g += (p >> 8) & 0xff;
                    b += p & 0xff;
                }
                out[o++] = (byte) (r >> 2);
                out[o++] = (byte) (g >> 2);
                out[o++] = (byte) (b >> 2);
            }
        }
    }

    private String ensureModel() {
        if (interpreter != null && builtThreads == threads) return null;
        if (interpreter != null) {
            try {
                interpreter.close();
            } catch (Throwable ignored) {
                // 忽略
            }
            interpreter = null;
        }
        try {
            ByteBuffer buf = loadModel(activity, PoseEngine.MODEL);
            Interpreter.Options opt = new Interpreter.Options();
            opt.setNumThreads(threads);
            opt.setUseXNNPACK(true);
            Interpreter it = new Interpreter(buf, opt);
            DataType type = it.getInputTensor(0).dataType();
            int bytesPer = (type == DataType.UINT8 || type == DataType.INT8) ? 1 : 4;
            ByteBuffer in = ByteBuffer.allocateDirect(IN * IN * 3 * bytesPer).order(ByteOrder.nativeOrder());
            it.run(in, output);
            input = in;
            inputType = type;
            interpreter = it;
            builtThreads = threads;
            return null;
        } catch (Throwable e) {
            Log.w(TAG, "模型加载失败", e);
            return "识别模型加载失败：" + e.getMessage();
        }
    }

    private static ByteBuffer loadModel(Context ctx, String name) throws IOException {
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

    private void ensureThread() {
        if (thread != null) return;
        thread = new HandlerThread("td-coach", Process.THREAD_PRIORITY_DEFAULT);
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    String infoJson() {
        JSONObject o = new JSONObject();
        try {
            synchronized (statLock) {
                o.put("running", running);
                o.put("mode", mode);
                o.put("target", target);
                o.put("fps", fps);
                o.put("threads", threads);
                o.put("frames", frames);
                o.put("blacks", blacks);
                o.put("copyFails", copyFails);
                o.put("pushes", pushes);
                o.put("pushDrops", pushDrops);
                o.put("decodeFails", decodeFails);
                o.put("copyMs", Math.round(copyMs * 10) / 10.0);
                o.put("inferMs", Math.round(inferMs * 10) / 10.0);
                o.put("luma", Math.round(luma));
                o.put("secs", startedAt > 0 ? (SystemClock.elapsedRealtime() - startedAt) / 1000 : 0);
                o.put("error", lastError);
                o.put("sdk", Build.VERSION.SDK_INT);
            }
        } catch (Exception ignored) {
            // 拿不到的字段就空着
        }
        return o.toString();
    }

    private void event(String type, String... kv) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(kv[i], kv[i + 1]);
            o.put("target", target);
        } catch (Exception ignored) {
            // 忽略
        }
        listener.onCoachEvent(o.toString());
    }

    private static JSONObject parse(String json) {
        try {
            return new JSONObject(json == null || json.trim().isEmpty() ? "{}" : json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
