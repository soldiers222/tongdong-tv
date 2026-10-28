package com.family.tongdong;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 给遥控器用的网页浏览器（遥控游戏里的编程、下棋网站）：
 *   方向键  移动光标（按住越走越快；走到上下边缘继续按就滚动网页）
 *   确定键  点一下；按住确定再按方向键 = 拖动（拖积木、拖棋子、滑动页面）
 *   返回键  网页后退，退到第一页就回到童动乐园
 *   菜单键  放大、缩小、刷新、回到这个网站的首页、切换电脑版 / 手机版网页、退出
 * 光标点击是模拟手指触摸，网页把它当成在平板上点。
 */
public class BrowserActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    // 电脑版网页：很多编程网站在手机版上会提示「请用电脑打开」
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private WebView web;
    private CursorView cursor;
    private TextView hint;
    private View bar;
    private String homeUrl;
    private String title;
    private String mobileUa;
    private boolean desktop = true;

    private float cx, cy;            // 光标位置（像素，相对网页左上角）
    private boolean pressed;         // 确定键按着
    private boolean dragged;         // 按着的时候动过
    private long downTime;
    private float pageScale = 1f;    // 一个 CSS 像素对应多少物理像素
    private float density = 1f;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable hideHint = new Runnable() {
        @Override
        public void run() {
            if (hint != null) hint.animate().alpha(0f).setDuration(400).start();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        homeUrl = getIntent().getStringExtra(EXTRA_URL);
        title = getIntent().getStringExtra(EXTRA_TITLE);
        if (homeUrl == null || !(homeUrl.startsWith("https://") || homeUrl.startsWith("http://"))) {
            finish();
            return;
        }
        if (title == null) title = "";
        DisplayMetrics dm = getResources().getDisplayMetrics();
        density = dm.density;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        mobileUa = s.getUserAgentString();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false); // 新窗口就在当前页打开
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(DESKTOP_UA);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        // 4K 电视上网页默认只有 960 个 CSS 像素宽，电脑版网页会挤；按屏幕把页面缩小一点，大约 1440 宽
        int initial = Math.round(dm.widthPixels / 1440f * 100f);
        if (initial > 0 && initial < Math.round(density * 100f)) web.setInitialScale(initial);
        pageScale = initial > 0 ? initial / 100f : density;
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 加载进度条
        bar = new View(this);
        bar.setBackgroundColor(0xFFFFC928);
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(0, dp(4));
        blp.gravity = Gravity.TOP | Gravity.START;
        root.addView(bar, blp);

        cursor = new CursorView(this);
        root.addView(cursor, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        hint = new TextView(this);
        hint.setTextColor(0xFFF7F5EF);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        hint.setPadding(dp(20), dp(10), dp(20), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xE613213C);
        bg.setCornerRadius(dp(22));
        hint.setBackground(bg);
        hint.setText(title + "　方向键移动光标 · 确定键点击 · 按住确定再按方向键拖动 · 返回键后退 · 菜单键放大缩小");
        FrameLayout.LayoutParams hlp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hlp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        hlp.topMargin = dp(16);
        root.addView(hint, hlp);

        setContentView(root);
        hideSystemUi();
        cx = dm.widthPixels / 2f;
        cy = dm.heightPixels / 2f;
        web.loadUrl(homeUrl);
        showHint(7000);
    }

    private int dp(float v) {
        return Math.round(v * density);
    }

    private void showHint(long ms) {
        ui.removeCallbacks(hideHint);
        hint.animate().cancel();
        hint.setAlpha(1f);
        ui.postDelayed(hideHint, ms);
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ---------- 遥控器 ----------

    private static boolean isOk(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        int action = e.getAction();
        if (web == null) return super.dispatchKeyEvent(e);
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (action == KeyEvent.ACTION_DOWN) move(code, e.getRepeatCount());
                return true;
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
                if (action == KeyEvent.ACTION_DOWN) scrollPage(0, -pageStep());
                return true;
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                if (action == KeyEvent.ACTION_DOWN) scrollPage(0, pageStep());
                return true;
            case KeyEvent.KEYCODE_BACK:
                if (action == KeyEvent.ACTION_UP && !e.isCanceled()) back();
                return true;
            case KeyEvent.KEYCODE_MENU:
                if (action == KeyEvent.ACTION_UP) menu();
                return true;
            default:
                break;
        }
        if (isOk(code)) {
            if (action == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) press();
            else if (action == KeyEvent.ACTION_UP) release();
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void move(int code, int repeat) {
        float speed = dp(9) * Math.min(1f + repeat * 0.3f, 6f);
        float dx = 0, dy = 0;
        if (code == KeyEvent.KEYCODE_DPAD_UP) dy = -speed;
        else if (code == KeyEvent.KEYCODE_DPAD_DOWN) dy = speed;
        else if (code == KeyEvent.KEYCODE_DPAD_LEFT) dx = -speed;
        else dx = speed;
        float w = web.getWidth(), h = web.getHeight();
        float nx = cx + dx, ny = cy + dy;
        // 走到边上还继续按：滚动网页（拖动的时候不滚，免得拖着东西乱跑）
        if (!pressed) {
            int step = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / pageScale * 2.5f);
            if (ny < 0 && cy <= 1) scrollPage(0, -step);
            else if (ny > h - 1 && cy >= h - 2) scrollPage(0, step);
            else if (nx < 0 && cx <= 1) scrollPage(-step, 0);
            else if (nx > w - 1 && cx >= w - 2) scrollPage(step, 0);
        }
        cx = Math.max(0, Math.min(w - 1, nx));
        cy = Math.max(0, Math.min(h - 1, ny));
        cursor.invalidate();
        if (pressed) {
            dragged = true;
            touch(MotionEvent.ACTION_MOVE);
        } else {
            hover();
        }
    }

    private void press() {
        pressed = true;
        dragged = false;
        touch(MotionEvent.ACTION_DOWN);
        cursor.invalidate();
    }

    private void release() {
        if (!pressed) return;
        pressed = false;
        touch(MotionEvent.ACTION_UP);
        cursor.invalidate();
    }

    // 模拟手指：按下、移动、抬起
    private void touch(int action) {
        long now = SystemClock.uptimeMillis();
        if (action == MotionEvent.ACTION_DOWN) downTime = now;
        MotionEvent.PointerProperties[] pp = new MotionEvent.PointerProperties[]{new MotionEvent.PointerProperties()};
        pp[0].id = 0;
        pp[0].toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords[] pc = new MotionEvent.PointerCoords[]{new MotionEvent.PointerCoords()};
        pc[0].x = cx;
        pc[0].y = cy;
        pc[0].pressure = 1f;
        pc[0].size = 1f;
        MotionEvent ev = MotionEvent.obtain(downTime, now, action, 1, pp, pc, 0, 0, 1f, 1f, 0, 0,
                InputDevice.SOURCE_TOUCHSCREEN, 0);
        try {
            web.dispatchTouchEvent(ev);
        } finally {
            ev.recycle();
        }
    }

    // 鼠标悬停：有的网页把菜单藏在「鼠标移上去」里
    private void hover() {
        long now = SystemClock.uptimeMillis();
        MotionEvent.PointerProperties[] pp = new MotionEvent.PointerProperties[]{new MotionEvent.PointerProperties()};
        pp[0].id = 0;
        pp[0].toolType = MotionEvent.TOOL_TYPE_MOUSE;
        MotionEvent.PointerCoords[] pc = new MotionEvent.PointerCoords[]{new MotionEvent.PointerCoords()};
        pc[0].x = cx;
        pc[0].y = cy;
        MotionEvent ev = MotionEvent.obtain(now, now, MotionEvent.ACTION_HOVER_MOVE, 1, pp, pc, 0, 0, 1f, 1f, 0, 0,
                InputDevice.SOURCE_MOUSE, 0);
        try {
            web.dispatchGenericMotionEvent(ev);
        } catch (Exception ignored) {
            // 不支持悬停也没关系
        } finally {
            ev.recycle();
        }
    }

    private int pageStep() {
        return Math.round(web.getHeight() / pageScale * 0.6f);
    }

    // 滚动：光标下面能滚动的框先滚（很多网页的内容在一个能滚动的框里），滚不动再滚整页
    private void scrollPage(int dx, int dy) {
        if (web == null) return;
        int x = Math.round(cx / pageScale), y = Math.round(cy / pageScale);
        String js = "(function(x,y,dx,dy){var e=document.elementFromPoint(x,y);"
                + "while(e&&e!==document.body&&e!==document.documentElement){var s=getComputedStyle(e);"
                + "if((dy&&/(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+2)||"
                + "(dx&&/(auto|scroll)/.test(s.overflowX)&&e.scrollWidth>e.clientWidth+2)){e.scrollBy(dx,dy);return;}"
                + "e=e.parentElement;}window.scrollBy(dx,dy);})(" + x + "," + y + "," + dx + "," + dy + ")";
        web.evaluateJavascript(js, null);
    }

    private void back() {
        if (pressed) release();
        if (web != null && web.canGoBack()) web.goBack();
        else finish();
    }

    private void menu() {
        String[] items = new String[]{
                "放大",
                "缩小",
                "刷新",
                "回到" + (title.length() > 0 ? title : "这个网站") + "首页",
                desktop ? "换成手机版网页" : "换成电脑版网页",
                "回到童动乐园"
        };
        new AlertDialog.Builder(this)
                .setTitle(title.length() > 0 ? title : "网页")
                .setItems(items, (d, which) -> {
                    if (web == null) return;
                    if (which == 0) web.zoomIn();
                    else if (which == 1) web.zoomOut();
                    else if (which == 2) web.reload();
                    else if (which == 3) web.loadUrl(homeUrl);
                    else if (which == 4) {
                        desktop = !desktop;
                        web.getSettings().setUserAgentString(desktop ? DESKTOP_UA : mobileUa);
                        web.reload();
                    } else finish();
                })
                .show();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u.getScheme();
            // 只开网页；应用商店、打电话之类的链接不打开
            if ("http".equals(scheme) || "https".equals(scheme)) return false;
            Toast.makeText(BrowserActivity.this, "这个链接在电视上打不开", Toast.LENGTH_SHORT).show();
            return true;
        }

        @Override
        public void onScaleChanged(WebView view, float oldScale, float newScale) {
            if (newScale > 0) pageScale = newScale;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            bar.setVisibility(View.GONE);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            ViewGroup.LayoutParams lp = bar.getLayoutParams();
            lp.width = Math.round(view.getWidth() * p / 100f);
            bar.setLayoutParams(lp);
        }
    }

    // ---------- 光标 ----------
    private class CursorView extends View {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path arrow = new Path();

        CursorView(Context c) {
            super(c);
            setFocusable(false);
            setClickable(false);
            fill.setColor(0xFFFFC928);
            fill.setStyle(Paint.Style.FILL);
            edge.setColor(0xFF13213C);
            edge.setStyle(Paint.Style.STROKE);
            edge.setStrokeWidth(dp(2.5f));
            edge.setStrokeJoin(Paint.Join.ROUND);
            ring.setColor(0x9913213C);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(dp(4));
            float s = dp(1);
            // 箭头：尖在 (0,0)
            arrow.moveTo(0, 0);
            arrow.lineTo(0, 26 * s);
            arrow.lineTo(7 * s, 20 * s);
            arrow.lineTo(12 * s, 31 * s);
            arrow.lineTo(17 * s, 29 * s);
            arrow.lineTo(12 * s, 18 * s);
            arrow.lineTo(21 * s, 18 * s);
            arrow.close();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            if (pressed) {
                ring.setColor(dragged ? 0xCC3FBF6A : 0x9913213C);
                canvas.drawCircle(cx, cy, dp(16), ring);
            }
            canvas.save();
            canvas.translate(cx, cy);
            canvas.drawPath(arrow, fill);
            canvas.drawPath(arrow, edge);
            canvas.restore();
        }
    }
}
