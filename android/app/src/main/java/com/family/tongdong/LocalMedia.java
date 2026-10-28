package com.family.tongdong;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 电视里自己存的视频（跟着自己的舞蹈视频跳）：
 *   - 应用自己的文件夹 /sdcard/Android/data/com.family.tongdong/files/Movies/（不用任何权限，电脑上 adb push 进来）
 *   - 系统媒体库里的视频（U 盘、下载的视频；要「读取视频」权限）
 * 网页通过 https://appassets.androidplatform.net/media/… 访问：
 *   /media/list        视频列表（JSON）
 *   /media/a/文件名    应用文件夹里的视频
 *   /media/m/编号      媒体库里的视频
 * 视频支持按范围读取（Range），网页的 <video> 可以拖动进度。只读，不改动任何文件。
 */
final class LocalMedia {
    private static final String TAG = "TongdongMedia";
    private static final String[] EXT = {".mp4", ".m4v", ".webm", ".mkv", ".mov", ".3gp", ".ts"};

    private final Context ctx;
    private final Map<String, Long> durations = new HashMap<>();

    LocalMedia(Context ctx) {
        this.ctx = ctx;
    }

    static String permissionName() {
        return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_VIDEO" : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    boolean permitted() {
        return ctx.checkSelfPermission(permissionName()) == PackageManager.PERMISSION_GRANTED;
    }

    File dir() {
        File d = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        //noinspection ResultOfMethodCallIgnored
        if (d != null) d.mkdirs();
        return d;
    }

    WebResourceResponse handle(WebResourceRequest req) {
        String path = req.getUrl().getPath();
        try {
            if ("/media/list".equals(path)) return text("application/json", list());
            if (path != null && path.startsWith("/media/a/")) {
                String name = path.substring("/media/a/".length());
                File d = dir();
                if (d == null || !safeName(name)) return status(404);
                File f = new File(d, name);
                if (!f.isFile()) return status(404);
                return ranged(new FileInputStream(f), f.length(), mimeOf(name), req);
            }
            if (path != null && path.startsWith("/media/m/")) {
                if (!permitted()) return status(403);
                long id = Long.parseLong(path.substring("/media/m/".length()));
                Uri u = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);
                AssetFileDescriptor afd = ctx.getContentResolver().openAssetFileDescriptor(u, "r");
                if (afd == null) return status(404);
                long len = afd.getLength();
                if (len < 0) len = afd.getParcelFileDescriptor().getStatSize();
                String mime = ctx.getContentResolver().getType(u);
                return ranged(afd.createInputStream(), len, mime == null ? "video/mp4" : mime, req);
            }
        } catch (Exception e) {
            Log.w(TAG, "读视频出错 " + path, e);
            return status(500);
        }
        return status(404);
    }

    private static boolean safeName(String n) {
        return n.length() > 0 && n.length() < 240 && !n.contains("/") && !n.contains("\\") && !n.startsWith(".") && isVideo(n);
    }

    private static boolean isVideo(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        for (String e : EXT) if (n.endsWith(e)) return true;
        return false;
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".3gp")) return "video/3gpp";
        if (n.endsWith(".ts")) return "video/mp2t";
        return "video/mp4";
    }

    // ---------- 列表 ----------

    private String list() throws Exception {
        JSONObject out = new JSONObject();
        JSONArray arr = new JSONArray();
        File d = dir();
        out.put("dir", d == null ? "" : d.getAbsolutePath());
        out.put("permitted", permitted());
        out.put("permission", permissionName());
        if (d != null) {
            File[] fs = d.listFiles();
            if (fs != null) {
                Arrays.sort(fs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                for (File f : fs) {
                    if (!f.isFile() || !safeName(f.getName())) continue;
                    JSONObject o = new JSONObject();
                    o.put("id", "a/" + Uri.encode(f.getName()));
                    o.put("name", f.getName());
                    o.put("size", f.length());
                    o.put("dur", durationOf(f));
                    o.put("at", f.lastModified());
                    o.put("src", "app");
                    arr.put(o);
                    if (arr.length() >= 100) break;
                }
            }
        }
        if (permitted()) {
            String[] cols = {
                    MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.DURATION,
                    MediaStore.Video.Media.SIZE, MediaStore.Video.Media.WIDTH, MediaStore.Video.Media.HEIGHT,
                    MediaStore.Video.Media.DATE_MODIFIED
            };
            try (Cursor c = ctx.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cols,
                    null, null, MediaStore.Video.Media.DATE_MODIFIED + " DESC")) {
                int n = 0;
                while (c != null && c.moveToNext() && n < 300) {
                    long dur = c.getLong(2);
                    if (dur > 0 && dur < 5000) continue; // 太短的小片段不算
                    JSONObject o = new JSONObject();
                    o.put("id", "m/" + c.getLong(0));
                    o.put("name", c.getString(1));
                    o.put("dur", dur);
                    o.put("size", c.getLong(3));
                    o.put("w", c.getInt(4));
                    o.put("h", c.getInt(5));
                    o.put("at", c.getLong(6) * 1000);
                    o.put("src", "store");
                    arr.put(o);
                    n++;
                }
            } catch (Exception e) {
                out.put("error", "读媒体库出错：" + e.getMessage());
            }
        }
        out.put("list", arr);
        return out.toString();
    }

    private long durationOf(File f) {
        String key = f.getAbsolutePath() + "|" + f.length() + "|" + f.lastModified();
        synchronized (durations) {
            Long v = durations.get(key);
            if (v != null) return v;
        }
        long ms = 0;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(f.getAbsolutePath());
            String s = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            ms = s == null ? 0 : Long.parseLong(s);
        } catch (Exception ignored) {
            // 读不出时长就当不知道
        } finally {
            try {
                r.release();
            } catch (Exception ignored) {
                // 忽略
            }
        }
        synchronized (durations) {
            durations.put(key, ms);
        }
        return ms;
    }

    // ---------- 按范围读 ----------

    private static WebResourceResponse ranged(InputStream in, long len, String mime, WebResourceRequest req) throws IOException {
        String range = null;
        Map<String, String> rh = req.getRequestHeaders();
        if (rh != null) {
            for (Map.Entry<String, String> e : rh.entrySet()) {
                if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            }
        }
        long start = 0, end = len - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=") && len > 0) {
            String spec = range.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            try {
                if (dash == 0) {
                    start = Math.max(0, len - Long.parseLong(spec.substring(1)));
                } else if (dash > 0) {
                    start = Long.parseLong(spec.substring(0, dash));
                    if (dash < spec.length() - 1) end = Math.min(len - 1, Long.parseLong(spec.substring(dash + 1)));
                }
                partial = true;
            } catch (NumberFormatException ignored) {
                partial = false;
            }
        }
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "no-store");
        h.put("Cross-Origin-Resource-Policy", "same-origin");
        if (len > 0 && start >= len) {
            in.close();
            h.put("Content-Range", "bytes */" + len);
            return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
        }
        long skip = start;
        while (skip > 0) {
            long n = in.skip(skip);
            if (n <= 0) break;
            skip -= n;
        }
        long count = len > 0 ? end - start + 1 : -1;
        if (count >= 0) h.put("Content-Length", String.valueOf(count));
        if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
        InputStream body = count >= 0 ? new Limited(in, count) : in;
        return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
    }

    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long n) {
            super(in);
            left = n;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(Math.min(n, left));
            left -= s;
            return s;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }

    private static WebResourceResponse text(String mime, String s) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Cross-Origin-Resource-Policy", "same-origin");
        return new WebResourceResponse(mime, "utf-8", 200, "OK", h, new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse status(int code) {
        Map<String, String> h = new HashMap<>();
        h.put("Cross-Origin-Resource-Policy", "same-origin");
        String reason = code == 404 ? "Not Found" : (code == 403 ? "Forbidden" : "Error");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, h, new ByteArrayInputStream(new byte[0]));
    }
}
