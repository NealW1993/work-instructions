export interface ChartPoint {
  label: string;
  value: number;
}

export type InstructionChartType = "bar" | "line";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Reject malformed or oversized data instead of silently omitting manufacturing results. */
export function normalizeChartData(input: unknown): ChartPoint[] | null {
  let candidate = input;
  if (typeof candidate === "string") {
    if (candidate.length > 24_000) return null;
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 24) return null;
  const result: ChartPoint[] = [];
  for (const point of candidate) {
    if (!point || typeof point !== "object" || Array.isArray(point)) return null;
    const { label, value } = point as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim() || label.trim().length > 80
      || typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e100) return null;
    result.push({ label: label.trim(), value });
  }
  return result;
}

function coordinate(value: number) {
  return Number(value.toFixed(3)).toString();
}

function tickLabel(value: number) {
  return Number(value.toPrecision(5)).toString();
}

/** Self-contained, print-ready markup. The table retains every exact supplied result. */
export function buildChartHtml(input: {
  type: InstructionChartType;
  title: string;
  data: unknown;
}): string {
  const data = normalizeChartData(input.data);
  if (!data || (input.type !== "bar" && input.type !== "line")) return "";
  const title = input.title.trim().slice(0, 160) || "Process chart";
  const low = Math.min(0, ...data.map((point) => point.value));
  const rawHigh = Math.max(0, ...data.map((point) => point.value));
  const high = rawHigh === low ? low + 1 : rawHigh;
  const range = high - low || 1;
  const plot = { x: 76, y: 20, width: 620, height: 220 };
  const y = (value: number) => plot.y + ((high - value) / range) * plot.height;
  const step = plot.width / data.length;
  const x = (index: number) => plot.x + step * (index + 0.5);
  const baseline = y(0);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = high - (index / 4) * range;
    const tickY = plot.y + (index / 4) * plot.height;
    return `<line x1="${plot.x}" y1="${coordinate(tickY)}" x2="${plot.x + plot.width}" y2="${coordinate(tickY)}" stroke="#cbd5e1" stroke-width="1" /><text x="${plot.x - 8}" y="${coordinate(tickY + 4)}" text-anchor="end" fill="#475569" font-size="11">${escapeHtml(tickLabel(value))}</text>`;
  }).join("");
  const marks = input.type === "bar"
    ? data.map((point, index) => `<rect x="${coordinate(x(index) - step * 0.32)}" y="${coordinate(Math.min(baseline, y(point.value)))}" width="${coordinate(step * 0.64)}" height="${coordinate(Math.abs(y(point.value) - baseline))}" rx="2" fill="#0891b2" />`).join("")
    : `<polyline points="${data.map((point, index) => `${coordinate(x(index))},${coordinate(y(point.value))}`).join(" ")}" fill="none" stroke="#0891b2" stroke-width="3" />${data.map((point, index) => `<circle cx="${coordinate(x(index))}" cy="${coordinate(y(point.value))}" r="4" fill="#0891b2" />`).join("")}`;
  const labelInterval = Math.max(1, Math.ceil(data.length / 8));
  const labels = data.map((point, index) => index % labelInterval === 0
    ? `<text x="${coordinate(x(index))}" y="264" text-anchor="middle" fill="#475569" font-size="11">${escapeHtml(point.label.length > 14 ? `${point.label.slice(0, 13)}…` : point.label)}</text>` : "").join("");
  const rows = data.map((point) => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${point.value}</td></tr>`).join("");
  return `<figure data-type="instruction-chart" data-chart-type="${input.type}" data-chart-title="${escapeHtml(title)}" data-chart-data="${escapeHtml(JSON.stringify(data))}" class="instruction-chart"><figcaption>${escapeHtml(title)}</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 284" role="img" aria-label="${escapeHtml(`${title}, ${input.type} chart. Exact values in the following table.`)}">${grid}<line x1="${plot.x}" y1="${coordinate(baseline)}" x2="${plot.x + plot.width}" y2="${coordinate(baseline)}" stroke="#64748b" stroke-width="1.5" />${marks}${labels}</svg><table><caption>Chart data: ${escapeHtml(title)}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead><tbody>${rows}</tbody></table></figure>`;
}
