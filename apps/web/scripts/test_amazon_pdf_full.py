import contextlib
import io
import json
import re
import runpy
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader


def build_report(config):
    item_count = config["fixtureItemCount"]
    groups = []
    analyses = []
    for index in range(item_count):
        item_id = f"campaign-{index:03d}"
        name = f"Campaign {index:03d}"
        spend = 25 + index
        sales = 50 + index * 2
        groups.append(
            {
                "itemId": item_id,
                "name": name,
                "impressions": 1000 + index * 10,
                "clicks": 20 + index,
                "spend": spend,
                "sales": sales,
                "orders": 1 + index % 5,
                "ctr": round((20 + index) / (1000 + index * 10) * 100, 2),
                "acos": round(spend / sales * 100, 2),
                "roas": round(sales / spend, 2),
            }
        )
        analyses.append(
            {
                "itemId": item_id,
                "priority": ("high", "medium", "low")[index % 3],
                "dataBasis": f"Spend ${spend}, sales ${sales}, threshold ACOS 40%.",
                "reason": "Performance requires a measured bid and budget review.",
                "consolePath": f"Campaign Manager > Campaigns > {name}",
                "steps": [
                    "Open the campaign and record the current bid",
                    "Apply the recommended adjustment",
                    "Add the item to the review log",
                ],
                "adjustment": "Change bid by 10%-15%",
                "observationWindow": "7 days",
                "successCriteria": "ACOS stays below 40% and orders do not decline",
                "rollbackCondition": "Restore the recorded bid if orders fall to zero",
            }
        )

    result = dict(config)
    result["created"] = 1785200000000
    result["metrics"] = {
        "reportType": "campaign",
        "reportTypeName": "广告活动报告",
        "groupBy": "campaign",
        "rows": item_count,
        "sourceRowCount": item_count,
        "validRowCount": item_count,
        "totals": {
            "impressions": sum(item["impressions"] for item in groups),
            "clicks": sum(item["clicks"] for item in groups),
            "spend": sum(item["spend"] for item in groups),
            "sales": sum(item["sales"] for item in groups),
            "orders": sum(item["orders"] for item in groups),
            "ctr": 5.0,
            "acos": 48.0,
            "roas": 2.08,
        },
        "groups": groups,
        "campaigns": groups,
    }
    result["coverage"] = {
        "analyzedItems": item_count,
        "failedItems": 0,
        "totalItems": item_count,
        "percentage": 100,
    }
    result["itemAnalyses"] = analyses
    result["analysisWarnings"] = ["Method: deterministic metrics plus validated batched AI guidance."]
    result["batchSummary"] = {"completed": 13, "failed": 0, "total": 13}
    return result


def build_universal_report(config):
    item_count = config["fixtureItemCount"]
    groups = []
    analyses = []
    for index in range(item_count):
        item_id = f"universal-{index:03d}"
        sheet_name = "Operations" if index < 100 else "Owners"
        row_number = index + 2 if index < 100 else index - 98
        values = (
            {
                "Region": "East" if index % 2 == 0 else "West",
                "Units": index + 1,
                "Observed At": f"2026-{1 + index // 28:02d}-{1 + index % 28:02d}",
            }
            if sheet_name == "Operations"
            else {"Owner": f"Owner {index:03d}", "Active": index % 2 == 0}
        )
        groups.append(
            {
                "itemId": item_id,
                "name": f"{sheet_name} · Row {row_number}",
                "sheetName": sheet_name,
                "rowNumber": row_number,
                "values": values,
            }
        )
        analyses.append(
            {
                "itemId": item_id,
                "priority": ("high", "medium", "low")[index % 3],
                "dataBasis": f"Source values: {json.dumps(values, ensure_ascii=False)}",
                "reason": "The row is interpreted using its worksheet profile and neighboring values.",
                "consolePath": f"数据源 > {sheet_name} > Row {row_number}",
                "steps": ["Confirm field definitions", "Validate the source row"],
                "adjustment": "Observe; change only after validation",
                "observationWindow": "7 days",
                "successCriteria": "The source row and interpretation are confirmed",
                "rollbackCondition": "Remove annotations if the source row changes",
            }
        )

    result = dict(config)
    result["created"] = 1785200000000
    result["metrics"] = {
        "reportType": "universal",
        "reportTypeName": "通用数据报告",
        "rows": item_count,
        "sourceRowCount": item_count,
        "validRowCount": item_count,
        "columns": ["Region", "Units", "Observed At", "Owner", "Active"],
        "totals": {
            "sourceRows": item_count,
            "validRows": item_count,
            "sheetCount": 2,
            "columnCount": 5,
        },
        "sheets": [
            {
                "name": "Operations",
                "sourceRowCount": 100,
                "validRowCount": 100,
                "columnCount": 3,
                "profiles": [
                    {"field": "Region", "kind": "category", "nonEmptyCount": 100, "distinctCount": 2, "topValues": [{"value": "East", "count": 50}, {"value": "West", "count": 50}]},
                    {"field": "Units", "kind": "numeric", "nonEmptyCount": 100, "distinctCount": 100, "numeric": {"min": 1, "max": 100, "sum": 5050, "mean": 50.5}},
                    {"field": "Observed At", "kind": "date", "nonEmptyCount": 100, "distinctCount": 100, "dateRange": {"min": "2026-01-01", "max": "2026-04-16"}},
                ],
            },
            {
                "name": "Owners",
                "sourceRowCount": 25,
                "validRowCount": 25,
                "columnCount": 2,
                "profiles": [
                    {"field": "Owner", "kind": "text", "nonEmptyCount": 25, "distinctCount": 25, "topValues": [{"value": "Owner 100", "count": 1}]},
                    {"field": "Active", "kind": "category", "nonEmptyCount": 25, "distinctCount": 2, "topValues": [{"value": True, "count": 13}, {"value": False, "count": 12}]},
                ],
            },
        ],
        "groups": groups,
        "items": groups,
    }
    result["coverage"] = {
        "analyzedItems": item_count,
        "failedItems": 0,
        "totalItems": item_count,
        "percentage": 100,
    }
    result["itemAnalyses"] = analyses
    result["analysisWarnings"] = ["Universal interpretation uses field profiles and complete source rows."]
    result["batchSummary"] = {"completed": 13, "failed": 0, "total": 13}
    return result


def run_pdf_script(script_path, report_path, pdf_path):
    previous_argv = sys.argv
    output = io.StringIO()
    try:
        sys.argv = [str(script_path), str(report_path), str(pdf_path)]
        with contextlib.redirect_stdout(output):
            runpy.run_path(str(script_path), run_name="__main__")
    finally:
        sys.argv = previous_argv
    status = json.loads(output.getvalue().strip().splitlines()[-1])
    assert status.get("ok"), status


def main():
    scripts_dir = Path(__file__).resolve().parent
    config = json.loads(
        (scripts_dir / "fixtures" / "amazon-full-report.json").read_text(encoding="utf-8")
    )
    report = build_report(config)
    universal_config = json.loads(
        (scripts_dir / "fixtures" / "amazon-universal-report.json").read_text(encoding="utf-8")
    )
    universal_report = build_universal_report(universal_config)
    with tempfile.TemporaryDirectory() as tmp:
        report_path = Path(tmp) / "amazon-full.json"
        pdf_path = Path(tmp) / "amazon-full.pdf"
        report_path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        run_pdf_script(scripts_dir / "amazon_pdf.py", report_path, pdf_path)
        reader = PdfReader(str(pdf_path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        first_page_text = reader.pages[0].extract_text() or ""
        second_page_text = reader.pages[1].extract_text() or ""
        legacy_path = Path(tmp) / "amazon-legacy.json"
        legacy_pdf_path = Path(tmp) / "amazon-legacy.pdf"
        legacy_path.write_text(
            json.dumps(
                {
                    "file": "legacy.csv",
                    "metrics": {
                        "rows": 1,
                        "reportTypeName": "广告活动报告",
                        "totals": {
                            "impressions": 100,
                            "clicks": 10,
                            "spend": 5,
                            "sales": 20,
                            "orders": 1,
                            "ctr": 10,
                            "acos": 25,
                            "roas": 4,
                        },
                        "groups": [],
                        "campaigns": [],
                    },
                    "report": {
                        "overview": "Legacy report remains readable.",
                        "issues": [],
                        "actions": {"now": [], "week": [], "ongoing": []},
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        run_pdf_script(scripts_dir / "amazon_pdf.py", legacy_path, legacy_pdf_path)
        legacy_text = "\n".join(
            page.extract_text() or "" for page in PdfReader(str(legacy_pdf_path)).pages
        )
        universal_path = Path(tmp) / "amazon-universal.json"
        universal_pdf_path = Path(tmp) / "amazon-universal.pdf"
        universal_path.write_text(
            json.dumps(universal_report, ensure_ascii=False), encoding="utf-8"
        )
        run_pdf_script(scripts_dir / "amazon_pdf.py", universal_path, universal_pdf_path)
        universal_reader = PdfReader(str(universal_pdf_path))
        universal_text = "\n".join(
            page.extract_text() or "" for page in universal_reader.pages
        )

    assert len(reader.pages) > 1
    assert "覆盖率 125 / 125 · 100%" in text
    assert "campaign-000" in text
    assert "campaign-124" in text
    for plain_heading in (
        "整体健康",
        "最大风险",
        "最大机会",
        "发生了什么",
        "这意味着什么",
        "为什么要处理",
        "今天处理",
        "本周优化",
        "持续观察",
        "每获得 100 元销售额花了多少广告费",
    ):
        assert plain_heading in text
    assert re.search(r"已分析\s*125\s*/\s*125\s*项", text)
    assert "<font" not in text, "ReportLab rich-text tags must not render as visible text"
    assert "先看这三件事" in first_page_text
    assert "全部明细在附录" in first_page_text
    assert "实际 {" not in first_page_text
    assert "阈值 {" not in first_page_text
    assert "优先路线图（前10项）" in text
    assert "其余项目仍在逐项教学和全量附录中" in text
    assert "指标白话说明" not in first_page_text
    assert "AI 深度摘要（参考）" in text
    for heading in (
        "逐项教学手册",
        "数据依据",
        "后台路径",
        "操作步骤",
        "调整范围",
        "观察窗口",
        "成功标准",
        "回滚条件",
    ):
        assert heading in text
    for checklist in ("7天复盘清单", "14天复盘清单", "30天复盘清单"):
        assert checklist in text
    markers = re.findall(r"APPENDIX_ITEM campaign-\d{3}", text)
    assert len(markers) == 125
    assert "Legacy report remains readable." in legacy_text
    assert len(universal_reader.pages) > 1
    assert "通用数据分析手册" in universal_text
    assert "覆盖率 125 / 125 · 100%" in universal_text
    assert "工作表与字段概况" in universal_text
    assert "Operations" in universal_text
    assert "Owners" in universal_text
    assert "Units" in universal_text
    assert "数值范围" in universal_text
    assert "universal-000" in universal_text
    assert "universal-124" in universal_text
    assert "数据路径" in universal_text
    assert "成功标准" in universal_text
    assert "回滚条件" in universal_text
    for universal_heading in (
        "数据健康看板",
        "数据规模",
        "需要确认",
        "字段白话说明",
        "全部源行均已纳入分析",
    ):
        assert universal_heading in universal_text
    for advertising_only_term in ("广告竞价", "广告花费占销售额"):
        assert advertising_only_term not in universal_text
    universal_markers = re.findall(r"UNIVERSAL_ITEM universal-\d{3}", universal_text)
    assert len(universal_markers) == 125


if __name__ == "__main__":
    main()
    print("amazon full PDF tests passed")
