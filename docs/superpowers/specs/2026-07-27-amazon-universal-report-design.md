# Amazon Universal Report Fallback Design

## Scope

The Amazon entry accepts every CSV, XLS, and XLSX file. Recognized Amazon advertising or business reports keep the existing specialized metrics contract. Files without recognized advertising metrics return a non-error `universal` report that profiles and preserves every valid row from every worksheet.

## Parser contract

`parse_ads.py` loads a CSV as one logical sheet and Excel workbooks as all worksheets. It first searches non-empty sheets for the existing known-report signature. A recognized sheet follows the existing aggregation path unchanged.

When no sheet has a known signature, the parser returns:

- `reportType: "universal"` and `reportTypeName: "通用数据报告"`;
- total source and valid row counts across all sheets;
- `sheets`, each containing sheet name, row/column counts, and column profiles;
- profiles with field name, inferred kind, non-empty count, distinct count, numeric min/max/sum/mean, date range, and top categorical values where applicable;
- complete `groups` and `items`, one stable item per valid source row, containing sheet name, source row number, display name, and all JSON-safe cell values.

The final serializer converts pandas, NumPy, timestamp, date, time, missing, infinity, and other scalar values to strict JSON. It uses `allow_nan=False` so invalid JSON cannot silently escape.

## Analysis and presentation

The server uses a universal-specific batch instruction: infer what the columns and rows represent, summarize their relationships, and explain the data without assuming PPC concepts. Existing known reports keep their Amazon PPC guidance.

The web report displays sheet and column profiles plus a searchable full-row table for universal records. Existing expanded Amazon and legacy layouts remain unchanged.

The PDF uses a universal branch with coverage, worksheet profiles, complete row-by-row teaching sections, full data appendix, review checklist, and method warnings. Existing Amazon expanded and legacy branches remain unchanged.

## Failure handling

Unreadable or truly empty files still return an error. Unknown columns are not an error. Empty worksheets are listed but contribute no valid items. Unsupported cell objects are rendered as stable strings only after known scalar/date conversions are attempted.

## Testing

Tests cover workbooks without default styles, NumPy and timestamp serialization, unknown columns, more than 100 rows, multiple worksheets, specialized-report compatibility, universal AI prompt semantics, universal web rendering, and complete universal PDF output.
