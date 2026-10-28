package com.family.tongdong;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 视频库里B站视频的标题、时长、封面：网页请求 https://appassets.androidplatform.net/bili/…，这里代为联网取。
 *   /bili/view/BV号     视频信息（精简过的 JSON：标题、时长、UP 主、分集），存在本机，3 天内不重复取
 *   /bili/cover/BV号    封面小图（JPEG），存在缓存目录
 *   /bili/resolve/短码  b23.tv 短链接 → BV 号
 * 网页直接请求B站会被跨源隔离挡住（网页开了 COEP），所以从安卓这边绕一下。
 * 只取这几个固定地址，参数都先检查过格式。
 */
final class BiliApi {
    private static final String TAG = "TongdongBili";
    static final Pattern BV = Pattern.compile("BV[0-9A-Za-z]{10}");
    private static final long FRESH_MS = 3L * 24 * 3600 * 1000;
    private static final long GONE_MS = 24L * 3600 * 1000;

    private final File viewDir;
    private final File coverDir;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);

    BiliApi(Context ctx) {
        viewDir = new File(ctx.getFilesDir(), "bili");
        coverDir = new File(ctx.getCacheDir(), "bili-cover");
        //noinspection ResultOfMethodCallIgnored
        viewDir.mkdirs();
        //noinspection ResultOfMethodCallIgnored
        coverDir.mkdirs();
    }

    /** path 形如 /bili/view/BV1xx411c7mD */
    WebResourceResponse handle(String path) {
        String[] parts = path == null ? new String[0] : path.split("/");
        if (parts.length != 4) return empty(404);
        final String kind = parts[2], arg = parts[3];
        if ("view".equals(kind) && BV.matcher(arg).matches()) return json(() -> view(arg));
        if ("cover".equals(kind) && BV.matcher(arg).matches()) return image(() -> cover(arg));
        if ("resolve".equals(kind) && arg.matches("[0-9A-Za-z]{4,16}")) return json(() -> resolve(arg));
        return empty(404);
    }

    void shutdown() {
        pool.shutdownNow();
    }

    // ---------- 视频信息 ----------

    private byte[] view(String bv) {
        File f = new File(viewDir, bv + ".json");
        String cached = readText(f);
        long age = System.currentTimeMillis() - f.lastModified();
        if (cached != null) {
            int code = parse(cached).optInt("code", -1);
            if ((code == 0 && age < FRESH_MS) || (gone(code) && age < GONE_MS)) return utf8(cached);
        }
        try {
            String body = new String(get("https://api.bilibili.com/x/web-interface/view?bvid=" + bv, 1 << 20), StandardCharsets.UTF_8);
            JSONObject raw = new JSONObject(body);
            int code = raw.optInt("code", -1);
            String out = slim(raw).toString();
            if (code == 0 || gone(code)) writeText(f, out);
            else if (cached != null) return utf8(cached); // 被限流之类：先用旧的
            return utf8(out);
        } catch (Exception e) {
            Log.w(TAG, "取视频信息失败 " + bv + "：" + e);
            if (cached != null) return utf8(cached);
            return utf8("{\"code\":-1,\"message\":" + JSONObject.quote("联网失败：" + e.getMessage()) + "}");
        }
    }

    /** 视频确实没了（删了、看不了），这种结果也存一天，别反复去问 */
    private static boolean gone(int code) {
        return code == -404 || code == 62002 || code == 62004 || code == 62012;
    }

    static JSONObject slim(JSONObject raw) throws JSONException {
        JSONObject out = new JSONObject();
        out.put("code", raw.optInt("code", -1));
        out.put("message", raw.optString("message", ""));
        JSONObject d = raw.optJSONObject("data");
        if (d != null) {
            JSONObject o = new JSONObject();
            o.put("bvid", d.optString("bvid"));
            o.put("aid", d.optLong("aid"));
            o.put("title", d.optString("title"));
            o.put("pic", d.optString("pic"));
            o.put("duration", d.optInt("duration"));
            JSONObject owner = d.optJSONObject("owner");
            if (owner != null) o.put("owner", owner.optString("name"));
            JSONObject stat = d.optJSONObject("stat");
            if (stat != null) o.put("view", stat.optLong("view"));
            JSONObject dim = d.optJSONObject("dimension");
            if (dim != null) {
                o.put("w", dim.optInt("width"));
                o.put("h", dim.optInt("height"));
                o.put("rotate", dim.optInt("rotate"));
            }
            String desc = d.optString("desc", "");
            o.put("desc", desc.length() > 200 ? desc.substring(0, 200) : desc);
            JSONArray pages = d.optJSONArray("pages");
            JSONArray ps = new JSONArray();
            if (pages != null) {
                for (int i = 0; i < pages.length() && i < 60; i++) {
                    JSONObject p = pages.optJSONObject(i);
                    if (p == null) continue;
                    JSONObject q = new JSONObject();
                    q.put("cid", p.optLong("cid"));
                    q.put("page", p.optInt("page", i + 1));
                    q.put("part", p.optString("part"));
                    q.put("duration", p.optInt("duration"));
                    ps.put(q);
                }
            }
            o.put("pages", ps);
            out.put("data", o);
        }
        out.put("at", System.currentTimeMillis());
        return out;
    }

    // ---------- 封面 ----------

    private byte[] cover(String bv) throws Exception {
        File f = new File(coverDir, bv + ".jpg");
        if (f.length() > 0) return readBytes(f);
        JSONObject d = parse(new String(view(bv), StandardCharsets.UTF_8)).optJSONObject("data");
        String pic = d == null ? "" : d.optString("pic", "");
        if (pic.startsWith("//")) pic = "https:" + pic;
        if (pic.startsWith("http://")) pic = "https://" + pic.substring(7);
        Uri u = Uri.parse(pic);
        String host = u.getHost();
        if (!"https".equals(u.getScheme()) || host == null || !(host.endsWith(".hdslb.com") || host.endsWith(".biliimg.com"))) {
            return new byte[0];
        }
        byte[] img;
        try {
            // B站图片服务：后缀里写尺寸，直接给小图
            img = get(pic + "@336w_189h_1c.jpg", 2 << 20);
        } catch (Exception e) {
            img = get(pic, 6 << 20);
        }
        writeBytes(f, img);
        return img;
    }

    // ---------- b23.tv 短链接 ----------

    private byte[] resolve(String code) {
        JSONObject o = new JSONObject();
        HttpURLConnection c = null;
        try {
            c = open("https://b23.tv/" + code);
            c.setInstanceFollowRedirects(false);
            c.getResponseCode();
            String loc = c.getHeaderField("Location");
            Matcher m = BV.matcher(loc == null ? "" : loc);
            if (m.find()) {
                o.put("bv", m.group());
                try {
                    String p = Uri.parse(loc).getQueryParameter("p");
                    if (p != null) o.put("p", Integer.parseInt(p));
                } catch (Exception ignored) {
                    // 没有分集参数
                }
            } else {
                o.put("error", "这个短链接打开的不是视频");
            }
        } catch (Exception e) {
            try {
                o.put("error", "联网失败：" + e.getMessage());
            } catch (JSONException ignored) {
                // 忽略
            }
        } finally {
            if (c != null) c.disconnect();
        }
        return utf8(o.toString());
    }

    // ---------- 联网 ----------

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(9000);
        c.setRequestProperty("User-Agent", VideoPanel.DESKTOP_UA);
        c.setRequestProperty("Referer", "https://www.bilibili.com/");
        c.setRequestProperty("Accept", "application/json, text/plain, */*");
        try {
            String ck = CookieManager.getInstance().getCookie("https://www.bilibili.com");
            if (ck != null && !ck.isEmpty()) c.setRequestProperty("Cookie", ck);
        } catch (Throwable ignored) {
            // 没有 cookie 也能取
        }
        return c;
    }

    private static byte[] get(String url, int max) throws IOException {
        HttpURLConnection c = open(url);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] b = new byte[16384];
                int n, total = 0;
                while ((n = in.read(b)) > 0) {
                    total += n;
                    if (total > max) throw new IOException("太大了");
                    out.write(b, 0, n);
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    // ---------- 返回给网页 ----------

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        // 网页版（别的域名）在电视 APK 里打开时也能用
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cross-Origin-Resource-Policy", "cross-origin");
        return h;
    }

    private WebResourceResponse json(Callable<byte[]> task) {
        Map<String, String> h = headers();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json", "utf-8", 200, "OK", h, lazy(task));
    }

    private WebResourceResponse image(Callable<byte[]> task) {
        Map<String, String> h = headers();
        h.put("Cache-Control", "max-age=604800");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", h, lazy(task));
    }

    private static WebResourceResponse empty(int code) {
        return new WebResourceResponse("text/plain", "utf-8", code, code == 404 ? "Not Found" : "Error", headers(),
                new ByteArrayInputStream(new byte[0]));
    }

    /** 网页内核读响应内容时才等联网结果（不卡住拦截请求的线程） */
    private InputStream lazy(Callable<byte[]> task) {
        final Future<byte[]> f = pool.submit(task);
        return new InputStream() {
            private byte[] buf;
            private int pos;

            private void fill() {
                if (buf != null) return;
                try {
                    buf = f.get(20, TimeUnit.SECONDS);
                } catch (Exception e) {
                    buf = null;
                }
                if (buf == null) buf = new byte[0];
            }

            @Override
            public int read() {
                fill();
                return pos < buf.length ? (buf[pos++] & 0xff) : -1;
            }

            @Override
            public int read(byte[] dst, int off, int len) {
                fill();
                if (pos >= buf.length) return -1;
                int n = Math.min(len, buf.length - pos);
                System.arraycopy(buf, pos, dst, off, n);
                pos += n;
                return n;
            }

            @Override
            public int available() {
                return buf == null ? 0 : buf.length - pos;
            }
        };
    }

    // ---------- 文件 ----------

    private static JSONObject parse(String s) {
        try {
            return new JSONObject(s == null ? "{}" : s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static String readText(File f) {
        if (!f.isFile()) return null;
        try {
            return new String(readBytes(f), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    private static byte[] readBytes(File f) throws IOException {
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toByteArray();
        }
    }

    private static void writeText(File f, String s) {
        writeBytes(f, utf8(s));
    }

    private static void writeBytes(File f, byte[] b) {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(b);
        } catch (IOException e) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(f);
    }
}
