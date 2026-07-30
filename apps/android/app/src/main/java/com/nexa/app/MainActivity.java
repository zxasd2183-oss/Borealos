package com.nexa.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {

    private static final String HOME_URL = "https://borealos.dev/";
    private static final int REQ_FILE_CHOOSER = 1002;

    private FrameLayout root;
    private WebView webView;
    private TextView errorView;
    private ValueCallback<Uri[]> filePathCallback;
    private volatile boolean feedbackForeground;

    private boolean isTrustedBorealosUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            int port = uri.getPort();
            if ("https".equalsIgnoreCase(scheme) && "borealos.dev".equalsIgnoreCase(host) && (port == -1 || port == 443)) return true;
            return BuildConfig.DEBUG && "http".equalsIgnoreCase(scheme)
                    && port == 18790 && ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host) || "10.0.2.2".equals(host));
        } catch (Throwable ignored) {
            return false;
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        root = new FrameLayout(this);
        webView = new WebView(this);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // 平板/大屏适配：按 CSS 像素排版，1K~4K 各 dpi 下布局一致
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        // UA 追加终端标记，网页端可识别手机/平板做布局
        String uaMark = "android-tablet".equals(BuildConfig.UPDATE_CHANNEL) ? "Pad" : "Phone";
        s.setUserAgentString(s.getUserAgentString() + " Borealos/5.1.8 " + uaMark);

        // 灵动岛即时桥：页面 islTask* 钩子 → IslandService（window.NexaIsland）
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void taskStart(String id, String icon, String name) {
                IslandService.onPageEvent("start", id, icon, name);
            }

            @android.webkit.JavascriptInterface
            public void taskProgress(String id, String pct, String name) {
                IslandService.onPageEvent("progress", id, pct, name);
            }

            @android.webkit.JavascriptInterface
            public void taskDone(String id, String text, String ok) {
                IslandService.onPageEvent("done", id, text, ok);
            }

            @android.webkit.JavascriptInterface
            public void taskDrop(String id, String unused1, String unused2) {
                IslandService.onPageEvent("drop", id, unused1, unused2);
            }
        }, "NexaIsland");

        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public String captureCurrentActivity() {
                final String[] result = {""};
                final CountDownLatch done = new CountDownLatch(1);
                runOnUiThread(() -> {
                    try {
                        if (!feedbackForeground || !isTrustedBorealosUrl(webView.getUrl())
                                || (getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0) return;
                        int width = webView.getWidth();
                        int height = webView.getHeight();
                        if (width <= 0 || height <= 0) throw new IllegalStateException("WebView is not visible");
                        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                        webView.draw(new Canvas(bitmap));
                        ByteArrayOutputStream output = new ByteArrayOutputStream();
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
                        bitmap.recycle();
                        byte[] bytes = output.toByteArray();
                        if (bytes.length <= 0 || bytes.length > 8 * 1024 * 1024) throw new IllegalStateException("Capture size is invalid");
                        JSONObject payload = new JSONObject();
                        payload.put("mime", "image/png");
                        payload.put("size", bytes.length);
                        payload.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        result[0] = payload.toString();
                    } catch (Throwable ignored) {
                        result[0] = "";
                    } finally {
                        done.countDown();
                    }
                });
                try {
                    if (!done.await(8, TimeUnit.SECONDS)) return "";
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return "";
                }
                return result[0];
            }
        }, "BorealosFeedbackBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isTrustedBorealosUrl(request.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!isTrustedBorealosUrl(url)) {
                    view.stopLoading();
                    showError();
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                if (BuildConfig.DEBUG && isTrustedBorealosUrl(error.getUrl())) handler.proceed();
                else handler.cancel();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError();
                }
            }
        });

        // 文件选择支持：网页 <input type="file"> 走系统文件选择器
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // 已存在未完成回调时先以 null 结束旧回调，避免 WebView 永久卡死
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                filePathCallback = callback;

                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    String[] accept = params.getAcceptTypes();
                    if (accept != null && accept.length > 0 && !TextUtils.isEmpty(accept[0])) {
                        i.putExtra(Intent.EXTRA_MIME_TYPES, accept);
                    }
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                } catch (Throwable ignored) {
                }
                try {
                    startActivityForResult(Intent.createChooser(i, "选择文件"), REQ_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "未找到文件管理器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        // 下载支持：http(s) 走系统 DownloadManager 到公共 Download 目录
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                try {
                    String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    r.setMimeType(mimetype);
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) {
                        r.addRequestHeader("Cookie", cookie);
                    }
                    if (userAgent != null) {
                        r.addRequestHeader("User-Agent", userAgent);
                    }
                    r.setTitle(name);
                    r.setDescription("Borealos 下载");
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(r);
                        Toast.makeText(this, "开始下载：" + name, Toast.LENGTH_SHORT).show();
                    }
                } catch (Throwable t) {
                    Toast.makeText(this, "下载失败：" + t.getMessage(), Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(this, "此文件请长按后保存", Toast.LENGTH_SHORT).show();
            }
        });

        // 原生「连接失败，点按重试」界面
        errorView = new TextView(this);
        errorView.setText("连接失败\n\n点按重试");
        errorView.setTextColor(Color.WHITE);
        errorView.setTextSize(20f);
        errorView.setGravity(android.view.Gravity.CENTER);
        errorView.setBackgroundColor(Color.rgb(11, 11, 18));
        errorView.setVisibility(View.GONE);
        errorView.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            webView.reload();
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME_URL);
        }

        // 灵动岛：通知权限（Android 13+）检查，已授权则启动前台服务
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
        showFocusGuideOnce();

        // 在线更新：启动自动检查（局域网优先，公网兜底）
        UpdateChecker.check(this);
    }

    // 首次启动弹一次「开启焦点通知」引导：焦点通知权限 + 自启动 + 电池优化无限制
    private void showFocusGuideOnce() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences("nexa_prefs", MODE_PRIVATE);
            if (sp.getBoolean("focus_guide_shown", false)) {
                return;
            }
            sp.edit().putBoolean("focus_guide_shown", true).apply();
            new android.app.AlertDialog.Builder(this)
                    .setTitle("开启灵动岛（焦点通知）")
                    .setMessage("为让任务进度出现在通知栏/澎湃焦点通知，请完成三步：\n\n"
                            + "① 系统设置 → 通知与状态栏 → 焦点通知 → 允许 Borealos\n\n"
                            + "② 系统设置 → 应用设置 → 授权管理 → 自启动管理 → 允许 Borealos\n\n"
                            + "③ 点下方「设为无限制」，把电池优化关掉，进度刷新才及时")
                    .setPositiveButton("设为无限制", (d, w) -> requestIgnoreBatteryOptimizations())
                    .setNegativeButton("知道了", null)
                    .show();
        } catch (Throwable ignored) {
        }
    }

    private void requestIgnoreBatteryOptimizations() {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Throwable t) {
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        // 多选
                        int n = data.getClipData().getItemCount();
                        results = new Uri[n];
                        for (int k = 0; k < n; k++) {
                            results[k] = data.getClipData().getItemAt(k).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                // 无论选择/取消都必须回调，否则 WebView 上传永久卡死
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        }
    }

    private void startIslandService() {
        try {
            startForegroundService(new Intent(this, IslandService.class));
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        feedbackForeground = true;
        // 灵动岛为原生常驻通知，无需悬浮窗权限，直接启动前台服务
        startIslandService();
        // 从「允许安装未知来源」授权页返回后继续更新
        UpdateChecker.onResume(this);
        // 回到前台也触发一次检查（内部 2 分钟节流）
        UpdateChecker.check(this);
    }

    @Override
    protected void onPause() {
        feedbackForeground = false;
        super.onPause();
    }

    private void showError() {
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        // 进程重建后旧 ValueCallback 已失效，置空防止误回调
        filePathCallback = null;
    }

    @Override
    protected void onDestroy() {
        // Activity 销毁时结束未完成的文件选择回调
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
