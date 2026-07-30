# quota.py — 各模型订阅的真实限额与已用量采集（被 /api/quota 调用）
#
# 被误删后按会话日志规格重建（2026-07-26）。
# 约定：stdout 输出单行 JSON：
#   {"fetchedAt": ISO8601, "source": "...", "providers": [...]}
# 每家失败不拖垮整体：该 provider 加 "error" 字段，其他家照常输出。
# 三家并发采集，单家请求超时 18s，总耗时远低于 server.js 的 60s execFile 超时。
#
# 数据源：
#   1. Claude 订阅  GET https://api.anthropic.com/api/oauth/usage
#      token 读 OpenClaw 凭据库（auth_profile_store.sqlite）
#   2. Codex/GPT 订阅  GET https://chatgpt.com/backend-api/wham/usage
#      token 读 C:\Users\Gateway\.codex\auth.json，走代理 127.0.0.1:7890，
#      带 ChatGPT-Account-Id 头；401 时用 refresh_token 刷新（先备份 auth.json）再重试
#   3. Kimi 订阅  官方无公开配额接口 → 只输出订阅有效性 note

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

CODEX_AUTH_FILE = r"C:\Users\Gateway\.codex\auth.json"
OPENCLAW_AUTH_DB = r"D:\KIMI\openclaw\state\agents\main\agent\openclaw-agent.sqlite"

PROXY = "http://127.0.0.1:7890"
PROXIES = {"http": PROXY, "https": PROXY}

CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
TOKEN_URL = "https://auth.openai.com/oauth/token"
WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"

# Claude Code 本地凭据（优先于 OpenClaw 凭据库；过期自动刷新并写回）
CLAUDE_CRED_FILE = r"C:\Users\Gateway\.claude\.credentials.json"
CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

REQ_TIMEOUT = 18  # 单请求超时（秒）


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def epoch_to_iso(ts):
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).isoformat()
    except Exception:
        return None


def clamp_pct(v):
    try:
        return max(0, min(100, round(float(v))))
    except Exception:
        return None


# ---------- HTTP 小工具 ----------

def _open(req, use_proxy, timeout):
    if use_proxy:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler(PROXIES))
        return opener.open(req, timeout=timeout)
    return urllib.request.urlopen(req, timeout=timeout)


def http_get_json(url, headers, use_proxy=False, timeout=REQ_TIMEOUT):
    """GET JSON，返回 (status, data|None, err_text|None)。网络错误抛异常。"""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with _open(req, use_proxy, timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        return e.code, None, body or e.reason


def http_post_form_json(url, form, use_proxy, timeout=REQ_TIMEOUT):
    body = "&".join("%s=%s" % (k, urllib.parse.quote(str(v), safe="")) for k, v in form.items())
    req = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    with _open(req, use_proxy, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_json(url, payload, use_proxy, timeout=REQ_TIMEOUT):
    """POST JSON body，返回解析后的 dict；HTTP/网络错误抛异常。"""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with _open(req, use_proxy, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- OpenClaw 凭据库 ----------

def read_openclaw_profiles():
    """读 OpenClaw auth_profile_store，返回 {profile_key: profile_dict}；读不到返回 {}。"""
    if not os.path.exists(OPENCLAW_AUTH_DB):
        return {}
    try:
        con = sqlite3.connect("file:%s?mode=ro" % OPENCLAW_AUTH_DB.replace("\\", "/"), uri=True, timeout=5)
        try:
            row = con.execute(
                "SELECT store_json FROM auth_profile_store WHERE store_key='primary'"
            ).fetchone()
        finally:
            con.close()
        if not row:
            return {}
        return json.loads(row[0]).get("profiles", {}) or {}
    except Exception:
        return {}


# ---------- Claude 订阅 ----------

def read_claude_creds():
    """读 Claude Code 本地凭据，返回 (creds_dict|None, oauth_dict|None, err|None)。"""
    if not os.path.exists(CLAUDE_CRED_FILE):
        return None, None, None
    try:
        with open(CLAUDE_CRED_FILE, encoding="utf-8") as f:
            cc = json.load(f)
        return cc, (cc.get("claudeAiOauth") or {}), None
    except Exception as e:
        return None, None, str(e)


def refresh_claude_token(cc, oauth):
    """用 refreshToken 换新 accessToken；写回前备份凭据文件为 .bak。返回新 oauth dict。"""
    rt = oauth.get("refreshToken")
    if not rt:
        raise RuntimeError("凭据缺少 refreshToken")
    payload = {"grant_type": "refresh_token", "refresh_token": rt, "client_id": CLAUDE_CLIENT_ID}
    try:
        j = http_post_json(CLAUDE_TOKEN_URL, payload, use_proxy=False)
    except Exception:
        j = http_post_json(CLAUDE_TOKEN_URL, payload, use_proxy=True)  # 直连不通走代理
    at = j.get("access_token") or j.get("accessToken")
    if not at:
        raise RuntimeError("刷新响应缺少 access_token: " + str(j)[:120])
    shutil.copyfile(CLAUDE_CRED_FILE, CLAUDE_CRED_FILE + ".bak")  # 先备份原文件
    oauth["accessToken"] = at
    new_rt = j.get("refresh_token") or j.get("refreshToken")
    if new_rt:
        oauth["refreshToken"] = new_rt
    exp_in = j.get("expires_in") or j.get("expiresIn")
    try:
        exp_in = float(exp_in) if exp_in else 3600.0
    except Exception:
        exp_in = 3600.0
    oauth["expiresAt"] = int(time.time() * 1000 + exp_in * 1000)
    cc["claudeAiOauth"] = oauth
    fd, tmp = tempfile.mkstemp(prefix="cred-", suffix=".json", dir=os.path.dirname(CLAUDE_CRED_FILE))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(cc, f, indent=2)
    os.replace(tmp, CLAUDE_CRED_FILE)
    return oauth


def claude_usage_get(token):
    """调 usage 接口：先直连，网络层失败再走本地代理重试一次。"""
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "User-Agent": "work-ui-quota",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
    }
    try:
        return http_get_json(ANTHROPIC_USAGE_URL, headers, use_proxy=False)
    except Exception:
        return http_get_json(ANTHROPIC_USAGE_URL, headers, use_proxy=True)


def fetch_claude(profiles):
    p = {"id": "anthropic", "name": "Claude 订阅", "windows": []}
    cc, oauth, read_err = read_claude_creds()
    token = None
    refreshed = False
    if oauth:
        sub = oauth.get("subscriptionType")
        if sub:
            p["plan"] = sub
        exp_ms = oauth.get("expiresAt")
        if oauth.get("accessToken") and exp_ms and exp_ms / 1000 - 60 > time.time():
            token = oauth["accessToken"]  # 未过期直接用
        elif oauth.get("refreshToken"):
            try:
                oauth = refresh_claude_token(cc, oauth)
                token = oauth["accessToken"]
                refreshed = True
            except Exception as e:
                p["error"] = ("凭据已过期且自动刷新失败（refresh_token 可能已失效）: %s。"
                              "请在终端运行 claude 重新登录 Claude CLI 后重试" % str(e)[:120])
                return p
        else:
            p["error"] = "Claude 凭据缺少 refreshToken，请在终端运行 claude 重新登录 Claude CLI"
            return p
    else:
        # 回退：OpenClaw 凭据库
        if read_err:
            p["error"] = "读取 Claude 凭据失败: %s" % read_err
            return p
        try:
            sub = profiles.get("anthropic:default") or {}
            token = sub.get("access")
        except Exception:
            token = None
        if not token:
            p["error"] = "未找到 Claude OAuth token（~/.claude/.credentials.json 与 OpenClaw 凭据库均无）"
            return p

    status, data, err = claude_usage_get(token)

    # token 未过期却被拒（401/403），且还没刷新过、有 refreshToken → 刷新重试一次
    if status in (401, 403) and not refreshed and oauth and oauth.get("refreshToken"):
        try:
            oauth = refresh_claude_token(cc, oauth)
            refreshed = True
            status, data, err = claude_usage_get(oauth["accessToken"])
        except Exception as e:
            p["error"] = ("凭据被拒且自动刷新失败: %s。请在终端运行 claude 重新登录 Claude CLI"
                          % str(e)[:120])
            return p

    if refreshed:
        p["note"] = "accessToken 已自动刷新（原凭据已备份为 .credentials.json.bak）"
    if status != 200:
        hint = "（token 被拒，请在终端运行 claude 重新登录 Claude CLI）" if status in (401, 403) else ""
        detail = ""
        if data is None and err:
            detail = " " + " ".join(str(err).split())[:120]
        exp_ms = (oauth or {}).get("expiresAt")
        if exp_ms and exp_ms / 1000 <= time.time():
            detail += "（凭据已于 %s 过期）" % datetime.fromtimestamp(
                exp_ms / 1000).strftime("%Y-%m-%d %H:%M")
        p["error"] = "HTTP %s%s%s" % (status, hint, detail)
        return p

    fh = (data or {}).get("five_hour") or {}
    if fh.get("utilization") is not None:
        p["windows"].append({
            "label": "5小时窗口",
            "usedPercent": clamp_pct(fh.get("utilization")),
            "resetAt": fh.get("resets_at"),
        })
    sd = (data or {}).get("seven_day") or {}
    if sd.get("utilization") is not None:
        p["windows"].append({
            "label": "7天窗口",
            "usedPercent": clamp_pct(sd.get("utilization")),
            "resetAt": sd.get("resets_at"),
        })
    extra = (data or {}).get("extra_usage") or {}
    if extra.get("is_enabled") and isinstance(extra.get("used_credits"), (int, float)) \
            and isinstance(extra.get("monthly_limit"), (int, float)):
        p["billing"] = {
            "used": round(extra["used_credits"] / 100, 2),
            "limit": round(extra["monthly_limit"] / 100, 2),
        }
    return p


# ---------- Codex / GPT 订阅 ----------

def read_codex_auth():
    with open(CODEX_AUTH_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def jwt_exp(token):
    try:
        import base64
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part)).get("exp")
    except Exception:
        return None


def refresh_codex_token(auth):
    """用 refresh_token 换新 access_token；写回前备份 auth.json。返回新 auth dict。"""
    rt = (auth.get("tokens") or {}).get("refresh_token")
    if not rt:
        raise RuntimeError("auth.json 缺少 refresh_token")
    j = http_post_form_json(TOKEN_URL, {
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": rt,
    }, use_proxy=True)
    if not j.get("access_token"):
        raise RuntimeError("刷新响应缺少 access_token")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copyfile(CODEX_AUTH_FILE, CODEX_AUTH_FILE + ".bak-" + stamp)
    auth["tokens"]["access_token"] = j["access_token"]
    if j.get("refresh_token"):
        auth["tokens"]["refresh_token"] = j["refresh_token"]
    if j.get("id_token"):
        auth["tokens"]["id_token"] = j["id_token"]
    auth["last_refresh"] = iso_now()
    fd, tmp = tempfile.mkstemp(prefix="auth-", suffix=".json", dir=os.path.dirname(CODEX_AUTH_FILE))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(auth, f, indent=2)
    os.replace(tmp, CODEX_AUTH_FILE)
    return auth


def wham_usage(auth):
    tokens = auth.get("tokens") or {}
    headers = {
        "Authorization": "Bearer " + tokens.get("access_token", ""),
        "Accept": "application/json",
        "User-Agent": "work-ui-quota",
    }
    if tokens.get("account_id"):
        headers["ChatGPT-Account-Id"] = tokens["account_id"]
    return http_get_json(WHAM_USAGE_URL, headers, use_proxy=True)


def fetch_codex():
    p = {"id": "openai", "name": "Codex / GPT 订阅", "windows": []}
    try:
        auth = read_codex_auth()
    except Exception as e:
        p["error"] = "读取 auth.json 失败: %s" % e
        return p
    if not (auth.get("tokens") or {}).get("access_token"):
        p["error"] = "auth.json 缺少 access_token"
        return p

    refreshed = False
    try:
        # 过期先刷新；401 也刷新重试一次
        exp = jwt_exp(auth["tokens"]["access_token"])
        if exp and exp - 60 <= time.time():
            auth = refresh_codex_token(auth)
            refreshed = True
        status, data, err = wham_usage(auth)
        if status == 401 and not refreshed:
            auth = refresh_codex_token(auth)
            refreshed = True
            status, data, err = wham_usage(auth)
    except Exception as e:
        p["error"] = "token 刷新失败: %s" % str(e)[:150]
        return p

    if refreshed:
        p["note"] = "access_token 已自动刷新（原 auth.json 已备份）"
    if status != 200:
        hint = "(可能需要重新登录刷新 token)" if status in (401, 403) else ""
        detail = (" " + str(err)[:120]) if err else ""
        p["error"] = "HTTP %s%s%s" % (status, hint, detail)
        return p

    rl = (data or {}).get("rate_limit") or {}
    pw = rl.get("primary_window") or {}
    if pw:
        hours = round((pw.get("limit_window_seconds") or 10800) / 3600)
        p["windows"].append({
            "label": "%d小时窗口" % hours,
            "usedPercent": clamp_pct(pw.get("used_percent")),
            "resetAt": epoch_to_iso(pw.get("reset_at")),
        })
    sw = rl.get("secondary_window") or {}
    if sw:
        hours = round((sw.get("limit_window_seconds") or 86400) / 3600)
        label = "周窗口" if hours >= 168 else "%d小时窗口" % hours
        p["windows"].append({
            "label": label,
            "usedPercent": clamp_pct(sw.get("used_percent")),
            "resetAt": epoch_to_iso(sw.get("reset_at")),
        })
    if (data or {}).get("plan_type"):
        p["plan"] = data["plan_type"]
    credits = (data or {}).get("credits") or {}
    if credits.get("balance") is not None:
        try:
            p["billing"] = {"balance": float(credits["balance"]), "unit": "credits"}
        except Exception:
            p["billing"] = {"balance": credits["balance"], "unit": "credits"}
    return p


# ---------- Kimi 订阅 ----------
# 2026-07-26 起接入真实配额：GET https://api.kimi.com/coding/v1/usages
# （与 Kimi Code CLI /usage 同源，API key 直调，官方文档未列出但实测可用）

KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages"

KIMI_LEVEL_NAMES = {
    "LEVEL_ADVANCED": "Advanced 会员",
    "LEVEL_BASIC": "Basic 会员",
    "LEVEL_FREE": "免费版",
    "LEVEL_ALLEGRETTO": "Allegretto 会员",
    "LEVEL_MODERATO": "Moderato 会员",
}


def fetch_kimi(profiles):
    p = {"id": "moonshot", "name": "Kimi 订阅", "plan": "coding 订阅", "windows": []}
    prof = profiles.get("moonshot:default") or {}
    key = prof.get("key")
    if not key:
        p["error"] = "未能在 OpenClaw 凭据库找到 moonshot API key"
        return p
    req = urllib.request.Request(KIMI_USAGE_URL, headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=REQ_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        p["error"] = "HTTP %d（可能需要重新创建 API key）" % e.code
        return p
    except Exception as e:
        p["error"] = "查询失败: %s" % str(e)[:120]
        return p

    # 会员档位
    level = (((data.get("user") or {}).get("membership") or {}).get("level")) or ""
    if level:
        p["plan"] = KIMI_LEVEL_NAMES.get(level, level.replace("LEVEL_", "").title() + " 会员")

    # 周期总额度（usage.limit/used/remaining + resetTime）
    usage = data.get("usage") or {}
    try:
        limit = float(usage.get("limit") or 0)
        used = float(usage.get("used") or 0)
        if limit > 0:
            p["windows"].append({
                "label": "周期额度（%d%% 已用）" % clamp_pct(used / limit * 100),
                "usedPercent": clamp_pct(used / limit * 100),
                "resetAt": usage.get("resetTime"),
            })
    except Exception:
        pass

    # 5 小时滚动窗口（limits[].window.duration=300 分钟）
    for w in data.get("limits") or []:
        try:
            win = w.get("window") or {}
            detail = w.get("detail") or {}
            dur = int(win.get("duration") or 0)
            unit = win.get("timeUnit") or ""
            wlimit = float(detail.get("limit") or 0)
            remaining = float(detail.get("remaining") or 0)
            if wlimit <= 0:
                continue
            used_pct = clamp_pct((wlimit - remaining) / wlimit * 100)
            if dur == 300 and "MINUTE" in unit:
                label = "5小时窗口"
            elif "HOUR" in unit:
                label = "%d小时窗口" % (dur if dur else 0)
            elif "DAY" in unit:
                label = "%d天窗口" % dur
            elif "MINUTE" in unit:
                label = "%d分钟窗口" % dur
            else:
                label = "滚动窗口"
            p["windows"].append({"label": label, "usedPercent": used_pct, "resetAt": detail.get("resetTime")})
        except Exception:
            continue

    # 并发上限
    par = (data.get("parallel") or {}).get("limit")
    if par:
        p["note"] = "并发上限 %s · 与 Kimi Code CLI /usage 同源" % par
    if not p["windows"]:
        p["note"] = (p.get("note") or "") + "（官方未返回窗口数据）"
    return p


def main():
    profiles = read_openclaw_profiles()
    providers = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(fetch_claude, profiles), ex.submit(fetch_codex), ex.submit(fetch_kimi, profiles)]
        for f in futs:
            try:
                providers.append(f.result(timeout=REQ_TIMEOUT * 2 + 10))
            except Exception as e:
                providers.append({"id": "unknown", "name": "未知", "windows": [],
                                  "error": "采集异常: %s" % str(e)[:150]})
    out = {
        "fetchedAt": iso_now(),
        "source": "OpenClaw 凭据 + 官方订阅接口(与 CLI /usage 同源)",
        "providers": providers,
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
