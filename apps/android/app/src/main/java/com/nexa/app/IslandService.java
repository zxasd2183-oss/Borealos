package com.nexa.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Borealos 灵动岛前台服务（v5.1.6）：
 * - 原生常驻通知 + 小米澎湃焦点通知官方配方（miui.focus.param param_v2：protocol/business/updatable/
 *   ticker/aodTitle/baseInfo/param_island + miui.focus.pics Icon 包），渠道 IMPORTANCE_HIGH 但静默；
 * - 多源轮询：eng 工程任务 + 表情包 + 真动画 + 视频生成 + 参考视频（v5.1.5 只看 eng 一路，其他任务永远不上岛）；
 * - 页面即时桥：WebView 内 islTask* 钩子经 NexaIsland JS 接口直推，任务开始/进度/完成零延迟上岛；
 * - 自适应轮询防发热：有进行中任务 4s、空闲 45s、断线 60s 指数退避至 120s；
 *   熄屏（ACTION_SCREEN_OFF）暂停轮询，亮屏立即补一次；不持 WakeLock。
 * 纯原生 + org.json + HttpURLConnection，零第三方依赖。
 */
public class IslandService extends Service {

    private static final String BASE = "https://borealos.dev";
    private static final String CH_ISLAND = "borealos_island_v2"; // 换 id：旧 DEFAULT 渠道缓存在系统里，HIGH 需新渠道
    private static final int NOTIFY_ID = 1;

    private static final long POLL_ACTIVE_MS = 4_000L;    // 有进行中任务（页面桥+多源，活跃期加密到 4s）
    private static final long POLL_IDLE_MS = 45_000L;     // 空闲
    private static final long POLL_OFFLINE_MIN_MS = 60_000L;  // 断线退避起点
    private static final long POLL_OFFLINE_MAX_MS = 120_000L; // 断线退避上限

    private Handler handler;
    private ExecutorService io;
    private BroadcastReceiver screenReceiver;

    // 状态（主线程读写）
    private boolean loggedIn = true;
    private boolean reachable = true;
    private boolean screenOn = true;
    private long offlineDelayMs = POLL_OFFLINE_MIN_MS;
    private int lastActive = 0;
    private final List<TaskItem> tasks = new ArrayList<>();

    // 页面即时桥推来的任务（id -> 任务），30 分钟兜底过期防残留
    private static volatile IslandService sInstance;
    private static final long PAGE_TASK_TTL_MS = 30 * 60_000L;
    private final Map<String, TaskItem> pageTasks = new LinkedHashMap<>();

    private static final class TaskItem {
        String text;
        String status;
        int pct = -1;  // -1 = 不确定进度
        long ts;       // 页面桥任务最后更新时间（过期清理用）
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            poll(); // 结果回调里统一 scheduleNext()
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        io = Executors.newSingleThreadExecutor();
        ensureChannel();
        startFg(buildNotification());
        registerScreenReceiver();
        sInstance = this;
        handler.post(pollRunnable);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel();
        startFg(buildNotification());
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }
        if (screenReceiver != null) {
            try {
                unregisterReceiver(screenReceiver); // 与 onCreate 动态注册配对
            } catch (Throwable ignored) {
            }
            screenReceiver = null;
        }
        if (io != null) {
            io.shutdownNow();
        }
        sInstance = null;
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    // ---------- 熄屏暂停 / 亮屏补一轮 ----------

    private void registerScreenReceiver() {
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String a = intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(a)) {
                    screenOn = false;
                    handler.removeCallbacks(pollRunnable); // 熄屏暂停轮询
                } else if (Intent.ACTION_SCREEN_ON.equals(a)) {
                    screenOn = true;
                    handler.removeCallbacks(pollRunnable);
                    handler.post(pollRunnable); // 亮屏立即补一次
                }
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenReceiver, f);
        }
    }

    // ---------- 自适应调度 ----------

    private int pageActiveCount() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, TaskItem>> it = pageTasks.entrySet().iterator();
        while (it.hasNext()) {
            if (now - it.next().getValue().ts > PAGE_TASK_TTL_MS) {
                it.remove(); // 页面崩溃/关闭没发完成事件时的兜底清理
            }
        }
        return pageTasks.size();
    }

    private long nextDelayMs() {
        if (!reachable) {
            return offlineDelayMs;
        }
        return (lastActive > 0 || pageActiveCount() > 0) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    }

    private void scheduleNext() {
        handler.removeCallbacks(pollRunnable);
        if (screenOn) {
            handler.postDelayed(pollRunnable, nextDelayMs());
        }
    }

    // ---------- 前台服务 + 常驻通知（澎湃焦点通知配方） ----------

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            // 高重要级但完全静默：澎湃对高重要级 + ongoing + 带进度通知更容易收为焦点通知
            NotificationChannel ch = new NotificationChannel(CH_ISLAND, "Borealos 任务状态",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(null, null);
            ch.setVibrationPattern(null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            ch.setDescription("工程任务进度常驻通知（澎湃 OS 收为焦点通知）");
            nm.createNotificationChannel(ch);
        }
    }

    private void startFg(Notification n) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFY_ID, n);
        }
    }

    private int smallIcon() {
        int id = getResources().getIdentifier("ic_stat_notify", "drawable", getPackageName());
        return id != 0 ? id : getApplicationInfo().icon;
    }

    private Notification buildNotification() {
        return buildNotification(false);
    }

    // floatPop=true：本次更新允许焦点通知展开弹出（任务开始/完成的关键时刻），平时静默刷新
    private Notification buildNotification(boolean floatPop) {
        List<TaskItem> all = new ArrayList<>(tasks);
        pageActiveCount(); // 顺带清过期页面任务
        all.addAll(pageTasks.values());
        int active = 0, done = 0;
        for (TaskItem t : all) {
            if ("running".equals(t.status) || "pending".equals(t.status)) {
                active++;
            } else if ("done".equals(t.status)) {
                done++;
            }
        }
        int total = all.size();

        String title;
        String text;
        boolean showProgress = false;
        if (!loggedIn) {
            title = "Borealos 未登录";
            text = "点按打开并登录";
        } else if (!reachable) {
            title = "Borealos 网关离线";
            text = "连接中，自动重试…";
        } else if (active > 0) {
            title = active + " 个任务进行中";
            String first = "";
            for (TaskItem t : all) {
                if ("running".equals(t.status) || "pending".equals(t.status)) {
                    first = t.text == null ? "" : t.text;
                    if (t.pct >= 0) {
                        first += " " + t.pct + "%";
                    }
                    break;
                }
            }
            text = "进度 " + done + "/" + total + (first.isEmpty() ? "" : " · " + first);
            showProgress = true;
        } else {
            title = "Borealos 在线";
            text = total > 0 ? ("任务全部完成 " + done + "/" + total) : "无进行中任务";
        }

        PendingIntent openApp = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent siteIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(BASE));
        PendingIntent openSite = PendingIntent.getActivity(this, 1, siteIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CH_ISLAND)
                : new Notification.Builder(this);
        b.setSmallIcon(smallIcon())
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp)
                .addAction(new Notification.Action.Builder(null, "打开主站", openSite).build());
        if (showProgress) {
            b.setProgress(Math.max(total, 1), done, false);
            b.setCategory(Notification.CATEGORY_PROGRESS);
        } else {
            b.setCategory(Notification.CATEGORY_STATUS);
        }

        // 小米澎湃焦点通知官方配方（dev.mi.com HyperOS 开发指南）：
        // extras["miui.focus.param"] = param_v2 JSON；自定义图片走 extras["miui.focus.pics"] Icon 包
        try {
            Bundle carrier = new Bundle();
            Bundle pics = new Bundle();
            pics.putParcelable("miui.focus.pic_icon", Icon.createWithResource(this, smallIcon()));
            carrier.putBundle("miui.focus.pics", pics);
            b.addExtras(carrier);

            JSONObject textInfo = new JSONObject();
            textInfo.put("frontTitle", "Borealos");
            textInfo.put("title", title);
            textInfo.put("content", text);
            textInfo.put("useHighLight", false);
            JSONObject leftPic = new JSONObject();
            leftPic.put("type", 1);
            leftPic.put("pic", "miui.focus.pic_icon");
            JSONObject imageTextLeft = new JSONObject();
            imageTextLeft.put("type", 1);
            imageTextLeft.put("picInfo", leftPic);
            imageTextLeft.put("textInfo", textInfo);
            JSONObject bigIsland = new JSONObject();
            bigIsland.put("imageTextInfoLeft", imageTextLeft);
            JSONObject smallPic = new JSONObject();
            smallPic.put("type", 1);
            smallPic.put("pic", "miui.focus.pic_icon");
            JSONObject smallIsland = new JSONObject();
            smallIsland.put("picInfo", smallPic);
            JSONObject paramIsland = new JSONObject();
            paramIsland.put("islandProperty", 1);
            paramIsland.put("bigIslandArea", bigIsland);
            paramIsland.put("smallIslandArea", smallIsland);

            JSONObject baseInfo = new JSONObject();
            baseInfo.put("title", title);
            baseInfo.put("content", text);
            baseInfo.put("type", 1);

            JSONObject v2 = new JSONObject();
            v2.put("protocol", 1);
            v2.put("business", "task_progress");
            v2.put("updatable", true);          // 持续性通知，轮询更新同一 id
            v2.put("enableFloat", floatPop);    // 关键时刻（开始/完成）弹出，平时静默更新
            v2.put("islandFirstFloat", floatPop);
            v2.put("ticker", title);            // OS2 状态栏焦点文案
            v2.put("aodTitle", title);          // 息屏焦点文案
            v2.put("baseInfo", baseInfo);       // 焦点通知数据
            v2.put("param_island", paramIsland); // OS3 超级岛数据
            JSONObject root = new JSONObject();
            root.put("param_v2", v2);

            b.addExtras(buildFocusBundle(root.toString()));
        } catch (Throwable ignored) {
        }
        return b.build();
    }

    private static Bundle buildFocusBundle(String paramJson) {
        Bundle extra = new Bundle();
        extra.putString("miui.focus.param", paramJson);
        return extra;
    }

    // ---------- 轮询 ----------

    private void poll() {
        io.execute(new Runnable() {
            @Override
            public void run() {
                final String cookie = readAuthCookie();
                if (cookie == null) {
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            loggedIn = false;
                            reachable = true; // 未登录≠断线，按空闲节奏
                            lastActive = 0;
                            updateNotification();
                            scheduleNext();
                        }
                    });
                    return;
                }
                try {
                    final List<TaskItem> newTasks = new ArrayList<>();
                    int okCount = 0;
                    // 多源合并：eng 工程任务 + 表情包 + 真动画 + 视频生成 + 参考视频（单源失败不影响其他源）
                    try {
                        newTasks.addAll(parseTasks(httpGet(BASE + "/api/eng/tasks", cookie, 8000, 12000)));
                        okCount++;
                    } catch (Throwable ignored) {
                    }
                    try {
                        newTasks.addAll(parseCountTasks(httpGet(BASE + "/api/sticker/list", cookie, 8000, 12000),
                                "jobs", "🐹 表情包"));
                        okCount++;
                    } catch (Throwable ignored) {
                    }
                    try {
                        newTasks.addAll(parseCountTasks(httpGet(BASE + "/api/anim/list", cookie, 8000, 12000),
                                "batches", "🎞 真动画"));
                        okCount++;
                    } catch (Throwable ignored) {
                    }
                    try {
                        newTasks.addAll(parseVideoTasks(httpGet(BASE + "/api/video/tasks", cookie, 8000, 12000)));
                        okCount++;
                    } catch (Throwable ignored) {
                    }
                    try {
                        newTasks.addAll(parseRefvidTasks(httpGet(BASE + "/api/refvid/list", cookie, 8000, 12000)));
                        okCount++;
                    } catch (Throwable ignored) {
                    }
                    if (okCount == 0) {
                        throw new Exception("all sources unreachable");
                    }
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            loggedIn = true;
                            reachable = true;
                            offlineDelayMs = POLL_OFFLINE_MIN_MS; // 恢复后重置退避
                            tasks.clear();
                            tasks.addAll(newTasks);
                            int a = 0;
                            for (TaskItem t : tasks) {
                                if ("running".equals(t.status) || "pending".equals(t.status)) {
                                    a++;
                                }
                            }
                            int prev = lastActive;
                            lastActive = a;
                            // 关键时刻弹一下：新任务出现（0→N）或全部完成（N→0）
                            boolean pop = (prev == 0 && a > 0) || (prev > 0 && a == 0);
                            updateNotification(pop);
                            scheduleNext();
                        }
                    });
                } catch (Throwable e) {
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            reachable = false;
                            offlineDelayMs = Math.min(offlineDelayMs * 2, POLL_OFFLINE_MAX_MS); // 指数退避
                            updateNotification();
                            scheduleNext();
                        }
                    });
                }
            }
        });
    }

    private void updateNotification() {
        updateNotification(false);
    }

    private void updateNotification(boolean floatPop) {
        Notification n = buildNotification(floatPop);
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTIFY_ID, n); // 同一 id 更新常驻通知（标题/文本/进度）
        } catch (Throwable ignored) {
        }
    }

    // ---------- 解析 ----------

    private static List<TaskItem> parseTasks(String body) throws Exception {
        List<TaskItem> out = new ArrayList<>();
        JSONObject o = new JSONObject(body);
        JSONArray arr = o.optJSONArray("tasks");
        if (arr == null) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject t = arr.optJSONObject(i);
            if (t == null) {
                continue;
            }
            TaskItem item = new TaskItem();
            item.text = t.optString("text", "");
            item.status = t.optString("status", "");
            out.add(item);
        }
        return out;
    }

    // 表情包/真动画：只取 running，文本带 done/total
    private static List<TaskItem> parseCountTasks(String body, String arrayKey, String label) throws Exception {
        List<TaskItem> out = new ArrayList<>();
        JSONArray arr = new JSONObject(body).optJSONArray(arrayKey);
        if (arr == null) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject j = arr.optJSONObject(i);
            if (j == null || !"running".equals(j.optString("status"))) {
                continue;
            }
            int done = j.optInt("done", 0);
            int total = j.optInt("total", 0);
            TaskItem t = new TaskItem();
            t.status = "running";
            t.text = label + (total > 0 ? " " + done + "/" + total : "");
            t.ts = System.currentTimeMillis();
            out.add(t);
        }
        return out;
    }

    // 视频生成（模板/电商共用任务池）：running/pending 上岛，进度=服务端 progress
    private static List<TaskItem> parseVideoTasks(String body) throws Exception {
        List<TaskItem> out = new ArrayList<>();
        JSONArray arr = new JSONObject(body).optJSONArray("tasks");
        if (arr == null) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject j = arr.optJSONObject(i);
            if (j == null) {
                continue;
            }
            String st = j.optString("status");
            if (!"running".equals(st) && !"pending".equals(st)) {
                continue;
            }
            TaskItem t = new TaskItem();
            t.status = "running";
            t.text = "🎬 视频生成";
            t.pct = j.has("progress") ? j.optInt("progress", -1) : -1;
            t.ts = System.currentTimeMillis();
            out.add(t);
        }
        return out;
    }

    // 参考视频制作：step=running 上岛
    private static List<TaskItem> parseRefvidTasks(String body) throws Exception {
        List<TaskItem> out = new ArrayList<>();
        JSONArray arr = new JSONObject(body).optJSONArray("jobs");
        if (arr == null) {
            return out;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject j = arr.optJSONObject(i);
            if (j == null || !"running".equals(j.optString("step"))) {
                continue;
            }
            TaskItem t = new TaskItem();
            t.status = "running";
            t.text = "🎥 参考视频";
            t.ts = System.currentTimeMillis();
            out.add(t);
        }
        return out;
    }

    // ---------- 页面即时桥（NexaIsland JS 接口） ----------

    static void onPageEvent(final String action, final String id, final String a, final String b) {
        final IslandService svc = sInstance;
        if (svc == null || svc.handler == null || id == null || id.isEmpty()) {
            return; // 服务未起时静默丢弃，多源轮询 4s/45s 兜底
        }
        svc.handler.post(new Runnable() {
            @Override
            public void run() {
                svc.applyPageEvent(action, id, a, b);
            }
        });
    }

    private void applyPageEvent(String action, String id, String a, String b) {
        if ("start".equals(action)) {
            TaskItem t = new TaskItem();
            t.status = "running";
            t.text = (a == null || a.isEmpty() ? "" : a + " ") + (b == null ? "" : b);
            t.pct = -1;
            t.ts = System.currentTimeMillis();
            pageTasks.put(id, t);
        } else if ("progress".equals(action)) {
            TaskItem t = pageTasks.get(id);
            if (t != null) {
                try {
                    t.pct = Integer.parseInt(a);
                } catch (Throwable ignored) {
                }
                if (b != null && !b.isEmpty()) {
                    String prefix = "";
                    if (t.text != null && t.text.contains(" ")) {
                        prefix = t.text.substring(0, t.text.indexOf(" ") + 1); // 保留 emoji 前缀
                    }
                    t.text = prefix + b;
                }
                t.ts = System.currentTimeMillis();
            }
        } else { // done / drop：移除（完成闪光播报由页内岛负责，原生侧撤下并弹一次完成态）
            pageTasks.remove(id);
            updateNotification(pageTasks.isEmpty()); // 最后一件完成→弹出「任务全部完成」
            scheduleNext();
            return;
        }
        updateNotification("start".equals(action)); // 任务开始→立即弹出上岛
        scheduleNext(); // 立即进入 4s 活跃节奏（或回落空闲节奏）
    }

    // ---------- 网络 ----------

    private static String readAuthCookie() {
        try {
            String all = CookieManager.getInstance().getCookie(BASE);
            if (all == null) {
                return null;
            }
            for (String part : all.split(";")) {
                String p = part.trim();
                if (p.startsWith("nexa_auth=")) {
                    return p;
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static volatile SSLSocketFactory trustAllFactory;

    // 内测专用：服务端可能为自签证书，与 WebView onReceivedSslError 放行行为保持一致。
    private static SSLSocketFactory trustAllSsl() throws Exception {
        if (trustAllFactory == null) {
            TrustManager[] tm = new TrustManager[]{new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            }};
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, tm, new SecureRandom());
            trustAllFactory = sc.getSocketFactory();
        }
        return trustAllFactory;
    }

    private static String httpGet(String u, String cookie, int ct, int rt) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        if (c instanceof HttpsURLConnection) {
            HttpsURLConnection h = (HttpsURLConnection) c;
            h.setSSLSocketFactory(trustAllSsl());
            h.setHostnameVerifier(new HostnameVerifier() {
                @Override
                public boolean verify(String host, SSLSession session) {
                    return true;
                }
            });
        }
        c.setConnectTimeout(ct);
        c.setReadTimeout(rt);
        c.setRequestProperty("Accept", "application/json");
        if (cookie != null) {
            c.setRequestProperty("Cookie", cookie);
        }
        int code = c.getResponseCode();
        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = readAll(is);
        c.disconnect();
        if (code != 200) {
            throw new Exception("HTTP " + code);
        }
        return body;
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) {
            return "";
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        is.close();
        return bos.toString("UTF-8");
    }
}
