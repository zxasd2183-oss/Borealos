# -*- coding: utf-8 -*-
# 亚马逊广告诊断报告 → 精美 PDF（reportlab + matplotlib）
# 用法: python amazon_pdf.py <report.json> <out.pdf>  → stdout 单行 JSON {"ok":true,...} / {"error":...}
import sys, os, json, tempfile, traceback
from pathlib import Path

FONT_DIR = Path(sys.executable).resolve().parents[2] / "fonts"
FONT_REG = FONT_DIR / "NotoSansSC-Regular.ttf"
FONT_BOLD = FONT_DIR / "NotoSansSC-Bold.ttf"


def plain_metric_label(key):
    explanations = {
        "acos": "ACOS：每获得 100 元销售额花了多少广告费。",
        "roas": "ROAS：每花 1 元广告费带来多少销售额。",
        "ctr": "CTR：看到广告的人里，有多少人点击。",
        "cvr": "CVR：点击广告后，有多少人最终下单。",
    }
    return explanations.get(str(key or "").lower(), str(key or ""))


def action_stage(priority):
    return {
        "high": "今天处理",
        "medium": "本周优化",
        "low": "持续观察",
    }.get(str(priority or "").lower(), "持续观察")


def health_model(rec):
    analyses = rec.get("itemAnalyses") or []
    groups = (rec.get("metrics") or {}).get("groups") or []
    by_id = {item.get("itemId"): item for item in groups}
    counts = {"high": 0, "medium": 0, "low": 0}
    for item in analyses:
        priority = str(item.get("priority") or "").lower()
        if priority in counts:
            counts[priority] += 1
    coverage = rec.get("coverage") or {}
    percentage = float(coverage.get("percentage") or 0)
    if percentage < 100:
        label, color_key = "数据不完整", "red"
    elif counts["high"]:
        label, color_key = "高风险", "red"
    elif counts["medium"]:
        label, color_key = "需关注", "orange"
    elif counts["low"]:
        label, color_key = "良好", "green"
    else:
        label, color_key = "优秀", "green"

    ordered = sorted(
        analyses,
        key=lambda item: (
            {"high": 0, "medium": 1, "low": 2}.get(item.get("priority"), 9),
            -float((by_id.get(item.get("itemId")) or {}).get("spend") or 0),
        ),
    )
    risk = ordered[0] if ordered else {}
    opportunity = next(
        (item for item in reversed(ordered) if item.get("priority") == "low"),
        ordered[-1] if ordered else {},
    )
    return {
        "label": label,
        "colorKey": color_key,
        "counts": counts,
        "risk": by_id.get(risk.get("itemId")) or risk,
        "riskAnalysis": risk,
        "opportunity": by_id.get(opportunity.get("itemId")) or opportunity,
        "opportunityAnalysis": opportunity,
    }


def build_universal_pdf(rec, out_path):
    from xml.sax.saxutils import escape
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import (
        BaseDocTemplate, Frame, PageTemplate, PageBreak, Paragraph, Spacer,
        Table, TableStyle, KeepTogether,
    )
    from pypdf import PdfReader

    pdfmetrics.registerFont(TTFont("NotoSC", str(FONT_REG)))
    pdfmetrics.registerFont(TTFont("NotoSC-Bold", str(FONT_BOLD)))
    metrics = rec.get("metrics") or {}
    groups = metrics.get("groups") or metrics.get("items") or []
    analyses = rec.get("itemAnalyses") or []
    coverage = rec.get("coverage") or {}
    total_items = int(coverage.get("totalItems") or len(groups))
    if len(groups) != total_items:
        raise ValueError(
            "universal PDF requires metrics.groups row count to equal coverage.totalItems"
        )

    PRIMARY = HexColor("#2563EB")
    INK = HexColor("#18181B")
    SUB = HexColor("#66616F")
    LINE = HexColor("#D8E0EF")
    SOFT = HexColor("#F3F7FD")
    GREEN = HexColor("#0F8A5F")
    AMBER = HexColor("#B45309")
    W, H = A4
    ML = MR = 16 * mm
    AVAIL = W - ML - MR

    def style(name, **kwargs):
        base = {
            "fontName": "NotoSC",
            "fontSize": 9,
            "leading": 14,
            "textColor": INK,
            "wordWrap": "CJK",
        }
        base.update(kwargs)
        return ParagraphStyle(name, **base)

    title_style = style("universal-title", fontName="NotoSC-Bold", fontSize=21, leading=27)
    subtitle_style = style("universal-subtitle", fontSize=9, leading=13, textColor=SUB)
    h1_style = style("universal-h1", fontName="NotoSC-Bold", fontSize=15, leading=21, spaceBefore=4)
    h2_style = style("universal-h2", fontName="NotoSC-Bold", fontSize=11, leading=16, spaceBefore=3)
    body_style = style("universal-body", fontSize=9, leading=14)
    small_style = style("universal-small", fontSize=7.5, leading=11, textColor=SUB)
    head_style = style(
        "universal-head", fontName="NotoSC-Bold", fontSize=7.5, leading=10,
        textColor=white, alignment=TA_CENTER,
    )
    cell_style = style("universal-cell", fontSize=7.2, leading=10)

    def page_header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PRIMARY)
        canvas.rect(0, H - 11 * mm, W, 11 * mm, fill=1, stroke=0)
        canvas.setFillColor(white)
        canvas.setFont("NotoSC-Bold", 8.5)
        canvas.drawString(ML, H - 7.2 * mm, "Borealos · 通用数据分析手册")
        canvas.setFont("NotoSC", 7.5)
        canvas.drawRightString(W - MR, H - 7.2 * mm, str(rec.get("file") or "Universal report"))
        canvas.setStrokeColor(LINE)
        canvas.line(ML, 13 * mm, W - MR, 13 * mm)
        canvas.setFillColor(SUB)
        canvas.setFont("NotoSC", 7)
        canvas.drawString(ML, 9 * mm, "全部工作表 · 完整源行 · 可验证解释")
        canvas.drawRightString(W - MR, 9 * mm, "第 %d 页" % canvas.getPageNumber())
        canvas.restoreState()

    doc = BaseDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=ML,
        rightMargin=MR,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title="通用数据分析手册",
    )
    frame = Frame(ML, 18 * mm, AVAIL, H - 35 * mm, id="universal")
    doc.addPageTemplates([
        PageTemplate(id="universal", frames=[frame], onPage=page_header_footer)
    ])

    def paragraph(text, paragraph_style=body_style):
        return Paragraph(escape(str(text if text is not None else "—")), paragraph_style)

    def profile_detail(profile):
        if profile.get("numeric"):
            stats = profile["numeric"]
            return "数值范围 %s - %s；总和 %s；均值 %s" % (
                stats.get("min"), stats.get("max"), stats.get("sum"), stats.get("mean")
            )
        if profile.get("dateRange"):
            return "日期范围 %s - %s" % (
                profile["dateRange"].get("min"), profile["dateRange"].get("max")
            )
        if profile.get("topValues"):
            return "常见值 " + "、".join(
                "%s (%s)" % (item.get("value"), item.get("count"))
                for item in profile["topValues"][:8]
            )
        return "无可汇总的非空值"

    story = [
        Spacer(1, 3 * mm),
        Paragraph("通用数据分析手册", title_style),
        Spacer(1, 1.5 * mm),
        paragraph(
            "%s · %s 行源数据 · %s 个工作表 · %s 个字段"
            % (
                rec.get("file") or "—",
                metrics.get("sourceRowCount") or metrics.get("rows") or 0,
                len(metrics.get("sheets") or []),
                len(metrics.get("columns") or []),
            ),
            subtitle_style,
        ),
        Spacer(1, 5 * mm),
    ]
    percentage = float(coverage.get("percentage") or 0)
    coverage_color = GREEN if percentage == 100 else AMBER
    coverage_text = "覆盖率 %s / %s · %s%%" % (
        coverage.get("analyzedItems", 0), total_items, coverage.get("percentage", 0)
    )
    coverage_note = (
        "全部有效源行均已完成解释。"
        if percentage == 100
        else "部分结果：未解释 %s 行，不得标记为完整分析。" % coverage.get("failedItems", 0)
    )
    coverage_box = Table(
        [[
            Paragraph(
                '<font name="NotoSC-Bold" color="%s">%s</font>'
                % (coverage_color.hexval(), escape(coverage_text)),
                body_style,
            ),
            paragraph(coverage_note, small_style),
        ]],
        colWidths=[AVAIL * 0.42, AVAIL * 0.58],
    )
    coverage_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.8, coverage_color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([coverage_box, Spacer(1, 5 * mm), Paragraph("数据健康看板", h1_style)])
    totals = metrics.get("totals") or {}
    sheets = metrics.get("sheets") or []
    field_count = int(totals.get("columnCount") or len(metrics.get("columns") or []))
    invalid_rows = max(
        0,
        int(totals.get("sourceRows") or metrics.get("sourceRowCount") or 0)
        - int(totals.get("validRows") or metrics.get("validRowCount") or 0),
    )
    universal_cards = Table(
        [[
            Paragraph(
                '<font name="NotoSC-Bold" color="#2563EB">数据规模</font><br/>'
                '%s 个工作表 · %s 行 · %s 个字段'
                % (
                    totals.get("sheetCount") or len(sheets),
                    totals.get("sourceRows") or metrics.get("sourceRowCount") or 0,
                    field_count,
                ),
                body_style,
            ),
            Paragraph(
                '<font name="NotoSC-Bold" color="#0F8A5F">完整覆盖</font><br/>'
                '全部源行均已纳入分析：%s/%s 项'
                % (coverage.get("analyzedItems", 0), total_items),
                body_style,
            ),
            Paragraph(
                '<font name="NotoSC-Bold" color="#B45309">需要确认</font><br/>'
                '%s 行格式或业务含义需要人工复核' % invalid_rows,
                body_style,
            ),
        ]],
        colWidths=[AVAIL / 3] * 3,
    )
    universal_cards.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), HexColor("#EFF6FF")),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#ECFDF5")),
        ("BACKGROUND", (2, 0), (2, 0), HexColor("#FFF7ED")),
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.extend([
        universal_cards,
        Spacer(1, 4 * mm),
        Paragraph("字段白话说明", h2_style),
        paragraph(
            "数值字段用来比较大小、合计和变化；日期字段用来确认时间范围；"
            "分类字段用来比较不同分组；文本字段保留原文，不擅自推断业务含义。"
        ),
        paragraph(
            "无法从列名和源值确认含义的字段会原样保留，并标记为需要人工确认。"
        ),
        Spacer(1, 4 * mm),
        Paragraph("通用摘要", h1_style),
    ])
    report = rec.get("report") or {}
    story.append(paragraph(report.get("overview") or "未生成全局摘要。"))
    summary = Table(
        [[
            paragraph("源数据行\n%s" % (metrics.get("sourceRowCount") or 0)),
            paragraph("有效行\n%s" % (metrics.get("validRowCount") or 0)),
            paragraph("工作表\n%s" % len(metrics.get("sheets") or [])),
            paragraph("字段\n%s" % len(metrics.get("columns") or [])),
        ]],
        colWidths=[AVAIL / 4] * 4,
    )
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.extend([Spacer(1, 3 * mm), summary, Spacer(1, 5 * mm)])

    story.append(Paragraph("工作表与字段概况", h1_style))
    for sheet in metrics.get("sheets") or []:
        story.append(Paragraph(
            "%s · %s 有效行 · %s 字段"
            % (sheet.get("name"), sheet.get("validRowCount", 0), sheet.get("columnCount", 0)),
            h2_style,
        ))
        profile_rows = [[
            Paragraph("字段", head_style),
            Paragraph("类型", head_style),
            Paragraph("非空", head_style),
            Paragraph("去重", head_style),
            Paragraph("范围 / 分类概况", head_style),
        ]]
        for profile in sheet.get("profiles") or []:
            profile_rows.append([
                paragraph(profile.get("field"), cell_style),
                paragraph(profile.get("kind"), cell_style),
                paragraph(profile.get("nonEmptyCount"), cell_style),
                paragraph(profile.get("distinctCount"), cell_style),
                paragraph(profile_detail(profile), cell_style),
            ])
        profile_table = Table(
            profile_rows,
            colWidths=[34 * mm, 19 * mm, 16 * mm, 16 * mm, AVAIL - 85 * mm],
            repeatRows=1,
        )
        profile_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.extend([profile_table, Spacer(1, 3 * mm)])

    story.extend([PageBreak(), Paragraph("逐行教学手册", h1_style)])
    analysis_by_id = {item.get("itemId"): item for item in analyses}
    for index, group in enumerate(groups, 1):
        item_id = group.get("itemId") or "universal-%03d" % index
        item = analysis_by_id.get(item_id) or {
            "priority": "unanalyzed",
            "dataBasis": json.dumps(group.get("values") or {}, ensure_ascii=False),
            "reason": "该行的结构化解释未完成。",
            "consolePath": "数据源 > %s > Row %s" % (
                group.get("sheetName") or "工作表", group.get("rowNumber") or "—"
            ),
            "steps": ["重新运行缺失批次", "确认源行后再记录结论"],
            "adjustment": "暂不调整",
            "observationWindow": "待解释完成",
            "successCriteria": "补齐并验证该行解释",
            "rollbackCondition": "未执行调整，无需回滚",
        }
        flowables = [
            Paragraph(
                "#%03d %s (%s) · %s"
                % (index, escape(str(group.get("name") or item_id)), escape(str(item_id)), escape(str(item.get("priority") or "—"))),
                h2_style,
            ),
            paragraph("源数据：" + json.dumps(group.get("values") or {}, ensure_ascii=False)),
            paragraph("数据依据：" + str(item.get("dataBasis") or "—")),
            paragraph("解释：" + str(item.get("reason") or "—")),
            paragraph("数据路径：" + str(item.get("consolePath") or "—")),
            paragraph("验证步骤："),
        ]
        for step_index, step in enumerate(item.get("steps") or [], 1):
            flowables.append(paragraph("%d. %s" % (step_index, step)))
        flowables.extend([
            paragraph("调整或观察：" + str(item.get("adjustment") or "—")),
            paragraph("复核周期：" + str(item.get("observationWindow") or "—")),
            paragraph("成功标准：" + str(item.get("successCriteria") or "—")),
            paragraph("回滚条件：" + str(item.get("rollbackCondition") or "—")),
            Spacer(1, 3 * mm),
        ])
        story.append(KeepTogether(flowables))

    story.extend([PageBreak(), Paragraph("全量源数据附录", h1_style)])
    story.append(paragraph(
        "附录行数 %d，与 coverage.totalItems 完全一致；表头跨页重复。" % total_items,
        small_style,
    ))
    appendix = [[
        Paragraph("项目标识", head_style),
        Paragraph("工作表 / 行", head_style),
        Paragraph("完整源值", head_style),
    ]]
    for group in groups:
        item_id = group.get("itemId") or "—"
        appendix.append([
            paragraph("UNIVERSAL_ITEM " + item_id, cell_style),
            paragraph(group.get("name") or "—", cell_style),
            paragraph(json.dumps(group.get("values") or {}, ensure_ascii=False, sort_keys=True), cell_style),
        ])
    appendix_table = Table(
        appendix,
        colWidths=[43 * mm, 38 * mm, AVAIL - 81 * mm],
        repeatRows=1,
    )
    appendix_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.extend([appendix_table, PageBreak(), Paragraph("复核清单", h1_style)])
    for heading, items in [
        ("7天复核清单", ["确认字段定义与单位。", "抽查源行和解释是否一致。", "记录新增分类和异常值。"]),
        ("14天复核清单", ["比较工作表之间的字段关系。", "复核数值与日期范围变化。", "撤销无法由源数据验证的结论。"]),
        ("30天复核清单", ["重新运行全量 profile。", "确认新增行全部进入覆盖率。", "归档字段变更和解释规则。"]),
    ]:
        story.append(Paragraph(heading, h2_style))
        for item in items:
            story.append(paragraph("□ " + item))
        story.append(Spacer(1, 2 * mm))
    story.extend([Spacer(1, 3 * mm), Paragraph("警告与方法", h1_style)])
    for warning in rec.get("analysisWarnings") or ["无分析警告。"]:
        story.append(paragraph("• " + str(warning)))
    story.append(paragraph(
        "方法：读取全部工作表，按字段统计非空、去重、数值范围、日期范围和分类概况；每个有效源行生成稳定 itemId 并参与动态批次解释。",
        small_style,
    ))

    doc.build(story)
    pages = len(PdfReader(out_path).pages)
    print(json.dumps({"ok": True, "pages": pages, "size": os.path.getsize(out_path)}))


def build_expanded_pdf(rec, out_path):
    from xml.sax.saxutils import escape
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import (
        BaseDocTemplate, Frame, PageTemplate, PageBreak, Paragraph, Spacer,
        Table, TableStyle, KeepTogether,
    )
    from pypdf import PdfReader

    pdfmetrics.registerFont(TTFont("NotoSC", str(FONT_REG)))
    pdfmetrics.registerFont(TTFont("NotoSC-Bold", str(FONT_BOLD)))

    metrics = rec.get("metrics") or {}
    totals = metrics.get("totals") or {}
    groups = metrics.get("groups") or []
    analyses = rec.get("itemAnalyses") or []
    coverage = rec.get("coverage") or {}
    total_items = int(coverage.get("totalItems") or len(groups))
    if len(groups) != total_items:
        raise ValueError(
            "expanded PDF requires metrics.groups row count to equal coverage.totalItems"
        )

    PRIMARY = HexColor("#6D4AFF")
    INK = HexColor("#18181B")
    SUB = HexColor("#66616F")
    LINE = HexColor("#DED8EE")
    SOFT = HexColor("#F7F5FC")
    GREEN = HexColor("#0F8A5F")
    AMBER = HexColor("#B45309")
    RED = HexColor("#C43D4B")
    W, H = A4
    ML = MR = 16 * mm
    AVAIL = W - ML - MR

    def style(name, **kwargs):
        base = {
            "fontName": "NotoSC",
            "fontSize": 9,
            "leading": 14,
            "textColor": INK,
            "wordWrap": "CJK",
        }
        base.update(kwargs)
        return ParagraphStyle(name, **base)

    title_style = style("full-title", fontName="NotoSC-Bold", fontSize=21, leading=27)
    subtitle_style = style("full-subtitle", fontSize=9, leading=13, textColor=SUB)
    h1_style = style("full-h1", fontName="NotoSC-Bold", fontSize=15, leading=21, spaceBefore=4)
    h2_style = style("full-h2", fontName="NotoSC-Bold", fontSize=11, leading=16, spaceBefore=3)
    body_style = style("full-body", fontSize=9, leading=14)
    small_style = style("full-small", fontSize=7.5, leading=11, textColor=SUB)
    head_style = style(
        "full-head", fontName="NotoSC-Bold", fontSize=7.5, leading=10,
        textColor=white, alignment=TA_CENTER,
    )
    cell_style = style("full-cell", fontSize=7, leading=9)
    cell_right = style("full-cell-right", fontSize=7, leading=9, alignment=TA_RIGHT)

    def page_header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PRIMARY)
        canvas.rect(0, H - 11 * mm, W, 11 * mm, fill=1, stroke=0)
        canvas.setFillColor(white)
        canvas.setFont("NotoSC-Bold", 8.5)
        canvas.drawString(ML, H - 7.2 * mm, "Borealos · 亚马逊全量优化手册")
        canvas.setFont("NotoSC", 7.5)
        canvas.drawRightString(W - MR, H - 7.2 * mm, escape(str(rec.get("file") or "Amazon report")))
        canvas.setStrokeColor(LINE)
        canvas.line(ML, 13 * mm, W - MR, 13 * mm)
        canvas.setFillColor(SUB)
        canvas.setFont("NotoSC", 7)
        canvas.drawString(ML, 9 * mm, "完整数据 · 可执行步骤 · 可量化复盘")
        canvas.drawRightString(W - MR, 9 * mm, "第 %d 页" % canvas.getPageNumber())
        canvas.restoreState()

    doc = BaseDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=ML,
        rightMargin=MR,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title="亚马逊广告全量优化手册",
    )
    frame = Frame(ML, 18 * mm, AVAIL, H - 35 * mm, id="expanded")
    doc.addPageTemplates([
        PageTemplate(id="expanded", frames=[frame], onPage=page_header_footer)
    ])

    def paragraph(text, paragraph_style=body_style):
        return Paragraph(escape(str(text if text is not None else "—")), paragraph_style)

    def money(value):
        try:
            return "$%0.2f" % float(value or 0)
        except Exception:
            return str(value or 0)

    def number(value):
        try:
            return f"{int(round(float(value or 0))):,}"
        except Exception:
            return str(value or 0)

    story = [
        Spacer(1, 3 * mm),
        Paragraph("亚马逊广告全量优化手册", title_style),
        Spacer(1, 1.5 * mm),
        paragraph(
            "%s · %s · %s 行原始数据"
            % (
                rec.get("reportTypeName") or metrics.get("reportTypeName") or "广告报告",
                rec.get("file") or "—",
                metrics.get("sourceRowCount") or metrics.get("rows") or 0,
            ),
            subtitle_style,
        ),
        Spacer(1, 5 * mm),
    ]

    percentage = coverage.get("percentage", 0)
    coverage_color = GREEN if float(percentage or 0) == 100 else AMBER
    coverage_text = "覆盖率 %s / %s · %s%%" % (
        coverage.get("analyzedItems", 0),
        total_items,
        percentage,
    )
    coverage_note = (
        "全部项目均已完成逐项分析。"
        if float(percentage or 0) == 100
        else "部分结果：未分析 %s 项，本报告不得标记为完整分析。"
        % coverage.get("failedItems", 0)
    )
    coverage_box = Table(
        [[
            Paragraph(
                '<font name="NotoSC-Bold" color="%s">%s</font>'
                % (coverage_color.hexval(), escape(coverage_text)),
                body_style,
            ),
            paragraph(coverage_note, small_style),
        ]],
        colWidths=[AVAIL * 0.42, AVAIL * 0.58],
    )
    coverage_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.8, coverage_color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([coverage_box, Spacer(1, 5 * mm)])

    health = health_model(rec)
    palette = {
        "purple": HexColor("#7C3AED"),
        "blue": HexColor("#2563EB"),
        "green": HexColor("#059669"),
        "orange": HexColor("#D97706"),
        "red": HexColor("#DC2626"),
    }
    health_color = palette[health["colorKey"]]
    health_color_code = {
        "red": "#DC2626",
        "orange": "#D97706",
        "green": "#059669",
    }[health["colorKey"]]
    risk = health.get("risk") or {}
    risk_analysis = health.get("riskAnalysis") or {}
    opportunity = health.get("opportunity") or {}
    opportunity_analysis = health.get("opportunityAnalysis") or {}

    story.append(Paragraph("整体健康", h1_style))
    dashboard = Table(
        [
            [
                Paragraph(
                    '<font name="NotoSC-Bold" color="%s">%s</font><br/>'
                    '<font color="#66616F">红色标签：需要优先处理</font>'
                    % (health_color_code, escape(health["label"])),
                    body_style,
                ),
                Paragraph(
                    '<font name="NotoSC-Bold" color="#2563EB">已分析 %s/%s 项</font><br/>'
                    '<font color="#66616F">所有有效项目均进入逐项判断</font>'
                    % (coverage.get("analyzedItems", 0), total_items),
                    body_style,
                ),
            ],
            [
                Paragraph(
                    '<font name="NotoSC-Bold" color="#DC2626">最大风险</font><br/>%s<br/>%s'
                    % (
                        escape(str(risk.get("name") or risk.get("itemId") or "暂无高风险项目")),
                        escape(str(risk_analysis.get("reason") or "当前数据未发现明确高风险。")),
                    ),
                    body_style,
                ),
                Paragraph(
                    '<font name="NotoSC-Bold" color="#059669">最大机会</font><br/>%s<br/>%s'
                    % (
                        escape(str(opportunity.get("name") or opportunity.get("itemId") or "继续保持现有表现")),
                        escape(str(opportunity_analysis.get("reason") or "保持观察并积累更多数据。")),
                    ),
                    body_style,
                ),
            ],
        ],
        colWidths=[AVAIL / 2, AVAIL / 2],
    )
    dashboard.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), HexColor("#FFF1F2") if health["colorKey"] == "red" else HexColor("#F0FDF4")),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#EFF6FF")),
        ("BACKGROUND", (0, 1), (0, 1), HexColor("#FFF1F2")),
        ("BACKGROUND", (1, 1), (1, 1), HexColor("#ECFDF5")),
        ("GRID", (0, 0), (-1, -1), 0.7, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([dashboard, Spacer(1, 4 * mm)])

    story.append(Paragraph("执行摘要", h1_style))
    summary_rows = [
        [paragraph("曝光", small_style), paragraph(number(totals.get("impressions")))],
        [paragraph("点击", small_style), paragraph(number(totals.get("clicks")))],
        [paragraph("花费", small_style), paragraph(money(totals.get("spend")))],
        [paragraph("销售额", small_style), paragraph(money(totals.get("sales")))],
        [paragraph("订单", small_style), paragraph(number(totals.get("orders")))],
        [paragraph("ACOS", small_style), paragraph(str(totals.get("acos", 0)) + "%")],
    ]
    summary = Table(
        [summary_rows[:3], summary_rows[3:]],
        colWidths=[AVAIL / 3] * 3,
    )
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.extend([summary, Spacer(1, 3 * mm)])
    report = rec.get("report") or {}
    story.append(paragraph(
        "本次共分析 %s 项：%s 项需要今天处理，%s 项建议本周优化，其余项目继续观察。"
        "先完成下方三件事，再按第二页路线图操作。"
        % (
            total_items,
            health["counts"].get("high", 0),
            health["counts"].get("medium", 0),
        )
    ))
    group_lookup = {item.get("itemId"): item for item in groups}
    top_three = sorted(
        analyses,
        key=lambda item: (
            {"high": 0, "medium": 1, "low": 2}.get(item.get("priority"), 9),
            -float((group_lookup.get(item.get("itemId")) or {}).get("spend") or 0),
        ),
    )[:3]
    story.extend([
        Spacer(1, 3 * mm),
        Paragraph("先看这三件事", h1_style),
        paragraph("这里只放最重要的结论；全部明细在附录，所有项目仍然参与分析。", small_style),
    ])
    if top_three:
        focus_rows = []
        for index, item in enumerate(top_three, 1):
            group = group_lookup.get(item.get("itemId")) or {}
            focus_rows.append([
                Paragraph(
                    '<font name="NotoSC-Bold" color="#DC2626">%s</font>' % index,
                    body_style,
                ),
                paragraph(group.get("name") or item.get("itemId") or "—", body_style),
                paragraph(item.get("reason") or "请按数据依据复核该项目。", body_style),
                paragraph(action_stage(item.get("priority")), body_style),
            ])
        focus_table = Table(
            focus_rows,
            colWidths=[10 * mm, 42 * mm, AVAIL - 77 * mm, 25 * mm],
        )
        focus_table.setStyle(TableStyle([
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [HexColor("#FFF7F7"), white]),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(focus_table)

    story.extend([Spacer(1, 4 * mm), Paragraph("分阶段行动清单", h1_style)])
    stage_cards = []
    for stage_name, priority, color_code in (
        ("今天处理", "high", "#DC2626"),
        ("本周优化", "medium", "#D97706"),
        ("持续观察", "low", "#059669"),
    ):
        count = sum(1 for item in analyses if item.get("priority") == priority)
        stage_cards.append(
            Paragraph(
                '<font name="NotoSC-Bold" color="%s">%s</font><br/>%s 项'
                % (color_code, stage_name, count),
                body_style,
            )
        )
    stage_table = Table([stage_cards], colWidths=[AVAIL / 3] * 3)
    stage_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), HexColor("#FFF1F2")),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#FFF7ED")),
        ("BACKGROUND", (2, 0), (2, 0), HexColor("#ECFDF5")),
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.extend([
        stage_table,
        Spacer(1, 4 * mm),
        Paragraph("优先路线图（前10项）", h1_style),
        paragraph("先处理这 10 项；其余项目仍在逐项教学和全量附录中。", small_style),
    ])
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    group_by_id = {item.get("itemId"): item for item in groups}
    sorted_analyses = sorted(
        analyses,
        key=lambda item: (
            priority_rank.get(item.get("priority"), 9),
            -float((group_by_id.get(item.get("itemId")) or {}).get("spend") or 0),
        ),
    )
    roadmap_data = [[
        Paragraph("优先级", head_style),
        Paragraph("项目", head_style),
        Paragraph("调整范围", head_style),
        Paragraph("观察窗口", head_style),
        Paragraph("成功标准", head_style),
    ]]
    for item in sorted_analyses[:10]:
        group = group_by_id.get(item.get("itemId")) or {}
        roadmap_data.append([
            paragraph(item.get("priority"), cell_style),
            paragraph(group.get("name") or item.get("itemId"), cell_style),
            paragraph(item.get("adjustment"), cell_style),
            paragraph(item.get("observationWindow"), cell_style),
            paragraph(item.get("successCriteria"), cell_style),
        ])
    roadmap_table = Table(
        roadmap_data,
        colWidths=[14 * mm, 37 * mm, 34 * mm, 24 * mm, AVAIL - 109 * mm],
        repeatRows=1,
    )
    roadmap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.extend([roadmap_table, PageBreak(), Paragraph("逐项教学手册", h1_style)])
    story.append(paragraph("每个项目均包含数据依据、后台路径、编号步骤、调整范围、观察窗口、成功标准与回滚条件。", small_style))
    story.append(Spacer(1, 3 * mm))

    analysis_by_id = {item.get("itemId"): item for item in analyses}
    for index, group in enumerate(groups, 1):
        item_id = group.get("itemId") or "item-%03d" % index
        item = analysis_by_id.get(item_id)
        if not item:
            item = {
                "priority": "unanalyzed",
                "dataBasis": "Spend %s, sales %s, orders %s."
                % (
                    money(group.get("spend")),
                    money(group.get("sales")),
                    number(group.get("orders")),
                ),
                "reason": "该项目的 AI 批次未完成；仅显示确定性指标，不应视为完整建议。",
                "consolePath": "Campaign Manager > 对应项目",
                "steps": ["重新运行缺失批次", "验证 itemId 后再执行任何调整"],
                "adjustment": "暂不调整",
                "observationWindow": "待分析完成后确定",
                "successCriteria": "补齐并验证该项目的结构化分析",
                "rollbackCondition": "未执行调整，无需回滚",
            }
        title = "#%03d %s (%s) · %s" % (
            index,
            group.get("name") or item_id,
            item_id,
            item.get("priority") or "—",
        )
        steps = [
            paragraph(title, h2_style),
            paragraph("行动阶段：" + action_stage(item.get("priority"))),
            paragraph("发生了什么：" + str(item.get("dataBasis") or "—")),
            paragraph("这意味着什么：" + str(item.get("reason") or "—")),
            paragraph(
                "为什么要处理："
                + (
                    "这是高优先级问题，继续不处理可能扩大浪费或损失。"
                    if item.get("priority") == "high"
                    else "及时复核可以减少误判，并确认是否存在可复制的增长机会。"
                )
            ),
            paragraph("判断依据：" + str(item.get("dataBasis") or "—")),
            paragraph("后台路径：" + str(item.get("consolePath") or "—")),
            paragraph("操作步骤："),
        ]
        for step_index, step in enumerate(item.get("steps") or [], 1):
            steps.append(paragraph("%d. %s" % (step_index, step)))
        steps.extend([
            paragraph("调整范围：" + str(item.get("adjustment") or "—")),
            paragraph("观察窗口：" + str(item.get("observationWindow") or "—")),
            paragraph("成功标准：" + str(item.get("successCriteria") or "—")),
            paragraph("回滚条件：" + str(item.get("rollbackCondition") or "—")),
            Spacer(1, 3 * mm),
        ])
        story.append(KeepTogether(steps))

    story.extend([PageBreak(), Paragraph("全量数据附录", h1_style)])
    story.append(paragraph(
        "附录行数 %d，与 coverage.totalItems 完全一致；表头跨页重复。" % total_items,
        small_style,
    ))
    appendix_data = [[
        Paragraph("项目标识", head_style),
        Paragraph("名称", head_style),
        Paragraph("花费", head_style),
        Paragraph("销售", head_style),
        Paragraph("订单", head_style),
        Paragraph("ACOS", head_style),
        Paragraph("优先级", head_style),
    ]]
    for group in groups:
        item_id = group.get("itemId") or "—"
        item = analysis_by_id.get(item_id) or {}
        appendix_data.append([
            paragraph("APPENDIX_ITEM " + item_id, cell_style),
            paragraph(group.get("name") or "—", cell_style),
            paragraph(money(group.get("spend")), cell_right),
            paragraph(money(group.get("sales")), cell_right),
            paragraph(number(group.get("orders")), cell_right),
            paragraph(str(group.get("acos", 0)) + "%", cell_right),
            paragraph(item.get("priority") or "未分析", cell_style),
        ])
    appendix_table = Table(
        appendix_data,
        colWidths=[40 * mm, 39 * mm, 22 * mm, 22 * mm, 15 * mm, 18 * mm, AVAIL - 156 * mm],
        repeatRows=1,
    )
    appendix_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    story.extend([appendix_table, PageBreak(), Paragraph("复盘清单", h1_style)])
    checklists = [
        ("7天复盘清单", [
            "核对每项调整是否按后台路径执行并留存原值。",
            "检查曝光、点击、订单与 ACOS 是否达到成功标准。",
            "触发回滚条件的项目立即恢复原设置。",
        ]),
        ("14天复盘清单", [
            "比较两周趋势，避免用单日波动判断成败。",
            "把有效调整复制到相似项目前先重新核对数据依据。",
            "对仍无转化的高花费项目执行第二次止损评审。",
        ]),
        ("30天复盘清单", [
            "汇总预算迁移、竞价变化与利润影响。",
            "归档成功、失败与回滚案例，更新下一周期阈值。",
            "重新运行全量分析，确认覆盖率仍为 100%。",
        ]),
    ]
    for heading, items in checklists:
        story.append(Paragraph(heading, h2_style))
        for item in items:
            story.append(paragraph("□ " + item))
        story.append(Spacer(1, 2 * mm))

    story.extend([
        Spacer(1, 4 * mm),
        Paragraph("指标白话说明", h1_style),
        paragraph(plain_metric_label("acos")),
        paragraph(plain_metric_label("roas")),
        paragraph(plain_metric_label("ctr")),
        paragraph(plain_metric_label("cvr")),
        Spacer(1, 3 * mm),
        Paragraph("AI 深度摘要（参考）", h1_style),
        paragraph(report.get("overview") or "本次未生成 AI 深度摘要。"),
        Spacer(1, 4 * mm),
        Paragraph("警告与方法附录", h1_style),
    ])
    warnings = rec.get("analysisWarnings") or []
    if warnings:
        for warning in warnings:
            story.append(paragraph("• " + str(warning)))
    else:
        story.append(paragraph("无分析警告。"))
    story.append(paragraph(
        "方法：Python 对全部有效行进行确定性聚合；Node 按字符预算动态分批，严格验证逐项教学字段与 itemId，合并后计算精确覆盖率。"
    ))
    story.append(paragraph(
        "限制：AI 建议用于辅助投放决策；任何调整均应在观察窗口内按成功标准复盘，并在触发条件时回滚。",
        small_style,
    ))

    doc.build(story)
    pages = len(PdfReader(out_path).pages)
    print(json.dumps({"ok": True, "pages": pages, "size": os.path.getsize(out_path)}))

def main():
    json_path, out_path = sys.argv[1], sys.argv[2]
    rec = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if (rec.get("metrics") or {}).get("reportType") == "universal":
        build_universal_pdf(rec, out_path)
        return
    if rec.get("analysisVersion"):
        build_expanded_pdf(rec, out_path)
        return
    m = rec.get("metrics") or {}
    t = m.get("totals") or {}
    rp = rec.get("report") or None

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                    Table, TableStyle, Image, NextPageTemplate, KeepTogether)

    pdfmetrics.registerFont(TTFont("NotoSC", str(FONT_REG)))
    pdfmetrics.registerFont(TTFont("NotoSC-Bold", str(FONT_BOLD)))

    PRIMARY = HexColor("#7C3AED"); PRIMARY2 = HexColor("#5E5CE6")
    INK = HexColor("#1B1B1F"); SUB = HexColor("#6E6E73"); LINE = HexColor("#E7E4F0")
    RED = HexColor("#E5484D"); AMBER = HexColor("#F5A524"); GREEN = HexColor("#30A46C")
    BG_SOFT = HexColor("#F5F3FC"); BG_CARD = HexColor("#FBFAFE")

    import datetime
    created = rec.get("created")
    dt = datetime.datetime.fromtimestamp(created / 1000) if created else datetime.datetime.now()
    date_str = dt.strftime("%Y-%m-%d %H:%M")
    rtype = rec.get("reportTypeName") or m.get("reportTypeName") or "广告报告"
    src_file = rec.get("file") or "—"
    brand_line = "Borealos · 亚马逊广告诊断报告 · " + rtype

    W, H = A4
    ML = MR = 16 * mm
    AVAIL = W - ML - MR

    def footer(cv, doc):
        cv.saveState()
        cv.setStrokeColor(LINE); cv.setLineWidth(0.6)
        cv.line(ML, 13.5 * mm, W - MR, 13.5 * mm)
        cv.setFont("NotoSC", 7.5); cv.setFillColor(SUB)
        cv.drawString(ML, 9.5 * mm, "Borealos 出品 · AI 诊断仅供投放优化参考")
        cv.drawRightString(W - MR, 9.5 * mm, "第 %d 页" % cv.getPageNumber())
        cv.restoreState()

    def first_page(cv, doc):
        cv.saveState()
        band = 30 * mm
        cv.setFillColor(PRIMARY); cv.rect(0, H - band, W, band, fill=1, stroke=0)
        cv.setFillColor(PRIMARY2); cv.rect(0, H - band, W * 0.45, band, fill=1, stroke=0)
        cv.setFillColor(PRIMARY); cv.rect(W * 0.45, H - band, W * 0.55, band, fill=1, stroke=0)
        cv.setFillColor(HexColor("#8B5CF6")); cv.rect(0, H - band - 1.6 * mm, W, 1.6 * mm, fill=1, stroke=0)
        cv.setFillColor(white)
        cv.setFont("NotoSC-Bold", 14); cv.drawString(ML, H - 15 * mm, "● Borealos")
        cv.setFont("NotoSC", 10); cv.drawRightString(W - MR, H - 14 * mm, "亚马逊广告诊断报告")
        cv.setFont("NotoSC", 8); cv.drawRightString(W - MR, H - 20.5 * mm, rtype + " · " + date_str)
        cv.setFont("NotoSC", 8); cv.drawString(ML, H - 21 * mm, "AI-Powered Ads Intelligence")
        footer(cv, doc)
        cv.restoreState()

    def later_page(cv, doc):
        cv.saveState()
        band = 12 * mm
        cv.setFillColor(PRIMARY); cv.rect(0, H - band, W, band, fill=1, stroke=0)
        cv.setFillColor(HexColor("#8B5CF6")); cv.rect(0, H - band - 1.2 * mm, W, 1.2 * mm, fill=1, stroke=0)
        cv.setFillColor(white)
        cv.setFont("NotoSC-Bold", 9); cv.drawString(ML, H - 8 * mm, "● Borealos")
        cv.setFont("NotoSC", 8); cv.drawRightString(W - MR, H - 8 * mm, brand_line)
        footer(cv, doc)
        cv.restoreState()

    doc = BaseDocTemplate(out_path, pagesize=A4, leftMargin=ML, rightMargin=MR,
                          topMargin=38 * mm, bottomMargin=20 * mm, title="亚马逊广告诊断报告")
    f_first = Frame(ML, 20 * mm, AVAIL, H - 38 * mm - 20 * mm, id="f1")
    f_later = Frame(ML, 20 * mm, AVAIL, H - 20 * mm - 20 * mm, id="f2")
    doc.addPageTemplates([PageTemplate(id="first", frames=[f_first], onPage=first_page),
                          PageTemplate(id="later", frames=[f_later], onPage=later_page)])

    def st(name, **kw):
        base = dict(fontName="NotoSC", fontSize=9.5, leading=15, textColor=INK, wordWrap="CJK")
        base.update(kw); return ParagraphStyle(name, **base)
    st_title = st("t", fontName="NotoSC-Bold", fontSize=21, leading=27)
    st_sub = st("s", fontSize=10, textColor=SUB, leading=14)
    st_h2 = st("h2", fontName="NotoSC-Bold", fontSize=13, leading=18, spaceBefore=6)
    st_kpi_v = st("kv", fontName="NotoSC-Bold", fontSize=15, leading=19, alignment=TA_CENTER)
    st_kpi_k = st("kk", fontSize=8.5, textColor=SUB, alignment=TA_CENTER, leading=12)
    st_cell = st("c", fontSize=8.5, leading=12)
    st_cell_r = st("cr", fontSize=8.5, leading=12, alignment=TA_RIGHT)
    st_head = st("hd", fontName="NotoSC-Bold", fontSize=8.5, leading=12, textColor=white)
    st_head_r = st("hdr", fontName="NotoSC-Bold", fontSize=8.5, leading=12, textColor=white, alignment=TA_RIGHT)
    st_info_k = st("ik", fontSize=8, textColor=SUB, leading=11)
    st_info_v = st("iv", fontName="NotoSC-Bold", fontSize=10, leading=14)
    st_body = st("b", fontSize=9.5, leading=15.5)
    st_small = st("sm", fontSize=8.5, textColor=SUB, leading=12.5)
    st_bullet = st("bl", fontSize=9, leading=14.5, leftIndent=8)

    def fi(v):
        try: return f"{int(round(float(v))):,}"
        except Exception: return str(v)
    def fmo(v):
        try: return f"${float(v):,.2f}"
        except Exception: return str(v)

    story = [NextPageTemplate("later")]

    # ---------- 标题与信息卡 ----------
    story.append(Paragraph("亚马逊广告诊断报告", st_title))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(f'{rtype}　·　源文件 {src_file}　·　分析时间 {date_str}', st_sub))
    story.append(Spacer(1, 5 * mm))
    info = Table([[ [Paragraph("报告类型", st_info_k), Paragraph(rtype, st_info_v)],
                    [Paragraph("数据行数", st_info_k), Paragraph(fi(m.get("rows") or 0), st_info_v)],
                    [Paragraph("分析时间", st_info_k), Paragraph(date_str, st_info_v)],
                    [Paragraph("诊断引擎", st_info_k), Paragraph("DeepSeek AI", st_info_v)] ]],
                 colWidths=[AVAIL / 4] * 4)
    info.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_CARD), ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("LINEBEFORE", (1, 0), (-1, -1), 0.6, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(info)
    story.append(Spacer(1, 6 * mm))

    # ---------- 核心指标 ----------
    story.append(Paragraph('<font color="#7C3AED">▍</font>核心指标', st_h2))
    story.append(Spacer(1, 2.5 * mm))
    acos_v = float(t.get("acos") or 0); roas_v = float(t.get("roas") or 0)
    acos_c = RED if acos_v > 30 else (AMBER if acos_v > 20 else GREEN)
    roas_c = RED if roas_v < 1 else (AMBER if roas_v < 2 else GREEN)
    kpis = [("曝光", fi(t.get("impressions") or 0), INK), ("点击", fi(t.get("clicks") or 0), INK),
            ("CTR", str(t.get("ctr") or 0) + "%", INK), ("花费", fmo(t.get("spend") or 0), INK),
            ("销售额", fmo(t.get("sales") or 0), INK), ("订单", fi(t.get("orders") or 0), INK),
            ("ACOS", str(t.get("acos") or 0) + "%", acos_c), ("ROAS", str(t.get("roas") or 0), roas_c)]
    rows = []
    for r in range(2):
        row = []
        for c in range(4):
            k, v, col = kpis[r * 4 + c]
            row.append([Paragraph(v, ParagraphStyle("x", parent=st_kpi_v, textColor=col)), Paragraph(k, st_kpi_k)])
        rows.append(row)
    kpi = Table(rows, colWidths=[AVAIL / 4] * 4)
    kpi.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_CARD), ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(kpi)

    # ---------- 图表 ----------
    groups = m.get("groups") or []
    chart_png = None
    if len(groups) >= 2 and any(g.get("spend") is not None or g.get("acos") is not None for g in groups[:10]):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.font_manager as fm
        fm.fontManager.addfont(str(FONT_REG)); fm.fontManager.addfont(str(FONT_BOLD))
        plt.rcParams["font.family"] = "Noto Sans SC"; plt.rcParams["axes.unicode_minus"] = False
        gs = groups[:10]
        names = [str(g.get("name") or "")[:14] for g in gs][::-1]
        spend = [float(g.get("spend") or 0) for g in gs][::-1]
        sales = [float(g.get("sales") or 0) for g in gs][::-1]
        acos = [float(g.get("acos") or 0) for g in gs][::-1]
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.2, 3.5), dpi=190)
        fig.patch.set_facecolor("white")
        y = range(len(names))
        ax1.barh([i - 0.19 for i in y], spend, height=0.36, color="#7C3AED", label="花费")
        ax1.barh([i + 0.19 for i in y], sales, height=0.36, color="#30A46C", label="销售额")
        ax1.set_yticks(list(y)); ax1.set_yticklabels(names, fontsize=8)
        ax1.set_title("分组 花费 vs 销售额（$）", fontsize=10, fontweight="bold")
        ax1.legend(fontsize=8, frameon=False, loc="lower right")
        ax1.grid(axis="x", color="#EEEAF7", lw=0.8); ax1.set_axisbelow(True)
        colors = ["#E5484D" if a > 30 else ("#F5A524" if a > 20 else "#30A46C") for a in acos]
        ax2.barh(list(y), acos, height=0.55, color=colors)
        ax2.axvline(25, color="#B0A8C8", ls="--", lw=1)
        ax2.text(25.6, len(names) - 0.5, "基准 25%", fontsize=7.5, color="#8A84A0")
        ax2.set_yticks(list(y)); ax2.set_yticklabels(names, fontsize=8)
        ax2.set_title("分组 ACOS（%）", fontsize=10, fontweight="bold")
        ax2.grid(axis="x", color="#EEEAF7", lw=0.8); ax2.set_axisbelow(True)
        for ax in (ax1, ax2):
            for s in ("top", "right"): ax.spines[s].set_visible(False)
            for s in ("left", "bottom"): ax.spines[s].set_color("#DDD8EC")
            ax.tick_params(colors="#6E6E73", labelsize=8)
        fig.tight_layout(pad=1.2)
        chart_png = os.path.join(tempfile.gettempdir(), "amzpdf-chart-" + str(os.getpid()) + ".png")
        fig.savefig(chart_png, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        story.append(Spacer(1, 6 * mm))
        story.append(KeepTogether([Paragraph('<font color="#7C3AED">▍</font>数据透视', st_h2),
                                   Spacer(1, 2.5 * mm),
                                   Image(chart_png, width=AVAIL, height=AVAIL * 0.30)]))

    # ---------- 表格 ----------
    def data_table(title, rows_data, name_head):
        COLS = [["impressions", "曝光", "int"], ["clicks", "点击", "int"], ["ctr", "CTR%", "pct"],
                ["spend", "花费$", "money"], ["sales", "销售$", "money"], ["orders", "订单", "int"],
                ["acos", "ACOS%", "pct"], ["roas", "ROAS", "num2"],
                ["sessions", "会话", "int"], ["units", "订购件数", "int"], ["buybox", "BuyBox%", "pct"], ["budgetUtil", "预算利用%", "pct"]]
        cols = [c for c in COLS if any(g.get(c[0]) is not None for g in rows_data[:5])]
        def fmt(v, kind):
            if v is None: return "—"
            try:
                f = float(v)
                if kind == "int": return f"{int(round(f)):,}"
                if kind == "money": return f"{f:,.2f}"
                if kind == "num2": return f"{f:.2f}"
                return f"{f:g}"
            except Exception:
                return str(v)
        st_cell8 = ParagraphStyle("c8", parent=st_cell, fontSize=8)
        st_cell8r = ParagraphStyle("c8r", parent=st_cell_r, fontSize=8)
        head = [Paragraph(name_head, st_head)] + [Paragraph(c[1], st_head_r) for c in cols]
        body = [head]
        for g in rows_data:
            row = [Paragraph(str(g.get("name") or "")[:60], st_cell8)]
            for c in cols:
                row.append(Paragraph(fmt(g.get(c[0]), c[2]), st_cell8r))
            body.append(row)
        name_w = AVAIL * 0.24
        cw = [name_w] + [(AVAIL - name_w) / len(cols)] * len(cols)
        tb = Table(body, colWidths=cw, repeatRows=1)
        tb.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, BG_SOFT]),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return [KeepTogether([Paragraph('<font color="#7C3AED">▍</font>' + title, st_h2), Spacer(1, 2.5 * mm), tb])]

    campaigns = m.get("campaigns") or []
    same = campaigns and groups and campaigns[0] and groups[0] and campaigns[0].get("name") == groups[0].get("name") and len(campaigns) == len(groups)
    if campaigns and not same:
        story.append(Spacer(1, 6 * mm))
        story += data_table("广告活动维度（按花费排序，前 10）", campaigns[:10], "Campaign")
    if groups:
        DIM = {"campaign": "广告活动", "adgroup": "广告组", "targeting": "关键词/定向", "searchterm": "搜索词",
               "asin": "ASIN 商品", "product": "商品", "placement": "投放位置", "date": "日期", "query": "搜索查询"}
        gname = DIM.get(m.get("groupBy"), "分组")
        story.append(Spacer(1, 6 * mm))
        story += data_table(f"{gname}维度（前 15）", groups[:15], gname)

    # ---------- AI 诊断 ----------
    if rp:
        story.append(Spacer(1, 7 * mm))
        story.append(Paragraph('<font color="#7C3AED">▍</font>AI 总体诊断', st_h2))
        story.append(Spacer(1, 2.5 * mm))
        ov = Table([[Paragraph(rp.get("overview") or "—", st_body)]], colWidths=[AVAIL])
        ov.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F4F1FC")),
            ("LINEBEFORE", (0, 0), (0, -1), 3, PRIMARY),
            ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(ov)

        issues = rp.get("issues") or []
        if issues:
            story.append(Spacer(1, 6 * mm))
            story.append(Paragraph('<font color="#7C3AED">▍</font>问题清单（按严重度）', st_h2))
            story.append(Spacer(1, 2.5 * mm))
            SEV = [("high", "高严重度", RED, "#E5484D"), ("medium", "中严重度", AMBER, "#F5A524"), ("low", "低严重度", GREEN, "#30A46C")]
            for sev, sname, scol, shex in SEV:
                for it in [i for i in issues if i.get("severity") == sev]:
                    p_title = Paragraph(f'<font name="NotoSC-Bold" color="{shex}">[{sname}]</font> <font name="NotoSC-Bold">{it.get("title","")}</font>', st_body)
                    parts = [p_title, Spacer(1, 1.2 * mm), Paragraph(it.get("detail") or "", st_body)]
                    if it.get("dataBasis"):
                        parts += [Spacer(1, 1.2 * mm), Paragraph("数据依据：" + it["dataBasis"], st_small)]
                    cell = Table([[parts]], colWidths=[AVAIL])
                    cell.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, -1), BG_CARD),
                        ("LINEBEFORE", (0, 0), (0, -1), 3, scol),
                        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ]))
                    story.append(KeepTogether([cell, Spacer(1, 2.2 * mm)]))

        actions = rp.get("actions") or {}
        cols_data = [("立即做", actions.get("now") or [], RED), ("本周做", actions.get("week") or [], AMBER),
                     ("持续做", actions.get("ongoing") or [], GREEN)]
        if any(c[1] for c in cols_data):
            story.append(Spacer(1, 6 * mm))
            story.append(Paragraph('<font color="#7C3AED">▍</font>优化动作', st_h2))
            story.append(Spacer(1, 2.5 * mm))
            cells = []
            for label, items, col in cols_data:
                flow = [Paragraph(f'<font name="NotoSC-Bold" color="#7C3AED">● {label}</font>', st_body), Spacer(1, 1.5 * mm)]
                for a in items:
                    flow.append(Paragraph("· " + a, st_bullet))
                    flow.append(Spacer(1, 1 * mm))
                if not items:
                    flow.append(Paragraph("—", st_small))
                cells.append(flow)
            act = Table([cells], colWidths=[AVAIL / 3] * 3)
            act.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), BG_CARD), ("GRID", (0, 0), (-1, -1), 0.6, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(act)
    elif rec.get("llmError"):
        story.append(Spacer(1, 7 * mm))
        note = Table([[Paragraph("[提示] AI 诊断未生成：" + str(rec["llmError"]) + "（上方指标汇总不受影响）", st_body)]], colWidths=[AVAIL])
        note.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FFF8EC")), ("LINEBEFORE", (0, 0), (0, -1), 3, AMBER),
            ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(note)

    doc.build(story)
    if chart_png:
        try: os.unlink(chart_png)
        except Exception: pass
    from pypdf import PdfReader
    pages = len(PdfReader(out_path).pages)
    print(json.dumps({"ok": True, "pages": pages, "size": os.path.getsize(out_path)}))

try:
    main()
except Exception:
    print(json.dumps({"error": traceback.format_exc().splitlines()[-1][:300]}))
