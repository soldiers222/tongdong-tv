package com.family.tongdong;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Size;
import android.view.KeyEvent;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 童动乐园电视外壳：一个全屏 WebView，加载打包在 APK 里的网页（assets/www）。
 *
 * - 网页地址是 https://appassets.androidplatform.net/assets/www/index.html，
 *   由 shouldInterceptRequest 从 APK 里读文件返回。https 才算安全上下文，摄像头才能用。
 * - 返回键先交给网页（window.__tdBack），网页说已在首页时，再按一次退出。
 * - 菜单键：重新加载、在「内置版本」和「网页版地址」之间切换。
 * - 切到后台时通知网页（window.__tdPause）马上关摄像头，升降摄像头会缩回去。
 * - 原生识别（PoseEngine）：摄像头和 MoveNet 都在安卓里跑，关键点通过 window.__tdNativePose 交给网页；
 *   摄像头画面显示在网页下层的 TextureView 里，网页把对应区域做成透明。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ASSET_PREFIX = "/assets/";
    private static final String HOME_URL = "https://" + HOST + "/assets/www/index.html";
    private static final String DEFAULT_WEB_URL = "https://soldiers222.github.io/tongdong-tv/";
    private static final int REQ_CAMERA = 7;

    private WebView web;
    private FrameLayout root;
    private TextureView preview;
    private volatile SurfaceTexture previewTexture;
    private PoseEngine pose;
    private PermissionRequest pendingRequest;
    private long lastBackAt;
    private boolean stopped;
    private boolean askingPermission; // 系统权限弹窗显示期间，不当作切到后台

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // 调试版可以用电脑 Chrome 的 chrome://inspect 看网页日志
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web = new WebView(this);
        // 透明：原生识别时摄像头画面在网页下层，网页把画面区域做成透明（其他页面都有自己的背景色）
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // 页面自己把 1920×1080 的画布缩放到屏幕，WebView 不要再做任何缩放：
        // 打开宽视口/总览模式时，电视会先把页面缩小、随后又恢复，画面就被放大裁掉了。
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // 不跟随系统字号
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new NativeBridge(), "TongdongNative");
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root = new FrameLayout(this);
        // 黑底：网页透明的地方（原生摄像头画面还没出来时）露出来的是黑色
        root.setBackgroundColor(Color.BLACK);
        // 摄像头预览层：平时 1×1 像素藏在网页后面（保持可见，系统才会创建画面缓冲）
        preview = new TextureView(this);
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
                previewTexture = st;
            }

            @Override
            public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {
            }

            @Override
            public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
                previewTexture = null;
                return true;
            }

            @Override
            public void onSurfaceTextureUpdated(SurfaceTexture st) {
            }
        });
        root.addView(preview, new FrameLayout.LayoutParams(1, 1));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemUi();
        web.requestFocus();
        web.loadUrl(startUrl());
    }

    // ---------- 原生识别：摄像头 + MoveNet ----------

    private PoseEngine pose() {
        if (pose == null) {
            pose = new PoseEngine(this, new PoseEngine.Listener() {
                @Override
                public void onPose(String json) {
                    runOnUiThread(() -> {
                        if (web != null) web.evaluateJavascript("window.__tdNativePose&&window.__tdNativePose(" + json + ")", null);
                    });
                }

                @Override
                public void onError(String message) {
                    runOnUiThread(() -> {
                        if (web != null) web.evaluateJavascript("window.__tdNativeError&&window.__tdNativeError(" + JSONObject.quote(message) + ")", null);
                    });
                }
            });
        }
        return pose;
    }

    private String poseStart() {
        try {
            if (!PoseEngine.available(this)) return result(false, "这个安装包里没有原生识别模型");
            if (!hasCamera()) {
                runOnUiThread(() -> {
                    askingPermission = true;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                });
                return result(false, "permission");
            }
            SurfaceTexture st = previewTexture;
            if (st == null) return result(false, "preview");
            PoseEngine p = pose();
            String why = p.start(st);
            if (why != null) return result(false, why);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            Size a = p.getAnalysisSize();
            if (a != null) {
                o.put("w", a.getWidth());
                o.put("h", a.getHeight());
            }
            return o.toString();
        } catch (Exception e) {
            return result(false, String.valueOf(e.getMessage()));
        }
    }

    private static String result(boolean ok, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            if (error != null) o.put("error", error);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }

    /** 网页告诉我们预览要放在哪（CSS 像素）、怎么铺（cover 裁满 / contain 留边）、要不要镜像 */
    private void layoutPreview(String json) {
        try {
            JSONObject o = new JSONObject(json);
            boolean show = o.optBoolean("show", false);
            Size ps = pose == null ? null : pose.getPreviewSize();
            if (!show || ps == null) {
                preview.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
                preview.setTransform(null);
                return;
            }
            float d = getResources().getDisplayMetrics().density;
            float x = (float) o.optDouble("x", 0) * d, y = (float) o.optDouble("y", 0) * d;
            float w = (float) o.optDouble("w", 0) * d, h = (float) o.optDouble("h", 0) * d;
            if (w < 2 || h < 2) return;
            boolean cover = "cover".equals(o.optString("fit", "cover"));
            // 前置摄像头的预览系统已经左右翻过一次，再按网页的要求翻
            boolean mirror = o.optBoolean("mirror", true) != pose.isPreviewMirrored();
            float bw = ps.getWidth(), bh = ps.getHeight();
            float vx = x, vy = y, vw = w, vh = h;
            Matrix m = new Matrix();
            if (cover) {
                // 视图铺满目标区域，画面按比例放大后裁掉多出来的部分
                float s = Math.max(w / bw, h / bh);
                m.setScale(bw * s / w, bh * s / h, w / 2f, h / 2f);
            } else {
                // 视图缩到和画面同样的宽高比，放在目标区域正中
                float s = Math.min(w / bw, h / bh);
                vw = bw * s;
                vh = bh * s;
                vx = x + (w - vw) / 2f;
                vy = y + (h - vh) / 2f;
            }
            if (mirror) m.postScale(-1f, 1f, vw / 2f, vh / 2f);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(vw), Math.round(vh));
            lp.leftMargin = Math.round(vx);
            lp.topMargin = Math.round(vy);
            preview.setLayoutParams(lp);
            preview.setTransform(m);
        } catch (Exception ignored) {
            // 参数不对就不动
        }
    }

    // ---------- 生命周期：切到后台就关摄像头 ----------

    @Override
    protected void onStart() {
        super.onStart();
        if (stopped) {
            stopped = false;
            web.onResume();
            web.evaluateJavascript("window.__tdResume && window.__tdResume()", null);
        }
    }

    @Override
    protected void onStop() {
        // 摄像头权限弹窗在有的系统上会让本页面进入 onStop，这时不能关摄像头
        if (!askingPermission) {
            stopped = true;
            web.evaluateJavascript("window.__tdPause && window.__tdPause()", null);
            web.onPause();
            if (pose != null) pose.stop();
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (pose != null) {
            pose.close();
            pose = null;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
            if (web != null) web.requestFocus();
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    // ---------- 遥控器按键 ----------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) handleBack();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_UP) showMenu();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void handleBack() {
        if (web == null) {
            finish();
            return;
        }
        String js = "(function(){try{return window.__tdBack?window.__tdBack():null}catch(e){return null}})()";
        web.evaluateJavascript(js, value -> {
            if ("true".equals(value)) return;
            if (!"false".equals(value) && web != null && web.canGoBack()) {
                web.goBack();
                return;
            }
            long t = System.currentTimeMillis();
            if (t - lastBackAt < 2500) {
                finish();
            } else {
                lastBackAt = t;
                Toast.makeText(this, "再按一次返回键退出童动乐园", Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ---------- 菜单：内置版本 / 网页版 ----------

    private SharedPreferences prefs() {
        return getSharedPreferences("shell", MODE_PRIVATE);
    }

    private String customUrl() {
        return prefs().getString("url", "");
    }

    private boolean usingCustom() {
        return prefs().getBoolean("useCustom", false) && customUrl().length() > 0;
    }

    private String startUrl() {
        return usingCustom() ? customUrl() : HOME_URL;
    }

    private void showMenu() {
        final String custom = customUrl();
        final boolean onCustom = usingCustom();
        String[] items = new String[]{
                "重新加载",
                (onCustom ? "" : "✓ ") + "使用内置版本（不用联网，推荐）",
                (onCustom ? "✓ " : "") + "使用网页版" + (custom.length() > 0 ? "：" + custom : "（先设置地址）"),
                "设置网页版地址…",
                "退出童动乐园"
        };
        new AlertDialog.Builder(this)
                .setTitle("童动乐园 " + appVersion())
                .setItems(items, (dialog, which) -> {
                    if (which == 0) web.reload();
                    else if (which == 1) useBuiltIn();
                    else if (which == 2) {
                        if (custom.length() > 0) useCustom(custom);
                        else askUrl();
                    } else if (which == 3) askUrl();
                    else if (which == 4) finish();
                })
                .show();
    }

    private void useBuiltIn() {
        prefs().edit().putBoolean("useCustom", false).apply();
        web.loadUrl(HOME_URL);
    }

    private void useCustom(String url) {
        prefs().edit().putString("url", url).putBoolean("useCustom", true).apply();
        web.loadUrl(url);
    }

    private void askUrl() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        String current = customUrl();
        input.setText(current.length() > 0 ? current : DEFAULT_WEB_URL);
        input.setSelection(input.getText().length());
        new AlertDialog.Builder(this)
                .setTitle("网页版地址")
                .setMessage("网页版总是最新代码，但要联网，记录和内置版本分开保存。地址必须是 https 开头，摄像头才能用。")
                .setView(input)
                .setPositiveButton("打开", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (url.length() == 0) return;
                    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
                    useCustom(url);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // ---------- 摄像头权限 ----------

    private boolean hasCamera() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean trustedOrigin(Uri origin) {
        if (origin == null) return false;
        String host = origin.getHost();
        if (host == null) return false;
        if (HOST.equals(host)) return true;
        String custom = customUrl();
        return custom.length() > 0 && host.equals(Uri.parse(custom).getHost());
    }

    private void handlePermission(PermissionRequest request) {
        boolean video = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
        }
        if (!video || !trustedOrigin(request.getOrigin())) {
            request.deny();
            return;
        }
        if (hasCamera()) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingRequest != null) pendingRequest.deny();
        pendingRequest = request;
        askingPermission = true;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CAMERA) return;
        askingPermission = false;
        boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingRequest != null) {
            if (ok) pendingRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingRequest.deny();
            pendingRequest = null;
        }
        if (!ok) {
            Toast.makeText(this, "没有摄像头权限，体感运动用不了。可以在电视的 设置 → 应用 → 童动乐园 → 权限 里打开。", Toast.LENGTH_LONG).show();
        }
    }

    // ---------- 网页文件：从 APK 的 assets/www 读取 ----------

    private WebResourceResponse serveAsset(String path) {
        if (path == null || !path.startsWith(ASSET_PREFIX) || path.contains("..")) return notFound();
        String rel = path.substring(ASSET_PREFIX.length());
        if (rel.length() == 0 || rel.endsWith("/")) rel = rel + "index.html";
        try {
            InputStream in = getAssets().open(rel);
            String mime = mimeOf(rel);
            boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("+xml");
            Map<String, String> headers = isolationHeaders();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", isolationHeaders(),
                new ByteArrayInputStream(new byte[0]));
    }

    // 跨源隔离：网页里才能用 SharedArrayBuffer，后台识别可以多线程跑（所有文件都是同源的，不受影响）
    private static Map<String, String> isolationHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cross-Origin-Opener-Policy", "same-origin");
        headers.put("Cross-Origin-Embedder-Policy", "require-corp");
        headers.put("Cross-Origin-Resource-Policy", "same-origin");
        return headers;
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".wasm")) return "application/wasm";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    // ---------- 设备信息（给网页的「设备测试」用） ----------

    @SuppressWarnings("deprecation")
    private String appVersion() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName + " (" + pi.versionCode + ")";
        } catch (Exception e) {
            return "";
        }
    }

    private static String webViewVersion() {
        if (Build.VERSION.SDK_INT >= 26) {
            PackageInfo pi = WebView.getCurrentWebViewPackage();
            if (pi != null) return pi.packageName + " " + pi.versionName;
        }
        return "";
    }

    private static String sysProp(String key) {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            Object v = c.getMethod("get", String.class).invoke(null, key);
            return v == null ? "" : v.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    public class NativeBridge {
        @JavascriptInterface
        public boolean poseAvailable() {
            return PoseEngine.available(MainActivity.this);
        }

        @JavascriptInterface
        public boolean hasCameraPermission() {
            return hasCamera();
        }

        @JavascriptInterface
        public String poseStart(String options) {
            return MainActivity.this.poseStart();
        }

        @JavascriptInterface
        public void poseStop() {
            if (pose != null) pose.stop();
            runOnUiThread(() -> layoutPreview("{\"show\":false}"));
        }

        @JavascriptInterface
        public String poseInfo() {
            PoseEngine p = pose();
            if (p.getAnalysisSize() == null) p.prepare();
            return p.infoJson();
        }

        @JavascriptInterface
        public String cameraSizes() {
            return PoseEngine.sizesJson(MainActivity.this);
        }

        @JavascriptInterface
        public void preview(String json) {
            runOnUiThread(() -> layoutPreview(json));
        }

        @JavascriptInterface
        public String info() {
            JSONObject o = new JSONObject();
            try {
                o.put("manufacturer", Build.MANUFACTURER);
                o.put("model", Build.MODEL);
                o.put("device", Build.DEVICE);
                o.put("hardware", Build.HARDWARE);
                o.put("android", Build.VERSION.RELEASE);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("harmony", sysProp("hw_sc.build.platform.version"));
                o.put("app", appVersion());
                o.put("webview", webViewVersion());
                o.put("cameraPermission", hasCamera());
                o.put("nativePose", PoseEngine.available(MainActivity.this));
            } catch (Exception ignored) {
                // 拿不到的字段就空着
            }
            return o.toString();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            return serveAsset(u.getPath());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !HOST.equals(request.getUrl().getHost())) {
                // 网页版打不开（没网、地址错）：这次先用内置版本，下次启动还会再试网页版
                Toast.makeText(MainActivity.this, "网页版打不开（" + error.getDescription() + "），先用内置版本。按菜单键可以切换。", Toast.LENGTH_LONG).show();
                view.loadUrl(HOME_URL);
            }
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> handlePermission(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingRequest == request) pendingRequest = null;
        }
    }
}
