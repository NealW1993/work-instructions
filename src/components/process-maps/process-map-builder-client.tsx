"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CheckCircle2,
  Copy,
  FileDown,
  Download,
  FileText,
  GitBranch,
  LineChart,
  Loader2,
  Network,
  Palette,
  Printer,
  RefreshCw,
  Save,
  Sparkles,
  Table2,
  Target,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DIAGRAM_DEFINITIONS,
  DMAIC_PHASE_OPTIONS,
  type DiagramRecommendation,
  type DiagramType,
  type DmaicPhase,
  getDiagramDefinition,
  getDmaicPhaseOption,
  splitListInput,
} from "@/lib/process-map-tools";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface DepartmentOption {
  id: string;
  name: string;
}

interface ProcessMapBuilderClientProps {
  canEdit: boolean;
  departments: DepartmentOption[];
}

interface MetricPoint {
  label: string;
  value: number;
  value2: number;
}

type FormulaTool = NonNullable<DiagramRecommendation["formulaTool"]>;

interface CapabilityStats {
  n: number;
  mean: number;
  sampleStdDev: number;
  populationStdDev: number;
  min: number;
  max: number;
  cp: number | null;
  cpu: number | null;
  cpl: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  sigmaLevel: number | null;
  estimatedYield: number | null;
  estimatedPpm: number | null;
}

interface OeeStats {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

interface DpmoStats {
  dpmo: number | null;
  yieldPercent: number | null;
}

interface TaktStats {
  taktMinutes: number | null;
  taktSeconds: number | null;
}

interface ControlLimitStats {
  centerline: number | null;
  sigma: number | null;
  ucl: number | null;
  lcl: number | null;
}

interface LayerSettings {
  showTitle: boolean;
  showIsoNotes: boolean;
  showFormulaLayer: boolean;
  showDataLayer: boolean;
  showControlLimits: boolean;
  showGrid: boolean;
  showLegend: boolean;
}

interface DiagramStyle {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  riskColor: string;
  backgroundColor: string;
}

type DrawingMode = "select" | "process" | "decision" | "terminator" | "connector";

interface CustomFlowNode {
  id: string;
  type: Exclude<DrawingMode, "select" | "connector">;
  label: string;
  x: number;
  y: number;
}

interface CustomFlowLink {
  id: string;
  from: string;
  to: string;
}

type RecommendationPayload = DiagramRecommendation & {
  error?: string;
};

interface PageExplainResponse {
  explanation?: string;
  error?: string;
}

const TABLE_DIAGRAM_TYPES = new Set<DiagramType>([
  "sipoc",
  "project_charter",
  "fmea",
  "control_plan",
  "solution_matrix",
]);

const BAR_DIAGRAM_TYPES = new Set<DiagramType>(["pareto", "histogram"]);
const LINE_DIAGRAM_TYPES = new Set<DiagramType>(["run_chart", "control_chart"]);
const CHART_DATA_DIAGRAM_TYPES = new Set<DiagramType>([
  "pareto",
  "histogram",
  "run_chart",
  "control_chart",
  "scatter_plot",
]);
const CUSTOM_FLOW_DIAGRAM_TYPES = new Set<DiagramType>([
  "process_map",
  "flowchart",
  "swimlane",
  "value_stream_map",
]);

const DEFAULT_METRIC_ROWS = [
  "Defect A,42,12",
  "Defect B,31,24",
  "Defect C,18,38",
  "Defect D,12,45",
  "Other,7,54",
].join("\n");

const DEFAULT_CAPABILITY_DATA = [
  "10.01",
  "10.03",
  "9.99",
  "10.02",
  "10.00",
  "10.04",
  "9.98",
  "10.01",
  "10.02",
  "10.00",
].join("\n");

const DEFAULT_LAYER_SETTINGS: LayerSettings = {
  showTitle: true,
  showIsoNotes: true,
  showFormulaLayer: true,
  showDataLayer: true,
  showControlLimits: true,
  showGrid: true,
  showLegend: true,
};

const DEFAULT_DIAGRAM_STYLE: DiagramStyle = {
  primaryColor: "#0f766e",
  secondaryColor: "#0284c7",
  accentColor: "#f59e0b",
  riskColor: "#dc2626",
  backgroundColor: "#f8fafc",
};

const DEFAULT_PROMPT =
  "Document the process boundary, inputs, outputs, owners, decisions, and major process steps for controlled process documentation.";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
}

function toDocumentNumber() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `PM-${stamp}-${Math.floor(Math.random() * 900 + 100)}`;
}

function parseMetricRows(value: string, fallbackLabels: string[]): MetricPoint[] {
  const parsed = value
    .split(/\r?\n/)
    .map((line, index) => {
      const [rawLabel, rawValue, rawValue2] = line.split(",").map((part) => part?.trim() ?? "");
      if (!rawLabel) {
        return null;
      }

      const valueNumber = Number.parseFloat(rawValue);
      const value2Number = Number.parseFloat(rawValue2);
      return {
        label: rawLabel,
        value: Number.isFinite(valueNumber) ? valueNumber : Math.max(5, 40 - index * 7),
        value2: Number.isFinite(value2Number) ? value2Number : Math.max(3, 12 + index * 8),
      };
    })
    .filter((point): point is MetricPoint => point !== null)
    .slice(0, 10);

  if (parsed.length > 0) {
    return parsed;
  }

  return fallbackLabels.slice(0, 6).map((label, index) => ({
    label,
    value: Math.max(8, 42 - index * 6),
    value2: Math.max(4, 12 + index * 8),
  }));
}

function parseMeasurementValues(value: string) {
  return value
    .split(/[\s,\t;|]+/)
    .map((entry) => Number.parseFloat(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function formatNumber(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }

  return value.toFixed(digits);
}

function erfApprox(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function normalCdf(value: number) {
  return 0.5 * (1 + erfApprox(value / Math.SQRT2));
}

function calculateCapability(
  values: number[],
  specLower: number | null,
  specUpper: number | null,
): CapabilityStats | null {
  if (values.length < 2) {
    return null;
  }

  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sampleVariance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, n - 1);
  const populationVariance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const sampleStdDev = Math.sqrt(sampleVariance);
  const populationStdDev = Math.sqrt(populationVariance);
  const hasLower = specLower !== null && Number.isFinite(specLower);
  const hasUpper = specUpper !== null && Number.isFinite(specUpper);
  const safeSampleSigma = sampleStdDev > 0 ? sampleStdDev : null;
  const safePopulationSigma = populationStdDev > 0 ? populationStdDev : null;
  const cp =
    hasLower && hasUpper && safeSampleSigma
      ? ((specUpper as number) - (specLower as number)) / (6 * safeSampleSigma)
      : null;
  const cpu = hasUpper && safeSampleSigma ? ((specUpper as number) - mean) / (3 * safeSampleSigma) : null;
  const cpl = hasLower && safeSampleSigma ? (mean - (specLower as number)) / (3 * safeSampleSigma) : null;
  const cpk = cpu !== null && cpl !== null ? Math.min(cpu, cpl) : cpu ?? cpl;
  const pp =
    hasLower && hasUpper && safePopulationSigma
      ? ((specUpper as number) - (specLower as number)) / (6 * safePopulationSigma)
      : null;
  const ppu = hasUpper && safePopulationSigma ? ((specUpper as number) - mean) / (3 * safePopulationSigma) : null;
  const ppl = hasLower && safePopulationSigma ? (mean - (specLower as number)) / (3 * safePopulationSigma) : null;
  const ppk = ppu !== null && ppl !== null ? Math.min(ppu, ppl) : ppu ?? ppl;
  const lowerYield =
    hasLower && safeSampleSigma ? normalCdf(((specLower as number) - mean) / safeSampleSigma) : 0;
  const upperYield =
    hasUpper && safeSampleSigma ? 1 - normalCdf(((specUpper as number) - mean) / safeSampleSigma) : 0;
  const estimatedPpm =
    safeSampleSigma && (hasLower || hasUpper) ? Math.max(0, (lowerYield + upperYield) * 1_000_000) : null;
  const estimatedYield = estimatedPpm === null ? null : Math.max(0, 100 - estimatedPpm / 10_000);

  return {
    n,
    mean,
    sampleStdDev,
    populationStdDev,
    min,
    max,
    cp,
    cpu,
    cpl,
    cpk,
    pp,
    ppk,
    sigmaLevel: cpk === null ? null : Math.max(0, cpk * 3),
    estimatedYield,
    estimatedPpm,
  };
}

function parsePositiveNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function calculateOee(input: {
  plannedProductionMinutes: string;
  runTimeMinutes: string;
  idealCycleSeconds: string;
  totalCount: string;
  goodCount: string;
}): OeeStats {
  const plannedProductionMinutes = parsePositiveNumber(input.plannedProductionMinutes);
  const runTimeMinutes = parsePositiveNumber(input.runTimeMinutes);
  const idealCycleSeconds = parsePositiveNumber(input.idealCycleSeconds);
  const totalCount = parsePositiveNumber(input.totalCount);
  const goodCount = parsePositiveNumber(input.goodCount);

  const availability =
    plannedProductionMinutes && runTimeMinutes
      ? Math.min(1, runTimeMinutes / plannedProductionMinutes)
      : null;
  const performance =
    runTimeMinutes && idealCycleSeconds && totalCount
      ? Math.min(1, (idealCycleSeconds * totalCount) / (runTimeMinutes * 60))
      : null;
  const quality = totalCount && goodCount ? Math.min(1, goodCount / totalCount) : null;
  const oee =
    availability !== null && performance !== null && quality !== null
      ? availability * performance * quality
      : null;

  return {
    availability,
    performance,
    quality,
    oee,
  };
}

function calculateDpmo(input: {
  defects: string;
  units: string;
  opportunities: string;
}): DpmoStats {
  const defects = parsePositiveNumber(input.defects);
  const units = parsePositiveNumber(input.units);
  const opportunities = parsePositiveNumber(input.opportunities);

  if (!defects || !units || !opportunities) {
    return {
      dpmo: null,
      yieldPercent: null,
    };
  }

  const dpmo = (defects / (units * opportunities)) * 1_000_000;
  return {
    dpmo,
    yieldPercent: Math.max(0, 100 - dpmo / 10_000),
  };
}

function calculateTakt(input: {
  availableMinutes: string;
  demand: string;
}): TaktStats {
  const availableMinutes = parsePositiveNumber(input.availableMinutes);
  const demand = parsePositiveNumber(input.demand);
  const taktMinutes = availableMinutes && demand ? availableMinutes / demand : null;

  return {
    taktMinutes,
    taktSeconds: taktMinutes === null ? null : taktMinutes * 60,
  };
}

function calculateControlLimits(metrics: MetricPoint[]): ControlLimitStats {
  const values = metrics.map((metric) => metric.value).filter(Number.isFinite);
  if (values.length < 2) {
    return {
      centerline: values[0] ?? null,
      sigma: null,
      ucl: null,
      lcl: null,
    };
  }

  const centerline = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - centerline) ** 2, 0) /
    Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);

  return {
    centerline,
    sigma,
    ucl: centerline + 3 * sigma,
    lcl: centerline - 3 * sigma,
  };
}

function svgText(
  x: number,
  y: number,
  text: string,
  options: { anchor?: "start" | "middle" | "end"; size?: number; weight?: number; color?: string } = {},
) {
  const anchor = options.anchor ?? "middle";
  const size = options.size ?? 13;
  const weight = options.weight ?? 700;
  const color = options.color ?? "#0f172a";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeHtml(
    truncate(text, 28),
  )}</text>`;
}

function svgShell(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <path d="M0,0 L10,3.5 L0,7 Z" fill="#0f766e"></path>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#f8fafc"></rect>
  ${body}
</svg>`;
}

function formatAxisNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }

  if (Math.abs(value) >= 10) {
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function getAxisTicks(minValue: number, maxValue: number, tickCount = 5) {
  const safeMin = Number.isFinite(minValue) ? minValue : 0;
  const safeMax = Number.isFinite(maxValue) ? maxValue : 1;
  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);
  const range = Math.max(1, high - low);
  const step = range / Math.max(1, tickCount - 1);

  return Array.from({ length: tickCount }, (_, index) => low + step * index);
}

function applySvgTheme(svg: string, style: DiagramStyle, layerSettings: LayerSettings) {
  let themedSvg = svg
    .replaceAll("#0f766e", style.primaryColor)
    .replaceAll("#0284c7", style.secondaryColor)
    .replaceAll("#0ea5e9", style.secondaryColor)
    .replaceAll("#f59e0b", style.accentColor)
    .replaceAll("#dc2626", style.riskColor)
    .replaceAll("#f8fafc", style.backgroundColor);

  if (!layerSettings.showGrid) {
    themedSvg = themedSvg.replaceAll("stroke=\"#cbd5e1\"", "stroke=\"transparent\"");
  }

  return themedSvg;
}

function buildFlowSvg(title: string, items: string[], valueStream = false) {
  const width = 960;
  const height = valueStream ? 360 : 280;
  const visibleItems = items.slice(0, 6);
  const count = Math.max(visibleItems.length, 2);
  const left = 80;
  const right = 80;
  const y = valueStream ? 145 : 125;
  const boxWidth = 122;
  const boxHeight = 68;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });

  visibleItems.forEach((item, index) => {
    const x = left + ((width - left - right) / Math.max(1, count - 1)) * index;
    const isDecision = /decision|approve|verify|check|inspect|\?/.test(item.toLowerCase());

    if (index > 0) {
      const previousX = left + ((width - left - right) / Math.max(1, count - 1)) * (index - 1);
      body += `<line x1="${previousX + boxWidth / 2 + 12}" y1="${y}" x2="${x - boxWidth / 2 - 14}" y2="${y}" stroke="#0f766e" stroke-width="3" marker-end="url(#arrowhead)"></line>`;
    }

    if (isDecision) {
      body += `<polygon points="${x},${y - 45} ${x + 62},${y} ${x},${y + 45} ${x - 62},${y}" fill="#fef3c7" stroke="#d97706" stroke-width="2"></polygon>`;
    } else {
      body += `<rect x="${x - boxWidth / 2}" y="${y - boxHeight / 2}" width="${boxWidth}" height="${boxHeight}" rx="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"></rect>`;
    }

    body += svgText(x, y - 5, item, { size: 12, color: "#0f172a" });
    body += svgText(x, y + 14, valueStream ? `CT ${index + 2}m | WIP ${index + 1}` : `Step ${index + 1}`, {
      size: 10,
      weight: 600,
      color: "#475569",
    });
  });

  if (valueStream) {
    body += `<line x1="90" y1="258" x2="870" y2="258" stroke="#64748b" stroke-width="2"></line>`;
    body += svgText(480, 286, "Lead time / wait time timeline", {
      size: 13,
      color: "#475569",
    });
  }

  return svgShell(width, height, body);
}

function buildSwimlaneSvg(title: string, items: string[], lanes: string[]) {
  const width = 960;
  const height = 420;
  const visibleLanes = lanes.slice(0, 4);
  const visibleItems = items.slice(0, 8);
  const laneHeight = 74;
  const top = 80;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });

  visibleLanes.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight;
    body += `<rect x="40" y="${y}" width="880" height="${laneHeight}" fill="${
      laneIndex % 2 === 0 ? "#f1f5f9" : "#ffffff"
    }" stroke="#cbd5e1" stroke-width="1.5"></rect>`;
    body += `<rect x="40" y="${y}" width="130" height="${laneHeight}" fill="#ccfbf1" stroke="#99f6e4" stroke-width="1.5"></rect>`;
    body += svgText(105, y + 43, lane, { size: 12, color: "#0f172a" });
  });

  visibleItems.forEach((item, index) => {
    const laneIndex = index % Math.max(visibleLanes.length, 1);
    const x = 210 + Math.floor(index / Math.max(visibleLanes.length, 1)) * 170;
    const y = top + laneIndex * laneHeight + 18;
    body += `<rect x="${x}" y="${y}" width="130" height="38" rx="8" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.5"></rect>`;
    body += svgText(x + 65, y + 24, item, { size: 11, color: "#0f172a" });
    if (index > 0) {
      const prevLane = (index - 1) % Math.max(visibleLanes.length, 1);
      const prevX = 210 + Math.floor((index - 1) / Math.max(visibleLanes.length, 1)) * 170;
      const prevY = top + prevLane * laneHeight + 37;
      body += `<line x1="${prevX + 130}" y1="${prevY}" x2="${x}" y2="${y + 19}" stroke="#0f766e" stroke-width="2" marker-end="url(#arrowhead)"></line>`;
    }
  });

  return svgShell(width, height, body);
}

function buildCustomFlowSketchSvg(title: string, nodes: CustomFlowNode[], links: CustomFlowLink[]) {
  const width = 960;
  const boardHeight = 360;
  const top = title ? 58 : 18;
  const height = top + boardHeight + 18;
  let body = title ? svgText(width / 2, 36, title, { size: 20, color: "#111827" }) : "";

  body += `<defs>
    <pattern id="custom-flow-export-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#cbd5e1" stroke-width="0.7"></path>
    </pattern>
  </defs>`;
  body += `<rect x="0" y="${top}" width="${width}" height="${boardHeight}" fill="url(#custom-flow-export-grid)" stroke="#cbd5e1" stroke-width="1.5"></rect>`;

  links.forEach((link) => {
    const from = nodes.find((node) => node.id === link.from);
    const to = nodes.find((node) => node.id === link.to);
    if (!from || !to) {
      return;
    }

    body += `<line x1="${from.x + 56}" y1="${top + from.y}" x2="${to.x - 56}" y2="${
      top + to.y
    }" stroke="#0f766e" stroke-width="3" marker-end="url(#arrowhead)"></line>`;
  });

  nodes.forEach((node) => {
    const y = top + node.y;
    if (node.type === "decision") {
      body += `<polygon points="${node.x},${y - 44} ${node.x + 70},${y} ${node.x},${
        y + 44
      } ${node.x - 70},${y}" fill="#fff7ed" stroke="#0f766e" stroke-width="2"></polygon>`;
    } else {
      body += `<rect x="${node.x - 72}" y="${y - 32}" width="144" height="64" rx="${
        node.type === "terminator" ? 28 : 10
      }" fill="#ffffff" stroke="#0f766e" stroke-width="2"></rect>`;
    }

    body += svgText(node.x, y + 4, node.label, { size: 12, color: "#0f172a" });
  });

  return svgShell(width, height, body);
}

function buildFishboneSvg(title: string, items: string[]) {
  const width = 1040;
  const height = 440;
  const categories = items.slice(0, 6);
  const spineY = 220;
  const spineStartX = 120;
  const spineEndX = 800;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<line x1="${spineStartX}" y1="${spineY}" x2="${spineEndX}" y2="${spineY}" stroke="#0f766e" stroke-width="4" marker-end="url(#arrowhead)"></line>`;
  body += `<rect x="810" y="176" width="155" height="88" rx="12" fill="#fee2e2" stroke="#dc2626" stroke-width="2.5"></rect>`;
  body += svgText(887, 214, "Effect /", { size: 14, color: "#991b1b" });
  body += svgText(887, 236, "Problem", { size: 14, color: "#991b1b" });

  categories.forEach((category, index) => {
    const top = index % 2 === 0;
    const column = Math.floor(index / 2);
    const spineX = 310 + column * 220;
    const branchX = spineX - 130;
    const branchY = top ? 94 : 346;
    const labelY = top ? branchY - 14 : branchY + 24;
    const minorY1 = top ? branchY + 40 : branchY - 40;
    const minorY2 = top ? branchY + 72 : branchY - 72;
    body += `<line x1="${branchX}" y1="${branchY}" x2="${spineX}" y2="${spineY}" stroke="#334155" stroke-width="2.5"></line>`;
    body += svgText(branchX - 12, labelY, category, {
      anchor: "start",
      size: 13,
      color: "#0f172a",
    });
    body += `<line x1="${branchX + 28}" y1="${minorY1}" x2="${
      branchX + 92
    }" y2="${minorY2}" stroke="#94a3b8" stroke-width="1.8"></line>`;
  });

  return svgShell(width, height, body);
}

function buildCtqSvg(title: string, items: string[]) {
  const width = 960;
  const height = 360;
  const drivers = items.slice(1, 4);
  const ctqs = items.slice(4, 7);
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<rect x="55" y="140" width="165" height="70" rx="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"></rect>`;
  body += svgText(137, 178, items[0] ?? "Customer Need", { size: 13, color: "#1e3a8a" });

  drivers.forEach((driver, index) => {
    const y = 85 + index * 85;
    body += `<line x1="220" y1="175" x2="360" y2="${y + 30}" stroke="#0f766e" stroke-width="2" marker-end="url(#arrowhead)"></line>`;
    body += `<rect x="360" y="${y}" width="170" height="60" rx="10" fill="#ccfbf1" stroke="#0d9488" stroke-width="2"></rect>`;
    body += svgText(445, y + 35, driver, { size: 12, color: "#134e4a" });
    const ctq = ctqs[index] ?? `CTQ ${index + 1}`;
    body += `<line x1="530" y1="${y + 30}" x2="665" y2="${y + 30}" stroke="#0f766e" stroke-width="2" marker-end="url(#arrowhead)"></line>`;
    body += `<rect x="665" y="${y}" width="190" height="60" rx="10" fill="#fef3c7" stroke="#d97706" stroke-width="2"></rect>`;
    body += svgText(760, y + 35, ctq, { size: 12, color: "#78350f" });
  });

  return svgShell(width, height, body);
}

function buildBarSvg(title: string, metrics: MetricPoint[], pareto: boolean) {
  const width = 960;
  const height = 420;
  const chartTop = 82;
  const chartLeft = 94;
  const chartWidth = 760;
  const chartHeight = 248;
  const maxValue = Math.max(...metrics.map((metric) => metric.value), 1);
  const barSlotWidth = chartWidth / Math.max(metrics.length, 1);
  const barWidth = Math.max(18, Math.min(82, barSlotWidth - 22));
  let cumulative = 0;
  const total = metrics.reduce((sum, metric) => sum + metric.value, 0) || 1;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += svgText(chartLeft, 64, pareto ? "Y: Count / impact" : "Y: Value", {
    anchor: "start",
    size: 11,
    color: "#475569",
  });
  body += `<line x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${
    chartLeft + chartWidth
  }" y2="${chartTop + chartHeight}" stroke="#334155" stroke-width="2"></line>`;
  body += `<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${
    chartTop + chartHeight
  }" stroke="#334155" stroke-width="2"></line>`;
  getAxisTicks(0, maxValue, 5).forEach((tick) => {
    const y = chartTop + chartHeight - (tick / maxValue) * chartHeight;
    body += `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="#cbd5e1" stroke-width="1" stroke-opacity="0.55"></line>`;
    body += svgText(chartLeft - 10, y + 4, formatAxisNumber(tick), {
      anchor: "end",
      size: 10,
      color: "#475569",
    });
  });

  metrics.forEach((metric, index) => {
    const x = chartLeft + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
    const barHeight = (metric.value / maxValue) * (chartHeight - 18);
    const y = chartTop + chartHeight - barHeight;
    cumulative += metric.value;
    body += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${
      pareto ? "#0ea5e9" : "#14b8a6"
    }"><title>${escapeHtml(`${metric.label}: Y value ${metric.value}`)}</title></rect>`;
    body += svgText(x + barWidth / 2, y - 8, String(Math.round(metric.value)), {
      size: 11,
      color: "#0f172a",
    });
    body += svgText(x + barWidth / 2, chartTop + chartHeight + 24, metric.label, {
      size: 10,
      color: "#475569",
    });

    if (pareto) {
      const pointX = x + barWidth / 2;
      const pointY = chartTop + chartHeight - (cumulative / total) * (chartHeight - 18);
      const cumulativePercent = (cumulative / total) * 100;
      body += `<circle cx="${pointX}" cy="${pointY}" r="4" fill="#f59e0b"><title>${escapeHtml(
        `${metric.label}: cumulative ${cumulativePercent.toFixed(1)}%`,
      )}</title></circle>`;
      if (index > 0) {
        const previousCumulative = metrics
          .slice(0, index)
          .reduce((sum, previousMetric) => sum + previousMetric.value, 0);
        const previousX =
          chartLeft + (index - 1) * barSlotWidth + (barSlotWidth - barWidth) / 2 + barWidth / 2;
        const previousY =
          chartTop + chartHeight - (previousCumulative / total) * (chartHeight - 18);
        body += `<line x1="${previousX}" y1="${previousY}" x2="${pointX}" y2="${pointY}" stroke="#f59e0b" stroke-width="3"></line>`;
      }
    }
  });

  body += svgText(chartLeft + chartWidth / 2, height - 24, "X: Category / date label", {
    size: 12,
    color: "#475569",
  });

  return svgShell(width, height, body);
}

function buildCapabilitySvg(
  title: string,
  values: number[],
  specLower: number | null,
  specUpper: number | null,
  target: number | null,
  stats: CapabilityStats | null,
) {
  const width = 960;
  const height = 410;
  const chartTop = 78;
  const chartLeft = 86;
  const chartWidth = 780;
  const chartHeight = 230;
  const usableValues = values.length > 0 ? values : parseMeasurementValues(DEFAULT_CAPABILITY_DATA);
  const minValue = Math.min(...usableValues, specLower ?? Infinity, target ?? Infinity);
  const maxValue = Math.max(...usableValues, specUpper ?? -Infinity, target ?? -Infinity);
  const safeMin = Number.isFinite(minValue) ? minValue : Math.min(...usableValues);
  const safeMax = Number.isFinite(maxValue) ? maxValue : Math.max(...usableValues);
  const range = Math.max(0.000001, safeMax - safeMin);
  const binCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(usableValues.length))));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: safeMin + (range / binCount) * index,
    end: safeMin + (range / binCount) * (index + 1),
    count: 0,
  }));

  usableValues.forEach((value) => {
    const index = Math.min(
      binCount - 1,
      Math.max(0, Math.floor(((value - safeMin) / range) * binCount)),
    );
    bins[index].count += 1;
  });

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const xFor = (value: number) => chartLeft + ((value - safeMin) / range) * chartWidth;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<rect x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"></rect>`;

  bins.forEach((bin, index) => {
    const x = chartLeft + index * (chartWidth / binCount) + 5;
    const barWidth = chartWidth / binCount - 10;
    const barHeight = (bin.count / maxCount) * (chartHeight - 20);
    const y = chartTop + chartHeight - barHeight;
    body += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="#14b8a6" fill-opacity="0.82"></rect>`;
    body += svgText(x + barWidth / 2, chartTop + chartHeight + 22, bin.start.toFixed(2), {
      size: 9,
      color: "#475569",
    });
  });

  [
    { value: specLower, label: "LSL", color: "#dc2626" },
    { value: target, label: "Target", color: "#f59e0b" },
    { value: specUpper, label: "USL", color: "#dc2626" },
  ].forEach((limit) => {
    if (limit.value === null || !Number.isFinite(limit.value)) {
      return;
    }

    const x = xFor(limit.value);
    body += `<line x1="${x}" y1="${chartTop}" x2="${x}" y2="${
      chartTop + chartHeight
    }" stroke="${limit.color}" stroke-width="3" stroke-dasharray="8 5"></line>`;
    body += svgText(x, chartTop - 10, limit.label, { size: 11, color: limit.color });
  });

  body += svgText(chartLeft + 8, 350, `Mean ${formatNumber(stats?.mean)}`, {
    anchor: "start",
    size: 12,
    color: "#0f172a",
  });
  body += svgText(chartLeft + 235, 350, `StdDev ${formatNumber(stats?.sampleStdDev)}`, {
    anchor: "start",
    size: 12,
    color: "#0f172a",
  });
  body += svgText(chartLeft + 470, 350, `Cp ${formatNumber(stats?.cp)} | Cpk ${formatNumber(stats?.cpk)}`, {
    anchor: "start",
    size: 12,
    color: "#0f172a",
  });

  return svgShell(width, height, body);
}

function buildOeeSvg(title: string, stats: OeeStats) {
  const width = 960;
  const height = 380;
  const metricRows = [
    { label: "Availability", value: stats.availability, color: "#0f766e" },
    { label: "Performance", value: stats.performance, color: "#0284c7" },
    { label: "Quality", value: stats.quality, color: "#f59e0b" },
    { label: "OEE", value: stats.oee, color: "#8b5cf6" },
  ];
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<rect x="74" y="82" width="812" height="220" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"></rect>`;

  metricRows.forEach((metric, index) => {
    const x = 116 + index * 196;
    const percent = metric.value === null ? 0 : Math.max(0, Math.min(100, metric.value * 100));
    const barHeight = 146 * (percent / 100);
    const barY = 250 - barHeight;

    body += `<rect x="${x}" y="104" width="112" height="146" rx="8" fill="#e2e8f0"></rect>`;
    body += `<rect x="${x}" y="${barY}" width="112" height="${barHeight}" rx="8" fill="${metric.color}" fill-opacity="0.86"></rect>`;
    body += svgText(x + 56, 276, metric.label, { size: 12, color: "#0f172a" });
    body += svgText(x + 56, barY - 10, metric.value === null ? "N/A" : `${percent.toFixed(1)}%`, {
      size: 13,
      color: metric.color,
    });
  });

  body += svgText(
    width / 2,
    334,
    "OEE = Availability x Performance x Quality",
    { size: 13, color: "#475569" },
  );

  return svgShell(width, height, body);
}

function buildLineSvg(title: string, metrics: MetricPoint[], control: boolean) {
  const width = 960;
  const height = 420;
  const chartTop = 78;
  const chartLeft = 94;
  const chartWidth = 760;
  const chartHeight = 248;
  const values = metrics.map((metric) => metric.value);
  const center = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance =
    values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);
  const ucl = center + 3 * sigma;
  const lcl = center - 3 * sigma;
  const maxValue = Math.max(...values, control ? ucl : -Infinity, 1);
  const minValue = Math.min(...values, control ? lcl : Infinity, 0);
  const range = Math.max(1, maxValue - minValue);
  const pointFor = (metric: MetricPoint, index: number) => {
    const x = chartLeft + (chartWidth / Math.max(1, metrics.length - 1)) * index;
    const y = chartTop + chartHeight - ((metric.value - minValue) / range) * chartHeight;
    return { x, y };
  };
  const yFor = (value: number) => chartTop + chartHeight - ((value - minValue) / range) * chartHeight;
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<rect x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"></rect>`;
  body += svgText(chartLeft, 62, "Y: Process value", {
    anchor: "start",
    size: 11,
    color: "#475569",
  });
  getAxisTicks(minValue, maxValue, 5).forEach((tick) => {
    const y = yFor(tick);
    body += `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="#cbd5e1" stroke-width="1" stroke-opacity="0.55"></line>`;
    body += svgText(chartLeft - 10, y + 4, formatAxisNumber(tick), {
      anchor: "end",
      size: 10,
      color: "#475569",
    });
  });

  if (control) {
    const centerY = yFor(center);
    const uclY = yFor(ucl);
    const lclY = yFor(lcl);
    body += `<line x1="${chartLeft}" y1="${uclY}" x2="${chartLeft + chartWidth}" y2="${uclY}" stroke="#dc2626" stroke-width="2" stroke-dasharray="8 6"></line>`;
    body += `<line x1="${chartLeft}" y1="${centerY}" x2="${chartLeft + chartWidth}" y2="${centerY}" stroke="#0f766e" stroke-width="2" stroke-dasharray="7 5"></line>`;
    body += `<line x1="${chartLeft}" y1="${lclY}" x2="${chartLeft + chartWidth}" y2="${lclY}" stroke="#dc2626" stroke-width="2" stroke-dasharray="8 6"></line>`;
    body += svgText(chartLeft + chartWidth + 14, uclY + 4, `UCL ${formatAxisNumber(ucl)}`, {
      anchor: "start",
      size: 11,
      color: "#991b1b",
    });
    body += svgText(chartLeft + chartWidth + 14, centerY + 4, `CL ${formatAxisNumber(center)}`, {
      anchor: "start",
      size: 11,
      color: "#0f766e",
    });
    body += svgText(chartLeft + chartWidth + 14, lclY + 4, `LCL ${formatAxisNumber(lcl)}`, {
      anchor: "start",
      size: 11,
      color: "#991b1b",
    });
  }

  const points = metrics.map(pointFor);
  points.forEach((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      body += `<line x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}" stroke="#0284c7" stroke-width="3"></line>`;
    }
    body += `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#0284c7"><title>${escapeHtml(
      `${metrics[index]?.label ?? `Point ${index + 1}`}: Y value ${metrics[index]?.value ?? ""}`,
    )}</title></circle>`;
    body += svgText(point.x, point.y - 12, formatAxisNumber(metrics[index]?.value ?? 0), {
      size: 10,
      color: "#0f172a",
    });
    body += svgText(point.x, chartTop + chartHeight + 24, metrics[index]?.label ?? "", {
      size: 10,
      color: "#475569",
    });
  });

  body += svgText(chartLeft + chartWidth / 2, height - 24, "X: Time / sample / date", {
    size: 12,
    color: "#475569",
  });

  return svgShell(width, height, body);
}

function buildScatterSvg(title: string, metrics: MetricPoint[]) {
  const width = 960;
  const height = 420;
  const chartTop = 78;
  const chartLeft = 94;
  const chartWidth = 760;
  const chartHeight = 248;
  const maxX = Math.max(...metrics.map((metric) => metric.value), 1);
  const maxY = Math.max(...metrics.map((metric) => metric.value2), 1);
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<rect x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"></rect>`;
  getAxisTicks(0, maxY, 5).forEach((tick) => {
    const y = chartTop + chartHeight - (tick / maxY) * chartHeight;
    body += `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="#cbd5e1" stroke-width="1" stroke-opacity="0.55"></line>`;
    body += svgText(chartLeft - 10, y + 4, formatAxisNumber(tick), {
      anchor: "end",
      size: 10,
      color: "#475569",
    });
  });
  getAxisTicks(0, maxX, 5).forEach((tick) => {
    const x = chartLeft + (tick / maxX) * chartWidth;
    body += `<line x1="${x}" y1="${chartTop}" x2="${x}" y2="${chartTop + chartHeight}" stroke="#cbd5e1" stroke-width="1" stroke-opacity="0.35"></line>`;
    body += svgText(x, chartTop + chartHeight + 22, formatAxisNumber(tick), {
      size: 10,
      color: "#475569",
    });
  });
  metrics.forEach((metric) => {
    const x = chartLeft + (metric.value / maxX) * chartWidth;
    const y = chartTop + chartHeight - (metric.value2 / maxY) * chartHeight;
    body += `<circle cx="${x}" cy="${y}" r="7" fill="#8b5cf6" fill-opacity="0.86"><title>${escapeHtml(
      `${metric.label}: X ${metric.value}, Y ${metric.value2}`,
    )}</title></circle>`;
    body += svgText(x, y - 12, metric.label, { size: 10, color: "#475569" });
  });
  body += svgText(chartLeft + chartWidth / 2, height - 24, "X: Factor value", {
    size: 12,
    color: "#475569",
  });
  body += svgText(chartLeft, 62, "Y: Outcome value", {
    anchor: "start",
    size: 11,
    color: "#475569",
  });
  return svgShell(width, height, body);
}

function buildDiagramSvg(input: {
  diagramType: DiagramType;
  title: string;
  items: string[];
  lanes: string[];
  metrics: MetricPoint[];
}) {
  switch (input.diagramType) {
    case "swimlane":
      return buildSwimlaneSvg(input.title, input.items, input.lanes);
    case "value_stream_map":
      return buildFlowSvg(input.title, input.items, true);
    case "fishbone":
      return buildFishboneSvg(input.title, input.items);
    case "ctq_tree":
      return buildCtqSvg(input.title, input.items);
    case "pareto":
      return buildBarSvg(input.title, input.metrics, true);
    case "histogram":
      return buildBarSvg(input.title, input.metrics, false);
    case "run_chart":
      return buildLineSvg(input.title, input.metrics, false);
    case "control_chart":
      return buildLineSvg(input.title, input.metrics, true);
    case "scatter_plot":
      return buildScatterSvg(input.title, input.metrics);
    default:
      return buildFlowSvg(input.title, input.items);
  }
}

function buildEditableCell(input: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  editable?: boolean;
  onChange?: (value: string) => void;
}) {
  if (!input.editable || !input.onChange) {
    return input.value || input.placeholder;
  }

  return (
    <textarea
      aria-label={input.ariaLabel}
      value={input.value}
      placeholder={input.placeholder}
      onChange={(event) => input.onChange?.(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      rows={2}
      className="min-h-10 w-full resize-y rounded-md border border-transparent bg-white/75 px-2 py-1 text-sm outline-none transition placeholder:text-slate-400 hover:border-cyan-300 focus:border-cyan-500 focus:bg-white dark:bg-slate-950/70 dark:placeholder:text-slate-500"
    />
  );
}

function buildTableRows(
  diagramType: DiagramType,
  items: string[],
  metrics: MetricPoint[],
  options: {
    editable?: boolean;
    onItemChange?: (index: number, value: string) => void;
    onMetricChange?: (index: number, field: "label" | "value" | "value2", value: string) => void;
  } = {},
) {
  if (diagramType === "sipoc") {
    const headers = ["Suppliers", "Inputs", "Process", "Outputs", "Customers"];
    return (
      <table className="w-full table-fixed border-collapse text-sm leading-relaxed">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border border-slate-300 bg-slate-100 px-4 py-3 text-left dark:border-slate-700 dark:bg-slate-900"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header, columnIndex) => {
                const itemIndex = rowIndex + columnIndex;
                return (
                  <td
                    key={header}
                    className="min-w-0 break-words border border-slate-300 px-3 py-3 align-top dark:border-slate-700"
                  >
                    {buildEditableCell({
                      value: items[itemIndex] ?? "",
                      placeholder: `${header} ${rowIndex + 1}`,
                      ariaLabel: `${header} row ${rowIndex + 1}`,
                      editable: options.editable,
                      onChange: (value) => options.onItemChange?.(itemIndex, value),
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const headers =
    diagramType === "fmea"
      ? ["Step", "Failure Mode", "Effect", "Cause", "Current Control", "Action"]
      : diagramType === "control_plan"
        ? ["Step", "Characteristic", "Method", "Frequency", "Owner", "Reaction"]
        : diagramType === "solution_matrix"
          ? ["Option", "Impact", "Effort", "Risk", "Score", "Decision"]
          : ["Field", "Detail"];

  return (
    <table className="w-full table-fixed border-collapse text-sm leading-relaxed">
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              className="border border-slate-300 bg-slate-100 px-4 py-3 text-left dark:border-slate-700 dark:bg-slate-900"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {metrics.slice(0, 5).map((metric, rowIndex) => (
          <tr key={`${metric.label}-${rowIndex}`}>
            {headers.map((header, columnIndex) => (
              <td
                key={header}
                className="min-w-0 break-words border border-slate-300 px-3 py-3 align-top dark:border-slate-700"
              >
                {columnIndex === 0
                  ? buildEditableCell({
                      value: metric.label,
                      placeholder: `${header} ${rowIndex + 1}`,
                      ariaLabel: `${header} row ${rowIndex + 1}`,
                      editable: options.editable,
                      onChange: (value) => options.onMetricChange?.(rowIndex, "label", value),
                    })
                  : buildEditableCell({
                      value: items[rowIndex + columnIndex] ?? "",
                      placeholder: `${header} ${rowIndex + 1}`,
                      ariaLabel: `${header} row ${rowIndex + 1}`,
                      editable: options.editable,
                      onChange: (value) => options.onItemChange?.(rowIndex + columnIndex, value),
                    })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildTableDiagramHtml(diagramType: DiagramType, items: string[], metrics: MetricPoint[]) {
  if (diagramType === "sipoc") {
    const headers = ["Suppliers", "Inputs", "Process", "Outputs", "Customers"];
    const rows = Array.from({ length: 4 }, (_, rowIndex) =>
      headers.map((header, columnIndex) => items[rowIndex + columnIndex] ?? `${header} ${rowIndex + 1}`),
    );
    return buildHtmlTable(headers, rows);
  }

  const headers =
    diagramType === "fmea"
      ? ["Step", "Failure Mode", "Effect", "Cause", "Current Control", "Action"]
      : diagramType === "control_plan"
        ? ["Step", "Characteristic", "Method", "Frequency", "Owner", "Reaction"]
        : diagramType === "solution_matrix"
          ? ["Option", "Impact", "Effort", "Risk", "Score", "Decision"]
          : ["Field", "Detail"];
  const rows = metrics.slice(0, 5).map((metric, rowIndex) =>
    headers.map((header, columnIndex) =>
      columnIndex === 0 ? metric.label : items[rowIndex + columnIndex] ?? `${header} ${rowIndex + 1}`,
    ),
  );
  return buildHtmlTable(headers, rows);
}

function buildHtmlTable(headers: string[], rows: string[][]) {
  return `<table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${headers
          .map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}

function buildControlledDocumentHtml(input: {
  title: string;
  diagramType: DiagramType;
  dmaicEnabled: boolean;
  dmaicPhase: DmaicPhase;
  prompt: string;
  processArea: string;
  items: string[];
  lanes: string[];
  metrics: MetricPoint[];
  svg: string;
  recommendation: DiagramRecommendation | null;
  formulaTool: FormulaTool;
  specLower: string;
  specUpper: string;
  targetValue: string;
  capabilityStats: CapabilityStats | null;
  oeeStats: OeeStats;
  dpmoStats: DpmoStats;
  taktStats: TaktStats;
  controlLimitStats: ControlLimitStats;
}) {
  const definition = getDiagramDefinition(input.diagramType);
  const phase = getDmaicPhaseOption(input.dmaicPhase);
  const setupSteps = input.recommendation?.setupSteps ?? [
    "Review the draft with the process owner.",
    "Confirm the data source and process boundary.",
    "Submit for approval when the document is ready for controlled use.",
  ];
  const rows = input.metrics.slice(0, 8).map((metric, index) => [
    String(index + 1),
    metric.label,
    String(metric.value),
    String(metric.value2),
  ]);

  return [
    `<h1>${escapeHtml(input.title)}</h1>`,
    `<p><strong>Diagram type:</strong> ${escapeHtml(definition.label)}<br><strong>Method:</strong> ${
      input.dmaicEnabled
        ? `DMAIC - ${escapeHtml(phase.label)}`
        : "General process documentation"
    }<br><strong>Process area:</strong> ${escapeHtml(input.processArea || "Unassigned")}</p>`,
    `<h2>Purpose</h2>`,
    `<p>${escapeHtml(input.prompt)}</p>`,
    `<h2>Diagram</h2>`,
    TABLE_DIAGRAM_TYPES.has(input.diagramType)
      ? buildTableDiagramHtml(input.diagramType, input.items, input.metrics)
      : input.svg,
    `<h2>How to Use</h2>`,
    `<ol>${setupSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`,
    `<h2>Key Fields</h2>`,
    `<ul>${definition.keyFields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>`,
    `<h2>Chart Data</h2>`,
    buildHtmlTable(["#", "Label", "Value", "Secondary Value"], rows),
    input.formulaTool === "capability"
      ? [
          `<h2>Capability Analysis</h2>`,
          `<p><strong>LSL:</strong> ${escapeHtml(input.specLower || "N/A")}<br><strong>Target:</strong> ${escapeHtml(
            input.targetValue || "N/A",
          )}<br><strong>USL:</strong> ${escapeHtml(input.specUpper || "N/A")}</p>`,
          buildHtmlTable(
            ["Metric", "Value"],
            [
              ["N", String(input.capabilityStats?.n ?? 0)],
              ["Mean", formatNumber(input.capabilityStats?.mean)],
              ["Sample Std Dev", formatNumber(input.capabilityStats?.sampleStdDev)],
              ["Cp", formatNumber(input.capabilityStats?.cp)],
              ["Cpu", formatNumber(input.capabilityStats?.cpu)],
              ["Cpl", formatNumber(input.capabilityStats?.cpl)],
              ["Cpk", formatNumber(input.capabilityStats?.cpk)],
              ["Estimated PPM", formatNumber(input.capabilityStats?.estimatedPpm, 0)],
            ],
          ),
          `<p>Cp = (USL - LSL) / (6 * sigma). Cpu = (USL - mean) / (3 * sigma). Cpl = (mean - LSL) / (3 * sigma). Cpk = min(Cpu, Cpl).</p>`,
        ].join("")
      : input.formulaTool === "oee"
        ? [
            `<h2>OEE Analysis</h2>`,
            buildHtmlTable(
              ["Metric", "Value"],
              [
                ["Availability", `${formatNumber((input.oeeStats.availability ?? 0) * 100, 2)}%`],
                ["Performance", `${formatNumber((input.oeeStats.performance ?? 0) * 100, 2)}%`],
                ["Quality", `${formatNumber((input.oeeStats.quality ?? 0) * 100, 2)}%`],
                ["OEE", `${formatNumber((input.oeeStats.oee ?? 0) * 100, 2)}%`],
              ],
            ),
            `<p>OEE = Availability x Performance x Quality.</p>`,
          ].join("")
        : input.formulaTool === "dpmo"
          ? [
              `<h2>DPMO Analysis</h2>`,
              buildHtmlTable(
                ["Metric", "Value"],
                [
                  ["DPMO", formatNumber(input.dpmoStats.dpmo, 0)],
                  ["Estimated Yield", `${formatNumber(input.dpmoStats.yieldPercent, 2)}%`],
                ],
              ),
            ].join("")
          : input.formulaTool === "takt_time"
            ? [
                `<h2>Takt Time</h2>`,
                buildHtmlTable(
                  ["Metric", "Value"],
                  [
                    ["Minutes / Unit", formatNumber(input.taktStats.taktMinutes, 3)],
                    ["Seconds / Unit", formatNumber(input.taktStats.taktSeconds, 1)],
                  ],
                ),
              ].join("")
            : input.formulaTool === "control_limits"
              ? [
                  `<h2>Control Limits</h2>`,
                  buildHtmlTable(
                    ["Metric", "Value"],
                    [
                      ["Centerline", formatNumber(input.controlLimitStats.centerline)],
                      ["Sample Sigma", formatNumber(input.controlLimitStats.sigma)],
                      ["UCL", formatNumber(input.controlLimitStats.ucl)],
                      ["LCL", formatNumber(input.controlLimitStats.lcl)],
                    ],
                  ),
                ].join("")
      : "",
    `<h2>Control Notes</h2>`,
    `<p>Verify this draft with the process owner. Approval, effective date, revision history, and audit trail are controlled in the Process Documentation workflow.</p>`,
  ].join("");
}

function ChartIcon({ diagramType }: { diagramType: DiagramType }) {
  if (TABLE_DIAGRAM_TYPES.has(diagramType)) {
    return <Table2 size={16} />;
  }
  if (BAR_DIAGRAM_TYPES.has(diagramType)) {
    return <BarChart3 size={16} />;
  }
  if (LINE_DIAGRAM_TYPES.has(diagramType)) {
    return <LineChart size={16} />;
  }
  if (diagramType === "fishbone" || diagramType === "ctq_tree") {
    return <GitBranch size={16} />;
  }
  if (diagramType === "swimlane" || diagramType === "value_stream_map") {
    return <Network size={16} />;
  }
  return <Workflow size={16} />;
}

export function ProcessMapBuilderClient({
  canEdit,
  departments,
}: ProcessMapBuilderClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const processAreaInputRef = useRef<HTMLInputElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const itemsTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lanesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const metricsTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState("Process Map Draft");
  const [diagramType, setDiagramType] = useState<DiagramType>("process_map");
  const [dmaicEnabled, setDmaicEnabled] = useState(false);
  const [dmaicPhase, setDmaicPhase] = useState<DmaicPhase>("define");
  const [departmentId, setDepartmentId] = useState("");
  const [processArea, setProcessArea] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [itemsText, setItemsText] = useState(
    getDiagramDefinition("process_map").starterItems.join("\n"),
  );
  const [lanesText, setLanesText] = useState("Operations\nQuality\nSupervisor");
  const [metricsText, setMetricsText] = useState(DEFAULT_METRIC_ROWS);
  const [capabilityDataText, setCapabilityDataText] = useState(DEFAULT_CAPABILITY_DATA);
  const [formulaTool, setFormulaTool] = useState<FormulaTool>("none");
  const [specLower, setSpecLower] = useState("");
  const [specUpper, setSpecUpper] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [dpmoDefects] = useState("7");
  const [dpmoUnits] = useState("100");
  const [dpmoOpportunities] = useState("3");
  const [taktAvailableMinutes] = useState("420");
  const [taktDemand] = useState("210");
  const [oeePlannedMinutes] = useState("480");
  const [oeeRunMinutes] = useState("420");
  const [oeeIdealCycleSeconds] = useState("45");
  const [oeeTotalCount] = useState("520");
  const [oeeGoodCount] = useState("498");
  const [layerSettings, setLayerSettings] = useState<LayerSettings>(DEFAULT_LAYER_SETTINGS);
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>(DEFAULT_DIAGRAM_STYLE);
  const [previewRevision, setPreviewRevision] = useState(1);
  const [recommendation, setRecommendation] = useState<DiagramRecommendation | null>(null);
  const [recommendBusy, setRecommendBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [chartModalOpen, setChartModalOpen] = useState(false);
  const [pageExplainBusy, setPageExplainBusy] = useState(false);
  const [pageExplanation, setPageExplanation] = useState("");
  const [pageExplainError, setPageExplainError] = useState<string | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("select");
  const [customFlowNodes, setCustomFlowNodes] = useState<CustomFlowNode[]>([
    { id: "start", type: "terminator", label: "Start", x: 110, y: 120 },
    { id: "step-1", type: "process", label: "Process step", x: 310, y: 120 },
    { id: "decision-1", type: "decision", label: "Decision", x: 520, y: 120 },
  ]);
  const [customFlowLinks, setCustomFlowLinks] = useState<CustomFlowLink[]>([
    { id: "start-step-1", from: "start", to: "step-1" },
    { id: "step-1-decision-1", from: "step-1", to: "decision-1" },
  ]);
  const [selectedCustomNodeId, setSelectedCustomNodeId] = useState<string | null>("step-1");
  const [pendingConnectorNodeId, setPendingConnectorNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const customFlowDragRef = useRef<{
    nodeId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const customFlowSuppressClickRef = useRef(false);

  const definition = getDiagramDefinition(diagramType);
  const phase = getDmaicPhaseOption(dmaicPhase);
  const isCustomFlowDiagram = CUSTOM_FLOW_DIAGRAM_TYPES.has(diagramType);
  const items = splitListInput(itemsText, definition.starterItems);
  const lanes = splitListInput(lanesText, ["Operations", "Quality", "Supervisor"]);
  const metrics = parseMetricRows(metricsText, definition.starterItems);
  const capabilityValues = parseMeasurementValues(capabilityDataText);
  const normalizedSpecLower = specLower.trim() ? Number.parseFloat(specLower) : null;
  const normalizedSpecUpper = specUpper.trim() ? Number.parseFloat(specUpper) : null;
  const normalizedTarget = targetValue.trim() ? Number.parseFloat(targetValue) : null;
  const capabilityStats = calculateCapability(
    capabilityValues,
    normalizedSpecLower,
    normalizedSpecUpper,
  );
  const oeeStats = calculateOee({
    plannedProductionMinutes: oeePlannedMinutes,
    runTimeMinutes: oeeRunMinutes,
    idealCycleSeconds: oeeIdealCycleSeconds,
    totalCount: oeeTotalCount,
    goodCount: oeeGoodCount,
  });
  const dpmoStats = calculateDpmo({
    defects: dpmoDefects,
    units: dpmoUnits,
    opportunities: dpmoOpportunities,
  });
  const taktStats = calculateTakt({
    availableMinutes: taktAvailableMinutes,
    demand: taktDemand,
  });
  const controlLimitStats = calculateControlLimits(metrics);
  const rawSvg =
    isCustomFlowDiagram
      ? buildCustomFlowSketchSvg(layerSettings.showTitle ? title : "", customFlowNodes, customFlowLinks)
      : formulaTool === "capability" && (diagramType === "histogram" || diagramType === "control_chart")
      ? buildCapabilitySvg(
          layerSettings.showTitle ? title : "",
          capabilityValues,
          normalizedSpecLower,
          normalizedSpecUpper,
          normalizedTarget,
          capabilityStats,
        )
      : formulaTool === "oee"
        ? buildOeeSvg(layerSettings.showTitle ? title : "", oeeStats)
      : buildDiagramSvg({
          diagramType,
          title: layerSettings.showTitle ? title : "",
          items,
          lanes,
          metrics,
        });
  const svg = applySvgTheme(rawSvg, diagramStyle, layerSettings);
  const selectedCustomNode =
    customFlowNodes.find((node) => node.id === selectedCustomNodeId) ?? null;

  function focusEditorField(
    ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
    selectContent = true,
  ) {
    const element = ref.current;
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      element.focus();
      if (selectContent) {
        element.select();
      }
    }, 120);
  }

  function updateSourceLine(
    currentText: string,
    index: number,
    value: string,
    fallbackRows: string[],
  ) {
    const rows = currentText.split(/\r?\n/);
    const targetLength = Math.max(index + 1, rows.length, fallbackRows.length);
    while (rows.length < targetLength) {
      rows.push(fallbackRows[rows.length] ?? "");
    }
    rows[index] = value;
    return rows.join("\n");
  }

  function updateItemLine(index: number, value: string) {
    setItemsText((current) => updateSourceLine(current, index, value, definition.starterItems));
  }

  function updateMetricLine(
    index: number,
    field: "label" | "value" | "value2",
    value: string,
  ) {
    setMetricsText((current) => {
      const rows = current.split(/\r?\n/);
      const targetLength = Math.max(index + 1, rows.length, DEFAULT_METRIC_ROWS.split("\n").length);
      while (rows.length < targetLength) {
        rows.push(DEFAULT_METRIC_ROWS.split("\n")[rows.length] ?? "");
      }
      const parts = (rows[index] ?? "").split(",");
      const normalizedParts = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
      const nextValue = field === "label" ? value.replaceAll(",", " ") : value;
      const partIndex = field === "label" ? 0 : field === "value" ? 1 : 2;
      normalizedParts[partIndex] = nextValue;
      rows[index] = normalizedParts.join(",");
      return rows.join("\n");
    });
  }

  function updateCapabilityLine(index: number, value: string) {
    setCapabilityDataText((current) =>
      updateSourceLine(current, index, value, DEFAULT_CAPABILITY_DATA.split("\n")),
    );
  }

  function focusPrimaryPreviewSource() {
    if (TABLE_DIAGRAM_TYPES.has(diagramType) || CUSTOM_FLOW_DIAGRAM_TYPES.has(diagramType)) {
      focusEditorField(itemsTextareaRef);
      return;
    }

    if (CHART_DATA_DIAGRAM_TYPES.has(diagramType)) {
      focusEditorField(metricsTextareaRef);
      return;
    }

    focusEditorField(itemsTextareaRef);
  }

  function applyDiagramType(nextDiagramType: DiagramType) {
    const nextDefinition = getDiagramDefinition(nextDiagramType);
    setDiagramType(nextDiagramType);
    setItemsText(nextDefinition.starterItems.join("\n"));
    setRecommendation(null);
    if (!title.trim() || title === "Process Map Draft") {
      setTitle(
        dmaicEnabled
          ? `${getDmaicPhaseOption(dmaicPhase).label} - ${nextDefinition.shortLabel} Draft`
          : `${nextDefinition.shortLabel} Draft`,
      );
    }
  }

  function addCustomFlowNode(type: CustomFlowNode["type"], x: number, y: number) {
    const id = `${type}-${Date.now()}-${Math.round(x)}-${Math.round(y)}`;
    const nextNode: CustomFlowNode = {
      id,
      type,
      label:
        type === "decision"
          ? "Decision"
          : type === "terminator"
            ? "Start / End"
            : "Process step",
      x: Math.max(70, Math.min(850, x)),
      y: Math.max(45, Math.min(315, y)),
    };
    setCustomFlowNodes((current) => [...current, nextNode]);
    setSelectedCustomNodeId(id);
  }

  function getCustomFlowPoint(
    event: Pick<ReactPointerEvent<SVGElement>, "clientX" | "clientY">,
    svgElement: SVGSVGElement,
  ) {
    const bounds = svgElement.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 960,
      y: ((event.clientY - bounds.top) / bounds.height) * 360,
    };
  }

  function updateCustomFlowNodePosition(nodeId: string, x: number, y: number) {
    setCustomFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              x: Math.max(70, Math.min(890, x)),
              y: Math.max(45, Math.min(315, y)),
            }
          : node,
      ),
    );
  }

  function moveCustomFlowNode(nodeId: string, deltaX: number, deltaY: number) {
    setCustomFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              x: Math.max(70, Math.min(890, node.x + deltaX)),
              y: Math.max(45, Math.min(315, node.y + deltaY)),
            }
          : node,
      ),
    );
  }

  function handleDrawingBoardClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (drawingMode === "select" || drawingMode === "connector") {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 960;
    const y = ((event.clientY - bounds.top) / bounds.height) * 360;
    addCustomFlowNode(drawingMode, x, y);
  }

  function handleCustomNodePointerDown(
    node: CustomFlowNode,
    event: ReactPointerEvent<SVGGElement>,
  ) {
    if (drawingMode !== "select" || event.button !== 0) {
      return;
    }

    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, svgElement);
    customFlowDragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      moved: false,
    };
    setSelectedCustomNodeId(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomNodePointerMove(event: ReactPointerEvent<SVGGElement>) {
    const dragState = customFlowDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, svgElement);
    dragState.moved = true;
    updateCustomFlowNodePosition(
      dragState.nodeId,
      point.x - dragState.offsetX,
      point.y - dragState.offsetY,
    );
  }

  function finishCustomNodeDrag(event: ReactPointerEvent<SVGGElement>) {
    const dragState = customFlowDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    customFlowSuppressClickRef.current = dragState.moved;
    customFlowDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCustomNodeClick(nodeId: string) {
    if (customFlowSuppressClickRef.current) {
      customFlowSuppressClickRef.current = false;
      return;
    }

    setSelectedCustomNodeId(nodeId);

    if (drawingMode !== "connector") {
      return;
    }

    if (!pendingConnectorNodeId) {
      setPendingConnectorNodeId(nodeId);
      return;
    }

    if (pendingConnectorNodeId !== nodeId) {
      const id = `${pendingConnectorNodeId}-${nodeId}`;
      setCustomFlowLinks((current) =>
        current.some((link) => link.id === id)
          ? current
          : [...current, { id, from: pendingConnectorNodeId, to: nodeId }],
      );
    }
    setPendingConnectorNodeId(null);
  }

  function updateSelectedCustomNodeLabel(label: string) {
    if (!selectedCustomNodeId) {
      return;
    }
    setCustomFlowNodes((current) =>
      current.map((node) => (node.id === selectedCustomNodeId ? { ...node, label } : node)),
    );
  }

  function handleCustomNodeKeyDown(
    node: CustomFlowNode,
    event: ReactKeyboardEvent<SVGGElement>,
  ) {
    const step = event.shiftKey ? 36 : 18;
    const keyMovement: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const movement = keyMovement[event.key];

    if (movement) {
      event.preventDefault();
      setSelectedCustomNodeId(node.id);
      moveCustomFlowNode(node.id, movement[0], movement[1]);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setSelectedCustomNodeId(node.id);
      setCustomFlowNodes((current) => current.filter((entry) => entry.id !== node.id));
      setCustomFlowLinks((current) =>
        current.filter((link) => link.from !== node.id && link.to !== node.id),
      );
      setPendingConnectorNodeId((current) => (current === node.id ? null : current));
    }
  }

  function deleteSelectedCustomNode() {
    if (!selectedCustomNodeId) {
      return;
    }
    setCustomFlowNodes((current) =>
      current.filter((node) => node.id !== selectedCustomNodeId),
    );
    setCustomFlowLinks((current) =>
      current.filter(
        (link) => link.from !== selectedCustomNodeId && link.to !== selectedCustomNodeId,
      ),
    );
    setSelectedCustomNodeId(null);
    setPendingConnectorNodeId(null);
  }

  function applyCustomFlowToSteps() {
    if (customFlowNodes.length === 0) {
      return;
    }
    setDiagramType("flowchart");
    setItemsText(customFlowNodes.map((node) => node.label).join("\n"));
    setMessage("Custom sketch copied into the flowchart steps.");
    setChartModalOpen(true);
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return session.access_token;
  }

  async function explainProcessMapPage() {
    setPageExplainBusy(true);
    setPageExplainError(null);

    try {
      const token = await getAccessToken();
      const context = [
        `Title: ${title || "Untitled"}`,
        `Method: ${dmaicEnabled ? `DMAIC ${phase.label}` : "General"}`,
        `Diagram: ${definition.label}`,
        `Process area: ${processArea || "Not specified"}`,
        `Prompt: ${prompt}`,
        `Steps or fields: ${items.join("; ")}`,
        `Chart data: ${metrics.map((metric) => `${metric.label}=${metric.value}/${metric.value2}`).join("; ")}`,
        recommendation ? `Recommendation: ${recommendation.reason}` : "Recommendation: none yet",
      ].join("\n");
      const response = await fetch("/api/page-explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pageType: "process_map",
          context,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as PageExplainResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to explain this page.");
      }

      setPageExplanation(payload.explanation ?? "");
    } catch (caughtError) {
      setPageExplainError(
        caughtError instanceof Error ? caughtError.message : "Unable to explain this page.",
      );
    } finally {
      setPageExplainBusy(false);
    }
  }

  function buildUsageMetadata() {
    return {
      title,
      diagramType,
      dmaicPhase,
      processArea,
      formulaTool,
      usesCapability: formulaTool === "capability",
      usesOee: formulaTool === "oee",
      itemCount: items.length,
      metricCount: metrics.length,
      capabilityCount: capabilityValues.length,
      cp: capabilityStats?.cp ?? null,
      cpk: capabilityStats?.cpk ?? null,
      pp: capabilityStats?.pp ?? null,
      ppk: capabilityStats?.ppk ?? null,
      oee: oeeStats.oee,
      availability: oeeStats.availability,
      performance: oeeStats.performance,
      quality: oeeStats.quality,
    };
  }

  async function logProcessMapUsage(action: string) {
    try {
      const token = await getAccessToken();
      await fetch("/api/process-maps/usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          mode: formulaTool === "none" ? "manual" : formulaTool,
          metadata: buildUsageMetadata(),
        }),
      });
    } catch {
      // Usage telemetry should not interrupt exports, printing, or draft creation.
    }
  }

  async function recommendChart() {
    setRecommendBusy(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/process-maps/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt,
          dmaicPhase: dmaicEnabled ? dmaicPhase : null,
          dmaicEnabled,
          processArea,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as RecommendationPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to recommend a chart.");
      }

      setRecommendation(payload);
      setDiagramType(payload.diagramType);
      if (dmaicEnabled) {
        setDmaicPhase(payload.dmaicPhase);
      }
      setTitle(
        dmaicEnabled
          ? payload.suggestedTitle
          : payload.suggestedTitle.replace(/^(Define|Measure|Analyze|Improve|Control)\s+-\s+/i, ""),
      );
      setItemsText(payload.starterItems.join("\n"));
      setFormulaTool("none");
      if (payload.metricRows?.length) {
        setMetricsText(payload.metricRows.join("\n"));
        if ((payload.formulaTool ?? "none") === "capability") {
          setCapabilityDataText(
            payload.metricRows
              .map((row) => row.split(",")[1]?.trim() ?? row.trim())
              .filter(Boolean)
              .join("\n"),
          );
        }
      }
      if (payload.specLower !== undefined && payload.specLower !== null) {
        setSpecLower(String(payload.specLower));
      }
      if (payload.specUpper !== undefined && payload.specUpper !== null) {
        setSpecUpper(String(payload.specUpper));
      }
      if (payload.target !== undefined && payload.target !== null) {
        setTargetValue(String(payload.target));
      }
      setMessage(
        payload.warning ??
          (payload.mode === "ai"
            ? "OpenAI recommended a chart for this context."
            : "Rules-based chart recommendation applied."),
      );
      setPreviewRevision((current) => current + 1);
      setChartModalOpen(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to recommend a chart.");
    } finally {
      setRecommendBusy(false);
    }
  }

  function downloadSvg() {
    void logProcessMapUsage("download_svg");
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "process-map"}.svg`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function downloadDataCsv() {
    void logProcessMapUsage("download_csv");
    if (formulaTool === "capability") {
      void logProcessMapUsage("capability_analysis");
    }

    const rows =
      formulaTool === "capability"
        ? [
            ["measurement"],
            ...capabilityValues.map((value) => [String(value)]),
            [],
            ["lsl", specLower],
            ["target", targetValue],
            ["usl", specUpper],
            ["mean", formatNumber(capabilityStats?.mean)],
            ["sample_std_dev", formatNumber(capabilityStats?.sampleStdDev)],
            ["cp", formatNumber(capabilityStats?.cp)],
            ["cpu", formatNumber(capabilityStats?.cpu)],
            ["cpl", formatNumber(capabilityStats?.cpl)],
            ["cpk", formatNumber(capabilityStats?.cpk)],
          ]
        : formulaTool === "oee"
          ? [
              ["metric", "value"],
              ["planned_production_minutes", oeePlannedMinutes],
              ["run_time_minutes", oeeRunMinutes],
              ["ideal_cycle_seconds", oeeIdealCycleSeconds],
              ["total_count", oeeTotalCount],
              ["good_count", oeeGoodCount],
              ["availability_percent", formatNumber((oeeStats.availability ?? 0) * 100, 2)],
              ["performance_percent", formatNumber((oeeStats.performance ?? 0) * 100, 2)],
              ["quality_percent", formatNumber((oeeStats.quality ?? 0) * 100, 2)],
              ["oee_percent", formatNumber((oeeStats.oee ?? 0) * 100, 2)],
            ]
        : formulaTool === "dpmo"
          ? [
              ["metric", "value"],
              ["defects", dpmoDefects],
              ["units", dpmoUnits],
              ["opportunities_per_unit", dpmoOpportunities],
              ["dpmo", formatNumber(dpmoStats.dpmo, 0)],
              ["yield_percent", formatNumber(dpmoStats.yieldPercent, 2)],
            ]
        : formulaTool === "takt_time"
          ? [
              ["metric", "value"],
              ["available_minutes", taktAvailableMinutes],
              ["customer_demand", taktDemand],
              ["takt_minutes_per_unit", formatNumber(taktStats.taktMinutes, 3)],
              ["takt_seconds_per_unit", formatNumber(taktStats.taktSeconds, 1)],
            ]
        : formulaTool === "control_limits"
          ? [
              ["metric", "value"],
              ["centerline", formatNumber(controlLimitStats.centerline)],
              ["sample_sigma", formatNumber(controlLimitStats.sigma)],
              ["ucl", formatNumber(controlLimitStats.ucl)],
              ["lcl", formatNumber(controlLimitStats.lcl)],
            ]
        : [
            ["label", "value", "secondary_value"],
            ...metrics.map((metric) => [
              metric.label,
              String(metric.value),
              String(metric.value2),
            ]),
          ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? "");
            return value.includes(",") || value.includes('"') || value.includes("\n")
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "process-map"}-data.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function buildPrintableReportHtml() {
    const formulaTable =
      formulaTool === "capability"
        ? buildHtmlTable(
            ["Metric", "Value"],
            [
              ["N", String(capabilityStats?.n ?? 0)],
              ["Mean", formatNumber(capabilityStats?.mean)],
              ["Sample Std Dev", formatNumber(capabilityStats?.sampleStdDev)],
              ["Population Std Dev", formatNumber(capabilityStats?.populationStdDev)],
              ["Cp", formatNumber(capabilityStats?.cp)],
              ["Cpu", formatNumber(capabilityStats?.cpu)],
              ["Cpl", formatNumber(capabilityStats?.cpl)],
              ["Cpk", formatNumber(capabilityStats?.cpk)],
              ["Pp", formatNumber(capabilityStats?.pp)],
              ["Ppk", formatNumber(capabilityStats?.ppk)],
              ["Estimated Yield", `${formatNumber(capabilityStats?.estimatedYield, 2)}%`],
              ["Estimated PPM", formatNumber(capabilityStats?.estimatedPpm, 0)],
            ],
          )
        : formulaTool === "oee"
          ? buildHtmlTable(
              ["Metric", "Value"],
              [
                ["Availability", `${formatNumber((oeeStats.availability ?? 0) * 100, 2)}%`],
                ["Performance", `${formatNumber((oeeStats.performance ?? 0) * 100, 2)}%`],
                ["Quality", `${formatNumber((oeeStats.quality ?? 0) * 100, 2)}%`],
                ["OEE", `${formatNumber((oeeStats.oee ?? 0) * 100, 2)}%`],
              ],
            )
          : formulaTool === "dpmo"
            ? buildHtmlTable(
                ["Metric", "Value"],
                [
                  ["DPMO", formatNumber(dpmoStats.dpmo, 0)],
                  ["Estimated Yield", `${formatNumber(dpmoStats.yieldPercent, 2)}%`],
                ],
              )
            : formulaTool === "takt_time"
              ? buildHtmlTable(
                  ["Metric", "Value"],
                  [
                    ["Takt Minutes / Unit", formatNumber(taktStats.taktMinutes, 3)],
                    ["Takt Seconds / Unit", formatNumber(taktStats.taktSeconds, 1)],
                  ],
                )
              : formulaTool === "control_limits"
                ? buildHtmlTable(
                    ["Metric", "Value"],
                    [
                      ["Centerline", formatNumber(controlLimitStats.centerline)],
                      ["Sample Sigma", formatNumber(controlLimitStats.sigma)],
                      ["UCL", formatNumber(controlLimitStats.ucl)],
                      ["LCL", formatNumber(controlLimitStats.lcl)],
                    ],
                  )
        : "";
    const dataTable = buildHtmlTable(
      formulaTool === "capability" ? ["#", "Measurement"] : ["Label", "Value", "Secondary Value"],
      formulaTool === "capability"
        ? capabilityValues.map((value, index) => [String(index + 1), String(value)])
        : metrics.map((metric) => [metric.label, String(metric.value), String(metric.value2)]),
    );

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin-top: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 18px; }
    .diagram { border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px; overflow: hidden; }
    .diagram svg { display: block; max-width: 100%; height: auto; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Diagram: ${escapeHtml(definition.label)} | ${
    dmaicEnabled ? `DMAIC: ${escapeHtml(phase.label)}` : "Method: General process documentation"
  } | Process area: ${escapeHtml(processArea || "Unassigned")}</div>
  <h2>Purpose</h2>
  <p>${escapeHtml(prompt)}</p>
  <h2>Diagram</h2>
  <div class="diagram">${
    TABLE_DIAGRAM_TYPES.has(diagramType) ? buildTableDiagramHtml(diagramType, items, metrics) : svg
  }</div>
  ${formulaTable ? `<h2>Calculator Results</h2>${formulaTable}` : ""}
  <h2>Data</h2>
  ${dataTable}
</body>
</html>`;
  }

  function downloadReportHtml() {
    void logProcessMapUsage("download_report");
    if (formulaTool === "capability") {
      void logProcessMapUsage("capability_analysis");
    }

    const blob = new Blob([buildPrintableReportHtml()], { type: "text/html;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "process-map"}-report.html`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function printTool() {
    void logProcessMapUsage("print");
    if (formulaTool === "capability") {
      void logProcessMapUsage("capability_analysis");
    }

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
    if (!printWindow) {
      setError("Unable to open print window. Check your browser popup settings.");
      return;
    }

    printWindow.document.write(buildPrintableReportHtml());
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  }

  function updateLayerSetting(key: keyof LayerSettings, value: boolean) {
    setLayerSettings((current) => ({ ...current, [key]: value }));
  }

  function updateDiagramStyle(key: keyof DiagramStyle, value: string) {
    setDiagramStyle((current) => ({ ...current, [key]: value }));
  }

  function refreshPreview() {
    setPreviewRevision((current) => current + 1);
    setMessage("Chart preview refreshed with the current data.");
    setChartModalOpen(true);
  }

  async function copyOutline() {
    const outline = [
      title,
      `Diagram: ${definition.label}`,
      dmaicEnabled ? `DMAIC: ${phase.label}` : "Method: General process documentation",
      `When to use: ${definition.whenToUse}`,
      "",
      "Items:",
      ...items.map((item) => `- ${item}`),
      "",
      "Key fields:",
      ...definition.keyFields.map((field) => `- ${field}`),
    ].join("\n");
    await navigator.clipboard.writeText(outline);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function saveControlledDraft() {
    setSaveBusy(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const bodyHtml = buildControlledDocumentHtml({
        title,
        diagramType,
        dmaicEnabled,
        dmaicPhase,
        prompt,
        processArea,
        items,
        lanes,
        metrics,
        svg,
        recommendation,
        formulaTool,
        specLower,
        specUpper,
        targetValue,
        capabilityStats,
        oeeStats,
        dpmoStats,
        taktStats,
        controlLimitStats,
      });

      const response = await fetch("/api/process-documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentNumber: toDocumentNumber(),
          title,
          documentType: "process_map",
          status: "draft",
          departmentId: departmentId || null,
          processName: title,
          processScope: prompt,
          processInputs: definition.keyFields.join(", "),
          processOutputs: `${definition.label} controlled draft`,
          processRisks:
            "Diagram must be reviewed against the real process before approval and effective release.",
          processControls:
            "Controlled document approval, revision history, periodic review, and process owner signoff.",
          relatedInstructionIds: [],
          isoClauseRefs: [
            "4.4 QMS processes",
            "6.1 Risks and opportunities",
            "7.5 Documented information",
            "8.5 Production and service provision",
            "10.2 Nonconformity and corrective action",
          ],
          bodyHtml,
          changeSummary: `Initial ${definition.label} draft created in the process map builder.`,
          sourceType: "manual",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        documentId?: string;
        error?: string;
      };

      if (!response.ok || !payload.documentId) {
        throw new Error(payload.error ?? "Unable to create controlled document draft.");
      }

      await logProcessMapUsage("save_controlled_draft");
      if (formulaTool === "capability") {
        await logProcessMapUsage("capability_analysis");
      }

      router.push(`/process-documents?doc=${payload.documentId}`);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create controlled document draft.",
      );
    } finally {
      setSaveBusy(false);
    }
  }

  const workspaceCanvas = isCustomFlowDiagram ? (
    <div className="grid h-full min-h-[36rem] grid-rows-[auto_minmax(0,1fr)] bg-white dark:bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
        <div>
          <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
            Editable Diagram Canvas
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Place, connect, select, and drag shapes in this one workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["select", "Select"],
            ["process", "Process"],
            ["decision", "Decision"],
            ["terminator", "Start/End"],
            ["connector", "Arrow"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setDrawingMode(mode as DrawingMode);
                if (mode !== "connector") {
                  setPendingConnectorNodeId(null);
                }
              }}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition",
                drawingMode === mode
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-100"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox="0 0 960 360"
        className="h-full min-h-[32rem] w-full cursor-crosshair"
        role="img"
        aria-label="Custom process flow sketch board"
        onClick={handleDrawingBoardClick}
      >
        <defs>
          <marker
            id="custom-flow-arrow-workspace"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill={diagramStyle.primaryColor} />
          </marker>
          <pattern id="custom-grid-workspace" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke={layerSettings.showGrid ? "#cbd5e1" : "transparent"}
              strokeWidth="0.7"
            />
          </pattern>
        </defs>
        <rect width="960" height="360" fill={diagramStyle.backgroundColor} />
        <rect width="960" height="360" fill="url(#custom-grid-workspace)" />
        {customFlowLinks.map((link) => {
          const from = customFlowNodes.find((node) => node.id === link.from);
          const to = customFlowNodes.find((node) => node.id === link.to);
          if (!from || !to) {
            return null;
          }
          return (
            <line
              key={link.id}
              x1={from.x + 56}
              y1={from.y}
              x2={to.x - 56}
              y2={to.y}
              stroke={diagramStyle.primaryColor}
              strokeWidth="3"
              markerEnd="url(#custom-flow-arrow-workspace)"
            />
          );
        })}
        {customFlowNodes.map((node) => {
          const isSelected = node.id === selectedCustomNodeId;
          const isPending = node.id === pendingConnectorNodeId;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => handleCustomNodePointerDown(node, event)}
              onPointerMove={handleCustomNodePointerMove}
              onPointerUp={finishCustomNodeDrag}
              onPointerCancel={finishCustomNodeDrag}
              onKeyDown={(event) => handleCustomNodeKeyDown(node, event)}
              onClick={(event) => {
                event.stopPropagation();
                handleCustomNodeClick(node.id);
              }}
              className={drawingMode === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
            >
              {node.type === "decision" ? (
                <polygon
                  points={`${node.x},${node.y - 44} ${node.x + 70},${node.y} ${node.x},${node.y + 44} ${node.x - 70},${node.y}`}
                  fill={isSelected ? "#ccfbf1" : "#fff7ed"}
                  stroke={isPending ? diagramStyle.accentColor : diagramStyle.primaryColor}
                  strokeWidth={isSelected || isPending ? 4 : 2}
                />
              ) : (
                <rect
                  x={node.x - 72}
                  y={node.y - 32}
                  width="144"
                  height="64"
                  rx={node.type === "terminator" ? 28 : 10}
                  fill={isSelected ? "#ccfbf1" : "#ffffff"}
                  stroke={isPending ? diagramStyle.accentColor : diagramStyle.primaryColor}
                  strokeWidth={isSelected || isPending ? 4 : 2}
                />
              )}
              <foreignObject x={node.x - 56} y={node.y - 22} width="112" height="44">
                <div className="flex h-full items-center justify-center text-center text-xs font-bold leading-tight text-slate-900">
                  {node.label}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  ) : TABLE_DIAGRAM_TYPES.has(diagramType) ? (
    <div className="min-h-[36rem] overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60">
      {buildTableRows(diagramType, items, metrics, {
        editable: true,
        onItemChange: updateItemLine,
        onMetricChange: updateMetricLine,
      })}
    </div>
  ) : (
    <div
      key={previewRevision}
      className="h-full min-h-[36rem] w-full overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60 [&>svg]:h-full [&>svg]:min-h-[32rem] [&>svg]:w-full"
      role="button"
      tabIndex={0}
      aria-label="Edit the source text or chart data for this preview"
      title="Click to edit the source text or chart data"
      onClick={focusPrimaryPreviewSource}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusPrimaryPreviewSource();
        }
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );

  const executiveStats = [
    ["Method", dmaicEnabled ? `DMAIC ${phase.label}` : "General"],
    ["Diagram", definition.shortLabel],
    ["X/Y Data Rows", String(metrics.length)],
    ["Flow Sketch", isCustomFlowDiagram ? "Editable" : "Not used"],
  ];

  return (
    <div className="grid gap-5">
      <header className="overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-white via-cyan-50/80 to-slate-100 p-5 shadow-xl shadow-slate-200/70 backdrop-blur dark:border-white/10 dark:from-slate-950 dark:via-slate-900 dark:to-cyan-950/40 dark:shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
            <Target size={13} />
            Process Mapping
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Chart and Process Map Builder
          </h1>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Build process maps, flow charts, and quality charts. Turn DMAIC on when the work is a
            Six Sigma project, or keep it general for everyday process documentation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void explainProcessMapPage()}
            disabled={pageExplainBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-800 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-fuchsia-100"
          >
            {pageExplainBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            AI explain page
          </button>
          <Link
            href="/process-documents"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <FileText size={16} />
            Process Docs
          </Link>
        </div>
        </div>
      </header>

      {message ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      {pageExplainError ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {pageExplainError}
        </p>
      ) : null}
      {pageExplanation ? (
        <section className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/10 p-4 text-sm text-slate-700 shadow-sm dark:text-slate-200">
          <div className="mb-2 flex items-center gap-2 font-extrabold text-slate-950 dark:text-slate-50">
            <Sparkles size={16} className="text-fuchsia-700 dark:text-fuchsia-200" />
            Simple explanation
          </div>
          <p>{pageExplanation}</p>
        </section>
      ) : null}

      <section className="grid gap-3 rounded-2xl border border-white/50 bg-white/80 p-4 shadow-lg shadow-slate-200/60 backdrop-blur dark:border-white/10 dark:bg-slate-950/65 dark:shadow-black/20">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {executiveStats.map(([label, value]) => (
            <div key={label} className="min-w-0 border-l-2 border-cyan-500/45 pl-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {label}
              </p>
              <p className="truncate text-sm font-extrabold text-slate-950 dark:text-slate-50">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Describe the process or problem
            </span>
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="min-w-0 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          {recommendation ? (
            <section className="grid gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                <ChartIcon diagramType={recommendation.diagramType} />
                {getDiagramDefinition(recommendation.diagramType).label}
                <span className="rounded-full border border-cyan-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                  {recommendation.mode === "ai" ? "OpenAI" : "Rules"} |{" "}
                  {recommendation.confidence}%
                </span>
              </div>
              <p className="text-slate-700 dark:text-slate-300">{recommendation.reason}</p>
              <ul className="grid gap-1 text-xs text-slate-600 dark:text-slate-400">
                {recommendation.setupSteps.map((step) => (
                  <li key={step}>- {step}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="grid content-start gap-3">
          <button
            type="button"
            onClick={() => void recommendChart()}
            disabled={recommendBusy || prompt.trim().length < 8}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-3 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
          >
            {recommendBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Recommend chart
          </button>
          <button
            type="button"
            onClick={refreshPreview}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <RefreshCw size={16} />
            Generate preview
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <aside id="map-setup" className="grid min-w-0 scroll-mt-24 content-start gap-3 rounded-2xl border border-slate-300/70 bg-white/90 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
          <div className="grid min-w-0 gap-3">
            <div className="grid gap-2 rounded-lg border border-slate-300/70 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">Method</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use DMAIC for Six Sigma work or General for documentation.
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                  {(["general", "dmaic"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDmaicEnabled(mode === "dmaic")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-extrabold transition",
                        (mode === "dmaic") === dmaicEnabled
                          ? "bg-cyan-500/20 text-cyan-900 dark:text-cyan-100"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                      )}
                    >
                      {mode === "dmaic" ? "DMAIC" : "General"}
                    </button>
                  ))}
                </div>
              </div>
              {dmaicEnabled ? (
                <div className="grid grid-cols-5 gap-1">
                  {DMAIC_PHASE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDmaicPhase(option.id)}
                      title={option.purpose}
                      className={cn(
                        "rounded-md border px-1.5 py-1 text-[11px] font-bold transition",
                        option.id === dmaicPhase
                          ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300",
                      )}
                    >
                      {option.label.slice(0, 1)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Title</span>
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            {dmaicEnabled ? (
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">DMAIC Phase</span>
                <select
                  value={dmaicPhase}
                  onChange={(event) => setDmaicPhase(event.target.value as DmaicPhase)}
                  className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                >
                  {DMAIC_PHASE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {phase.purpose}
                </span>
              </label>
            ) : null}

            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Process Area</span>
              <input
                ref={processAreaInputRef}
                value={processArea}
                onChange={(event) => setProcessArea(event.target.value)}
                placeholder="EDM setup, order entry, inspection..."
                className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Department</span>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Unassigned</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

          </div>
          <section className="grid min-w-0 gap-3 overflow-hidden rounded-lg border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/45">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
              <Target size={16} />
              Formula Tools
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              OEE, Cp/Cpk, DPMO, takt time, and control-limit calculators now live on their own
              page so chart setup stays focused on diagrams and data.
            </p>
            <Link
              href="/process-maps/formulas"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
            >
              <Target size={14} />
              Open formulas
            </Link>
          </section>

          <section className="grid min-w-0 gap-3 overflow-hidden rounded-lg border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/45">
            <div>
              <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
                Diagram Type
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pick the graph shape before editing the workspace.
              </p>
            </div>
            <div className="grid max-h-[38rem] gap-1.5 overflow-y-auto pr-1">
              {DIAGRAM_DEFINITIONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => applyDiagramType(entry.id)}
                  className={cn(
                    "grid gap-0.5 rounded-lg border p-2 text-left transition",
                    entry.id === diagramType
                      ? "border-cyan-500/60 bg-cyan-500/15"
                      : "border-slate-300/70 bg-white/70 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-900",
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                    <ChartIcon diagramType={entry.id} />
                    {entry.shortLabel}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {entry.category}
                    {dmaicEnabled
                      ? ` | ${entry.dmaicPhases
                          .map((phaseId) => getDmaicPhaseOption(phaseId).label)
                          .join(", ")}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="grid gap-4">
          <section id="map-preview" className="grid scroll-mt-24 gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                  Process Map Workspace
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {definition.label}: {definition.description}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <ChartIcon diagramType={diagramType} />
                {definition.category}
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={refreshPreview}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setChartModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                >
                  Open large preview
                </button>
                <button
                  type="button"
                  onClick={() => void copyOutline()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy Outline"}
                </button>
                <button
                  type="button"
                  onClick={downloadSvg}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <Download size={14} />
                  SVG
                </button>
                <button
                  type="button"
                  onClick={downloadDataCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <FileDown size={14} />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={downloadReportHtml}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <FileDown size={14} />
                  Report
                </button>
                <button
                  type="button"
                  onClick={printTool}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <Printer size={14} />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => void saveControlledDraft()}
                  disabled={!canEdit || saveBusy || !title.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200"
                  title={canEdit ? undefined : "Admin or system admin role required"}
                >
                  {saveBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Controlled Draft
                </button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-h-[36rem] overflow-hidden rounded-xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                {workspaceCanvas}
                {false && CUSTOM_FLOW_DIAGRAM_TYPES.has(diagramType) ? (
                  <div className="grid gap-3 rounded-xl border border-cyan-500/25 bg-slate-50 p-3 dark:border-cyan-500/20 dark:bg-slate-900/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
                        Custom Flow Sketch
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["select", "Select"],
                          ["process", "Process"],
                          ["decision", "Decision"],
                          ["terminator", "Start/End"],
                          ["connector", "Arrow"],
                        ].map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              setDrawingMode(mode as DrawingMode);
                              if (mode !== "connector") {
                                setPendingConnectorNodeId(null);
                              }
                            }}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                              drawingMode === mode
                                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-100"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-300/70 bg-white dark:border-slate-700 dark:bg-slate-950">
                      <svg
                        viewBox="0 0 960 360"
                        className="h-[28rem] w-full cursor-crosshair"
                        role="img"
                        aria-label="Custom process flow sketch board"
                        onClick={handleDrawingBoardClick}
                      >
                        <defs>
                          <marker
                            id="custom-flow-arrow-workspace"
                            markerWidth="10"
                            markerHeight="10"
                            refX="8"
                            refY="3"
                            orient="auto"
                            markerUnits="strokeWidth"
                          >
                            <path d="M0,0 L0,6 L9,3 z" fill="#0f766e" />
                          </marker>
                          <pattern id="custom-grid-workspace" width="24" height="24" patternUnits="userSpaceOnUse">
                            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#cbd5e1" strokeWidth="0.7" />
                          </pattern>
                        </defs>
                        <rect width="960" height="360" fill="url(#custom-grid-workspace)" />
                        {customFlowLinks.map((link) => {
                          const from = customFlowNodes.find((node) => node.id === link.from);
                          const to = customFlowNodes.find((node) => node.id === link.to);
                          if (!from || !to) {
                            return null;
                          }
                          return (
                            <line
                              key={link.id}
                              x1={from.x + 56}
                              y1={from.y}
                              x2={to.x - 56}
                              y2={to.y}
                              stroke="#0f766e"
                              strokeWidth="3"
                              markerEnd="url(#custom-flow-arrow-workspace)"
                            />
                          );
                        })}
                        {customFlowNodes.map((node) => {
                          const isSelected = node.id === selectedCustomNodeId;
                          const isPending = node.id === pendingConnectorNodeId;
                          return (
                            <g
                              key={node.id}
                              role="button"
                              tabIndex={0}
                              onPointerDown={(event) => handleCustomNodePointerDown(node, event)}
                              onPointerMove={handleCustomNodePointerMove}
                              onPointerUp={finishCustomNodeDrag}
                              onPointerCancel={finishCustomNodeDrag}
                              onKeyDown={(event) => handleCustomNodeKeyDown(node, event)}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCustomNodeClick(node.id);
                              }}
                              className={drawingMode === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
                            >
                              {node.type === "decision" ? (
                                <polygon
                                  points={`${node.x},${node.y - 44} ${node.x + 70},${node.y} ${node.x},${node.y + 44} ${node.x - 70},${node.y}`}
                                  fill={isSelected ? "#ccfbf1" : "#fff7ed"}
                                  stroke={isPending ? "#f59e0b" : "#0f766e"}
                                  strokeWidth={isSelected || isPending ? 4 : 2}
                                />
                              ) : (
                                <rect
                                  x={node.x - 72}
                                  y={node.y - 32}
                                  width="144"
                                  height="64"
                                  rx={node.type === "terminator" ? 28 : 10}
                                  fill={isSelected ? "#ccfbf1" : "#ffffff"}
                                  stroke={isPending ? "#f59e0b" : "#0f766e"}
                                  strokeWidth={isSelected || isPending ? 4 : 2}
                                />
                              )}
                              <foreignObject x={node.x - 56} y={node.y - 22} width="112" height="44">
                                <div className="flex h-full items-center justify-center text-center text-xs font-bold leading-tight text-slate-900">
                                  {node.label}
                                </div>
                              </foreignObject>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                ) : null}

                {false ? (
                <div className="min-h-[28rem] overflow-auto rounded-xl border border-slate-300/70 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-900/60">
                {TABLE_DIAGRAM_TYPES.has(diagramType) ? (
                  buildTableRows(diagramType, items, metrics, {
                    editable: true,
                    onItemChange: updateItemLine,
                    onMetricChange: updateMetricLine,
                  })
                ) : (
                  <div
                    key={previewRevision}
                    className="h-full min-h-[28rem] w-full"
                    role="button"
                    tabIndex={0}
                    aria-label="Edit the source text or chart data for this preview"
                    title="Click to edit the source text or chart data"
                    onClick={focusPrimaryPreviewSource}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        focusPrimaryPreviewSource();
                      }
                    }}
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                )}
                </div>
                ) : null}
              </div>

              <aside className="grid content-start gap-3 rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/60">
                {isCustomFlowDiagram ? (
                  <section className="grid gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-slate-100">
                        Selected shape
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {selectedCustomNode
                          ? `${selectedCustomNode.type}. Drag it on the sketch or use arrow keys.`
                          : "None selected"}
                      </p>
                    </div>
                    <label className="grid gap-1 text-xs">
                      <span className="font-semibold">Label</span>
                      <input
                        value={selectedCustomNode?.label ?? ""}
                        onChange={(event) => updateSelectedCustomNodeLabel(event.target.value)}
                        disabled={!selectedCustomNode}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={applyCustomFlowToSteps}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                      >
                        Sync steps
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelectedCustomNode}
                        disabled={!selectedCustomNode}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </section>
                ) : null}

                <details
                  open={!isCustomFlowDiagram}
                  className="rounded-lg border border-slate-300/70 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/45"
                >
                  <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-slate-100">
                    Source Data
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1 text-sm">
                      <span className="font-semibold">Steps, Categories, or Fields</span>
                      <textarea
                        ref={itemsTextareaRef}
                        value={itemsText}
                        onChange={(event) => setItemsText(event.target.value)}
                        rows={5}
                        className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        Swimlanes
                        {diagramType !== "swimlane" ? (
                          <button
                            type="button"
                            onClick={() => applyDiagramType("swimlane")}
                            className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                          >
                            Show lanes
                          </button>
                        ) : null}
                      </span>
                      <textarea
                        ref={lanesTextareaRef}
                        value={lanesText}
                        onChange={(event) => setLanesText(event.target.value)}
                        rows={3}
                        className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        Chart Data (X / Y)
                        <button
                          type="button"
                          onClick={refreshPreview}
                          className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                        >
                          Update
                        </button>
                      </span>
                      <textarea
                        ref={metricsTextareaRef}
                        value={metricsText}
                        onChange={(event) => setMetricsText(event.target.value)}
                        rows={4}
                        placeholder="X label/date, Y value, optional secondary Y"
                        className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                  </div>
                </details>

                <details
                  open
                  className="rounded-lg border border-slate-300/70 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/45"
                >
                  <summary className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Palette size={16} />
                    Display Settings
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      ["showTitle", "Title"],
                      ["showDataLayer", "Values"],
                      ["showControlLimits", "Limits"],
                      ["showGrid", "Grid"],
                      ["showLegend", "Legend"],
                      ["showIsoNotes", "ISO"],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                      >
                        <span className="font-semibold">{label}</span>
                        <input
                          type="checkbox"
                          checked={layerSettings[key as keyof LayerSettings]}
                          onChange={(event) =>
                            updateLayerSetting(key as keyof LayerSettings, event.target.checked)
                          }
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[
                      ["primaryColor", "Primary"],
                      ["secondaryColor", "Chart"],
                      ["accentColor", "Accent"],
                      ["riskColor", "Limits"],
                      ["backgroundColor", "Background"],
                    ].map(([key, label]) => (
                      <label key={key} className="grid gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        <span className="truncate">{label}</span>
                        <input
                          type="color"
                          value={diagramStyle[key as keyof DiagramStyle]}
                          onChange={(event) =>
                            updateDiagramStyle(key as keyof DiagramStyle, event.target.value)
                          }
                          className="h-8 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </label>
                    ))}
                  </div>
                </details>

                <details className="rounded-lg border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/35">
                  <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-slate-100">
                    Guidance
                  </summary>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-slate-100">When to use</h3>
                      <p>{definition.whenToUse}</p>
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-slate-100">ISO use</h3>
                      <p>{definition.isoUse}</p>
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-slate-100">Key fields</h3>
                      <ul className="grid gap-1">
                        {definition.keyFields.map((field) => (
                          <li key={field}>- {field}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              </aside>
            </div>
          </section>
        </main>
      </div>

      {chartModalOpen ? (
        <div
          className="fixed inset-0 flex items-start justify-center overflow-hidden bg-slate-950/75 p-3 pt-4 backdrop-blur-sm sm:p-5"
          style={{ zIndex: 2147483647 }}
        >
          <section className="grid max-h-[calc(100dvh-2rem)] w-full max-w-[96rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl dark:bg-slate-950">
            <header className="z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Generated chart preview
                </p>
                <h2 className="text-xl font-extrabold text-slate-950 dark:text-slate-50">
                  {title || definition.label}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={downloadSvg}
                  title="Download this chart as an SVG image"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <Download size={14} />
                  SVG
                </button>
                <button
                  type="button"
                  onClick={downloadDataCsv}
                  title="Download the current X/Y chart data as CSV"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <FileDown size={14} />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => setChartModalOpen(false)}
                  title="Close expanded chart preview"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <X size={14} />
                  Close
                </button>
              </div>
            </header>

            <div className="grid min-h-0 gap-4 overflow-y-auto overflow-x-hidden p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-h-[min(64dvh,42rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-300/70 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
                {TABLE_DIAGRAM_TYPES.has(diagramType) ? (
                  buildTableRows(diagramType, items, metrics, {
                    editable: true,
                    onItemChange: updateItemLine,
                    onMetricChange: updateMetricLine,
                  })
                ) : (
                  <div
                    key={`modal-${previewRevision}`}
                    className="h-full min-h-[min(64dvh,42rem)] w-full [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                )}
              </div>

              <aside className="grid content-start gap-4">
                <section className="rounded-xl border border-slate-300/70 bg-white/80 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                  <h3 className="font-extrabold text-slate-950 dark:text-slate-50">
                    Data and Analysis
                  </h3>
                  <dl className="mt-3 grid gap-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">Diagram</dt>
                      <dd className="font-bold">{definition.label}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">Method</dt>
                      <dd className="font-bold">{dmaicEnabled ? `DMAIC ${phase.label}` : "General"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">Rows</dt>
                      <dd className="font-bold">
                        {formulaTool === "capability" ? capabilityValues.length : metrics.length}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl border border-slate-300/70 bg-white/80 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                  <h3 className="font-extrabold text-slate-950 dark:text-slate-50">Chart data</h3>
                  <div className="mt-2 max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-t border-slate-200 text-left text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 pr-2 font-semibold">X label/date</th>
                          <th className="py-2 text-right font-semibold">Y value</th>
                          <th className="py-2 pl-2 text-right font-semibold">Secondary Y</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(formulaTool === "capability"
                          ? capabilityValues.map((value, index) => ({
                              label: `Measurement ${index + 1}`,
                              value,
                              value2: "",
                            }))
                          : metrics
                        ).map((metric, index) => (
                          <tr
                            key={`${metric.label}-${index}`}
                            title={`X: ${metric.label}; Y: ${metric.value}; secondary Y: ${metric.value2}`}
                            className="border-t border-slate-200 dark:border-slate-800"
                          >
                            <td className="py-2 pr-2 font-semibold">
                              <input
                                aria-label={`X label or date row ${index + 1}`}
                                value={metric.label}
                                onChange={(event) =>
                                  formulaTool === "capability"
                                    ? undefined
                                    : updateMetricLine(index, "label", event.target.value)
                                }
                                disabled={formulaTool === "capability"}
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-semibold outline-none transition hover:border-cyan-300 focus:border-cyan-500 focus:bg-white disabled:text-slate-500 dark:focus:bg-slate-950"
                              />
                            </td>
                            <td className="py-2 text-right">
                              <input
                                aria-label={`Y value row ${index + 1}`}
                                value={String(metric.value)}
                                onChange={(event) =>
                                  formulaTool === "capability"
                                    ? updateCapabilityLine(index, event.target.value)
                                    : updateMetricLine(index, "value", event.target.value)
                                }
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-xs outline-none transition hover:border-cyan-300 focus:border-cyan-500 focus:bg-white dark:focus:bg-slate-950"
                              />
                            </td>
                            <td className="py-2 pl-2 text-right text-slate-500">
                              <input
                                aria-label={`Secondary Y value row ${index + 1}`}
                                value={String(metric.value2)}
                                onChange={(event) =>
                                  formulaTool === "capability"
                                    ? undefined
                                    : updateMetricLine(index, "value2", event.target.value)
                                }
                                disabled={formulaTool === "capability"}
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-xs outline-none transition hover:border-cyan-300 focus:border-cyan-500 focus:bg-white disabled:text-slate-400 dark:focus:bg-slate-950"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
