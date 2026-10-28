package com.family.tongdong;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 视频层：童动乐园网页下层的第二个 WebView，只用来放B站的外链播放器（player.bilibili.com）。
 *
 * - 网页（上层）把视频那块区域做成透明，告诉安卓放在哪（CSS 像素），和摄像头预览层同一个办法。
 * - 播放器页面里注入 inject.js：只留视频画面，其他都藏起来；网页通过 videoCmd 控制播放、暂停、跳转、镜像。
 * - 每 1/4 秒取一次播放状态（放到哪、暂停没有、画面在哪），转给网页（window.__tdVideo），
 *   同时告诉 CoachEngine 视频画面在窗口里的位置，好截下来识别老师的动作。
 * - 这个 WebView 不接收遥控器按键（不能获得焦点），只能打开 player.bilibili.com 的播放器页面，
 *   别的跳转（打开B站、打开 App）一律拦下。
 */
final class VideoPanel {
    interface Listener {
        /** UI 线程调用：播放状态 JSON（见 inject.js 的 state()） */
        void onVideoState(String json);

        /** UI 线程调用：{"type":"error"|"crash"|"loaded", …} */
        void onVideoEvent(String json);
    }

    private static final String TAG = "TongdongVideo";
    // 电脑版播放器：手机版页面会提示「打开 App 观看」
    static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    private static final String PLAYER_HOST = "player.bilibili.com";
    private static final long POLL_MS = 250;
    private static final long PUSH_TIMEOUT_MS = 7000;

    private final Activity activity;
    private final FrameLayout root;
    private final CoachEngine coach;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::poll;
    private WebView vw;
    private String injectJs;
    private volatile boolean open;
    private int gen;
    private boolean coachOn;
    private boolean pushOn;
    private long pushSince;
    private int lastPushed;
    private long lastPushedAt;
    private String url = "";
    private volatile String lastState = "{}";

    VideoPanel(Activity activity, FrameLayout root, CoachEngine coach, Listener listener) {
        this.activity = activity;
        this.root = root;
        this.coach = coach;
        this.listener = listener;
    }

    /** 只允许B站外链播放器的页面 */
    static boolean allowed(String url) {
        if (url == null) return false;
        try {
            Uri u = Uri.parse(url);
            return "https".equals(u.getScheme()) && PLAYER_HOST.equals(u.getHost())
                    && u.getPath() != null && u.getPath().startsWith("/player.html");
        } catch (Exception e) {
            return false;
        }
    }

    String state() {
        return lastState;
    }

    boolean isOpen() {
        return open;
    }

    /** UI 线程。json：{url, x, y, w, h（CSS 像素）} */
    void open(String json) {
        JSONObject o = parse(json);
        String u = o.optString("url", "");
        if (!allowed(u)) {
            event("error", "msg", "只能放B站外链播放器的视频");
            return;
        }
        ensureView();
        if (vw == null) {
            event("error", "msg", "视频层打不开");
            return;
        }
        gen++;
        coachOn = false;
        pushOn = false;
        lastState = "{}";
        url = u;
        layout(o);
        vw.setVisibility(View.VISIBLE);
        vw.onResume();
        vw.loadUrl(u);
        open = true;
        ui.removeCallbacks(poll);
        ui.postDelayed(poll, 400);
        Log.i(TAG, "打开视频 " + u);
    }

    /** UI 线程。json：{x, y, w, h}（网页的 CSS 像素） */
    void layout(String json) {
        layout(parse(json));
    }

    private void layout(JSONObject o) {
        if (vw == null) return;
        float d = activity.getResources().getDisplayMetrics().density;
        int x = Math.round((float) o.optDouble("x", 0) * d), y = Math.round((float) o.optDouble("y", 0) * d);
        int w = Math.round((float) o.optDouble("w", 0) * d), h = Math.round((float) o.optDouble("h", 0) * d);
        if (w < 2 || h < 2) return;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h);
        lp.leftMargin = x;
        lp.topMargin = y;
        vw.setLayoutParams(lp);
    }

    /** UI 线程。json：{c: play|pause|seek|mirror|mute|unmute|rate, v: 数字} */
    void cmd(String json) {
        JSONObject o = parse(json);
        String c = o.optString("c", "");
        if (!c.matches("play|pause|seek|mirror|mute|unmute|rate")) return;
        double v = o.optDouble("v", 0);
        if (Double.isNaN(v) || Double.isInfinite(v)) v = 0;
        run("window.__tdv&&window.__tdv.cmd(" + JSONObject.quote(c) + "," + v + ")");
    }

    /** UI 线程：开始识别视频里的老师（json 同 CoachEngine.start，target 固定是 video） */
    String coachStart(String json) {
        JSONObject o = parse(json);
        try {
            o.put("target", "video");
        } catch (Exception ignored) {
            // 忽略
        }
        String err = coach.start(o.toString());
        if (err != null) return err;
        coachOn = true;
        pushOn = false;
        setPush("push".equals(coach.mode()));
        return null;
    }

    void coachStop() {
        if (coachOn) coach.stop();
        coachOn = false;
        setPush(false);
    }

    /** CoachEngine 说截图不行、改成网页送画面（UI 线程） */
    void onCoachMode(String mode) {
        if (!coachOn) return;
        setPush("push".equals(mode));
    }

    private void setPush(boolean on) {
        if (on == pushOn) return;
        pushOn = on;
        pushSince = SystemClock.elapsedRealtime();
        lastPushed = -1;
        lastPushedAt = pushSince;
        run("window.__tdv&&window.__tdv.cmd('push'," + (on ? 1 : 0) + ")");
    }

    /** UI 线程：关掉视频（保留 WebView 下次再用） */
    void close() {
        open = false;
        gen++;
        ui.removeCallbacks(poll);
        coachStop();
        if (vw != null) {
            vw.evaluateJavascript("try{window.__tdv&&window.__tdv.cmd('pause')}catch(e){}", null);
            vw.loadUrl("about:blank");
            vw.setVisibility(View.GONE);
            vw.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
        }
        lastState = "{}";
        url = "";
    }

    /** 应用切到后台 */
    void pause() {
        if (vw == null) return;
        if (open) run("window.__tdv&&window.__tdv.cmd('pause')");
        vw.onPause();
    }

    void resume() {
        if (vw != null) vw.onResume();
    }

    void destroy() {
        close();
        if (vw != null) {
            root.removeView(vw);
            vw.destroy();
            vw = null;
        }
    }

    /** 主网页的 WebView 换了一个新的（网页内核崩溃后重建）：视频层要留在它下面 */
    void keepBelow(View top) {
        if (vw == null) return;
        int vi = root.indexOfChild(vw), ti = root.indexOfChild(top);
        if (vi > ti && ti >= 0) {
            root.removeView(vw);
            root.addView(vw, root.indexOfChild(top));
        }
    }

    private void run(String js) {
        if (vw != null && open) vw.evaluateJavascript(js, null);
    }

    // ---------- 播放状态 ----------

    private void poll() {
        if (!open || vw == null) return;
        final int g = gen;
        String js = "(function(){try{" + inject() + "\nreturn JSON.stringify(window.__tdv.state());}catch(e){return JSON.stringify({ok:false,error:String(e)})}})()";
        vw.evaluateJavascript(js, value -> onPolled(g, value));
        ui.postDelayed(poll, POLL_MS);
    }

    private void onPolled(int g, String value) {
        if (g != gen || !open) return;
        String json;
        try {
            Object v = new JSONTokener(value == null ? "null" : value).nextValue();
            if (!(v instanceof String)) return;
            json = (String) v;
        } catch (Exception e) {
            return;
        }
        lastState = json;
        JSONObject s = parse(json);
        if (coachOn) updateCoach(s);
        listener.onVideoState(json);
    }

    private void updateCoach(JSONObject s) {
        boolean playing = s.optBoolean("ok") && !s.optBoolean("paused", true) && !s.optBoolean("ended")
                && s.optInt("ready") >= 2;
        Rect wr = null;
        JSONArray r = s.optJSONArray("rect");
        double W = s.optDouble("W", 0), H = s.optDouble("H", 0);
        if (r != null && r.length() == 4 && W > 0 && H > 0 && vw.getWidth() > 0 && vw.getHeight() > 0) {
            int[] loc = new int[2];
            vw.getLocationInWindow(loc);
            double sx = vw.getWidth() / W, sy = vw.getHeight() / H;
            int x0 = (int) Math.round(loc[0] + r.optDouble(0) * sx), y0 = (int) Math.round(loc[1] + r.optDouble(1) * sy);
            int x1 = (int) Math.round(loc[0] + (r.optDouble(0) + r.optDouble(2)) * sx);
            int y1 = (int) Math.round(loc[1] + (r.optDouble(1) + r.optDouble(3)) * sy);
            x0 = Math.max(x0, loc[0]);
            y0 = Math.max(y0, loc[1]);
            x1 = Math.min(x1, loc[0] + vw.getWidth());
            y1 = Math.min(y1, loc[1] + vw.getHeight());
            if (x1 - x0 >= 16 && y1 - y0 >= 16) wr = new Rect(x0, y0, x1, y1);
        }
        coach.setVideo(wr, playing, s.optDouble("t", -1));
        if (s.optBoolean("taint")) {
            coach.giveUp("视频画面拿不到（跨域）");
            return;
        }
        // 网页送画面：放着视频却一直没有新画面送过来，也放弃
        if (pushOn && "push".equals(coach.mode())) {
            int pushed = s.optInt("pushed", 0);
            long t = SystemClock.elapsedRealtime();
            if (pushed != lastPushed) {
                lastPushed = pushed;
                lastPushedAt = t;
            } else if (playing && t - lastPushedAt > PUSH_TIMEOUT_MS && t - pushSince > PUSH_TIMEOUT_MS) {
                coach.giveUp("视频页面送不出画面（" + s.optString("tag", "?") + "）");
            }
        }
    }

    private String inject() {
        if (injectJs == null) {
            try (InputStream in = activity.getAssets().open("www/js/video/inject.js");
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
                injectJs = out.toString(StandardCharsets.UTF_8.name());
            } catch (Exception e) {
                Log.w(TAG, "读不到 inject.js", e);
                injectJs = "";
            }
        }
        return injectJs;
    }

    // ---------- WebView ----------

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void ensureView() {
        if (vw != null) return;
        try {
            vw = new WebView(activity);
        } catch (Throwable t) {
            Log.w(TAG, "建不了视频层", t);
            vw = null;
            return;
        }
        vw.setBackgroundColor(Color.BLACK);
        WebSettings s = vw.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(DESKTOP_UA);
        vw.setFocusable(false);
        vw.setFocusableInTouchMode(false);
        vw.setVerticalScrollBarEnabled(false);
        vw.setHorizontalScrollBarEnabled(false);
        vw.setOverScrollMode(View.OVER_SCROLL_NEVER);
        vw.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        // 视频页面自己画画面送过来（只在截屏截不到时才用）：只有这一个方法，收到的只是图片
        vw.addJavascriptInterface(new CoachFeed(), "TdCoach");
        vw.setWebViewClient(new Client());
        vw.setWebChromeClient(new Chrome());
        CookieManager.getInstance().setAcceptCookie(true);
        // 放在摄像头预览层和主网页之间（主网页永远在最上面）
        int at = Math.max(0, root.getChildCount() - 1);
        root.addView(vw, at, new FrameLayout.LayoutParams(1, 1));
        vw.setVisibility(View.GONE);
    }

    final class CoachFeed {
        @JavascriptInterface
        public void frame(String dataUrl, double vt, double wall) {
            if (open) coach.pushFrame(dataUrl, vt, wall);
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            String u = request.getUrl().toString();
            if (allowed(u)) return false;
            Log.i(TAG, "拦下跳转 " + u);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String u) {
            if (open && u != null && u.equals(url)) {
                event("loaded", "url", u);
                ui.removeCallbacks(poll);
                ui.post(poll);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (open && request.isForMainFrame()) event("error", "msg", "视频页面打不开：" + error.getDescription());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (open && request.isForMainFrame() && response.getStatusCode() >= 400) {
                event("error", "msg", "视频页面打不开（" + response.getStatusCode() + "）");
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 网页内核崩了（多半是内存不够）：扔掉这个 WebView，下次再建；不能让整个应用退出
            Log.w(TAG, "视频层网页内核没了");
            if (view == vw) {
                open = false;
                gen++;
                ui.removeCallbacks(poll);
                coachStop();
                root.removeView(vw);
                try {
                    vw.destroy();
                } catch (Throwable ignored) {
                    // 忽略
                }
                vw = null;
                lastState = "{}";
                event("crash", "msg", "视频停了（电视内存不够），再试一次");
            }
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            // 不让播放器自己进全屏（全屏由童动乐园管）
            callback.onCustomViewHidden();
        }

        @Override
        public boolean onJsAlert(WebView view, String u, String message, JsResult result) {
            result.cancel();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String u, String message, JsResult result) {
            result.cancel();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String u, String message, String defaultValue, JsPromptResult result) {
            result.cancel();
            return true;
        }

        @Override
        public boolean onJsBeforeUnload(WebView view, String u, String message, JsResult result) {
            result.confirm();
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.d(TAG, "页面：" + m.message());
            return true;
        }
    }

    private void event(String type, String... kv) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(kv[i], kv[i + 1]);
        } catch (Exception ignored) {
            // 忽略
        }
        listener.onVideoEvent(o.toString());
    }

    private static JSONObject parse(String json) {
        try {
            return new JSONObject(json == null || json.trim().isEmpty() ? "{}" : json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }
}
