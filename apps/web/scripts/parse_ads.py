# -*- coding: utf-8 -*-
# parse_ads.py — 亚马逊广告报告解析 v2：全类型 + 中英双语
# 用法: python parse_ads.py <报告文件路径>
# 输出: stdout 单行 JSON：
#   {ok:true, reportType, reportTypeName, lang, rows, totals, groups, campaigns, keywords}
#   或 {error:"..."}
# 支持：SP 广告活动/搜索词/定向/广告组/推广商品/投放位置/预算/按时间/无效流量、
#       SB 视频(播放分段)、SB 新客(New-to-brand)、业务报告(sessions/buy box)、品牌分析
# 格式：csv(utf-8-sig/gbk) / xlsx / xls(xlrd)
import hashlib
import datetime
import json
import math
import sys
import warnings

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 部分亚马逊导出的 XLSX 没有 Excel 默认样式。openpyxl 会发出 UserWarning，
# 但样式缺失不影响单元格数据读取；某些受管 Python 环境会把警告提升为异常。
warnings.filterwarnings(
    "ignore",
    message=r"Workbook contains no default style.*",
    category=UserWarning,
    module=r"openpyxl(\..*)?",
)

# ---------- 双语列名映射（归一化后的小写列名 →  canonical 字段） ----------
def n(s):
    return " ".join(str(s or "").strip().lower().replace("\n", " ").split())


def json_safe(value):
    """JSON default hook for pandas/NumPy/date scalars."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return float(value) if math.isfinite(float(value)) else None
    try:
        import pandas as pd
        missing = pd.isna(value)
        if isinstance(missing, bool) and missing:
            return None
    except Exception:
        pass
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return json_safe(value.item())
        except Exception:
            pass
    if hasattr(value, "tolist"):
        try:
            return to_json_safe(value.tolist())
        except Exception:
            pass
    return str(value)


def to_json_safe(value):
    """Recursively normalize values before strict json.dumps(allow_nan=False)."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, dict):
        return {str(key): to_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(item) for item in value]
    converted = json_safe(value)
    return to_json_safe(converted) if converted is not value else str(value)

COL_MAP = {}
def _reg(canon, *names):
    for x in names:
        COL_MAP[n(x)] = canon

_reg("date", "date", "日期")
_reg("campaign", "campaign name", "campaign", "广告活动", "广告活动名称")
_reg("adgroup", "ad group name", "ad group", "广告组", "广告组名称")
_reg("keyword", "keyword text", "keyword", "targeting", "targeting text", "关键词", "定向", "投放关键词", "定位")
_reg("searchterm", "customer search term", "search term", "搜索词", "客户搜索词", "买家搜索词")
_reg("asin", "asin", "advertised asin", "(parent) asin", "(child) asin", "（父）asin", "（子）asin", "父asin", "子asin", "推广商品", "商品asin", "广告商品asin")
_reg("sku", "sku", "advertised sku", "商品sku", "广告商品sku")
_reg("placement", "placement", "投放位置", "展示位置", "广告位")
_reg("impressions", "impressions", "impression", "曝光量", "曝光", "展示量", "展现量")
_reg("clicks", "clicks", "click", "点击量", "点击")
_reg("ctr", "ctr", "click-through rate", "点击率")
_reg("spend", "spend", "cost", "total spend", "花费", "费用", "广告花费", "总花费")
_reg("sales", "7 day total sales", "14 day total sales", "total sales", "sales", "ordered product sales", "total product sales", "销售额", "7天总销售额", "广告销售额", "总销售额", "已订购商品销售额")
_reg("orders", "7 day total orders", "14 day total orders", "orders", "conversions", "订单量", "订单", "转化量", "7天总订单量", "总订单量")
_reg("acos", "acos", "广告投入产出比")
_reg("roas", "roas", "广告支出回报率")
_reg("budget", "budget", "daily budget", "预算", "每日预算", "日预算")
_reg("sessions", "sessions", "会话", "会话次数", "访客数", "session")
_reg("buybox", "buy box percentage", "buy box", "购买按钮赢得率", "购物车赢得率", "buy box %")
_reg("units", "units ordered", "已订购商品数量", "订购件数", "商品数量")
_reg("pageviews", "page views", "页面浏览量", "浏览量")
_reg("ntb_orders", "new-to-brand orders", "新客订单", "新买家订单", "品牌新客订单量")
_reg("ntb_sales", "new-to-brand sales", "新客销售额", "新买家销售额", "品牌新客销售额")
_reg("v_q1", "video first quartile", "视频播放25%", "视频播放至25%")
_reg("v_mid", "video midpoint", "视频播放50%", "视频播放至50%")
_reg("v_q3", "video third quartile", "视频播放75%", "视频播放至75%")
_reg("v_complete", "video complete", "视频完整播放", "完整播放")
_reg("invalid_clicks", "invalid clicks", "无效点击", "无效流量点击")
_reg("query", "search query", "搜索查询", "查询词")
_reg("click_share", "click share", "点击份额")
_reg("conv_share", "conversion share", "转化份额")

DIM_FIELDS = {"date", "campaign", "adgroup", "keyword", "searchterm", "asin", "sku", "placement", "query"}
NUM_FIELDS = ["impressions", "clicks", "spend", "sales", "orders", "sessions", "units",
              "pageviews", "ntb_orders", "ntb_sales", "v_q1", "v_mid", "v_q3", "v_complete",
              "budget", "invalid_clicks", "buybox", "click_share", "conv_share"]

# ---------- 报告类型签名：按优先级 (type, 名称, 判定函数, 维度字段) ----------
def make_rules(c):
    return [
        ("business", "业务报告", lambda: ("sessions" in c or "units" in c or "buybox" in c) and "spend" not in c,
         "asin" if "asin" in c else ("sku" if "sku" in c else None)),
        ("newtobrand", "SB 品牌新客报告", lambda: "ntb_orders" in c or "ntb_sales" in c,
         "campaign" if "campaign" in c else ("keyword" if "keyword" in c else None)),
        ("sbvideo", "SB 视频报告", lambda: any(k in c for k in ("v_q1", "v_mid", "v_q3", "v_complete")),
         "campaign" if "campaign" in c else None),
        ("invalid", "无效流量报告", lambda: "invalid_clicks" in c,
         "campaign" if "campaign" in c else None),
        ("brandanalytics", "品牌分析报告", lambda: "query" in c and ("click_share" in c or "conv_share" in c),
         "query"),
        ("budget", "预算报告", lambda: "budget" in c and "campaign" in c,
         "campaign"),
        ("placement", "投放位置报告", lambda: "placement" in c,
         "placement"),
        ("searchterm", "搜索词报告", lambda: "searchterm" in c,
         "searchterm"),
        ("targeting", "定向/关键词报告", lambda: "keyword" in c,
         "keyword"),
        ("product", "推广商品(ASIN)报告", lambda: "asin" in c or "sku" in c,
         "asin" if "asin" in c else "sku"),
        ("adgroup", "广告组报告", lambda: "adgroup" in c,
         "adgroup"),
        ("time", "按时间报告", lambda: "date" in c,
         "date"),
        ("campaign", "广告活动报告", lambda: "campaign" in c,
         "campaign"),
        ("generic", "通用广告报告", lambda: any(k in c for k in ("impressions", "clicks", "spend")),
         None),
    ]


def num(v):
    try:
        s = str(v if v is not None else "").replace(",", "").replace("$", "").replace("%", "").replace("￥", "").strip()
        if s in ("", "-", "--", "nan", "None"):
            return 0.0
        return float(s)
    except Exception:
        return 0.0


def agg(rows, cols):
    """cols: 实际存在的 canonical 数值列集合 → 汇总（ctr/acos/roas 由总和推算；份额类取均值）"""
    t = {}
    MEAN_FIELDS = {"buybox", "click_share", "conv_share"}
    for k in NUM_FIELDS:
        if k in cols:
            vals = [num(r.get("_" + k)) for r in rows]
            t[k] = (sum(vals) / len(vals)) if k in MEAN_FIELDS and vals else sum(vals)
    imp, clk = t.get("impressions", 0), t.get("clicks", 0)
    spd, sal = t.get("spend", 0), t.get("sales", 0)
    t["ctr"] = round(clk / imp * 100, 3) if imp > 0 else 0.0
    t["acos"] = round(spd / sal * 100, 2) if sal > 0 else 0.0
    t["roas"] = round(sal / spd, 3) if spd > 0 else 0.0
    if t.get("budget"):
        t["budgetUtil"] = round(spd / t["budget"] * 100, 1) if t["budget"] > 0 else 0.0
    if t.get("sessions"):
        t["unitConv"] = round(t.get("units", 0) / t["sessions"] * 100, 2) if t["sessions"] > 0 else 0.0
    if t.get("orders") and t.get("ntb_orders") is not None and t.get("orders", 0) > 0:
        t["ntbOrderPct"] = round(t.get("ntb_orders", 0) / t["orders"] * 100, 1)
    if t.get("v_q1"):
        t["videoCompleteRate"] = round(t.get("v_complete", 0) / t["v_q1"] * 100, 1) if t["v_q1"] > 0 else 0.0
    for k in list(t.keys()):
        v = t[k]
        t[k] = int(round(v)) if k in ("impressions", "clicks", "orders", "sessions", "units", "pageviews",
                                      "ntb_orders", "v_q1", "v_mid", "v_q3", "v_complete", "invalid_clicks") else round(v, 2)
    return t


def canonical_columns(df):
    canon = {}
    for col in df.columns:
        key = n(col)
        canonical = COL_MAP.get(key)
        if not canonical:
            for mapped_name, mapped_value in COL_MAP.items():
                if key.startswith(mapped_name):
                    canonical = mapped_value
                    break
        if canonical and canonical not in canon.values():
            canon[str(col)] = canonical
    return canon


def non_missing(value):
    if value is None:
        return False
    try:
        import pandas as pd
        missing = pd.isna(value)
        if isinstance(missing, bool) and missing:
            return False
        if hasattr(missing, "item") and bool(missing.item()):
            return False
    except Exception:
        pass
    return not (isinstance(value, str) and not value.strip())


def universal_profile(series):
    import pandas as pd

    values = [value for value in series.tolist() if non_missing(value)]
    safe_values = [to_json_safe(value) for value in values]
    profile = {
        "field": str(series.name),
        "kind": "empty",
        "nonEmptyCount": len(values),
        "distinctCount": len({json.dumps(value, ensure_ascii=False, sort_keys=True) for value in safe_values}),
    }
    if not values:
        return profile

    numeric = pd.to_numeric(pd.Series(values), errors="coerce")
    if numeric.notna().all():
        nums = [float(value) for value in numeric.tolist() if math.isfinite(float(value))]
        profile["kind"] = "numeric"
        if nums:
            stats = {
                "min": min(nums),
                "max": max(nums),
                "sum": sum(nums),
                "mean": sum(nums) / len(nums),
            }
            profile["numeric"] = {
                key: to_json_safe(int(value) if float(value).is_integer() else round(value, 6))
                for key, value in stats.items()
            }
        return profile

    date_like = pd.api.types.is_datetime64_any_dtype(series.dtype)
    if not date_like:
        text_values = [str(value).strip() for value in values]
        date_like = all(
            any(marker in text for marker in ("-", "/", ":", "T"))
            for text in text_values
        )
    if date_like:
        parsed = pd.to_datetime(pd.Series(values), errors="coerce")
        if parsed.notna().all():
            profile["kind"] = "date"
            profile["dateRange"] = {
                "min": parsed.min().isoformat().split("T")[0],
                "max": parsed.max().isoformat().split("T")[0],
            }
            return profile

    counts = {}
    labels = {}
    for value in safe_values:
        key = json.dumps(value, ensure_ascii=False, sort_keys=True)
        counts[key] = counts.get(key, 0) + 1
        labels[key] = value
    ordered = sorted(counts, key=lambda key: (-counts[key], key))
    profile["kind"] = "category" if len(ordered) <= min(50, max(20, len(values) // 2)) else "text"
    profile["topValues"] = [
        {"value": labels[key], "count": counts[key]}
        for key in ordered[:20]
    ]
    return profile


def universal_value(value, profile):
    if not non_missing(value):
        return None
    if profile.get("kind") == "numeric":
        try:
            parsed = float(str(value).replace(",", "").strip())
            return int(parsed) if parsed.is_integer() else parsed
        except Exception:
            pass
    if profile.get("kind") == "date":
        try:
            import pandas as pd
            parsed = pd.Timestamp(value)
            return parsed.date().isoformat() if parsed.time() == datetime.time() else parsed.isoformat()
        except Exception:
            pass
    return to_json_safe(value)


def build_universal_report(tables):
    sheets = []
    items = []
    source_rows = 0
    all_fields = []
    for sheet_name, frame in tables:
        source_rows += len(frame)
        profiles = [universal_profile(frame[column]) for column in frame.columns]
        profile_by_field = {profile["field"]: profile for profile in profiles}
        for profile in profiles:
            if profile["field"] not in all_fields:
                all_fields.append(profile["field"])
        valid_count = 0
        for position, (_, row) in enumerate(frame.iterrows(), start=2):
            values = {
                str(column): universal_value(row[column], profile_by_field[str(column)])
                for column in frame.columns
            }
            if not any(non_missing(row[column]) for column in frame.columns):
                continue
            valid_count += 1
            normalized = json.dumps(values, ensure_ascii=False, sort_keys=True, allow_nan=False)
            digest = hashlib.sha256(
                (str(sheet_name) + "\0" + str(position) + "\0" + normalized).encode("utf-8")
            ).hexdigest()[:16]
            items.append({
                "itemId": "universal-" + digest,
                "name": "%s · Row %d" % (sheet_name, position),
                "sheetName": str(sheet_name),
                "rowNumber": position,
                "values": values,
            })
        sheets.append({
            "name": str(sheet_name),
            "sourceRowCount": len(frame),
            "validRowCount": valid_count,
            "columnCount": len(frame.columns),
            "profiles": profiles,
        })

    return {
        "ok": True,
        "reportType": "universal",
        "reportTypeName": "通用数据报告",
        "lang": "mixed",
        "rows": source_rows,
        "sourceRowCount": source_rows,
        "validRowCount": len(items),
        "totals": {
            "sourceRows": source_rows,
            "validRows": len(items),
            "sheetCount": len(sheets),
            "columnCount": len(all_fields),
        },
        "groupBy": "row",
        "columns": all_fields,
        "sheets": sheets,
        "groups": items,
        "items": items,
        "campaigns": [],
        "keywords": [],
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少文件参数"}, ensure_ascii=False))
        return
    fp = sys.argv[1]
    try:
        import pandas as pd
    except Exception:
        print(json.dumps({"error": "pandas 不可用"}, ensure_ascii=False))
        return
    low = fp.lower()
    try:
        if low.endswith(".xlsx"):
            workbook = pd.read_excel(fp, dtype=object, sheet_name=None)
            tables = list(workbook.items())
        elif low.endswith(".xls"):
            workbook = pd.read_excel(fp, dtype=object, engine="xlrd", sheet_name=None)
            tables = list(workbook.items())
        else:
            try:
                df = pd.read_csv(fp, dtype=object, encoding="utf-8-sig")
            except Exception:
                df = pd.read_csv(fp, dtype=object, encoding="gbk")
            tables = [("CSV", df)]
    except Exception as e:
        print(json.dumps({"error": "读取文件失败: %s" % str(e)[:150]}, ensure_ascii=False))
        return
    if not tables or all(frame.empty for _, frame in tables):
        print(json.dumps({"error": "报告为空（0 行数据）"}, ensure_ascii=False))
        return

    selected = None
    for sheet_name, frame in tables:
        frame_present = set(canonical_columns(frame).values())
        frame_numeric = frame_present & set(NUM_FIELDS)
        if frame_numeric & {"impressions", "clicks", "spend", "sales", "sessions"}:
            selected = (sheet_name, frame)
            break
    if selected is None:
        out = build_universal_report(tables)
        print(json.dumps(to_json_safe(out), ensure_ascii=False, allow_nan=False))
        return
    _, df = selected

    # 列名归一化 → canonical；数值列重命名为 _<canon> 方便取值
    canon = canonical_columns(df)
    present = set(canon.values())
    lang = "zh" if any(ord(ch) > 0x3000 for col in canon for ch in col) else "en"

    rename = {}
    for col, c in canon.items():
        rename[col] = ("_" + c) if c in NUM_FIELDS else c
    df = df.rename(columns=rename)
    rows = df.to_dict("records")
    num_present = present & set(NUM_FIELDS)

    rtype, rname, dim = "generic", "通用广告报告", None
    for t, name, rule, d in make_rules(present):
        try:
            if rule():
                rtype, rname, dim = t, name, d
                break
        except Exception:
            continue

    valid_rows = rows
    if dim:
        valid_rows = [
            row for row in rows
            if str(row.get(dim) or "").strip()
            and str(row.get(dim) or "").strip().lower() != "nan"
        ]

    out = {
        "ok": True, "reportType": rtype, "reportTypeName": rname, "lang": lang,
        "rows": len(rows), "sourceRowCount": len(rows), "validRowCount": len(valid_rows),
        "totals": agg(valid_rows, num_present), "groups": [], "groupBy": dim,
    }
    if dim:
        groups = {}
        for r in rows:
            namev = str(r.get(dim) or "").strip()
            if not namev or namev.lower() == "nan":
                continue
            groups.setdefault(namev, []).append(r)
        items = []
        for namev, rs in groups.items():
            a = agg(rs, num_present)
            a["name"] = namev
            normalized_name = n(namev)
            digest = hashlib.sha256(normalized_name.encode("utf-8")).hexdigest()[:16]
            a["itemId"] = f"{rtype}-{digest}"
            items.append(a)
        items.sort(key=lambda x: -(x.get("spend", 0) or x.get("sales", 0) or x.get("sessions", 0) or x.get("impressions", 0)))
        out["groups"] = items

    # 兼容旧字段（server.js 老逻辑兜底用）
    if rtype in ("campaign", "budget", "invalid", "sbvideo", "newtobrand"):
        out["campaigns"] = out["groups"]
    elif "campaign" in present:
        camps = {}
        for r in rows:
            nm = str(r.get("campaign") or "").strip()
            if nm and nm.lower() != "nan":
                camps.setdefault(nm, []).append(r)
        out["campaigns"] = [dict(agg(rs, num_present), name=nm) for nm, rs in
                            sorted(camps.items(), key=lambda kv: -sum(num(r.get("_spend")) for r in kv[1]))[:20]]
    else:
        out["campaigns"] = []
    if rtype in ("searchterm", "targeting"):
        out["keywords"] = out["groups"]
    elif dim:
        out["keywords"] = []
    else:
        out["keywords"] = []

    print(json.dumps(to_json_safe(out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
