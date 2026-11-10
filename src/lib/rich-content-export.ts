/** Standalone downloads have no application stylesheet, so carry essential block formatting. */
export const RICH_CONTENT_EXPORT_STYLES = `
body{font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;max-width:960px;margin:32px auto;padding:0 24px}
img,video,svg{max-width:100%;height:auto}p,li,td,th{overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#f1f5f9}
pre{white-space:pre-wrap;background:#f1f5f9;padding:16px;border-radius:8px}blockquote{border-left:3px solid #0891b2;padding-left:16px}
aside[data-type="callout"]{border:1px solid #bae6fd;border-left:4px solid #0284c7;border-radius:8px;background:#f0f9ff;padding:12px 16px;margin:16px 0}
aside[data-tone="warning"]{border-color:#fcd34d;border-left-color:#d97706;background:#fffbeb}
aside[data-tone="success"]{border-color:#6ee7b7;border-left-color:#059669;background:#ecfdf5}
aside[data-tone="important"]{border-color:#c4b5fd;border-left-color:#7c3aed;background:#f5f3ff}
aside[data-tone="danger"]{border:2px solid #fca5a5;border-left:6px solid #dc2626;background:#fef2f2}
aside[data-type="callout"]::before{content:"Note";display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;color:#0369a1}
aside[data-tone="success"]::before{content:"Tip";color:#047857}aside[data-tone="important"]::before{content:"Important";color:#6d28d9}
aside[data-tone="warning"]::before{content:"Warning";color:#b45309}aside[data-tone="danger"]::before{content:"Caution";color:#b91c1c}
figure img{display:block;max-width:100%;height:auto;margin:0 auto}figcaption{color:#475569;font-size:14px;margin-top:6px}
figure[data-type="instruction-chart"]{margin:16px 0;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#0f172a}
figure[data-type="instruction-chart"] figcaption{font-weight:700;margin-bottom:12px}figure[data-type="instruction-chart"] svg{display:block;width:100%;background:#fff}figure[data-type="instruction-chart"] table{font-size:13px}
caption{text-align:left;font-weight:600}ul[data-type="taskList"]{list-style:none;padding-left:0}li[data-type="taskItem"]{display:flex;gap:8px}li[data-type="taskItem"]>div{flex:1}li[data-type="taskItem"] p{margin:0}
@media print{body{margin:0;max-width:none}tr,svg{break-inside:avoid}aside,figure{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
