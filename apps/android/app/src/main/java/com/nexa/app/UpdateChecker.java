package com.nexa.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * 在线更新：局域网优先、公网兜底检查 /api/client-latest，
 * 下载 APK + SHA256 校验，PackageInstaller 引导覆盖安装。
 */
public class UpdateChecker {

    private static final String LOCAL_BASE = "https://192.168.31.73:18790";
    private static final String PUB_BASE = "https://borealos.dev";
    private static final String API = "/api/client-latest";

    private static boolean running = false;
    private static String promptedFor = null;   // 本次运行已提示过的版本
    private static File pendingApk = null;      // 已下载待安装
    private static String pendingVer = null;
    private static long lastCheckAt = 0;        // onResume 节流

    private static void toast(final Activity act, final String msg) {
        act.runOnUiThread(() ->
                android.widget.Toast.makeText(act, msg, android.widget.Toast.LENGTH_LONG).show());
    }

    public static void check(final Activity act) {
        if (running) return;
        if (System.currentTimeMillis() - lastCheckAt < 120000) return;   // 2 分钟内不重复
        lastCheckAt = System.currentTimeMillis();
        running = true;
        new Thread(() -> {
            String stage = "读取版本";
            try {
                String cur = act.getPackageManager()
                        .getPackageInfo(act.getPackageName(), 0).versionName;
                stage = "连接服务器";
                JSONObject j = fetchJson();
                JSONObject and = j.getJSONObject("platforms").getJSONObject(BuildConfig.UPDATE_CHANNEL);
                String ver = and.getString("version");
                if (ver.equals(cur)) { toast(act, "已是最新版本 v" + cur); return; }
                if (ver.equals(promptedFor)) return;
                String rel = and.getString("url");
                String sha = and.optString("sha256", null);
                java.io.File dir = act.getExternalFilesDir(null);
                if (dir == null) throw new Exception("存储目录不可用");
                File apk = new File(dir, "borealos-update.apk");
                stage = "下载更新包";
                toast(act, "开始下载 v" + ver + " 更新包…");
                download(rel, apk);
                stage = "校验更新包";
                if (sha != null && !sha.equalsIgnoreCase(sha256(apk))) {
                    apk.delete();
                    throw new Exception("安装包校验不一致");
                }
                toast(act, "v" + ver + " 下载完成，准备安装");
                pendingApk = apk;
                pendingVer = ver;
                promptedFor = ver;
                act.runOnUiThread(() -> showInstallDialog(act));
            } catch (Throwable t) {
                String m = t.getMessage();
                toast(act, "更新检查失败（" + stage + "）：" + (m == null ? t.getClass().getSimpleName() : m));
            } finally {
                running = false;
            }
        }).start();
    }

    /** 从系统授权页返回后，若已有下载好的包则继续安装流程 */
    public static void onResume(Activity act) {
        if (pendingApk != null && pendingApk.exists() && canInstall(act)) {
            showInstallDialog(act);
        }
    }

    private static void showInstallDialog(final Activity act) {
        if (pendingApk == null || act.isFinishing()) return;
        new AlertDialog.Builder(act)
                .setTitle("发现新版本 v" + pendingVer)
                .setMessage("更新包已下载完成，是否立即安装？\n安装后自动重启应用。")
                .setPositiveButton("立即安装", (d, w) -> {
                    if (!canInstall(act)) {
                        requestInstallPermission(act);
                    } else {
                        install(act, pendingApk);
                    }
                })
                .setNegativeButton("稍后", null)
                .show();
    }

    private static boolean canInstall(Activity act) {
        return act.getPackageManager().canRequestPackageInstalls();
    }

    private static void requestInstallPermission(Activity act) {
        new AlertDialog.Builder(act)
                .setTitle("需要安装权限")
                .setMessage("请允许 Borealos 安装应用，授权后返回即可继续更新。")
                .setPositiveButton("去授权", (d, w) -> {
                    Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + act.getPackageName()));
                    act.startActivity(i);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    /** 安装：优先 MediaStore + 系统安装器（小米/MIUI 兼容性最好），PackageInstaller 兜底 */
    private static void install(Activity act, File apk) {
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            try {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "Borealos-update-v" + pendingVer + ".apk");
                v.put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive");
                android.net.Uri uri = act.getContentResolver().insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri != null) {
                    OutputStream os = act.getContentResolver().openOutputStream(uri);
                    FileInputStream in = new FileInputStream(apk);
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) >= 0) os.write(buf, 0, n);
                    in.close();
                    os.close();
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(i);
                    toast(act, "已调起系统安装器，按提示完成安装后自动使用新版");
                    return;
                }
            } catch (Throwable t) {
                // 落入 PackageInstaller 兜底
            }
        }
        PackageInstaller.Session session = null;
        try {
            PackageInstaller pi = act.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = pi.createSession(params);
            session = pi.openSession(sessionId);
            OutputStream out = session.openWrite("base.apk", 0, apk.length());
            FileInputStream in = new FileInputStream(apk);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            session.fsync(out);
            in.close();
            out.close();
            Intent intent = new Intent(act, MainActivity.class).setAction("borealos.INSTALL_STATUS");
            PendingIntent pi2 = PendingIntent.getActivity(act, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            session.commit(pi2.getIntentSender());
            session.close();
            session = null;
        } catch (Throwable t) {
            if (session != null) try { session.abandon(); } catch (Throwable ignored) {}
            new AlertDialog.Builder(act)
                    .setTitle("自动安装失败")
                    .setMessage("系统拒绝了安装（" + t.getClass().getSimpleName() + "）。\n可到官网下载页手动下载新版 APK 覆盖安装，本次更新不受影响。")
                    .setPositiveButton("知道了", null)
                    .show();
        }
    }

    // ---- 网络 ----

    private static JSONObject fetchJson() throws Exception {
        try {
            return new JSONObject(get(LOCAL_BASE + API, true, 4000));
        } catch (Throwable t) {
            return new JSONObject(get(PUB_BASE + API, false, 10000));
        }
    }

    private static void download(String rel, File out) throws Exception {
        try {
            downloadFrom(LOCAL_BASE + rel, true, out);
        } catch (Throwable t) {
            downloadFrom(PUB_BASE + rel, false, out);
        }
    }

    private static String get(String url, boolean trustAll, int timeoutMs) throws Exception {
        HttpURLConnection c = open(url, trustAll, timeoutMs);
        try {
            InputStream in = c.getInputStream();
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) sb.append(new String(buf, 0, n, "UTF-8"));
            in.close();
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }

    private static void downloadFrom(String url, boolean trustAll, File out) throws Exception {
        HttpURLConnection c = open(url, trustAll, 15000);
        c.setReadTimeout(60000);
        try {
            InputStream in = c.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) >= 0) fos.write(buf, 0, n);
            fos.flush();
            fos.close();
            in.close();
        } finally {
            c.disconnect();
        }
    }

    private static HttpURLConnection open(String url, boolean trustAll, int timeoutMs) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (trustAll && c instanceof HttpsURLConnection) {
            // 仅用于局域网自签证书直连；公网走系统默认校验
            HttpsURLConnection hc = (HttpsURLConnection) c;
            TrustManager[] tms = new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] x, String a) {}
                public void checkServerTrusted(X509Certificate[] x, String a) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, tms, new SecureRandom());
            hc.setSSLSocketFactory(sc.getSocketFactory());
            hc.setHostnameVerifier((h, s) -> true);
        }
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(timeoutMs);
        return c;
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) >= 0) md.update(buf, 0, n);
        in.close();
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
