import csv
import contextlib
import datetime
import io
import json
import os
import runpy
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook


def run_parser(script_path, report_path):
    previous_argv = sys.argv
    output = io.StringIO()
    try:
        sys.argv = [str(script_path), str(report_path)]
        with contextlib.redirect_stdout(output):
            runpy.run_path(str(script_path), run_name="__main__")
    finally:
        sys.argv = previous_argv
    return json.loads(output.getvalue())


def test_known_report(script_path, tmp):
    scripts_dir = Path(__file__).resolve().parent
    report_path = Path(tmp) / "amazon-125.csv"
    with report_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=[
                "Campaign Name",
                "Impressions",
                "Clicks",
                "Spend",
                "7 Day Total Sales",
                "7 Day Total Orders",
            ],
        )
        writer.writeheader()
        for index in range(125):
            writer.writerow(
                {
                    "Campaign Name": f"Campaign {index:03d}",
                    "Impressions": 100 + index,
                    "Clicks": 10 + index,
                    "Spend": f"{index + 1}.25",
                    "7 Day Total Sales": f"{index + 5}.50",
                    "7 Day Total Orders": 1,
                }
            )

    payload = run_parser(script_path, report_path)
    assert payload["reportType"] == "campaign"
    assert payload["sourceRowCount"] == 125
    assert payload["validRowCount"] == 125
    assert len(payload["groups"]) == 125
    item_ids = [group["itemId"] for group in payload["groups"]]
    assert len(set(item_ids)) == 125


def test_json_safe_scalars(script_path):
    namespace = runpy.run_path(str(script_path), run_name="parse_ads_test_module")
    normalizer = namespace["to_json_safe"]
    encoded = json.dumps(
        normalizer({
            "integer": np.int64(7),
            "floating": np.float64(2.5),
            "missing": np.float64("nan"),
            "timestamp": pd.Timestamp("2026-07-27 12:34:56"),
            "notATime": pd.NaT,
            "date": datetime.date(2026, 7, 27),
        }),
        ensure_ascii=False,
        allow_nan=False,
    )
    payload = json.loads(encoded)
    assert payload == {
        "integer": 7,
        "floating": 2.5,
        "missing": None,
        "timestamp": "2026-07-27T12:34:56",
        "notATime": None,
        "date": "2026-07-27",
    }


def test_unknown_csv_profiles_every_row(script_path, tmp):
    report_path = Path(tmp) / "unknown-125.csv"
    frame = pd.DataFrame(
        {
            "Region": ["West" if index % 2 else "East" for index in range(125)],
            "Units": np.arange(1, 126, dtype=np.int64),
            "Observed At": pd.date_range("2026-01-01", periods=125, freq="D"),
            "Note": [None if index == 4 else f"row {index}" for index in range(125)],
        }
    )
    frame.to_csv(report_path, index=False, encoding="utf-8-sig")
    payload = run_parser(script_path, report_path)

    assert payload["ok"] is True
    assert payload["reportType"] == "universal"
    assert payload["sourceRowCount"] == 125
    assert payload["validRowCount"] == 125
    assert len(payload["groups"]) == 125
    assert payload["items"] == payload["groups"]
    assert len({item["itemId"] for item in payload["items"]}) == 125
    assert payload["items"][0]["values"]["Units"] == 1
    assert payload["items"][-1]["values"]["Units"] == 125

    sheet = payload["sheets"][0]
    units = next(profile for profile in sheet["profiles"] if profile["field"] == "Units")
    observed = next(
        profile for profile in sheet["profiles"] if profile["field"] == "Observed At"
    )
    region = next(profile for profile in sheet["profiles"] if profile["field"] == "Region")
    assert units["numeric"] == {"min": 1, "max": 125, "sum": 7875, "mean": 63}
    assert observed["dateRange"] == {"min": "2026-01-01", "max": "2026-05-05"}
    assert region["distinctCount"] == 2
    assert region["topValues"][0]["count"] in (62, 63)


def test_multisheet_and_no_default_style(script_path, tmp):
    multi_path = Path(tmp) / "multi-sheet.xlsx"
    with pd.ExcelWriter(multi_path, engine="openpyxl") as writer:
        pd.DataFrame({"Team": ["A", "B"], "Score": [10, 20]}).to_excel(
            writer, sheet_name="Scores", index=False
        )
        pd.DataFrame(
            {"Event": ["Launch", "Review"], "When": pd.to_datetime(["2026-01-02", "2026-02-03"])}
        ).to_excel(writer, sheet_name="Milestones", index=False)
    payload = run_parser(script_path, multi_path)
    assert payload["reportType"] == "universal"
    assert [sheet["name"] for sheet in payload["sheets"]] == ["Scores", "Milestones"]
    assert payload["validRowCount"] == 4
    assert len(payload["items"]) == 4
    assert {item["sheetName"] for item in payload["items"]} == {"Scores", "Milestones"}

    no_style_path = Path(tmp) / "no-default-style.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Unknown"
    sheet.append(["Label", "Value"])
    sheet.append(["alpha", np.int64(9)])
    workbook._named_styles = []
    workbook.save(no_style_path)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        no_style = run_parser(script_path, no_style_path)
    assert no_style["reportType"] == "universal"
    assert no_style["items"][0]["values"]["Value"] == 9
    assert not any("default style" in str(warning.message).lower() for warning in caught)


def test_cli_forces_utf8_when_parent_console_is_cp1252(script_path, tmp):
    report_path = Path(tmp) / "中文报告.csv"
    report_path.write_text("指标,数值\n曝光,10\n", encoding="utf-8-sig")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "cp1252"
    completed = subprocess.run(
        [sys.executable, str(script_path), str(report_path)],
        capture_output=True,
        env=env,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode("utf-8", errors="replace")
    payload = json.loads(completed.stdout.decode("utf-8"))
    assert payload["ok"] is True
    assert payload["sourceRowCount"] == 1


def main():
    script_path = Path(__file__).resolve().parent / "parse_ads.py"
    with tempfile.TemporaryDirectory() as tmp:
        test_known_report(script_path, tmp)
        test_json_safe_scalars(script_path)
        test_unknown_csv_profiles_every_row(script_path, tmp)
        test_multisheet_and_no_default_style(script_path, tmp)
        test_cli_forces_utf8_when_parent_console_is_cp1252(script_path, tmp)


if __name__ == "__main__":
    main()
    print("parse_ads full-data tests passed")
