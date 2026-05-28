"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Bold,
  CheckCircle2,
  Copy,
  FileDown,
  Download,
  FileText,
  GitBranch,
  Italic,
  LineChart,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Palette,
  Plus,
  Printer,
  RefreshCw,
  Redo2,
  Save,
  Sparkles,
  Table2,
  Target,
  Trash2,
  Type,
  Underline,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
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

interface DiagramTextStyle {
  color: string;
  fontFamily: string;
  fontScale: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

type DrawingMode = "select" | "process" | "decision" | "terminator" | "connector" | "custom";

interface DiagramElementStyle {
  fillColor: string;
  strokeColor: string;
  textColor: string;
}

interface CustomFlowAnchor {
  x: number;
  y: number;
}

interface CustomFlowNode {
  id: string;
  type: Exclude<DrawingMode, "select" | "connector">;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: CustomFlowAnchor[];
  style?: Partial<DiagramElementStyle>;
}

interface CustomFlowLink {
  id: string;
  from: string;
  to: string;
  fromOffset?: CustomFlowAnchor;
  toOffset?: CustomFlowAnchor;
  label?: string;
  anchors?: CustomFlowAnchor[];
  style?: Partial<DiagramElementStyle>;
}

interface CustomFlowCanvasView {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DraftConnector {
  from: string;
  x: number;
  y: number;
  fromOffset?: CustomFlowAnchor;
  targetNodeId?: string | null;
}

interface CustomFlowSnapshot {
  nodes: CustomFlowNode[];
  links: CustomFlowLink[];
  selectedNodeId: string | null;
  selectedLinkId: string | null;
}

interface SwimlaneStep {
  id: string;
  label: string;
  laneIndex: number;
  x: number;
  style?: Partial<DiagramElementStyle>;
}

interface SwimlaneLink {
  id: string;
  from: string;
  to: string;
  label: string;
  bendX: number;
  bendY: number;
  style?: Partial<DiagramElementStyle>;
}

interface ValueStreamNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

type InlineChartEditTarget =
  | { kind: "title"; value: string }
  | { kind: "purpose"; value: string }
  | { kind: "item"; index: number; value: string }
  | { kind: "lane"; index: number; value: string }
  | { kind: "fishboneEffect"; value: string }
  | { kind: "metric"; index: number; field: "label" | "value" | "value2"; value: string }
  | { kind: "customNode"; nodeId: string; value: string }
  | { kind: "customLink"; linkId: string; value: string }
  | { kind: "swimlaneStep"; stepId: string; value: string }
  | { kind: "swimlaneArrow"; linkId: string; value: string }
  | { kind: "valueStreamTimeline"; value: string }
  | { kind: "valueStreamNote"; noteId: string; value: string };

type InlineChartEditor = InlineChartEditTarget & {
  left: number;
  top: number;
  width: number;
};

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
const SIPOC_HEADERS = ["Suppliers", "Inputs", "Process", "Outputs", "Customers"];

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

const DEFAULT_DIAGRAM_TEXT_STYLE: DiagramTextStyle = {
  color: "#0f172a",
  fontFamily: "Inter, Arial, sans-serif",
  fontScale: 1,
  bold: true,
  italic: false,
  underline: false,
};

const DEFAULT_PROMPT =
  "Document the process boundary, inputs, outputs, owners, decisions, and major process steps for controlled process documentation.";

const CUSTOM_FLOW_CANVAS_WIDTH = 1280;
const CUSTOM_FLOW_CANVAS_HEIGHT = 720;
const CUSTOM_FLOW_NODE_HALF_WIDTH = 82;
const CUSTOM_FLOW_NODE_HALF_HEIGHT = 38;
const CUSTOM_FLOW_DECISION_HALF_WIDTH = 88;
const CUSTOM_FLOW_DECISION_HALF_HEIGHT = 54;
const CUSTOM_FLOW_CUSTOM_MIN_SIZE = 36;
const CUSTOM_FLOW_CONNECT_SNAP_DISTANCE = 96;
const CUSTOM_FLOW_MIN_VIEW_WIDTH = 520;
const CUSTOM_FLOW_MIN_VIEW_HEIGHT = 300;
const CUSTOM_FLOW_DEFAULT_VIEW = {
  x: 0,
  y: 150,
  width: CUSTOM_FLOW_CANVAS_WIDTH,
  height: 500,
};
const QUICK_COLOR_SWATCHES = [
  "#0f766e",
  "#0284c7",
  "#f59e0b",
  "#dc2626",
  "#ffffff",
  "#111827",
  "#7c3aed",
  "#16a34a",
  "#f97316",
  "#e879f9",
];

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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDefaultElementStyle(
  fillColor: string,
  strokeColor: string,
  textColor: string,
): DiagramElementStyle {
  return {
    fillColor,
    strokeColor,
    textColor,
  };
}

function mergeElementStyle(
  baseStyle: DiagramElementStyle,
  override?: Partial<DiagramElementStyle>,
): DiagramElementStyle {
  return {
    fillColor: override?.fillColor ?? baseStyle.fillColor,
    strokeColor: override?.strokeColor ?? baseStyle.strokeColor,
    textColor: override?.textColor ?? baseStyle.textColor,
  };
}

function getCustomFlowNodeDefaultStyle(node: CustomFlowNode): DiagramElementStyle {
  return getDefaultElementStyle(
    node.type === "decision" ? "#fff7ed" : node.type === "custom" ? "#f5f3ff" : "#ffffff",
    node.type === "custom" ? "#7c3aed" : "#0f766e",
    "#0f172a",
  );
}

function getCustomFlowNodeStyle(node: CustomFlowNode): DiagramElementStyle {
  return mergeElementStyle(getCustomFlowNodeDefaultStyle(node), node.style);
}

function getCustomFlowLinkStyle(link: CustomFlowLink): DiagramElementStyle {
  return mergeElementStyle(
    getDefaultElementStyle("transparent", "#0f766e", "#0f172a"),
    link.style,
  );
}

function getSwimlaneStepStyle(step: SwimlaneStep): DiagramElementStyle {
  return mergeElementStyle(
    getDefaultElementStyle("#e0f2fe", "#0284c7", "#0f172a"),
    step.style,
  );
}

function getSwimlaneLinkStyle(link: SwimlaneLink): DiagramElementStyle {
  return mergeElementStyle(
    getDefaultElementStyle("transparent", "#0f766e", "#0f172a"),
    link.style,
  );
}

function getCustomFlowNodeEdgePoint(
  node: CustomFlowNode,
  toward: { x: number; y: number },
) {
  const deltaX = toward.x - node.x;
  const deltaY = toward.y - node.y;
  const halfSize = getCustomFlowNodeHalfSize(node);

  if (deltaX === 0 && deltaY === 0) {
    return { x: node.x, y: node.y };
  }

  if (node.type === "decision") {
    const scale =
      1 /
      Math.max(
        Math.abs(deltaX) / CUSTOM_FLOW_DECISION_HALF_WIDTH +
          Math.abs(deltaY) / CUSTOM_FLOW_DECISION_HALF_HEIGHT,
        0.0001,
      );
    return {
      x: node.x + deltaX * scale,
      y: node.y + deltaY * scale,
    };
  }

  const scale = Math.min(
    halfSize.width / Math.max(Math.abs(deltaX), 0.0001),
    halfSize.height / Math.max(Math.abs(deltaY), 0.0001),
  );

  return {
    x: node.x + deltaX * scale,
    y: node.y + deltaY * scale,
  };
}

function getCustomFlowNodeHalfSize(node: CustomFlowNode) {
  if (node.type === "decision") {
    return {
      width: CUSTOM_FLOW_DECISION_HALF_WIDTH,
      height: CUSTOM_FLOW_DECISION_HALF_HEIGHT,
    };
  }

  if (node.type === "custom") {
    return {
      width: Math.max(CUSTOM_FLOW_CUSTOM_MIN_SIZE / 2, (node.width ?? 110) / 2),
      height: Math.max(CUSTOM_FLOW_CUSTOM_MIN_SIZE / 2, (node.height ?? 72) / 2),
    };
  }

  return {
    width: CUSTOM_FLOW_NODE_HALF_WIDTH,
    height: CUSTOM_FLOW_NODE_HALF_HEIGHT,
  };
}

function getCustomFlowShapePath(node: CustomFlowNode) {
  const points =
    node.points && node.points.length >= 3
      ? node.points
      : [
          { x: -56, y: -34 },
          { x: 54, y: -26 },
          { x: 68, y: 22 },
          { x: 6, y: 42 },
          { x: -64, y: 18 },
        ];

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${node.x + point.x} ${node.y + point.y}`)
    .join(" ")
    .concat(" Z");
}

function isPointInsideCustomFlowNode(
  point: { x: number; y: number },
  node: CustomFlowNode,
) {
  if (node.type === "decision") {
    return (
      Math.abs(point.x - node.x) / CUSTOM_FLOW_DECISION_HALF_WIDTH +
        Math.abs(point.y - node.y) / CUSTOM_FLOW_DECISION_HALF_HEIGHT <=
      1
    );
  }

  const halfSize = getCustomFlowNodeHalfSize(node);
  return (
    Math.abs(point.x - node.x) <= halfSize.width &&
    Math.abs(point.y - node.y) <= halfSize.height
  );
}

function getCustomFlowLinkRoute(
  link: CustomFlowLink,
  from: CustomFlowNode,
  to: CustomFlowNode,
) {
  const anchors = link.anchors ?? [];
  const fromPoint = link.fromOffset
    ? { x: from.x + link.fromOffset.x, y: from.y + link.fromOffset.y }
    : null;
  const toPoint = link.toOffset
    ? { x: to.x + link.toOffset.x, y: to.y + link.toOffset.y }
    : null;
  const firstTarget = anchors[0] ?? toPoint ?? { x: to.x, y: to.y };
  const lastSource = anchors.at(-1) ?? fromPoint ?? { x: from.x, y: from.y };

  return [
    fromPoint ?? getCustomFlowNodeEdgePoint(from, firstTarget),
    ...anchors,
    toPoint ?? getCustomFlowNodeEdgePoint(to, lastSource),
  ];
}

function getCustomFlowConnectionOffset(
  node: CustomFlowNode,
  point: { x: number; y: number },
) {
  const connectionPoint = isPointInsideCustomFlowNode(point, node)
    ? point
    : getCustomFlowNodeEdgePoint(node, point);

  return {
    x: connectionPoint.x - node.x,
    y: connectionPoint.y - node.y,
  };
}

function customFlowPathFromRoute(route: Array<{ x: number; y: number }>) {
  if (route.length === 0) {
    return "";
  }

  const [start, ...rest] = route;
  return `M ${start.x} ${start.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function getRouteMidpoint(route: Array<{ x: number; y: number }>) {
  if (route.length === 0) {
    return { x: 0, y: 0 };
  }

  const middleIndex = Math.max(0, Math.floor((route.length - 1) / 2));
  const from = route[middleIndex];
  const to = route[Math.min(route.length - 1, middleIndex + 1)] ?? from;
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  };
}

function distanceToSegmentSquared(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    const pointDeltaX = point.x - from.x;
    const pointDeltaY = point.y - from.y;
    return pointDeltaX * pointDeltaX + pointDeltaY * pointDeltaY;
  }

  const t = clampNumber(
    ((point.x - from.x) * deltaX + (point.y - from.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  const projectionX = from.x + t * deltaX;
  const projectionY = from.y + t * deltaY;
  const projectionDeltaX = point.x - projectionX;
  const projectionDeltaY = point.y - projectionY;
  return projectionDeltaX * projectionDeltaX + projectionDeltaY * projectionDeltaY;
}

function getClosestRouteSegmentIndex(
  route: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < route.length - 1; index += 1) {
    const distance = distanceToSegmentSquared(point, route[index], route[index + 1]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
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
      <path d="M0,0 L10,3.5 L0,7 Z" fill="context-stroke"></path>
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

function applySvgTextStyle(svg: string, textStyle: DiagramTextStyle) {
  let styledSvg = svg
    .replaceAll(
      'font-family="Inter, Arial, sans-serif"',
      `font-family="${escapeHtml(textStyle.fontFamily)}"`,
    )
    .replace(/font-size="([0-9.]+)"/g, (_, size: string) => {
      const scaledSize = clampNumber(
        Number.parseFloat(size) * textStyle.fontScale,
        8,
        30,
      );
      return `font-size="${scaledSize.toFixed(scaledSize >= 10 ? 1 : 2)}"`;
    })
    .replace(/font-weight="[0-9]+"/g, `font-weight="${textStyle.bold ? 800 : 500}"`);

  const extraTextAttributes = [
    textStyle.italic ? 'font-style="italic"' : "",
    textStyle.underline ? 'text-decoration="underline"' : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (extraTextAttributes) {
    styledSvg = styledSvg.replace(/<text /g, `<text ${extraTextAttributes} `);
  }

  return styledSvg;
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

function buildValueStreamSvg(
  title: string,
  items: string[],
  timelineLabel: string,
  notes: ValueStreamNote[],
) {
  const width = 960;
  const height = 420;
  const visibleItems = items.length > 0 ? items : getDiagramDefinition("value_stream_map").starterItems;
  const count = Math.max(visibleItems.length, 1);
  const top = title ? 58 : 20;
  const y = top + 112;
  const left = 78;
  const right = 78;
  const availableWidth = width - left - right;
  const stepGap = count > 1 ? availableWidth / (count - 1) : 0;
  const boxWidth = clampNumber(stepGap - 34, 112, 142);
  const boxHeight = 66;
  let body = title ? svgText(width / 2, 36, title, { size: 20, color: "#111827" }) : "";

  visibleItems.forEach((item, index) => {
    const x = count === 1 ? width / 2 : left + stepGap * index;
    if (index > 0) {
      const previousX = count === 1 ? width / 2 : left + stepGap * (index - 1);
      body += `<line x1="${previousX + boxWidth / 2 + 10}" y1="${y}" x2="${x - boxWidth / 2 - 12}" y2="${y}" stroke="#0f766e" stroke-width="3" marker-end="url(#arrowhead)"></line>`;
    }
    body += `<rect x="${x - boxWidth / 2}" y="${y - boxHeight / 2}" width="${boxWidth}" height="${boxHeight}" rx="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"></rect>`;
    body += svgText(x, y - 5, item, { size: 12, color: "#0f172a" });
    body += svgText(x, y + 17, `CT ${index + 2}m | WIP ${index + 1}`, {
      size: 10,
      weight: 600,
      color: "#475569",
    });
  });

  body += `<line x1="110" y1="${top + 252}" x2="850" y2="${top + 252}" stroke="#64748b" stroke-width="2"></line>`;
  body += svgText(480, top + 282, timelineLabel, {
    size: 13,
    weight: 700,
    color: "#475569",
  });

  notes.forEach((note) => {
    body += `<rect x="${note.x - 70}" y="${note.y - 22}" width="140" height="44" rx="8" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.5"></rect>`;
    body += svgText(note.x, note.y + 4, note.text, { size: 10, weight: 700, color: "#713f12" });
  });

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

function buildSwimlaneSandboxSvg(
  title: string,
  lanes: string[],
  steps: SwimlaneStep[],
  links: SwimlaneLink[],
) {
  const width = 960;
  const laneHeight = 92;
  const laneHeaderWidth = 154;
  const top = title ? 70 : 28;
  const stepWidth = 164;
  const stepHeight = 48;
  const visibleLanes = lanes.length > 0 ? lanes : ["Operations"];
  const height = top + visibleLanes.length * laneHeight + 36;
  const stepById = new Map(steps.map((step) => [step.id, step]));
  let body = title ? svgText(width / 2, 38, title, { size: 20, color: "#111827" }) : "";

  visibleLanes.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight;
    body += `<rect x="36" y="${y}" width="888" height="${laneHeight}" fill="${
      laneIndex % 2 === 0 ? "#f1f5f9" : "#ffffff"
    }" stroke="#cbd5e1" stroke-width="1.5"></rect>`;
    body += `<rect x="36" y="${y}" width="${laneHeaderWidth}" height="${laneHeight}" fill="#ccfbf1" stroke="#99f6e4" stroke-width="1.5"></rect>`;
    body += svgText(36 + laneHeaderWidth / 2, y + laneHeight / 2 + 5, lane, {
      size: 12,
      color: "#0f172a",
    });
  });

  links.forEach((link) => {
    const from = stepById.get(link.from);
    const to = stepById.get(link.to);
    if (!from || !to) {
      return;
    }

    const fromY = top + from.laneIndex * laneHeight + laneHeight / 2;
    const toY = top + to.laneIndex * laneHeight + laneHeight / 2;
    const fromX = from.x + stepWidth / 2;
    const toX = to.x - stepWidth / 2;
    const bendX = Number.isFinite(link.bendX) ? link.bendX : (fromX + toX) / 2;
    const bendY = Number.isFinite(link.bendY) ? top + link.bendY : (fromY + toY) / 2;
    const linkStyle = getSwimlaneLinkStyle(link);
    body += `<path d="M ${fromX} ${fromY} Q ${bendX} ${bendY} ${toX} ${toY}" fill="none" stroke="${linkStyle.strokeColor}" stroke-width="2.5" marker-end="url(#arrowhead)"></path>`;
    if (link.label.trim()) {
      body += svgText(bendX, bendY - 10, link.label, { size: 10, color: linkStyle.textColor });
    }
  });

  steps.forEach((step) => {
    const laneIndex = clampNumber(step.laneIndex, 0, visibleLanes.length - 1);
    const y = top + laneIndex * laneHeight + laneHeight / 2 - stepHeight / 2;
    const stepStyle = getSwimlaneStepStyle(step);
    body += `<rect x="${step.x - stepWidth / 2}" y="${y}" width="${stepWidth}" height="${stepHeight}" rx="9" fill="${stepStyle.fillColor}" stroke="${stepStyle.strokeColor}" stroke-width="2"></rect>`;
    body += svgText(step.x, y + 29, step.label, { size: 11, color: stepStyle.textColor });
  });

  return svgShell(width, height, body);
}

function buildCustomFlowSketchSvg(title: string, nodes: CustomFlowNode[], links: CustomFlowLink[]) {
  const width = CUSTOM_FLOW_CANVAS_WIDTH;
  const boardHeight = CUSTOM_FLOW_CANVAS_HEIGHT;
  const top = title ? 50 : 8;
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

    const route = getCustomFlowLinkRoute(link, from, to).map((point) => ({
      x: point.x,
      y: top + point.y,
    }));
    const linkStyle = getCustomFlowLinkStyle(link);
    body += `<path d="${customFlowPathFromRoute(route)}" fill="none" stroke="${linkStyle.strokeColor}" stroke-width="3" marker-end="url(#arrowhead)"></path>`;
    if (link.label?.trim()) {
      const labelPoint = getRouteMidpoint(route);
      body += svgText(labelPoint.x, labelPoint.y - 10, link.label, {
        size: 10,
        color: linkStyle.textColor,
      });
    }
  });

  nodes.forEach((node) => {
    const y = top + node.y;
    const nodeStyle = getCustomFlowNodeStyle(node);
    if (node.type === "custom") {
      const path = getCustomFlowShapePath({ ...node, y });
      body += `<path d="${path}" fill="${nodeStyle.fillColor}" stroke="${nodeStyle.strokeColor}" stroke-width="2"></path>`;
    } else if (node.type === "decision") {
      body += `<polygon points="${node.x},${y - CUSTOM_FLOW_DECISION_HALF_HEIGHT} ${
        node.x + CUSTOM_FLOW_DECISION_HALF_WIDTH
      },${y} ${node.x},${y + CUSTOM_FLOW_DECISION_HALF_HEIGHT} ${
        node.x - CUSTOM_FLOW_DECISION_HALF_WIDTH
      },${y}" fill="${nodeStyle.fillColor}" stroke="${nodeStyle.strokeColor}" stroke-width="2"></polygon>`;
    } else {
      body += `<rect x="${node.x - CUSTOM_FLOW_NODE_HALF_WIDTH}" y="${
        y - CUSTOM_FLOW_NODE_HALF_HEIGHT
      }" width="${CUSTOM_FLOW_NODE_HALF_WIDTH * 2}" height="${
        CUSTOM_FLOW_NODE_HALF_HEIGHT * 2
      }" rx="${
        node.type === "terminator" ? 28 : 10
      }" fill="${nodeStyle.fillColor}" stroke="${nodeStyle.strokeColor}" stroke-width="2"></rect>`;
    }

    body += svgText(node.x, y + 4, node.label, { size: 12, color: nodeStyle.textColor });
  });

  return svgShell(width, height, body);
}

function buildFishboneSvg(
  title: string,
  items: string[],
  options: { effectLabel?: string; causeSlots?: number } = {},
) {
  const categories = (items.length > 0 ? items : getDiagramDefinition("fishbone").starterItems).slice(0, 12);
  const columns = Math.max(1, Math.ceil(categories.length / 2));
  const width = Math.max(1040, 520 + columns * 220);
  const height = 460;
  const causeSlots = clampNumber(Math.round(options.causeSlots ?? 2), 0, 5);
  const spineY = height / 2;
  const spineStartX = 120;
  const firstSpineX = 310;
  const spineEndX = firstSpineX + (columns - 1) * 220 + 150;
  const effectLabel = options.effectLabel?.trim() || "Effect / Problem";
  const effectLines = effectLabel.split(/\s*\/\s*|\r?\n/).filter(Boolean).slice(0, 2);
  let body = svgText(width / 2, 38, title, { size: 20, color: "#111827" });
  body += `<line x1="${spineStartX}" y1="${spineY}" x2="${spineEndX}" y2="${spineY}" stroke="#0f766e" stroke-width="4" marker-end="url(#arrowhead)"></line>`;
  body += `<rect x="${spineEndX + 12}" y="${spineY - 44}" width="165" height="88" rx="12" fill="#fee2e2" stroke="#dc2626" stroke-width="2.5"></rect>`;
  body += svgText(spineEndX + 94, spineY - 6, effectLines[0] ?? "Effect", { size: 14, color: "#991b1b" });
  body += svgText(spineEndX + 94, spineY + 18, effectLines[1] ?? "Problem", { size: 14, color: "#991b1b" });

  categories.forEach((category, index) => {
    const top = index % 2 === 0;
    const column = Math.floor(index / 2);
    const spineX = firstSpineX + column * 220;
    const branchX = spineX - 130;
    const branchY = top ? 100 : height - 100;
    const labelY = top ? branchY - 14 : branchY + 24;
    body += `<line x1="${branchX}" y1="${branchY}" x2="${spineX}" y2="${spineY}" stroke="#334155" stroke-width="2.5"></line>`;
    body += svgText(branchX - 12, labelY, category, {
      anchor: "start",
      size: 13,
      color: "#0f172a",
    });
    Array.from({ length: causeSlots }, (_, causeIndex) => {
      const offset = 38 + causeIndex * 28;
      const minorY1 = top ? branchY + offset : branchY - offset;
      const minorY2 = top ? branchY + offset + 28 : branchY - offset - 28;
      const minorX1 = branchX + 26 + causeIndex * 8;
      const minorX2 = branchX + 90 + causeIndex * 8;
      body += `<line x1="${minorX1}" y1="${minorY1}" x2="${minorX2}" y2="${minorY2}" stroke="#94a3b8" stroke-width="1.8"></line>`;
    });
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
  fishboneEffect?: string;
  fishboneCauseSlots?: number;
}) {
  switch (input.diagramType) {
    case "swimlane":
      return buildSwimlaneSvg(input.title, input.items, input.lanes);
    case "value_stream_map":
      return buildFlowSvg(input.title, input.items, true);
    case "fishbone":
      return buildFishboneSvg(input.title, input.items, {
        effectLabel: input.fishboneEffect,
        causeSlots: input.fishboneCauseSlots,
      });
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

function splitTableInputPreservingBlanks(value: string, fallback: string[] = []) {
  const entries = value.split(/\r?\n|,/).map((entry) => entry.trim());
  return entries.some(Boolean) ? entries : fallback;
}

function trimTrailingBlankRows(rows: string[]) {
  const nextRows = [...rows];
  while (nextRows.length > 0 && !nextRows.at(-1)?.trim()) {
    nextRows.pop();
  }
  return nextRows;
}

function removeSipocRowFromSource(currentText: string, rowIndex: number) {
  const rows = currentText.split(/\r?\n/);
  const startIndex = rowIndex * SIPOC_HEADERS.length;
  while (rows.length < startIndex + SIPOC_HEADERS.length) {
    rows.push("");
  }
  rows.splice(startIndex, SIPOC_HEADERS.length);
  const trimmedRows = trimTrailingBlankRows(rows);
  return trimmedRows.length > 0 ? trimmedRows.join("\n") : SIPOC_HEADERS.map(() => "").join("\n");
}

function buildTableRows(
  diagramType: DiagramType,
  items: string[],
  metrics: MetricPoint[],
  options: {
    editable?: boolean;
    sipocRowCount?: number;
    onItemChange?: (index: number, value: string) => void;
    onMetricChange?: (index: number, field: "label" | "value" | "value2", value: string) => void;
  } = {},
) {
  if (diagramType === "sipoc") {
    const headers = SIPOC_HEADERS;
    const rowCount = Math.max(1, options.sipocRowCount ?? Math.ceil(items.length / headers.length));
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
          {Array.from({ length: rowCount }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header, columnIndex) => {
                const itemIndex = rowIndex * headers.length + columnIndex;
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
        {metrics.map((metric, rowIndex) => (
          <tr key={`${metric.label}-${rowIndex}`}>
            {headers.map((header, columnIndex) => {
              const itemIndex = rowIndex * Math.max(1, headers.length - 1) + columnIndex - 1;
              return (
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

function buildTableDiagramHtml(
  diagramType: DiagramType,
  items: string[],
  metrics: MetricPoint[],
  options: { sipocRowCount?: number } = {},
) {
  if (diagramType === "sipoc") {
    const headers = SIPOC_HEADERS;
    const rowCount = Math.max(1, options.sipocRowCount ?? Math.ceil(items.length / headers.length));
    const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
      headers.map(
        (header, columnIndex) =>
          items[rowIndex * headers.length + columnIndex] ?? "",
      ),
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
  const rows = metrics.map((metric, rowIndex) =>
    headers.map((header, columnIndex) =>
      columnIndex === 0
        ? metric.label
        : items[rowIndex * Math.max(1, headers.length - 1) + columnIndex - 1] ??
          `${header} ${rowIndex + 1}`,
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
  purpose: string;
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
    `<p><strong>Diagram type:</strong> ${escapeHtml(definition.label)}<br><strong>Method:</strong> DMAIC - ${escapeHtml(
      phase.label,
    )}<br><strong>Process area:</strong> ${escapeHtml(input.processArea || "Unassigned")}</p>`,
    `<h2>Purpose</h2>`,
    `<p>${escapeHtml(input.purpose)}</p>`,
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
  const metricsTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState("Process Map Draft");
  const [diagramType, setDiagramType] = useState<DiagramType>("process_map");
  const dmaicEnabled = true;
  const [dmaicPhase, setDmaicPhase] = useState<DmaicPhase>("define");
  const [departmentId, setDepartmentId] = useState("");
  const [processArea, setProcessArea] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [purpose, setPurpose] = useState(DEFAULT_PROMPT);
  const [itemsText, setItemsText] = useState(
    getDiagramDefinition("process_map").starterItems.join("\n"),
  );
  const [lanesText, setLanesText] = useState("Operations\nQuality\nSupervisor");
  const [metricsText, setMetricsText] = useState(DEFAULT_METRIC_ROWS);
  const [capabilityDataText, setCapabilityDataText] = useState(DEFAULT_CAPABILITY_DATA);
  const [fishboneEffect, setFishboneEffect] = useState("Effect / Problem");
  const [fishboneCauseSlots, setFishboneCauseSlots] = useState(2);
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
  const [diagramStyle] = useState<DiagramStyle>(DEFAULT_DIAGRAM_STYLE);
  const [diagramTextStyle, setDiagramTextStyle] = useState<DiagramTextStyle>(
    DEFAULT_DIAGRAM_TEXT_STYLE,
  );
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
    { id: "start", type: "terminator", label: "Start", x: 180, y: 240 },
    { id: "step-1", type: "process", label: "Process step", x: 470, y: 240 },
    { id: "decision-1", type: "decision", label: "Decision", x: 780, y: 240 },
  ]);
  const [customFlowLinks, setCustomFlowLinks] = useState<CustomFlowLink[]>([
    { id: "start-step-1", from: "start", to: "step-1" },
    { id: "step-1-decision-1", from: "step-1", to: "decision-1" },
  ]);
  const [selectedCustomNodeId, setSelectedCustomNodeId] = useState<string | null>("step-1");
  const [selectedCustomLinkId, setSelectedCustomLinkId] = useState<string | null>(null);
  const [pendingConnectorNodeId, setPendingConnectorNodeId] = useState<string | null>(null);
  const [customCanvasView, setCustomCanvasView] =
    useState<CustomFlowCanvasView>(CUSTOM_FLOW_DEFAULT_VIEW);
  const [draftConnector, setDraftConnector] = useState<DraftConnector | null>(null);
  const [draftCustomShapePoints, setDraftCustomShapePoints] = useState<CustomFlowAnchor[] | null>(
    null,
  );
  const [customFlowUndoStack, setCustomFlowUndoStack] = useState<CustomFlowSnapshot[]>([]);
  const [customFlowRedoStack, setCustomFlowRedoStack] = useState<CustomFlowSnapshot[]>([]);
  const [swimlaneSteps, setSwimlaneSteps] = useState<SwimlaneStep[]>([
    { id: "swim-step-1", label: "Operator: Receive work", laneIndex: 0, x: 305 },
    { id: "swim-step-2", label: "Quality: Verify requirements", laneIndex: 1, x: 455 },
    { id: "swim-step-3", label: "Supervisor: Approve release", laneIndex: 2, x: 605 },
  ]);
  const [swimlaneLinks, setSwimlaneLinks] = useState<SwimlaneLink[]>([
    { id: "swim-link-1", from: "swim-step-1", to: "swim-step-2", label: "", bendX: 380, bendY: 138 },
    { id: "swim-link-2", from: "swim-step-2", to: "swim-step-3", label: "", bendX: 530, bendY: 230 },
  ]);
  const [sipocRowCount, setSipocRowCount] = useState(1);
  const [valueStreamTimelineLabel, setValueStreamTimelineLabel] = useState(
    "Lead time / wait time timeline",
  );
  const [valueStreamNotes, setValueStreamNotes] = useState<ValueStreamNote[]>([]);
  const [inlineChartEditor, setInlineChartEditor] = useState<InlineChartEditor | null>(null);
  const [showAdvancedColors, setShowAdvancedColors] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const customFlowDragRef = useRef<{
    nodeId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    historyCaptured: boolean;
  } | null>(null);
  const customFlowPanRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startView: CustomFlowCanvasView;
  } | null>(null);
  const customConnectorDragRef = useRef<{
    from: string;
    pointerId: number;
    fromOffset?: CustomFlowAnchor;
  } | null>(null);
  const customShapeDrawRef = useRef<{
    pointerId: number;
    points: CustomFlowAnchor[];
  } | null>(null);
  const customLinkBendDragRef = useRef<{
    linkId: string;
    pointerId: number;
    anchorIndex: number | null;
    segmentIndex: number;
    moved: boolean;
    historyCaptured: boolean;
  } | null>(null);
  const customLinkEndpointDragRef = useRef<{
    linkId: string;
    pointerId: number;
    endpoint: "from" | "to";
    moved: boolean;
    historyCaptured: boolean;
  } | null>(null);
  const customFlowSuppressClickRef = useRef(false);
  const customCanvasSvgRef = useRef<SVGSVGElement | null>(null);
  const chartPreviewRef = useRef<HTMLDivElement | null>(null);
  const sandboxHostRef = useRef<HTMLDivElement | null>(null);
  const editBarRef = useRef<HTMLFormElement | null>(null);
  const inlineChartEditCancelledRef = useRef(false);
  const swimlaneSvgRef = useRef<SVGSVGElement | null>(null);
  const swimlaneSuppressClickRef = useRef(false);
  const swimlaneDragRef = useRef<
    | {
        type: "step";
        stepId: string;
        pointerId: number;
        offsetX: number;
        moved: boolean;
      }
    | {
        type: "link";
        linkId: string;
        pointerId: number;
        moved: boolean;
      }
    | null
  >(null);
  const valueStreamSvgRef = useRef<SVGSVGElement | null>(null);
  const valueStreamSuppressClickRef = useRef(false);
  const valueStreamNoteDragRef = useRef<{
    noteId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const definition = getDiagramDefinition(diagramType);
  const phase = getDmaicPhaseOption(dmaicPhase);
  const isCustomFlowDiagram = CUSTOM_FLOW_DIAGRAM_TYPES.has(diagramType);
  const items = splitListInput(itemsText, definition.starterItems);
  const tableItems =
    diagramType === "sipoc" ? splitTableInputPreservingBlanks(itemsText, definition.starterItems) : items;
  const sipocDisplayRowCount =
    diagramType === "sipoc"
      ? Math.max(1, sipocRowCount, Math.ceil(tableItems.length / SIPOC_HEADERS.length))
      : 1;
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
      : diagramType === "swimlane"
        ? buildSwimlaneSandboxSvg(
            layerSettings.showTitle ? title : "",
            lanes,
            swimlaneSteps,
            swimlaneLinks,
          )
      : diagramType === "value_stream_map"
        ? buildValueStreamSvg(
            layerSettings.showTitle ? title : "",
            items,
            valueStreamTimelineLabel,
            valueStreamNotes,
          )
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
          fishboneEffect,
          fishboneCauseSlots,
        });
  const svg = applySvgTextStyle(
    applySvgTheme(rawSvg, diagramStyle, layerSettings),
    diagramTextStyle,
  );
  const selectedCustomNode =
    customFlowNodes.find((node) => node.id === selectedCustomNodeId) ?? null;
  const canUndoCustomFlow = customFlowUndoStack.length > 0;
  const canRedoCustomFlow = customFlowRedoStack.length > 0;

  function getCustomFlowSnapshot(): CustomFlowSnapshot {
    return {
      nodes: customFlowNodes.map((node) => ({
        ...node,
        points: node.points?.map((point) => ({ ...point })),
      })),
      links: customFlowLinks.map((link) => ({
        ...link,
        fromOffset: link.fromOffset ? { ...link.fromOffset } : undefined,
        toOffset: link.toOffset ? { ...link.toOffset } : undefined,
        anchors: link.anchors?.map((anchor) => ({ ...anchor })),
      })),
      selectedNodeId: selectedCustomNodeId,
      selectedLinkId: selectedCustomLinkId,
    };
  }

  function restoreCustomFlowSnapshot(snapshot: CustomFlowSnapshot) {
    setCustomFlowNodes(
      snapshot.nodes.map((node) => ({
        ...node,
        points: node.points?.map((point) => ({ ...point })),
      })),
    );
    setCustomFlowLinks(
      snapshot.links.map((link) => ({
        ...link,
        fromOffset: link.fromOffset ? { ...link.fromOffset } : undefined,
        toOffset: link.toOffset ? { ...link.toOffset } : undefined,
        anchors: link.anchors?.map((anchor) => ({ ...anchor })),
      })),
    );
    setSelectedCustomNodeId(snapshot.selectedNodeId);
    setSelectedCustomLinkId(snapshot.selectedLinkId);
    setPendingConnectorNodeId(null);
    setDraftConnector(null);
    setDraftCustomShapePoints(null);
    customConnectorDragRef.current = null;
    customFlowDragRef.current = null;
    customLinkBendDragRef.current = null;
    customShapeDrawRef.current = null;
  }

  function pushCustomFlowHistory() {
    const snapshot = getCustomFlowSnapshot();
    setCustomFlowUndoStack((current) => [...current.slice(-49), snapshot]);
    setCustomFlowRedoStack([]);
  }

  function undoCustomFlow() {
    const previousSnapshot = customFlowUndoStack.at(-1);
    if (!previousSnapshot) {
      return;
    }

    setCustomFlowRedoStack((current) => [...current.slice(-49), getCustomFlowSnapshot()]);
    setCustomFlowUndoStack((current) => current.slice(0, -1));
    restoreCustomFlowSnapshot(previousSnapshot);
  }

  function redoCustomFlow() {
    const nextSnapshot = customFlowRedoStack.at(-1);
    if (!nextSnapshot) {
      return;
    }

    setCustomFlowUndoStack((current) => [...current.slice(-49), getCustomFlowSnapshot()]);
    setCustomFlowRedoStack((current) => current.slice(0, -1));
    restoreCustomFlowSnapshot(nextSnapshot);
  }

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

  function updateLaneLine(index: number, value: string) {
    setLanesText((current) =>
      updateSourceLine(current, index, value, ["Operations", "Quality", "Supervisor"]),
    );
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

  function getInlineChartEditTarget(displayText: string): InlineChartEditTarget | null {
    const normalizedDisplayText = displayText.trim();
    if (!normalizedDisplayText) {
      return null;
    }

    const matchesRenderedText = (value: string | number) => {
      const textValue = String(value);
      return (
        normalizedDisplayText === textValue ||
        normalizedDisplayText === truncate(textValue, 28)
      );
    };

    if (matchesRenderedText(title)) {
      return { kind: "title", value: title };
    }

    if (matchesRenderedText(fishboneEffect)) {
      return { kind: "fishboneEffect", value: fishboneEffect };
    }

    const laneIndex = lanes.findIndex(matchesRenderedText);
    if (laneIndex >= 0) {
      return { kind: "lane", index: laneIndex, value: lanes[laneIndex] ?? "" };
    }

    const metricLabelIndex = metrics.findIndex((metric) => matchesRenderedText(metric.label));
    if (metricLabelIndex >= 0) {
      return {
        kind: "metric",
        index: metricLabelIndex,
        field: "label",
        value: metrics[metricLabelIndex]?.label ?? "",
      };
    }

    const metricValueIndex = metrics.findIndex((metric) =>
      [metric.value, Math.round(metric.value), formatAxisNumber(metric.value)].some(matchesRenderedText),
    );
    if (metricValueIndex >= 0) {
      return {
        kind: "metric",
        index: metricValueIndex,
        field: "value",
        value: String(metrics[metricValueIndex]?.value ?? ""),
      };
    }

    const metricValue2Index = metrics.findIndex((metric) =>
      [metric.value2, Math.round(metric.value2), formatAxisNumber(metric.value2)].some(
        matchesRenderedText,
      ),
    );
    if (metricValue2Index >= 0) {
      return {
        kind: "metric",
        index: metricValue2Index,
        field: "value2",
        value: String(metrics[metricValue2Index]?.value2 ?? ""),
      };
    }

    const itemIndex = items.findIndex(matchesRenderedText);
    if (itemIndex >= 0) {
      return { kind: "item", index: itemIndex, value: items[itemIndex] ?? "" };
    }

    return null;
  }

  function openInlineChartEditor(
    event: ReactMouseEvent<HTMLDivElement>,
    target: InlineChartEditTarget,
  ) {
    const host = sandboxHostRef.current ?? chartPreviewRef.current;
    const targetElement = event.target instanceof Element ? event.target : null;
    if (!host || !targetElement) {
      return;
    }

    const hostRect = host.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const width = target.kind === "metric" && target.field !== "label" ? 120 : 260;
    inlineChartEditCancelledRef.current = false;
    setInlineChartEditor({
      ...target,
      left: clampNumber(targetRect.left - hostRect.left - 12 + host.scrollLeft, 8, Math.max(8, hostRect.width - width - 8)),
      top: clampNumber(targetRect.top - hostRect.top - 30 + host.scrollTop, 8, Math.max(8, hostRect.height - 48)),
      width,
    });
  }

  function openInlineChartEditorAtPoint(
    clientX: number,
    clientY: number,
    target: InlineChartEditTarget,
    width = 300,
  ) {
    const host = sandboxHostRef.current ?? chartPreviewRef.current;
    if (!host) {
      return;
    }

    const hostRect = host.getBoundingClientRect();
    inlineChartEditCancelledRef.current = false;
    setInlineChartEditor({
      ...target,
      left: clampNumber(clientX - hostRect.left + host.scrollLeft - 18, 8, Math.max(8, hostRect.width - width - 8)),
      top: clampNumber(clientY - hostRect.top + host.scrollTop - 56, 8, Math.max(8, hostRect.height - 64)),
      width,
    });
  }

  function handleChartPreviewClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (isCustomFlowDiagram || TABLE_DIAGRAM_TYPES.has(diagramType)) {
      return;
    }

    const targetElement = event.target instanceof Element ? event.target : null;
    if (!targetElement) {
      return;
    }

    const tagName = targetElement.tagName.toLowerCase();
    let target =
      tagName === "text" ? getInlineChartEditTarget(targetElement.textContent ?? "") : null;
    if (!target && (tagName === "rect" || tagName === "circle")) {
      const titleText = targetElement.querySelector("title")?.textContent ?? "";
      const metricIndex = metrics.findIndex((metric) =>
        titleText.startsWith(`${metric.label}:`),
      );
      if (metricIndex >= 0) {
        target = {
          kind: "metric",
          index: metricIndex,
          field: "value",
          value: String(metrics[metricIndex]?.value ?? ""),
        };
      }
    }

    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditor(event, target);
  }

  function updateInlineChartEditValue(value: string) {
    setInlineChartEditor((current) => (current ? { ...current, value } : current));

    if (!inlineChartEditor) {
      return;
    }

    if (inlineChartEditor.kind === "title") {
      setTitle(value || "Untitled Process Map");
    } else if (inlineChartEditor.kind === "purpose") {
      setPurpose(value);
    } else if (inlineChartEditor.kind === "item") {
      updateItemLine(inlineChartEditor.index, value || `Step ${inlineChartEditor.index + 1}`);
    } else if (inlineChartEditor.kind === "lane") {
      updateLaneLine(inlineChartEditor.index, value || `Lane ${inlineChartEditor.index + 1}`);
    } else if (inlineChartEditor.kind === "fishboneEffect") {
      setFishboneEffect(value || "Effect / Problem");
    } else if (inlineChartEditor.kind === "customNode") {
      updateSelectedCustomNodeLabel(value || "Process step");
    } else if (inlineChartEditor.kind === "customLink") {
      setCustomFlowLinks((current) =>
        current.map((link) =>
          link.id === inlineChartEditor.linkId ? { ...link, label: value } : link,
        ),
      );
    } else if (inlineChartEditor.kind === "swimlaneStep") {
      setSwimlaneSteps((current) =>
        current.map((step) =>
          step.id === inlineChartEditor.stepId
            ? { ...step, label: value || `Step ${current.indexOf(step) + 1}` }
            : step,
        ),
      );
      setItemsText((current) => {
        const nextSteps = swimlaneSteps.map((step) =>
          step.id === inlineChartEditor.stepId ? { ...step, label: value } : step,
        );
        return nextSteps.map((step) => step.label).join("\n") || current;
      });
    } else if (inlineChartEditor.kind === "swimlaneArrow") {
      setSwimlaneLinks((current) =>
        current.map((link) =>
          link.id === inlineChartEditor.linkId ? { ...link, label: value } : link,
        ),
      );
    } else if (inlineChartEditor.kind === "valueStreamTimeline") {
      setValueStreamTimelineLabel(value || "Lead time / wait time timeline");
    } else if (inlineChartEditor.kind === "valueStreamNote") {
      setValueStreamNotes((current) =>
        current.map((note) =>
          note.id === inlineChartEditor.noteId ? { ...note, text: value } : note,
        ),
      );
    } else {
      updateMetricLine(
        inlineChartEditor.index,
        inlineChartEditor.field,
        inlineChartEditor.field === "label" ? value || `Point ${inlineChartEditor.index + 1}` : value || "0",
      );
    }

    setPreviewRevision((current) => current + 1);
  }

  function updateCapabilityLine(index: number, value: string) {
    setCapabilityDataText((current) =>
      updateSourceLine(current, index, value, DEFAULT_CAPABILITY_DATA.split("\n")),
    );
  }

  function updateLayerSetting(key: keyof LayerSettings, value: boolean) {
    setLayerSettings((current) => ({ ...current, [key]: value }));
  }

  function updateCustomFlowNodeStyle(
    nodeId: string,
    stylePatch: Partial<DiagramElementStyle>,
  ) {
    setCustomFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, style: { ...node.style, ...stylePatch } } : node,
      ),
    );
    setPreviewRevision((current) => current + 1);
  }

  function updateCustomFlowLinkStyle(
    linkId: string,
    stylePatch: Partial<DiagramElementStyle>,
  ) {
    setCustomFlowLinks((current) =>
      current.map((link) =>
        link.id === linkId ? { ...link, style: { ...link.style, ...stylePatch } } : link,
      ),
    );
    setPreviewRevision((current) => current + 1);
  }

  function updateSwimlaneStepStyle(
    stepId: string,
    stylePatch: Partial<DiagramElementStyle>,
  ) {
    setSwimlaneSteps((current) =>
      current.map((step) =>
        step.id === stepId ? { ...step, style: { ...step.style, ...stylePatch } } : step,
      ),
    );
    setPreviewRevision((current) => current + 1);
  }

  function updateSwimlaneLinkStyle(
    linkId: string,
    stylePatch: Partial<DiagramElementStyle>,
  ) {
    setSwimlaneLinks((current) =>
      current.map((link) =>
        link.id === linkId ? { ...link, style: { ...link.style, ...stylePatch } } : link,
      ),
    );
    setPreviewRevision((current) => current + 1);
  }

  function updateDiagramTextStyle<K extends keyof DiagramTextStyle>(
    key: K,
    value: DiagramTextStyle[K],
  ) {
    setDiagramTextStyle((current) => ({ ...current, [key]: value }));
    setPreviewRevision((current) => current + 1);
  }

  function addValueStreamNote(point?: { x: number; y: number }) {
    const note: ValueStreamNote = {
      id: `vsm-note-${Date.now()}`,
      text: "Note",
      x: clampNumber(point?.x ?? 480, 90, 870),
      y: clampNumber(point?.y ?? 310, 70, 390),
    };
    setValueStreamNotes((current) => [...current, note]);
    setPreviewRevision((current) => current + 1);
    return note;
  }

  function addLane() {
    setLanesText((current) => {
      const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
      rows.push(`Lane ${rows.length + 1}`);
      return rows.join("\n");
    });
    setPreviewRevision((current) => current + 1);
  }

  function removeLane() {
    const laneCount = lanes.length;
    setLanesText((current) => {
      const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
      return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
    });
    if (diagramType === "swimlane" && laneCount > 1) {
      setSwimlaneSteps((current) =>
        current
          .filter((step) => step.laneIndex < laneCount - 1)
          .map((step) => ({ ...step, laneIndex: clampNumber(step.laneIndex, 0, laneCount - 2) })),
      );
    }
    setPreviewRevision((current) => current + 1);
  }

  function addChartDataRow() {
    if (formulaTool === "capability") {
      setCapabilityDataText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        const lastValue = Number.parseFloat(rows.at(-1) ?? "10");
        rows.push(Number.isFinite(lastValue) ? (lastValue + 0.01).toFixed(2) : "10.00");
        return rows.join("\n");
      });
    } else if (TABLE_DIAGRAM_TYPES.has(diagramType)) {
      if (diagramType === "sipoc") {
        setSipocRowCount((current) => current + 1);
      } else {
        setMetricsText((current) => {
          const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
          rows.push(`Row ${rows.length + 1},0,0`);
          return rows.join("\n");
        });
      }
    } else if (CHART_DATA_DIAGRAM_TYPES.has(diagramType)) {
      setMetricsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        rows.push(`Point ${rows.length + 1},0,0`);
        return rows.join("\n");
      });
    } else if (diagramType === "fishbone") {
      setItemsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        rows.push(`Cause group ${rows.length + 1}`);
        return rows.join("\n");
      });
    } else if (diagramType === "swimlane") {
      const nextIndex = swimlaneSteps.length + 1;
      const laneIndex = Math.min(
        Math.max(0, lanes.length - 1),
        Math.max(0, swimlaneSteps.at(-1)?.laneIndex ?? 0),
      );
      const nextStep: SwimlaneStep = {
        id: `swim-step-${Date.now()}`,
        label: `${lanes[laneIndex] ?? "Lane"}: Step ${nextIndex}`,
        laneIndex,
        x: clampNumber(300 + nextIndex * 120, 250, 840),
      };
      const previousStep = swimlaneSteps.at(-1);
      setSwimlaneSteps((current) => [...current, nextStep]);
      setItemsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        rows.push(nextStep.label);
        return rows.join("\n");
      });
      if (previousStep) {
        setSwimlaneLinks((current) => [
          ...current,
          {
            id: `swim-link-${Date.now()}`,
            from: previousStep.id,
            to: nextStep.id,
            label: "",
            bendX: (previousStep.x + nextStep.x) / 2,
            bendY: laneIndex * 92 + 46,
          },
        ]);
      }
    } else if (diagramType === "value_stream_map") {
      setItemsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        rows.push(`Step ${rows.length + 1}`);
        return rows.join("\n");
      });
    } else {
      setItemsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        rows.push(`Step ${rows.length + 1}`);
        return rows.join("\n");
      });
    }

    setPreviewRevision((current) => current + 1);
  }

  function removeChartDataRow() {
    if (formulaTool === "capability") {
      setCapabilityDataText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
      });
    } else if (TABLE_DIAGRAM_TYPES.has(diagramType)) {
      if (diagramType === "sipoc") {
        if (sipocDisplayRowCount <= 1) {
          return;
        }
        setSipocRowCount((current) => Math.max(1, current - 1));
        setItemsText((current) => {
          const rowIndex = Math.max(0, sipocDisplayRowCount - 1);
          return removeSipocRowFromSource(current, rowIndex);
        });
      } else {
        setMetricsText((current) => {
          const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
          return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
        });
      }
    } else if (CHART_DATA_DIAGRAM_TYPES.has(diagramType)) {
      setMetricsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
      });
    } else if (diagramType === "swimlane") {
      const stepToRemove = swimlaneSteps.at(-1);
      if (stepToRemove) {
        setSwimlaneSteps((current) => current.filter((step) => step.id !== stepToRemove.id));
        setSwimlaneLinks((current) =>
          current.filter((link) => link.from !== stepToRemove.id && link.to !== stepToRemove.id),
        );
        setItemsText((current) => {
          const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
          return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
        });
      }
    } else {
      setItemsText((current) => {
        const rows = current.split(/\r?\n/).filter((row) => row.trim().length > 0);
        return rows.length <= 1 ? rows.join("\n") : rows.slice(0, -1).join("\n");
      });
    }

    setPreviewRevision((current) => current + 1);
  }

  function deleteCurrentEditTarget() {
    if (!inlineChartEditor) {
      removeChartDataRow();
      return;
    }

    if (inlineChartEditor.kind === "swimlaneStep") {
      const stepId = inlineChartEditor.stepId;
      const stepIndex = swimlaneSteps.findIndex((step) => step.id === stepId);
      setSwimlaneSteps((current) => current.filter((step) => step.id !== stepId));
      setSwimlaneLinks((current) =>
        current.filter((link) => link.from !== stepId && link.to !== stepId),
      );
      setItemsText((current) =>
        current
          .split(/\r?\n/)
          .filter((_, index) => index !== stepIndex)
          .join("\n"),
      );
    } else if (inlineChartEditor.kind === "swimlaneArrow") {
      setSwimlaneLinks((current) =>
        current.filter((link) => link.id !== inlineChartEditor.linkId),
      );
    } else if (inlineChartEditor.kind === "customNode") {
      deleteSelectedCustomNode();
    } else if (inlineChartEditor.kind === "customLink") {
      pushCustomFlowHistory();
      setCustomFlowLinks((current) =>
        current.filter((link) => link.id !== inlineChartEditor.linkId),
      );
      setSelectedCustomLinkId(null);
    } else if (inlineChartEditor.kind === "valueStreamNote") {
      setValueStreamNotes((current) =>
        current.filter((note) => note.id !== inlineChartEditor.noteId),
      );
    } else if (inlineChartEditor.kind === "lane") {
      removeLane();
    } else if (inlineChartEditor.kind === "metric") {
      setMetricsText((current) =>
        current
          .split(/\r?\n/)
          .filter((_, index) => index !== inlineChartEditor.index)
          .join("\n"),
      );
    } else if (inlineChartEditor.kind === "item") {
      if (diagramType === "sipoc") {
        setSipocRowCount((current) => Math.max(1, current - 1));
        setItemsText((current) =>
          removeSipocRowFromSource(
            current,
            Math.floor(inlineChartEditor.index / SIPOC_HEADERS.length),
          ),
        );
      } else {
        setItemsText((current) =>
          current
            .split(/\r?\n/)
            .filter((_, index) => index !== inlineChartEditor.index)
            .join("\n"),
        );
      }
    } else {
      removeChartDataRow();
    }

    setInlineChartEditor(null);
    setPreviewRevision((current) => current + 1);
  }

  function addCurrentEditTarget() {
    if (inlineChartEditor?.kind === "lane") {
      addLane();
      return;
    }

    if (inlineChartEditor?.kind === "valueStreamNote") {
      addValueStreamNote();
      return;
    }

    addChartDataRow();
  }

  function handleSandboxPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!inlineChartEditor) {
      return;
    }

    const targetElement = event.target instanceof Element ? event.target : null;
    if (targetElement?.closest("[data-process-edit-bar]")) {
      return;
    }

    setInlineChartEditor(null);
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
    setCustomFlowUndoStack([]);
    setCustomFlowRedoStack([]);
    setSelectedCustomLinkId(null);
    setInlineChartEditor(null);
    setDiagramType(nextDiagramType);
    setItemsText(nextDefinition.starterItems.join("\n"));
    setSipocRowCount(nextDiagramType === "sipoc" ? 1 : sipocRowCount);
    if (nextDiagramType === "value_stream_map") {
      setValueStreamTimelineLabel("Lead time / wait time timeline");
      setValueStreamNotes([]);
    }
    setRecommendation(null);
    if (nextDiagramType === "fishbone") {
      setFishboneEffect("Effect / Problem");
      setFishboneCauseSlots(2);
    }
    if (nextDiagramType === "swimlane") {
      const defaultSteps: SwimlaneStep[] = nextDefinition.starterItems.map((item, index) => ({
        id: `swim-step-${index + 1}`,
        label: item,
        laneIndex: index % Math.max(1, lanes.length),
        x: 305 + index * 150,
      }));
      setSwimlaneSteps(defaultSteps);
      setSwimlaneLinks(
        defaultSteps.slice(1).map((step, index) => {
          const previousStep = defaultSteps[index];
          return {
            id: `swim-link-${index + 1}`,
            from: previousStep.id,
            to: step.id,
            label: "",
            bendX: (previousStep.x + step.x) / 2,
            bendY: step.laneIndex * 92 + 46,
          };
        }),
      );
    }
    if (!title.trim() || title === "Process Map Draft") {
      setTitle(`${getDmaicPhaseOption(dmaicPhase).label} - ${nextDefinition.shortLabel} Draft`);
    }
  }

  function addCustomFlowNode(type: CustomFlowNode["type"], x: number, y: number) {
    pushCustomFlowHistory();
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
      x: clampNumber(
        x,
        CUSTOM_FLOW_DECISION_HALF_WIDTH,
        CUSTOM_FLOW_CANVAS_WIDTH - CUSTOM_FLOW_DECISION_HALF_WIDTH,
      ),
      y: clampNumber(
        y,
        CUSTOM_FLOW_DECISION_HALF_HEIGHT,
        CUSTOM_FLOW_CANVAS_HEIGHT - CUSTOM_FLOW_DECISION_HALF_HEIGHT,
      ),
    };
    setCustomFlowNodes((current) => [...current, nextNode]);
    setSelectedCustomNodeId(id);
    setSelectedCustomLinkId(null);
  }

  function addCustomFlowFreeformShape(points: CustomFlowAnchor[]) {
    if (points.length < 3) {
      return;
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const drawnWidth = maxX - minX;
    const drawnHeight = maxY - minY;
    const width = Math.max(CUSTOM_FLOW_CUSTOM_MIN_SIZE, drawnWidth);
    const height = Math.max(CUSTOM_FLOW_CUSTOM_MIN_SIZE, drawnHeight);

    if (drawnWidth < 10 && drawnHeight < 10) {
      return;
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const id = `custom-${Date.now()}-${Math.round(centerX)}-${Math.round(centerY)}`;
    const nextNode: CustomFlowNode = {
      id,
      type: "custom",
      label: "Custom shape",
      x: clampNumber(centerX, width / 2, CUSTOM_FLOW_CANVAS_WIDTH - width / 2),
      y: clampNumber(centerY, height / 2, CUSTOM_FLOW_CANVAS_HEIGHT - height / 2),
      width,
      height,
      points: points.map((point) => ({
        x: point.x - centerX,
        y: point.y - centerY,
      })),
    };

    pushCustomFlowHistory();
    setCustomFlowNodes((current) => [...current, nextNode]);
    setSelectedCustomNodeId(id);
    setSelectedCustomLinkId(null);
  }

  function getCustomFlowPoint(
    event: Pick<ReactPointerEvent<SVGElement>, "clientX" | "clientY">,
    svgElement: SVGSVGElement,
  ) {
    const bounds = svgElement.getBoundingClientRect();
    return {
      x: customCanvasView.x + ((event.clientX - bounds.left) / bounds.width) * customCanvasView.width,
      y: customCanvasView.y + ((event.clientY - bounds.top) / bounds.height) * customCanvasView.height,
    };
  }

  function updateCustomFlowNodePosition(nodeId: string, x: number, y: number) {
    setCustomFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? (() => {
              const halfSize = getCustomFlowNodeHalfSize(node);
              return {
                ...node,
                x: clampNumber(x, halfSize.width, CUSTOM_FLOW_CANVAS_WIDTH - halfSize.width),
                y: clampNumber(y, halfSize.height, CUSTOM_FLOW_CANVAS_HEIGHT - halfSize.height),
              };
            })()
          : node,
      ),
    );
  }

  function moveCustomFlowNode(nodeId: string, deltaX: number, deltaY: number) {
    setCustomFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? (() => {
              const halfSize = getCustomFlowNodeHalfSize(node);
              return {
                ...node,
                x: clampNumber(
                  node.x + deltaX,
                  halfSize.width,
                  CUSTOM_FLOW_CANVAS_WIDTH - halfSize.width,
                ),
                y: clampNumber(
                  node.y + deltaY,
                  halfSize.height,
                  CUSTOM_FLOW_CANVAS_HEIGHT - halfSize.height,
                ),
              };
            })()
          : node,
      ),
    );
  }

  function clampCustomCanvasView(view: CustomFlowCanvasView): CustomFlowCanvasView {
    const width = clampNumber(view.width, CUSTOM_FLOW_MIN_VIEW_WIDTH, CUSTOM_FLOW_CANVAS_WIDTH);
    const height = clampNumber(
      view.height,
      CUSTOM_FLOW_MIN_VIEW_HEIGHT,
      CUSTOM_FLOW_CANVAS_HEIGHT,
    );

    return {
      x: clampNumber(view.x, 0, CUSTOM_FLOW_CANVAS_WIDTH - width),
      y: clampNumber(view.y, 0, CUSTOM_FLOW_CANVAS_HEIGHT - height),
      width,
      height,
    };
  }

  function zoomCustomCanvas(factor: number, anchor?: { x: number; y: number }) {
    setCustomCanvasView((current) => {
      const nextWidth = clampNumber(
        current.width * factor,
        CUSTOM_FLOW_MIN_VIEW_WIDTH,
        CUSTOM_FLOW_CANVAS_WIDTH,
      );
      const nextHeight = clampNumber(
        current.height * factor,
        CUSTOM_FLOW_MIN_VIEW_HEIGHT,
        CUSTOM_FLOW_CANVAS_HEIGHT,
      );
      const zoomAnchor = anchor ?? {
        x: current.x + current.width / 2,
        y: current.y + current.height / 2,
      };
      const anchorRatioX = (zoomAnchor.x - current.x) / current.width;
      const anchorRatioY = (zoomAnchor.y - current.y) / current.height;

      return clampCustomCanvasView({
        x: zoomAnchor.x - nextWidth * anchorRatioX,
        y: zoomAnchor.y - nextHeight * anchorRatioY,
        width: nextWidth,
        height: nextHeight,
      });
    });
  }

  function resetCustomCanvasView() {
    setCustomCanvasView(CUSTOM_FLOW_DEFAULT_VIEW);
  }

  function setCustomDrawingMode(mode: DrawingMode) {
    setDrawingMode(mode);
    if (mode !== "connector") {
      setPendingConnectorNodeId(null);
      setDraftConnector(null);
      customConnectorDragRef.current = null;
    }
  }

  function clearCustomFlowInteraction() {
    setCustomDrawingMode("select");
    setPendingConnectorNodeId(null);
    setDraftConnector(null);
    setDraftCustomShapePoints(null);
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(null);
    customConnectorDragRef.current = null;
    customLinkBendDragRef.current = null;
    customLinkEndpointDragRef.current = null;
    customShapeDrawRef.current = null;
    setInlineChartEditor((current) => (current?.kind === "customLink" ? null : current));
  }

  function handleCustomCanvasWheel(event: ReactWheelEvent<SVGSVGElement>) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      return;
    }

    event.preventDefault();
    const point = getCustomFlowPoint(event, event.currentTarget);
    zoomCustomCanvas(event.deltaY > 0 ? 1.12 : 0.88, point);
  }

  function handleCustomCanvasKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    const key = event.key.toLowerCase();
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
    ) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearCustomFlowInteraction();
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && (selectedCustomLinkId || selectedCustomNodeId)) {
      event.preventDefault();
      deleteSelectedCustomElement();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoCustomFlow();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoCustomFlow();
      }
      return;
    }

    if (event.altKey) {
      return;
    }

    const modeShortcuts: Partial<Record<string, DrawingMode>> = {
      a: "connector",
      c: "custom",
      d: "decision",
      e: "terminator",
      p: "process",
      s: "select",
      t: "terminator",
      v: "select",
    };
    const nextMode = modeShortcuts[key];
    if (nextMode) {
      event.preventDefault();
      setCustomDrawingMode(nextMode);
    }
  }

  function handleCustomCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 1 && !(event.button === 0 && event.altKey)) {
      return;
    }

    event.preventDefault();
    customFlowPanRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startView: customCanvasView,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomCanvasPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const panState = customFlowPanRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - panState.startClientX) / bounds.width) * panState.startView.width;
    const deltaY =
      ((event.clientY - panState.startClientY) / bounds.height) * panState.startView.height;

    setCustomCanvasView(
      clampCustomCanvasView({
        ...panState.startView,
        x: panState.startView.x - deltaX,
        y: panState.startView.y - deltaY,
      }),
    );
  }

  function finishCustomCanvasPan(event: ReactPointerEvent<SVGSVGElement>) {
    const panState = customFlowPanRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    customFlowPanRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCustomShapePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (drawingMode !== "custom" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, event.currentTarget);
    customShapeDrawRef.current = {
      pointerId: event.pointerId,
      points: [point],
    };
    setDraftCustomShapePoints([point]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomShapePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drawState = customShapeDrawRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, event.currentTarget);
    const previousPoint = drawState.points.at(-1);
    if (previousPoint) {
      const deltaX = point.x - previousPoint.x;
      const deltaY = point.y - previousPoint.y;
      if (deltaX * deltaX + deltaY * deltaY < 25) {
        return;
      }
    }

    drawState.points = [...drawState.points, point];
    setDraftCustomShapePoints(drawState.points);
  }

  function finishCustomShapeDrawing(event: ReactPointerEvent<SVGSVGElement>) {
    const drawState = customShapeDrawRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, event.currentTarget);
    const points = [...drawState.points, point];
    addCustomFlowFreeformShape(points);
    customShapeDrawRef.current = null;
    setDraftCustomShapePoints(null);
    customFlowSuppressClickRef.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function findCustomFlowNodeAtPoint(point: { x: number; y: number }, excludeNodeId?: string) {
    return [...customFlowNodes]
      .reverse()
      .find((node) => {
        if (node.id === excludeNodeId) {
          return false;
        }

        return isPointInsideCustomFlowNode(point, node);
      });
  }

  function getNearestCustomFlowNodeAtPoint(
    point: { x: number; y: number },
    excludeNodeId?: string,
    snapDistance = CUSTOM_FLOW_CONNECT_SNAP_DISTANCE,
  ) {
    const directNode = [...customFlowNodes]
      .reverse()
      .find((node) => node.id !== excludeNodeId && isPointInsideCustomFlowNode(point, node));

    if (directNode) {
      return directNode;
    }

    let nearestNode: CustomFlowNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const node of customFlowNodes) {
      if (node.id === excludeNodeId) {
        continue;
      }

      const deltaX = point.x - node.x;
      const deltaY = point.y - node.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < nearestDistance && distance <= snapDistance) {
        nearestDistance = distance;
        nearestNode = node;
      }
    }

    return nearestNode;
  }

  function addCustomFlowLink(
    fromNodeId: string,
    toNodeId: string,
    options: { fromOffset?: CustomFlowAnchor; toOffset?: CustomFlowAnchor } = {},
  ) {
    if (fromNodeId === toNodeId) {
      return;
    }

    const baseId = `${fromNodeId}-${toNodeId}`;
    const id = customFlowLinks.some((link) => link.id === baseId)
      ? `${baseId}-${Date.now()}`
      : baseId;

    pushCustomFlowHistory();
    setCustomFlowLinks((current) => [
      ...current,
      {
        id,
        from: fromNodeId,
        to: toNodeId,
        fromOffset: options.fromOffset,
        toOffset: options.toOffset,
      },
    ]);
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(id);
  }

  function getCustomFlowLinkRouteById(linkId: string) {
    const link = customFlowLinks.find((entry) => entry.id === linkId);
    if (!link) {
      return null;
    }

    const from = customFlowNodes.find((node) => node.id === link.from);
    const to = customFlowNodes.find((node) => node.id === link.to);
    if (!from || !to) {
      return null;
    }

    return getCustomFlowLinkRoute(link, from, to);
  }

  function addCustomFlowLinkAnchor(
    linkId: string,
    segmentIndex: number,
    point: { x: number; y: number },
  ) {
    setCustomFlowLinks((current) =>
      current.map((link) => {
        if (link.id !== linkId) {
          return link;
        }

        const anchors = [...(link.anchors ?? [])];
        anchors.splice(segmentIndex, 0, {
          x: clampNumber(point.x, 24, CUSTOM_FLOW_CANVAS_WIDTH - 24),
          y: clampNumber(point.y, 24, CUSTOM_FLOW_CANVAS_HEIGHT - 24),
        });
        return { ...link, anchors };
      }),
    );
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(linkId);
  }

  function updateCustomFlowLinkAnchor(
    linkId: string,
    anchorIndex: number,
    point: { x: number; y: number },
  ) {
    setCustomFlowLinks((current) =>
      current.map((link) => {
        if (link.id !== linkId) {
          return link;
        }

        const anchors = [...(link.anchors ?? [])];
        if (!anchors[anchorIndex]) {
          return link;
        }

        anchors[anchorIndex] = {
          x: clampNumber(point.x, 24, CUSTOM_FLOW_CANVAS_WIDTH - 24),
          y: clampNumber(point.y, 24, CUSTOM_FLOW_CANVAS_HEIGHT - 24),
        };
        return { ...link, anchors };
      }),
    );
  }

  function removeCustomFlowLinkAnchor(linkId: string, anchorIndex: number) {
    pushCustomFlowHistory();
    setCustomFlowLinks((current) =>
      current.map((link) => {
        if (link.id !== linkId) {
          return link;
        }

        return {
          ...link,
          anchors: (link.anchors ?? []).filter((_, index) => index !== anchorIndex),
        };
      }),
    );
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(linkId);
  }

  function updateCustomFlowLinkEndpoint(
    linkId: string,
    endpoint: "from" | "to",
    point: { x: number; y: number },
  ) {
    setCustomFlowLinks((current) =>
      current.map((link) => {
        if (link.id !== linkId) {
          return link;
        }

        const fixedNodeId = endpoint === "to" ? link.from : link.to;
        const currentEndpointNodeId = endpoint === "to" ? link.to : link.from;
        const snappedNode =
          getNearestCustomFlowNodeAtPoint(point, fixedNodeId) ??
          customFlowNodes.find((node) => node.id === currentEndpointNodeId);

        if (!snappedNode || snappedNode.id === fixedNodeId) {
          return link;
        }

        const offset = getCustomFlowConnectionOffset(snappedNode, point);
        return endpoint === "to"
          ? { ...link, to: snappedNode.id, toOffset: offset }
          : { ...link, from: snappedNode.id, fromOffset: offset };
      }),
    );
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(linkId);
  }

  function deleteSelectedCustomElement() {
    if (selectedCustomLinkId) {
      pushCustomFlowHistory();
      setCustomFlowLinks((current) =>
        current.filter((link) => link.id !== selectedCustomLinkId),
      );
      setSelectedCustomLinkId(null);
      setInlineChartEditor((current) =>
        current?.kind === "customLink" && current.linkId === selectedCustomLinkId
          ? null
          : current,
      );
      return;
    }

    deleteSelectedCustomNode();
  }

  function handleDrawingBoardClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (drawingMode === "select" || drawingMode === "connector" || drawingMode === "custom") {
      return;
    }

    const point = getCustomFlowPoint(event, event.currentTarget);
    addCustomFlowNode(drawingMode, point.x, point.y);
  }

  function handleCustomNodePointerDown(
    node: CustomFlowNode,
    event: ReactPointerEvent<SVGGElement>,
  ) {
    customCanvasSvgRef.current?.focus();

    if (drawingMode === "connector" && event.button === 0) {
      const svgElement = event.currentTarget.ownerSVGElement;
      if (!svgElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const point = getCustomFlowPoint(event, svgElement);
      const fromOffset = getCustomFlowConnectionOffset(node, point);
      customConnectorDragRef.current = {
        from: node.id,
        pointerId: event.pointerId,
        fromOffset,
      };
      setSelectedCustomNodeId(node.id);
      setSelectedCustomLinkId(null);
      setPendingConnectorNodeId(node.id);
      setDraftConnector({
        from: node.id,
        fromOffset,
        x: point.x,
        y: point.y,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

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
      historyCaptured: false,
    };
    setSelectedCustomNodeId(node.id);
    setSelectedCustomLinkId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomNodePointerMove(event: ReactPointerEvent<SVGGElement>) {
    const connectorState = customConnectorDragRef.current;
    if (connectorState && connectorState.pointerId === event.pointerId) {
      const svgElement = event.currentTarget.ownerSVGElement;
      if (!svgElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const point = getCustomFlowPoint(event, svgElement);
      const targetNode = getNearestCustomFlowNodeAtPoint(point, connectorState.from);
      const snappedPoint = targetNode
        ? getCustomFlowNodeEdgePoint(targetNode, point)
        : point;
      setDraftConnector((current) =>
        current
          ? { ...current, x: snappedPoint.x, y: snappedPoint.y, targetNodeId: targetNode?.id ?? null }
          : current,
      );
      return;
    }

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
    if (!dragState.historyCaptured) {
      pushCustomFlowHistory();
      dragState.historyCaptured = true;
    }
    dragState.moved = true;
    updateCustomFlowNodePosition(
      dragState.nodeId,
      point.x - dragState.offsetX,
      point.y - dragState.offsetY,
    );
  }

  function finishCustomNodeDrag(event: ReactPointerEvent<SVGGElement>) {
    const connectorState = customConnectorDragRef.current;
    if (connectorState && connectorState.pointerId === event.pointerId) {
      const svgElement = event.currentTarget.ownerSVGElement;
      if (!svgElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const point = getCustomFlowPoint(event, svgElement);
      const targetNode =
        findCustomFlowNodeAtPoint(point, connectorState.from) ??
        getNearestCustomFlowNodeAtPoint(point, connectorState.from);
      if (targetNode) {
        addCustomFlowLink(connectorState.from, targetNode.id, {
          fromOffset: connectorState.fromOffset,
          toOffset: getCustomFlowConnectionOffset(targetNode, point),
        });
      }
      customConnectorDragRef.current = null;
      setDraftConnector(null);
      setPendingConnectorNodeId(null);
      customFlowSuppressClickRef.current = true;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

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

  function handleCustomNodeClick(nodeId: string, event?: ReactMouseEvent<SVGGElement>) {
    if (customFlowSuppressClickRef.current) {
      customFlowSuppressClickRef.current = false;
      return;
    }

    setSelectedCustomNodeId(nodeId);
    setSelectedCustomLinkId(null);

    if (drawingMode !== "connector") {
      const node = customFlowNodes.find((entry) => entry.id === nodeId);
      if (node && event) {
        openInlineChartEditorAtPoint(event.clientX, event.clientY, {
          kind: "customNode",
          nodeId,
          value: node.label,
        });
      }
      return;
    }

    if (!pendingConnectorNodeId) {
      setPendingConnectorNodeId(nodeId);
      return;
    }

    if (pendingConnectorNodeId !== nodeId) {
      addCustomFlowLink(pendingConnectorNodeId, nodeId);
    }
    setPendingConnectorNodeId(null);
  }

  function beginCustomLinkBendDrag(
    linkId: string,
    anchorIndex: number | null,
    segmentIndex: number,
    event: ReactPointerEvent<SVGElement>,
  ) {
    if (drawingMode !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    customCanvasSvgRef.current?.focus();
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(linkId);
    customLinkBendDragRef.current = {
      linkId,
      pointerId: event.pointerId,
      anchorIndex,
      segmentIndex,
      moved: false,
      historyCaptured: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomLinkPathPointerDown(
    link: CustomFlowLink,
    event: ReactPointerEvent<SVGPathElement>,
  ) {
    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    const point = getCustomFlowPoint(event, svgElement);
    const route = getCustomFlowLinkRouteById(link.id);
    const startPoint = route?.[0];
    const endPoint = route?.at(-1);
    if (endPoint) {
      const deltaX = point.x - endPoint.x;
      const deltaY = point.y - endPoint.y;
      if (deltaX * deltaX + deltaY * deltaY <= 625) {
        beginCustomLinkEndpointDrag(link.id, "to", event);
        return;
      }
    }
    if (startPoint) {
      const deltaX = point.x - startPoint.x;
      const deltaY = point.y - startPoint.y;
      if (deltaX * deltaX + deltaY * deltaY <= 400) {
        beginCustomLinkEndpointDrag(link.id, "from", event);
        return;
      }
    }

    const segmentIndex = route ? getClosestRouteSegmentIndex(route, point) : 0;
    beginCustomLinkBendDrag(link.id, null, segmentIndex, event);
  }

  function handleCustomLinkAnchorPointerDown(
    linkId: string,
    anchorIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) {
    beginCustomLinkBendDrag(linkId, anchorIndex, anchorIndex, event);
  }

  function beginCustomLinkEndpointDrag(
    linkId: string,
    endpoint: "from" | "to",
    event: ReactPointerEvent<SVGElement>,
  ) {
    if (drawingMode !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    customCanvasSvgRef.current?.focus();
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(linkId);
    customLinkEndpointDragRef.current = {
      linkId,
      pointerId: event.pointerId,
      endpoint,
      moved: false,
      historyCaptured: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomLinkBendPointerMove(event: ReactPointerEvent<SVGElement>) {
    const dragState = customLinkBendDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const svgElement = event.currentTarget.ownerSVGElement ?? customCanvasSvgRef.current;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, svgElement);
    if (!dragState.historyCaptured) {
      pushCustomFlowHistory();
      dragState.historyCaptured = true;
    }

    if (dragState.anchorIndex === null) {
      dragState.anchorIndex = dragState.segmentIndex;
      addCustomFlowLinkAnchor(dragState.linkId, dragState.segmentIndex, point);
    } else {
      updateCustomFlowLinkAnchor(dragState.linkId, dragState.anchorIndex, point);
    }
    dragState.moved = true;
  }

  function finishCustomLinkBendDrag(event: ReactPointerEvent<SVGElement>) {
    const dragState = customLinkBendDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    customFlowSuppressClickRef.current = dragState.moved;
    customLinkBendDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCustomLinkEndpointPointerMove(event: ReactPointerEvent<SVGElement>) {
    const dragState = customLinkEndpointDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const svgElement = event.currentTarget.ownerSVGElement ?? customCanvasSvgRef.current;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, svgElement);
    if (!dragState.historyCaptured) {
      pushCustomFlowHistory();
      dragState.historyCaptured = true;
    }

    updateCustomFlowLinkEndpoint(dragState.linkId, dragState.endpoint, point);
    dragState.moved = true;
  }

  function finishCustomLinkEndpointDrag(event: ReactPointerEvent<SVGElement>) {
    const dragState = customLinkEndpointDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    customFlowSuppressClickRef.current = dragState.moved;
    customLinkEndpointDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCustomLinkClick(link: CustomFlowLink, event: ReactMouseEvent<SVGPathElement>) {
    if (customFlowSuppressClickRef.current) {
      customFlowSuppressClickRef.current = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(link.id);
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "customLink",
      linkId: link.id,
      value: link.label ?? "",
    });
  }

  function handleCustomLinkDoubleClick(
    link: CustomFlowLink,
    event: ReactMouseEvent<SVGPathElement>,
  ) {
    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getCustomFlowPoint(event, svgElement);
    const route = getCustomFlowLinkRouteById(link.id);
    const segmentIndex = route ? getClosestRouteSegmentIndex(route, point) : 0;
    pushCustomFlowHistory();
    addCustomFlowLinkAnchor(link.id, segmentIndex, point);
  }

  function updateSelectedCustomNodeLabel(label: string) {
    if (!selectedCustomNodeId) {
      return;
    }
    if (selectedCustomNode?.label === label) {
      return;
    }
    pushCustomFlowHistory();
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
      pushCustomFlowHistory();
      setSelectedCustomNodeId(node.id);
      moveCustomFlowNode(node.id, movement[0], movement[1]);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      pushCustomFlowHistory();
      setSelectedCustomNodeId(node.id);
      setCustomFlowNodes((current) => current.filter((entry) => entry.id !== node.id));
      setCustomFlowLinks((current) =>
        current.filter((link) => link.from !== node.id && link.to !== node.id),
      );
      setPendingConnectorNodeId((current) => (current === node.id ? null : current));
      setSelectedCustomLinkId(null);
    }
  }

  function deleteSelectedCustomNode() {
    if (!selectedCustomNodeId) {
      return;
    }
    pushCustomFlowHistory();
    setCustomFlowNodes((current) =>
      current.filter((node) => node.id !== selectedCustomNodeId),
    );
    setCustomFlowLinks((current) =>
      current.filter(
        (link) => link.from !== selectedCustomNodeId && link.to !== selectedCustomNodeId,
      ),
    );
    setSelectedCustomNodeId(null);
    setSelectedCustomLinkId(null);
    setPendingConnectorNodeId(null);
    setDraftConnector(null);
    customConnectorDragRef.current = null;
  }

  function applyCustomFlowToSteps() {
    if (customFlowNodes.length === 0) {
      return;
    }
    setItemsText(customFlowNodes.map((node) => node.label).join("\n"));
    setMessage("Canvas steps synced to source data.");
  }

  function getSwimlaneTop() {
    return layerSettings.showTitle ? 70 : 28;
  }

  function getSwimlaneHeight() {
    return getSwimlaneTop() + Math.max(1, lanes.length) * 92 + 36;
  }

  function getSwimlanePoint(
    event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>,
    svg: SVGSVGElement,
  ) {
    const bounds = svg.getBoundingClientRect();
    const height = getSwimlaneHeight();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 960,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height,
    };
  }

  function syncSwimlaneStepsToItems(nextSteps: SwimlaneStep[]) {
    setItemsText(nextSteps.map((step) => step.label).join("\n"));
  }

  function handleSwimlaneStepPointerDown(
    step: SwimlaneStep,
    event: ReactPointerEvent<SVGGElement>,
  ) {
    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getSwimlanePoint(event, svgElement);
    swimlaneDragRef.current = {
      type: "step",
      stepId: step.id,
      pointerId: event.pointerId,
      offsetX: point.x - step.x,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSwimlaneLinkPointerDown(
    link: SwimlaneLink,
    event: ReactPointerEvent<SVGPathElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    swimlaneDragRef.current = {
      type: "link",
      linkId: link.id,
      pointerId: event.pointerId,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSwimlanePointerMove(event: ReactPointerEvent<SVGElement>) {
    const dragState = swimlaneDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const svgElement =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getSwimlanePoint(event, svgElement);
    const top = getSwimlaneTop();
    const laneIndex = clampNumber(
      Math.floor((point.y - top) / 92),
      0,
      Math.max(0, lanes.length - 1),
    );

    if (dragState.type === "step") {
      dragState.moved = true;
      const nextSteps = swimlaneSteps.map((step) =>
        step.id === dragState.stepId
          ? {
              ...step,
              laneIndex,
              x: clampNumber(point.x - dragState.offsetX, 250, 850),
            }
          : step,
      );
      setSwimlaneSteps(nextSteps);
      syncSwimlaneStepsToItems(nextSteps);
    } else {
      dragState.moved = true;
      setSwimlaneLinks((current) =>
        current.map((link) =>
          link.id === dragState.linkId
            ? {
                ...link,
                bendX: clampNumber(point.x, 210, 900),
                bendY: clampNumber(point.y - top, 18, Math.max(18, lanes.length * 92 - 18)),
              }
            : link,
        ),
      );
    }
  }

  function finishSwimlaneDrag(event: ReactPointerEvent<SVGElement>) {
    const dragState = swimlaneDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    swimlaneSuppressClickRef.current = dragState.moved;
    swimlaneDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewRevision((current) => current + 1);
  }

  function handleSwimlaneStepClick(step: SwimlaneStep, event: ReactMouseEvent<SVGGElement>) {
    if (swimlaneSuppressClickRef.current) {
      swimlaneSuppressClickRef.current = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "swimlaneStep",
      stepId: step.id,
      value: step.label,
    });
  }

  function handleSwimlaneLinkClick(link: SwimlaneLink, event: ReactMouseEvent<SVGPathElement>) {
    if (swimlaneSuppressClickRef.current) {
      swimlaneSuppressClickRef.current = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "swimlaneArrow",
      linkId: link.id,
      value: link.label,
    });
  }

  function getValueStreamPoint(
    event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>,
    svg: SVGSVGElement,
  ) {
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 960,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 420,
    };
  }

  function getValueStreamStepLayout(index: number, count: number) {
    const left = 78;
    const right = 78;
    const availableWidth = 960 - left - right;
    const safeCount = Math.max(count, 1);
    const stepGap = safeCount > 1 ? availableWidth / (safeCount - 1) : 0;
    const width = clampNumber(stepGap - 34, 112, 142);
    return {
      x: safeCount === 1 ? 480 : left + stepGap * index,
      y: layerSettings.showTitle ? 170 : 132,
      width,
      height: 66,
    };
  }

  function handleValueStreamCanvasDoubleClick(event: ReactMouseEvent<SVGRectElement>) {
    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getValueStreamPoint(event, svgElement);
    const note = addValueStreamNote(point);
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "valueStreamNote",
      noteId: note.id,
      value: note.text,
    });
  }

  function handleValueStreamStepClick(index: number, event: ReactMouseEvent<SVGGElement>) {
    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "item",
      index,
      value: items[index] ?? "",
    });
  }

  function handleValueStreamTimelineClick(event: ReactMouseEvent<SVGTextElement>) {
    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "valueStreamTimeline",
      value: valueStreamTimelineLabel,
    });
  }

  function handleValueStreamNotePointerDown(
    note: ValueStreamNote,
    event: ReactPointerEvent<SVGGElement>,
  ) {
    const svgElement = event.currentTarget.ownerSVGElement;
    if (!svgElement || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getValueStreamPoint(event, svgElement);
    valueStreamNoteDragRef.current = {
      noteId: note.id,
      pointerId: event.pointerId,
      offsetX: point.x - note.x,
      offsetY: point.y - note.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleValueStreamNotePointerMove(event: ReactPointerEvent<SVGElement>) {
    const dragState = valueStreamNoteDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const svgElement =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement;
    if (!svgElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getValueStreamPoint(event, svgElement);
    dragState.moved = true;
    setValueStreamNotes((current) =>
      current.map((note) =>
        note.id === dragState.noteId
          ? {
              ...note,
              x: clampNumber(point.x - dragState.offsetX, 75, 885),
              y: clampNumber(point.y - dragState.offsetY, 52, 392),
            }
          : note,
      ),
    );
  }

  function finishValueStreamNoteDrag(event: ReactPointerEvent<SVGElement>) {
    const dragState = valueStreamNoteDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    valueStreamSuppressClickRef.current = dragState.moved;
    valueStreamNoteDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewRevision((current) => current + 1);
  }

  function handleValueStreamNoteClick(note: ValueStreamNote, event: ReactMouseEvent<SVGGElement>) {
    if (valueStreamSuppressClickRef.current) {
      valueStreamSuppressClickRef.current = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
      kind: "valueStreamNote",
      noteId: note.id,
      value: note.text,
    });
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
        `Method: DMAIC ${phase.label}`,
        `Diagram: ${definition.label}`,
        `Process area: ${processArea || "Not specified"}`,
        `Purpose: ${purpose}`,
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
      purposeLength: purpose.trim().length,
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

  function buildProcessMapPayload() {
    return {
      version: 1,
      title,
      purpose,
      prompt,
      diagramType,
      dmaicPhase,
      processArea,
      departmentId: departmentId || null,
      items,
      lanes,
      metrics,
      formulaTool,
      capabilityData: capabilityValues,
      specLower: normalizedSpecLower,
      specUpper: normalizedSpecUpper,
      target: normalizedTarget,
      style: diagramStyle,
      textStyle: diagramTextStyle,
      layers: layerSettings,
      sipoc: {
        rowCount: sipocDisplayRowCount,
      },
      valueStream: {
        timelineLabel: valueStreamTimelineLabel,
        notes: valueStreamNotes,
      },
      customFlow: {
        nodes: customFlowNodes,
        links: customFlowLinks,
        view: customCanvasView,
      },
      swimlane: {
        steps: swimlaneSteps,
        links: swimlaneLinks,
      },
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
          dmaicPhase,
          dmaicEnabled: true,
          processArea,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as RecommendationPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to recommend a chart.");
      }

      setRecommendation(payload);
      setDiagramType(payload.diagramType);
      setSelectedCustomLinkId(null);
      setInlineChartEditor(null);
      setDmaicPhase(payload.dmaicPhase);
      setTitle(payload.suggestedTitle);
      setItemsText(payload.starterItems.join("\n"));
      setSipocRowCount(payload.diagramType === "sipoc" ? 1 : sipocRowCount);
      if (payload.diagramType === "value_stream_map") {
        setValueStreamTimelineLabel("Lead time / wait time timeline");
        setValueStreamNotes([]);
      }
      if (payload.diagramType === "swimlane") {
        const defaultSteps: SwimlaneStep[] = payload.starterItems.map((item, index) => ({
          id: `swim-step-${index + 1}`,
          label: item,
          laneIndex: index % Math.max(1, lanes.length),
          x: 305 + index * 150,
        }));
        setSwimlaneSteps(defaultSteps);
        setSwimlaneLinks(
          defaultSteps.slice(1).map((step, index) => {
            const previousStep = defaultSteps[index];
            return {
              id: `swim-link-${index + 1}`,
              from: previousStep.id,
              to: step.id,
              label: "",
              bendX: (previousStep.x + step.x) / 2,
              bendY: step.laneIndex * 92 + 46,
            };
          }),
        );
      }
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
    `DMAIC: ${escapeHtml(phase.label)}`
  } | Process area: ${escapeHtml(processArea || "Unassigned")}</div>
  <h2>Purpose</h2>
  <p>${escapeHtml(purpose)}</p>
  <h2>Diagram</h2>
  <div class="diagram">${
    TABLE_DIAGRAM_TYPES.has(diagramType)
      ? buildTableDiagramHtml(diagramType, tableItems, metrics, { sipocRowCount: sipocDisplayRowCount })
      : svg
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

    const printFrame = document.createElement("iframe");
    printFrame.title = "Print process map";
    printFrame.style.position = "fixed";
    printFrame.style.left = "-10000px";
    printFrame.style.top = "0";
    printFrame.style.width = "1200px";
    printFrame.style.height = "900px";
    printFrame.style.border = "0";
    printFrame.style.opacity = "0";
    document.body.appendChild(printFrame);

    const printWindow = printFrame.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      printFrame.remove();
      setError("Unable to prepare the print view.");
      return;
    }

    printDocument.open();
    printDocument.write(buildPrintableReportHtml());
    printDocument.close();

    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      window.setTimeout(() => printFrame.remove(), 1000);
    }, 300);
  }

  function refreshPreview() {
    setPreviewRevision((current) => current + 1);
    setMessage("Chart preview refreshed with the current data.");
  }

  async function copyOutline() {
    const outline = [
      title,
      `Diagram: ${definition.label}`,
      `DMAIC: ${phase.label}`,
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
        purpose,
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
          processScope: purpose,
          processPurpose: purpose,
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
          processMapPayload: buildProcessMapPayload(),
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

  const diagramTextCss = {
    color: diagramTextStyle.color,
    fontFamily: diagramTextStyle.fontFamily,
    fontSize: `${12 * diagramTextStyle.fontScale}px`,
    fontWeight: diagramTextStyle.bold ? 800 : 600,
    fontStyle: diagramTextStyle.italic ? "italic" : "normal",
    textDecoration: diagramTextStyle.underline ? "underline" : "none",
  };
  const editTargetLabel =
    inlineChartEditor?.kind === "metric"
      ? inlineChartEditor.field === "label"
        ? "Label"
        : inlineChartEditor.field === "value"
          ? "Value"
          : "Secondary"
      : inlineChartEditor?.kind === "lane"
        ? "Lane"
        : inlineChartEditor?.kind === "swimlaneArrow"
          ? "Arrow"
          : inlineChartEditor?.kind === "customLink"
            ? "Arrow"
          : inlineChartEditor?.kind === "valueStreamTimeline"
            ? "Timeline"
          : inlineChartEditor?.kind === "valueStreamNote"
            ? "Note"
          : inlineChartEditor?.kind === "purpose"
            ? "Purpose"
            : inlineChartEditor?.kind === "title"
              ? "Title"
              : "Text";

  const inlineStyleTarget = (() => {
    if (!inlineChartEditor) {
      return null;
    }

    if (inlineChartEditor.kind === "customNode") {
      const node = customFlowNodes.find((entry) => entry.id === inlineChartEditor.nodeId);
      return node ? { style: getCustomFlowNodeStyle(node), supportsFill: true, supportsText: true } : null;
    }

    if (inlineChartEditor.kind === "customLink") {
      const link = customFlowLinks.find((entry) => entry.id === inlineChartEditor.linkId);
      return link ? { style: getCustomFlowLinkStyle(link), supportsFill: false, supportsText: true } : null;
    }

    if (inlineChartEditor.kind === "swimlaneStep") {
      const step = swimlaneSteps.find((entry) => entry.id === inlineChartEditor.stepId);
      return step ? { style: getSwimlaneStepStyle(step), supportsFill: true, supportsText: true } : null;
    }

    if (inlineChartEditor.kind === "swimlaneArrow") {
      const link = swimlaneLinks.find((entry) => entry.id === inlineChartEditor.linkId);
      return link ? { style: getSwimlaneLinkStyle(link), supportsFill: false, supportsText: true } : null;
    }

    return null;
  })();

  function updateInlineElementStyle(stylePatch: Partial<DiagramElementStyle>) {
    if (!inlineChartEditor) {
      return;
    }

    if (inlineChartEditor.kind === "customNode") {
      updateCustomFlowNodeStyle(inlineChartEditor.nodeId, stylePatch);
    } else if (inlineChartEditor.kind === "customLink") {
      updateCustomFlowLinkStyle(inlineChartEditor.linkId, stylePatch);
    } else if (inlineChartEditor.kind === "swimlaneStep") {
      updateSwimlaneStepStyle(inlineChartEditor.stepId, stylePatch);
    } else if (inlineChartEditor.kind === "swimlaneArrow") {
      updateSwimlaneLinkStyle(inlineChartEditor.linkId, stylePatch);
    }
  }

  function applyQuickColor(color: string) {
    if (!inlineStyleTarget) {
      return;
    }

    if (inlineStyleTarget?.supportsFill) {
      updateInlineElementStyle({ fillColor: color });
      return;
    }

    updateInlineElementStyle({ strokeColor: color });
  }

  const canAddFromEditTarget = Boolean(
    inlineChartEditor &&
      ["item", "lane", "metric", "swimlaneStep", "valueStreamNote"].includes(inlineChartEditor.kind),
  );
  const canDeleteFromEditTarget = Boolean(
    inlineChartEditor &&
      !["title", "purpose", "fishboneEffect", "valueStreamTimeline"].includes(inlineChartEditor.kind),
  );

  const canvasQuickControls = (() => {
    if (isCustomFlowDiagram) {
      const hasSelection = Boolean(selectedCustomNodeId || selectedCustomLinkId);

      if (!hasSelection) {
        return null;
      }

      return (
        <div
          className="absolute right-3 top-12 z-20 inline-flex rounded-lg border border-slate-300/80 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-950/95"
          data-process-edit-bar
        >
          <button
            type="button"
            onClick={deleteSelectedCustomElement}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-200"
            aria-label="Delete selected shape or arrow"
            title="Delete selected shape or arrow"
          >
            <Trash2 size={16} />
          </button>
        </div>
      );
    }

    const addLabel =
      diagramType === "swimlane"
        ? "Add swimlane step"
        : diagramType === "value_stream_map"
          ? "Add value stream step"
        : diagramType === "fishbone"
          ? "Add cause group"
          : CHART_DATA_DIAGRAM_TYPES.has(diagramType) || TABLE_DIAGRAM_TYPES.has(diagramType)
            ? "Add data row"
            : "Add item";
    const deleteLabel =
      diagramType === "swimlane"
        ? "Delete selected or last swimlane step"
        : diagramType === "value_stream_map"
          ? "Delete selected or last value stream step"
        : diagramType === "fishbone"
          ? "Delete cause group"
          : CHART_DATA_DIAGRAM_TYPES.has(diagramType) || TABLE_DIAGRAM_TYPES.has(diagramType)
            ? "Delete data row"
            : "Delete item";

    return (
      <div
        className="absolute right-3 top-3 z-10 inline-flex rounded-lg border border-slate-300/80 bg-white/95 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-950/95"
        data-process-edit-bar
      >
        <button
          type="button"
          onClick={addChartDataRow}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cyan-800 transition hover:bg-cyan-500/15 dark:text-cyan-100"
          aria-label={addLabel}
          title={addLabel}
        >
          <Plus size={16} />
        </button>
        {diagramType === "value_stream_map" ? (
          <button
            type="button"
            onClick={() => addValueStreamNote()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-700 transition hover:bg-amber-400/20 dark:text-amber-200"
            aria-label="Add value stream note"
            title="Add value stream note"
          >
            <Type size={16} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={deleteCurrentEditTarget}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-200"
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  })();

  const floatingEditBar = inlineChartEditor ? (
    <form
      ref={editBarRef}
      className="absolute z-30 grid min-w-[18rem] gap-2 rounded-lg border border-slate-300/80 bg-white p-2 text-xs shadow-lg shadow-slate-950/15 dark:border-slate-700 dark:bg-slate-950"
      data-process-edit-bar
      style={{
        left: inlineChartEditor.left,
        top: inlineChartEditor.top,
        width: inlineChartEditor.width,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        setInlineChartEditor(null);
      }}
    >
      <div className="flex items-center gap-1.5">
        <Type size={14} className="shrink-0 text-slate-500" />
        <input
          autoFocus
          aria-label={`Edit ${editTargetLabel.toLowerCase()}`}
          value={inlineChartEditor.value}
          inputMode={
            inlineChartEditor.kind === "metric" && inlineChartEditor.field !== "label"
              ? "decimal"
              : "text"
          }
          onChange={(event) => updateInlineChartEditValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              inlineChartEditCancelledRef.current = true;
              setInlineChartEditor(null);
            }
          }}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="button"
          onClick={addCurrentEditTarget}
          hidden={!canAddFromEditTarget}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/35 text-cyan-800 transition hover:bg-cyan-500/15 dark:text-cyan-100"
          aria-label="Add related item"
          title="Add related item"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={deleteCurrentEditTarget}
          hidden={!canDeleteFromEditTarget}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-rose-500/35 text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-200"
          aria-label="Delete selected item"
          title="Delete selected item"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {inlineStyleTarget ? (
          <>
            {QUICK_COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => applyQuickColor(color)}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white p-1 transition hover:scale-105 dark:border-slate-700 dark:bg-slate-950",
                  (inlineStyleTarget.supportsFill
                    ? inlineStyleTarget.style.fillColor
                    : inlineStyleTarget.style.strokeColor) === color
                    ? "ring-2 ring-cyan-500/45"
                    : "",
                )}
                aria-label={`Apply ${color}`}
                title={`Apply ${color}`}
              >
                <span
                  className="block h-5 w-5 rounded"
                  style={{
                    backgroundColor: color,
                    border: color.toLowerCase() === "#ffffff" ? "1px solid #94a3b8" : "0",
                  }}
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAdvancedColors((current) => !current)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition",
                showAdvancedColors
                  ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
              )}
              aria-label="See more colors"
              title="See more colors"
            >
              <Palette size={12} />
              More
            </button>
          </>
        ) : null}
        {showAdvancedColors && inlineStyleTarget ? (
          <div className="grid basis-full gap-1.5 rounded-md border border-slate-300/80 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="grid grid-cols-3 gap-1.5">
              <label
                className={cn(
                  "grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                  inlineStyleTarget?.supportsFill === false ? "opacity-45" : "",
                )}
              >
                Fill
                <input
                  type="color"
                  disabled={inlineStyleTarget?.supportsFill === false}
                  value={inlineStyleTarget?.style.fillColor ?? diagramStyle.secondaryColor}
                  onChange={(event) => updateInlineElementStyle({ fillColor: event.target.value })}
                  className="h-7 w-full cursor-pointer rounded border border-slate-300 bg-transparent p-0 disabled:cursor-not-allowed dark:border-slate-700"
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Line
                <input
                  type="color"
                  value={inlineStyleTarget?.style.strokeColor ?? diagramStyle.primaryColor}
                  onChange={(event) => updateInlineElementStyle({ strokeColor: event.target.value })}
                  className="h-7 w-full cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Text
                <input
                  type="color"
                  value={inlineStyleTarget?.style.textColor ?? diagramTextStyle.color}
                  onChange={(event) => {
                    if (inlineStyleTarget) {
                      updateInlineElementStyle({ textColor: event.target.value });
                    } else {
                      updateDiagramTextStyle("color", event.target.value);
                    }
                  }}
                  className="h-7 w-full cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                />
              </label>
            </div>
          </div>
        ) : null}
        <select
          aria-label="Font"
          value={diagramTextStyle.fontFamily}
          onChange={(event) => updateDiagramTextStyle("fontFamily", event.target.value)}
          className="h-7 min-w-[7rem] rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-semibold outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="Inter, Arial, sans-serif">Inter</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier</option>
        </select>
        <button
          type="button"
          onClick={() => updateDiagramTextStyle("bold", !diagramTextStyle.bold)}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition",
            diagramTextStyle.bold
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
          )}
          aria-label="Bold"
          title="Bold"
        >
          <Bold size={13} />
        </button>
        <button
          type="button"
          onClick={() => updateDiagramTextStyle("italic", !diagramTextStyle.italic)}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition",
            diagramTextStyle.italic
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
          )}
          aria-label="Italic"
          title="Italic"
        >
          <Italic size={13} />
        </button>
        <button
          type="button"
          onClick={() => updateDiagramTextStyle("underline", !diagramTextStyle.underline)}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition",
            diagramTextStyle.underline
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
          )}
          aria-label="Underline"
          title="Underline"
        >
          <Underline size={13} />
        </button>
        <button
          type="button"
          onClick={() =>
            updateDiagramTextStyle(
              "fontScale",
              clampNumber(diagramTextStyle.fontScale - 0.08, 0.78, 1.5),
            )
          }
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
          aria-label="Smaller text"
          title="Smaller text"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          onClick={() =>
            updateDiagramTextStyle(
              "fontScale",
              clampNumber(diagramTextStyle.fontScale + 0.08, 0.78, 1.5),
            )
          }
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
          aria-label="Larger text"
          title="Larger text"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => updateLayerSetting("showTitle", !layerSettings.showTitle)}
          className={cn(
            "inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold transition",
            layerSettings.showTitle
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
          )}
          aria-label="Toggle title"
          title="Toggle title"
        >
          T
        </button>
        <button
          type="button"
          onClick={() => updateLayerSetting("showGrid", !layerSettings.showGrid)}
          className={cn(
            "inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold transition",
            layerSettings.showGrid
              ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
              : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300",
          )}
          aria-label="Toggle grid"
          title="Toggle grid"
        >
          #
        </button>
      </div>
    </form>
  ) : null;

  const workspaceCanvas = isCustomFlowDiagram ? (
    <div
      ref={sandboxHostRef}
      className="relative grid h-[calc(100dvh-5rem)] min-h-[56rem] grid-rows-[auto_minmax(0,1fr)] bg-white dark:bg-slate-950"
      onPointerDownCapture={handleSandboxPointerDownCapture}
    >
      {canvasQuickControls}
      {floatingEditBar}
      <div className="border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
              {[
                ["select", "Select", "V"],
                ["process", "Process", "P"],
                ["decision", "Decision", "D"],
                ["terminator", "Start/End", "T"],
                ["custom", "Custom", "C"],
                ["connector", "Arrow", "A"],
              ].map(([mode, label, shortcut]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCustomDrawingMode(mode as DrawingMode)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                    drawingMode === mode
                      ? "bg-cyan-500/15 text-cyan-900 dark:text-cyan-100"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                  )}
                  title={`${label} (${shortcut})`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                onClick={undoCustomFlow}
                disabled={!canUndoCustomFlow}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Undo canvas change"
                title="Undo canvas change"
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                onClick={redoCustomFlow}
                disabled={!canRedoCustomFlow}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Redo canvas change"
                title="Redo canvas change"
              >
                <Redo2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => zoomCustomCanvas(1.16)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={() => zoomCustomCanvas(0.86)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={resetCustomCanvasView}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Fit canvas view"
                title="Fit canvas view"
              >
                <Target size={14} />
              </button>
              <button
                type="button"
                onClick={applyCustomFlowToSteps}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Sync canvas labels to rows"
                title="Sync canvas labels to rows"
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                onClick={() => setChartModalOpen(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                aria-label="Open large preview"
                title="Open large preview"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
        </div>

      </div>
      <svg
        ref={customCanvasSvgRef}
        tabIndex={0}
        viewBox={`${customCanvasView.x} ${customCanvasView.y} ${customCanvasView.width} ${customCanvasView.height}`}
        className={cn(
          "h-full min-h-[38rem] w-full",
          drawingMode === "select"
            ? "cursor-default"
            : drawingMode === "connector" || drawingMode === "custom"
              ? "cursor-crosshair"
              : "cursor-copy",
        )}
        role="img"
        aria-label="Custom process flow sketch board"
        onClick={handleDrawingBoardClick}
        onKeyDown={handleCustomCanvasKeyDown}
        onWheel={handleCustomCanvasWheel}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          handleCustomShapePointerDown(event);
          handleCustomCanvasPointerDown(event);
        }}
        onPointerMove={(event) => {
          handleCustomShapePointerMove(event);
          handleCustomCanvasPointerMove(event);
        }}
        onPointerUp={(event) => {
          finishCustomShapeDrawing(event);
          finishCustomCanvasPan(event);
        }}
        onPointerCancel={(event) => {
          finishCustomShapeDrawing(event);
          finishCustomCanvasPan(event);
        }}
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
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
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
        <rect
          width={CUSTOM_FLOW_CANVAS_WIDTH}
          height={CUSTOM_FLOW_CANVAS_HEIGHT}
          fill={diagramStyle.backgroundColor}
        />
        <rect
          width={CUSTOM_FLOW_CANVAS_WIDTH}
          height={CUSTOM_FLOW_CANVAS_HEIGHT}
          fill="url(#custom-grid-workspace)"
        />
        {draftCustomShapePoints && draftCustomShapePoints.length > 1 ? (
          <path
            d={`${draftCustomShapePoints
              .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
              .join(" ")} Z`}
            fill="#f5f3ff"
            fillOpacity="0.58"
            stroke="#7c3aed"
            strokeDasharray="8 6"
            strokeWidth="2.5"
            pointerEvents="none"
          />
        ) : null}
        {customFlowLinks.map((link) => {
          const from = customFlowNodes.find((node) => node.id === link.from);
          const to = customFlowNodes.find((node) => node.id === link.to);
          if (!from || !to) {
            return null;
          }
          const route = getCustomFlowLinkRoute(link, from, to);
          const path = customFlowPathFromRoute(route);
          const linkStyle = getCustomFlowLinkStyle(link);
          const isSelected = link.id === selectedCustomLinkId;
          const labelPoint = getRouteMidpoint(route);
          const startPoint = route[0];
          const endPoint = route.at(-1) ?? startPoint;
          return (
            <g key={link.id}>
              <path
                d={path}
                fill="none"
                stroke={linkStyle.strokeColor}
                strokeWidth="14"
                strokeOpacity="0"
                className="cursor-crosshair"
                onPointerDown={(event) => handleCustomLinkPathPointerDown(link, event)}
                onPointerMove={handleCustomLinkBendPointerMove}
                onPointerUp={finishCustomLinkBendDrag}
                onPointerCancel={finishCustomLinkBendDrag}
                onClick={(event) => handleCustomLinkClick(link, event)}
                onDoubleClick={(event) => handleCustomLinkDoubleClick(link, event)}
              />
              <path
                d={path}
                fill="none"
                stroke={linkStyle.strokeColor}
                strokeWidth={isSelected ? 4 : 3}
                markerEnd="url(#custom-flow-arrow-workspace)"
                pointerEvents="none"
              />
              {isSelected ? (
                <path
                  d={path}
                  fill="none"
                  stroke="#0ea5e9"
                  strokeDasharray="7 7"
                  strokeWidth="1.5"
                  pointerEvents="none"
                />
              ) : null}
              {link.label?.trim() ? (
                <foreignObject
                  x={labelPoint.x - 70}
                  y={labelPoint.y - 34}
                  width="140"
                  height="24"
                  pointerEvents="none"
                >
                  <div
                    className="flex h-full items-center justify-center rounded bg-white/80 px-1 text-center leading-tight dark:bg-slate-950/80"
                    style={{
                      ...diagramTextCss,
                      color: linkStyle.textColor,
                      fontSize: `${10 * diagramTextStyle.fontScale}px`,
                    }}
                  >
                    {link.label}
                  </div>
                </foreignObject>
              ) : null}
              {isSelected
                ? route.slice(0, -1).map((point, segmentIndex) => {
                    const nextPoint = route[segmentIndex + 1];
                    const midpoint = {
                      x: (point.x + nextPoint.x) / 2,
                      y: (point.y + nextPoint.y) / 2,
                    };
                    return (
                      <g key={`${link.id}-segment-${segmentIndex}`}>
                        <circle
                          cx={midpoint.x}
                          cy={midpoint.y}
                          r="10"
                          fill="#ffffff"
                          stroke="#0ea5e9"
                          strokeWidth="1.5"
                          className="cursor-copy"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            pushCustomFlowHistory();
                            addCustomFlowLinkAnchor(link.id, segmentIndex, midpoint);
                          }}
                        />
                        <text
                          x={midpoint.x}
                          y={midpoint.y + 4}
                          textAnchor="middle"
                          fontSize="15"
                          fontWeight="800"
                          fill="#0369a1"
                          pointerEvents="none"
                        >
                          +
                        </text>
                      </g>
                    );
                  })
                : null}
              {isSelected
                ? (link.anchors ?? []).map((anchor, anchorIndex) => (
                    <g key={`${link.id}-anchor-${anchorIndex}`}>
                      <circle
                        cx={anchor.x}
                        cy={anchor.y}
                        r="8"
                        fill={diagramStyle.accentColor}
                        stroke="#ffffff"
                        strokeWidth="2"
                        className="cursor-move"
                        onPointerDown={(event) =>
                          handleCustomLinkAnchorPointerDown(link.id, anchorIndex, event)
                        }
                        onPointerMove={handleCustomLinkBendPointerMove}
                        onPointerUp={finishCustomLinkBendDrag}
                        onPointerCancel={finishCustomLinkBendDrag}
                      />
                      <circle
                        cx={anchor.x + 13}
                        cy={anchor.y - 13}
                        r="6"
                        fill="#ffffff"
                        stroke="#e11d48"
                        strokeWidth="1.5"
                        className="cursor-pointer"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          removeCustomFlowLinkAnchor(link.id, anchorIndex);
                        }}
                      />
                      <text
                        x={anchor.x + 13}
                        y={anchor.y - 10}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="800"
                        fill="#e11d48"
                        pointerEvents="none"
                      >
                        -
                      </text>
                    </g>
                  ))
                : null}
              {isSelected && startPoint && endPoint ? (
                <g>
                  <circle
                    cx={startPoint.x}
                    cy={startPoint.y}
                    r="8"
                    fill="#ffffff"
                    stroke="#64748b"
                    strokeWidth="2"
                    className="cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => beginCustomLinkEndpointDrag(link.id, "from", event)}
                    onPointerMove={handleCustomLinkEndpointPointerMove}
                    onPointerUp={finishCustomLinkEndpointDrag}
                    onPointerCancel={finishCustomLinkEndpointDrag}
                  />
                  <circle
                    cx={endPoint.x}
                    cy={endPoint.y}
                    r="11"
                    fill="#ffffff"
                    stroke="#0ea5e9"
                    strokeWidth="2"
                    className="cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => beginCustomLinkEndpointDrag(link.id, "to", event)}
                    onPointerMove={handleCustomLinkEndpointPointerMove}
                    onPointerUp={finishCustomLinkEndpointDrag}
                    onPointerCancel={finishCustomLinkEndpointDrag}
                  />
                  <circle cx={endPoint.x} cy={endPoint.y} r="4" fill={linkStyle.strokeColor} pointerEvents="none" />
                </g>
              ) : null}
            </g>
          );
        })}
        {draftConnector ? (
          (() => {
            const from = customFlowNodes.find((node) => node.id === draftConnector.from);
            if (!from) {
              return null;
            }
            const start = draftConnector.fromOffset
              ? {
                  x: from.x + draftConnector.fromOffset.x,
                  y: from.y + draftConnector.fromOffset.y,
                }
              : getCustomFlowNodeEdgePoint(from, draftConnector);
            return (
              <line
                x1={start.x}
                y1={start.y}
                x2={draftConnector.x}
                y2={draftConnector.y}
                stroke={diagramStyle.accentColor}
                strokeDasharray="10 8"
                strokeWidth="3"
                markerEnd="url(#custom-flow-arrow-workspace)"
              />
            );
          })()
        ) : null}
        {customFlowNodes.map((node) => {
          const isSelected = node.id === selectedCustomNodeId;
          const isPending = node.id === pendingConnectorNodeId;
          const isConnectorTarget = draftConnector?.targetNodeId === node.id;
          const nodeStyle = getCustomFlowNodeStyle(node);
          const halfSize = getCustomFlowNodeHalfSize(node);
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
                handleCustomNodeClick(node.id, event);
              }}
              className={drawingMode === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
            >
              {node.type === "custom" ? (
                <path
                  d={getCustomFlowShapePath(node)}
                  fill={nodeStyle.fillColor}
                  stroke={isPending || isConnectorTarget ? diagramStyle.accentColor : nodeStyle.strokeColor}
                  strokeWidth={isSelected || isPending || isConnectorTarget ? 4 : 2}
                />
              ) : node.type === "decision" ? (
                <polygon
                  points={`${node.x},${node.y - CUSTOM_FLOW_DECISION_HALF_HEIGHT} ${
                    node.x + CUSTOM_FLOW_DECISION_HALF_WIDTH
                  },${node.y} ${node.x},${node.y + CUSTOM_FLOW_DECISION_HALF_HEIGHT} ${
                    node.x - CUSTOM_FLOW_DECISION_HALF_WIDTH
                  },${node.y}`}
                  fill={nodeStyle.fillColor}
                  stroke={isPending || isConnectorTarget ? diagramStyle.accentColor : nodeStyle.strokeColor}
                  strokeWidth={isSelected || isPending || isConnectorTarget ? 4 : 2}
                />
              ) : (
                <rect
                  x={node.x - CUSTOM_FLOW_NODE_HALF_WIDTH}
                  y={node.y - CUSTOM_FLOW_NODE_HALF_HEIGHT}
                  width={CUSTOM_FLOW_NODE_HALF_WIDTH * 2}
                  height={CUSTOM_FLOW_NODE_HALF_HEIGHT * 2}
                  rx={node.type === "terminator" ? 28 : 10}
                  fill={nodeStyle.fillColor}
                  stroke={isPending || isConnectorTarget ? diagramStyle.accentColor : nodeStyle.strokeColor}
                  strokeWidth={isSelected || isPending || isConnectorTarget ? 4 : 2}
                />
              )}
              <foreignObject
                x={node.x - halfSize.width + 18}
                y={node.y - 24}
                width={Math.max(32, halfSize.width * 2 - 36)}
                height="48"
              >
                <div
                  className="flex h-full items-center justify-center text-center leading-tight"
                  style={{ ...diagramTextCss, color: nodeStyle.textColor }}
                >
                  {node.label}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  ) : diagramType === "value_stream_map" ? (
    <div
      ref={sandboxHostRef}
      className="relative h-full min-h-[36rem] w-full overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60"
      onPointerDownCapture={handleSandboxPointerDownCapture}
    >
      {canvasQuickControls}
      {floatingEditBar}
      <svg
        ref={valueStreamSvgRef}
        viewBox="0 0 960 420"
        className="h-full min-h-[32rem] w-full"
        role="img"
        aria-label="Editable value stream map"
        onPointerMove={handleValueStreamNotePointerMove}
        onPointerUp={finishValueStreamNoteDrag}
        onPointerCancel={finishValueStreamNoteDrag}
      >
        <defs>
          <marker
            id="value-stream-arrow-workspace"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
          </marker>
          <pattern id="value-stream-grid-workspace" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke={layerSettings.showGrid ? "#cbd5e1" : "transparent"}
              strokeWidth="0.7"
            />
          </pattern>
        </defs>
        <rect
          width="960"
          height="420"
          fill={diagramStyle.backgroundColor}
          onDoubleClick={handleValueStreamCanvasDoubleClick}
        />
        <rect
          width="960"
          height="420"
          fill="url(#value-stream-grid-workspace)"
          opacity="0.5"
          pointerEvents="none"
        />
        {layerSettings.showTitle ? (
          <text
            x="480"
            y="38"
            textAnchor="middle"
            fill={diagramTextStyle.color}
            fontFamily={diagramTextStyle.fontFamily}
            fontSize={20 * diagramTextStyle.fontScale}
            fontWeight={diagramTextStyle.bold ? 800 : 500}
            fontStyle={diagramTextStyle.italic ? "italic" : "normal"}
            textDecoration={diagramTextStyle.underline ? "underline" : "none"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openInlineChartEditorAtPoint(event.clientX, event.clientY, {
                kind: "title",
                value: title,
              });
            }}
            className="cursor-text"
          >
            {title}
          </text>
        ) : null}
        {items.map((item, index) => {
          const layout = getValueStreamStepLayout(index, items.length);
          const previousLayout = index > 0 ? getValueStreamStepLayout(index - 1, items.length) : null;
          return (
            <g key={`${item}-${index}`}>
              {previousLayout ? (
                <line
                  x1={previousLayout.x + previousLayout.width / 2 + 10}
                  y1={previousLayout.y}
                  x2={layout.x - layout.width / 2 - 12}
                  y2={layout.y}
                  stroke={diagramStyle.accentColor}
                  strokeWidth="3"
                  markerEnd="url(#value-stream-arrow-workspace)"
                  pointerEvents="none"
                />
              ) : null}
              <g
                className="cursor-text"
                onClick={(event) => handleValueStreamStepClick(index, event)}
              >
                <rect
                  x={layout.x - layout.width / 2}
                  y={layout.y - layout.height / 2}
                  width={layout.width}
                  height={layout.height}
                  rx="10"
                  fill="#e0f2fe"
                  stroke="#0284c7"
                  strokeWidth="2"
                />
                <foreignObject
                  x={layout.x - layout.width / 2 + 8}
                  y={layout.y - 28}
                  width={layout.width - 16}
                  height="36"
                  pointerEvents="none"
                >
                  <div
                    className="flex h-full items-center justify-center text-center leading-tight"
                    style={{ ...diagramTextCss, color: "#0f172a" }}
                  >
                    {item}
                  </div>
                </foreignObject>
                <text
                  x={layout.x}
                  y={layout.y + 22}
                  textAnchor="middle"
                  fill="#475569"
                  fontFamily={diagramTextStyle.fontFamily}
                  fontSize={10 * diagramTextStyle.fontScale}
                  fontWeight="700"
                  pointerEvents="none"
                >
                  {`CT ${index + 2}m | WIP ${index + 1}`}
                </text>
              </g>
            </g>
          );
        })}
        <line x1="110" y1="312" x2="850" y2="312" stroke="#64748b" strokeWidth="2" />
        <text
          x="480"
          y="342"
          textAnchor="middle"
          fill="#475569"
          fontFamily={diagramTextStyle.fontFamily}
          fontSize={13 * diagramTextStyle.fontScale}
          fontWeight="800"
          fontStyle={diagramTextStyle.italic ? "italic" : "normal"}
          textDecoration={diagramTextStyle.underline ? "underline" : "none"}
          className="cursor-text"
          onClick={handleValueStreamTimelineClick}
        >
          {valueStreamTimelineLabel}
        </text>
        {valueStreamNotes.map((note) => (
          <g
            key={note.id}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(event) => handleValueStreamNotePointerDown(note, event)}
            onPointerMove={handleValueStreamNotePointerMove}
            onPointerUp={finishValueStreamNoteDrag}
            onPointerCancel={finishValueStreamNoteDrag}
            onClick={(event) => handleValueStreamNoteClick(note, event)}
          >
            <rect
              x={note.x - 72}
              y={note.y - 24}
              width="144"
              height="48"
              rx="8"
              fill="#fef9c3"
              stroke="#ca8a04"
              strokeWidth="1.5"
            />
            <foreignObject x={note.x - 62} y={note.y - 18} width="124" height="36" pointerEvents="none">
              <div className="flex h-full items-center justify-center text-center text-[10px] font-bold leading-tight text-amber-900">
                {note.text}
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  ) : diagramType === "swimlane" ? (
    <div
      ref={sandboxHostRef}
      className="relative h-full min-h-[36rem] w-full overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60"
      onPointerDownCapture={handleSandboxPointerDownCapture}
    >
      {canvasQuickControls}
      {floatingEditBar}
      <svg
        ref={swimlaneSvgRef}
        viewBox={`0 0 960 ${getSwimlaneHeight()}`}
        className="h-full min-h-[32rem] w-full"
        role="img"
        aria-label="Editable swimlane map"
        onPointerMove={handleSwimlanePointerMove}
        onPointerUp={finishSwimlaneDrag}
        onPointerCancel={finishSwimlaneDrag}
      >
        <defs>
          <marker
            id="swimlane-arrow-workspace"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
          </marker>
          <pattern id="swimlane-grid-workspace" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke={layerSettings.showGrid ? "#cbd5e1" : "transparent"}
              strokeWidth="0.7"
            />
          </pattern>
        </defs>
        <rect width="960" height={getSwimlaneHeight()} fill={diagramStyle.backgroundColor} />
        <rect width="960" height={getSwimlaneHeight()} fill="url(#swimlane-grid-workspace)" opacity="0.52" />
        {layerSettings.showTitle ? (
          <text
            x="480"
            y="38"
            textAnchor="middle"
            fill={diagramTextStyle.color}
            fontFamily={diagramTextStyle.fontFamily}
            fontSize={20 * diagramTextStyle.fontScale}
            fontWeight={diagramTextStyle.bold ? 800 : 500}
            fontStyle={diagramTextStyle.italic ? "italic" : "normal"}
            textDecoration={diagramTextStyle.underline ? "underline" : "none"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openInlineChartEditorAtPoint(event.clientX, event.clientY, {
                kind: "title",
                value: title,
              });
            }}
            className="cursor-text"
          >
            {title}
          </text>
        ) : null}
        {lanes.map((lane, laneIndex) => {
          const y = getSwimlaneTop() + laneIndex * 92;
          return (
            <g key={`${lane}-${laneIndex}`}>
              <rect
                x="36"
                y={y}
                width="888"
                height="92"
                fill={laneIndex % 2 === 0 ? "#f1f5f9" : "#ffffff"}
                stroke="#cbd5e1"
                strokeWidth="1.5"
              />
              <rect
                x="36"
                y={y}
                width="154"
                height="92"
                fill="#ccfbf1"
                stroke="#99f6e4"
                strokeWidth="1.5"
              />
              <foreignObject x="48" y={y + 24} width="130" height="44">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openInlineChartEditorAtPoint(event.clientX, event.clientY, {
                      kind: "lane",
                      index: laneIndex,
                      value: lane,
                    });
                  }}
                  className="flex h-full w-full items-center justify-center rounded-md bg-transparent text-center leading-tight hover:bg-white/35"
                  style={diagramTextCss}
                >
                  {lane}
                </button>
              </foreignObject>
            </g>
          );
        })}
        {swimlaneLinks.map((link) => {
          const from = swimlaneSteps.find((step) => step.id === link.from);
          const to = swimlaneSteps.find((step) => step.id === link.to);
          if (!from || !to) {
            return null;
          }
          const fromY = getSwimlaneTop() + from.laneIndex * 92 + 46;
          const toY = getSwimlaneTop() + to.laneIndex * 92 + 46;
          const fromX = from.x + 82;
          const toX = to.x - 82;
          const bendX = Number.isFinite(link.bendX) ? link.bendX : (fromX + toX) / 2;
          const bendY = Number.isFinite(link.bendY)
            ? getSwimlaneTop() + link.bendY
            : (fromY + toY) / 2;
          const linkStyle = getSwimlaneLinkStyle(link);
          return (
            <g key={link.id}>
              <path
                d={`M ${fromX} ${fromY} Q ${bendX} ${bendY} ${toX} ${toY}`}
                fill="none"
                stroke={linkStyle.strokeColor}
                strokeWidth="8"
                strokeOpacity="0"
                className="cursor-move"
                onPointerDown={(event) => handleSwimlaneLinkPointerDown(link, event)}
                onPointerUp={finishSwimlaneDrag}
                onPointerCancel={finishSwimlaneDrag}
                onClick={(event) => handleSwimlaneLinkClick(link, event)}
              />
              <path
                d={`M ${fromX} ${fromY} Q ${bendX} ${bendY} ${toX} ${toY}`}
                fill="none"
                stroke={linkStyle.strokeColor}
                strokeWidth="2.5"
                markerEnd="url(#swimlane-arrow-workspace)"
                pointerEvents="none"
              />
              <circle
                cx={bendX}
                cy={bendY}
                r="6"
                fill={diagramStyle.accentColor}
                stroke="#ffffff"
                strokeWidth="2"
                pointerEvents="none"
              />
              {link.label ? (
                <text
                  x={bendX}
                  y={bendY - 12}
                  textAnchor="middle"
                  fill={linkStyle.textColor}
                  fontFamily={diagramTextStyle.fontFamily}
                  fontSize={10 * diagramTextStyle.fontScale}
                  fontWeight={diagramTextStyle.bold ? 800 : 500}
                  fontStyle={diagramTextStyle.italic ? "italic" : "normal"}
                  textDecoration={diagramTextStyle.underline ? "underline" : "none"}
                >
                  {link.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {swimlaneSteps.map((step) => {
          const laneIndex = clampNumber(step.laneIndex, 0, Math.max(0, lanes.length - 1));
          const y = getSwimlaneTop() + laneIndex * 92 + 22;
          const stepStyle = getSwimlaneStepStyle(step);
          return (
            <g
              key={step.id}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(event) => handleSwimlaneStepPointerDown(step, event)}
              onPointerMove={handleSwimlanePointerMove}
              onPointerUp={finishSwimlaneDrag}
              onPointerCancel={finishSwimlaneDrag}
              onClick={(event) => handleSwimlaneStepClick(step, event)}
            >
              <rect
                x={step.x - 82}
                y={y}
                width="164"
                height="48"
                rx="9"
                fill={stepStyle.fillColor}
                stroke={stepStyle.strokeColor}
                strokeWidth="2"
              />
              <foreignObject x={step.x - 70} y={y + 5} width="140" height="38">
                <div
                  className="flex h-full items-center justify-center text-center leading-tight"
                  style={{ ...diagramTextCss, color: stepStyle.textColor }}
                >
                  {step.label}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  ) : TABLE_DIAGRAM_TYPES.has(diagramType) ? (
    <div
      ref={sandboxHostRef}
      className="relative min-h-[36rem] overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60"
      onPointerDownCapture={handleSandboxPointerDownCapture}
    >
      {canvasQuickControls}
      {floatingEditBar}
      {buildTableRows(diagramType, tableItems, metrics, {
        editable: true,
        sipocRowCount: sipocDisplayRowCount,
        onItemChange: updateItemLine,
        onMetricChange: updateMetricLine,
      })}
    </div>
  ) : (
    <div
      key={previewRevision}
      ref={chartPreviewRef}
      onPointerDownCapture={handleSandboxPointerDownCapture}
      className="relative h-full min-h-[36rem] w-full overflow-auto bg-slate-50 p-4 dark:bg-slate-900/60"
      aria-label="Diagram preview"
      title="Click chart labels or values to edit them"
      onClick={handleChartPreviewClick}
    >
      {canvasQuickControls}
      {floatingEditBar}
      <div className="[&>svg]:h-full [&>svg]:min-h-[32rem] [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );

  const executiveStats = [
    ["Method", `DMAIC ${phase.label}`],
    ["Diagram", definition.shortLabel],
    ["X/Y Data Rows", String(metrics.length)],
    ["Flow Sketch", isCustomFlowDiagram ? "Editable" : "Not used"],
  ];
  const previewActionControls = (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={refreshPreview}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/45 bg-cyan-500/15 text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
        aria-label="Refresh preview"
        title="Refresh preview"
      >
        <RefreshCw size={15} />
      </button>
      <button
        type="button"
        onClick={() => setChartModalOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/45 bg-cyan-500/15 text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
        aria-label="Open large preview"
        title="Open large preview"
      >
        <Maximize2 size={15} />
      </button>
      <button
        type="button"
        onClick={downloadSvg}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Download SVG"
        title="Download SVG"
      >
        <Download size={15} />
      </button>
      <button
        type="button"
        onClick={downloadDataCsv}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Download CSV"
        title="Download CSV"
      >
        <FileDown size={15} />
      </button>
      <button
        type="button"
        onClick={downloadReportHtml}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Download report"
        title="Download report"
      >
        <FileText size={15} />
      </button>
      <button
        type="button"
        onClick={() => void copyOutline()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Copy outline"
        title={copied ? "Copied outline" : "Copy outline"}
      >
        {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
      </button>
      <button
        type="button"
        onClick={printTool}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Print"
        title="Print"
      >
        <Printer size={15} />
      </button>
      <button
        type="button"
        onClick={() => void saveControlledDraft()}
        disabled={!canEdit || saveBusy || !title.trim()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/45 bg-emerald-500/15 text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200"
        aria-label="Save controlled draft"
        title={canEdit ? "Save controlled draft" : "Document authoring is unavailable"}
      >
        {saveBusy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
      </button>
    </div>
  );

  return (
    <div className="process-workspace-shell process-map-builder-shell relative left-1/2 grid w-screen max-w-[1760px] -translate-x-1/2 gap-4 px-4 py-2 md:px-6">
      <header className="process-workbench-card overflow-hidden rounded-2xl p-4">
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
            Build process maps, flow charts, and quality charts with DMAIC context included for
            every workspace.
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

      <section className="process-workbench-card grid gap-3 rounded-2xl p-4">
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

      <section className="process-workbench-card grid gap-4 rounded-2xl p-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Describe the process or problem
            </span>
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
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

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside id="map-setup" className="process-workbench-card grid min-w-0 scroll-mt-24 content-start gap-3 rounded-2xl p-3 xl:sticky xl:top-24">
          <div className="grid min-w-0 gap-3">
            <div className="grid gap-3 rounded-lg border border-slate-300/70 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
              <div>
                <p className="font-bold text-slate-900 dark:text-slate-100">DMAIC Phase</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every process-map workspace includes DMAIC context.
                </p>
              </div>
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
              OEE, Cp/Cpk, DPMO, takt, yield, Little&apos;s Law, normal curve, and control-limit
              calculators live on their own page so chart setup stays focused on diagrams.
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
                    {` | ${entry.dmaicPhases
                      .map((phaseId) => getDmaicPhaseOption(phaseId).label)
                      .join(", ")}`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="grid content-start gap-4">
          <section
            id="map-preview"
            className={cn(
              "process-workbench-card grid content-start scroll-mt-24 rounded-2xl",
              isCustomFlowDiagram ? "gap-2 p-2" : "gap-4 p-4",
            )}
          >
            <div className={cn("grid", isCustomFlowDiagram ? "gap-2" : "gap-3")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                    Process Map Workspace
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {definition.label}: {definition.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    <ChartIcon diagramType={diagramType} />
                    {definition.category}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
                    DMAIC:{" "}
                    {definition.dmaicPhases
                      .map((phaseId) => getDmaicPhaseOption(phaseId).label)
                      .join(", ")}
                  </span>
                  {isCustomFlowDiagram ? previewActionControls : null}
                </div>
              </div>

              {!isCustomFlowDiagram ? (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="grid gap-1 text-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Purpose
                  </span>
                  <textarea
                    value={purpose}
                    rows={2}
                    onChange={(event) => setPurpose(event.target.value)}
                    className="resize-y rounded-lg border border-transparent bg-transparent px-0 py-1 text-sm text-slate-700 outline-none transition hover:border-slate-300 hover:px-2 focus:border-cyan-500 focus:bg-white focus:px-2 dark:text-slate-200 dark:focus:bg-slate-950"
                  />
                </label>
                {previewActionControls}
              </div>
              ) : null}
            </div>

            <div className={cn("grid", isCustomFlowDiagram ? "gap-1" : "gap-3")}>
              <div
                className={cn(
                  "overflow-hidden rounded-xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60",
                  isCustomFlowDiagram ? "process-map-canvas-frame" : "process-map-chart-frame",
                )}
              >
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
                  buildTableRows(diagramType, tableItems, metrics, {
                    editable: true,
                    sipocRowCount: sipocDisplayRowCount,
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
                  {isCustomFlowDiagram ? "Expanded diagram canvas" : "Generated chart preview"}
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

            {isCustomFlowDiagram ? (
              <div className="min-h-0 overflow-hidden p-3 sm:p-4">
                <div className="process-map-canvas-frame min-h-[calc(100dvh-8rem)] overflow-hidden rounded-xl border border-slate-300/70 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                  {workspaceCanvas}
                </div>
              </div>
            ) : (
            <div className="grid min-h-0 gap-4 overflow-y-auto overflow-x-hidden p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-h-[min(64dvh,42rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-300/70 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
                {TABLE_DIAGRAM_TYPES.has(diagramType) ? (
                  buildTableRows(diagramType, tableItems, metrics, {
                    editable: true,
                    sipocRowCount: sipocDisplayRowCount,
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
                      <dd className="font-bold">DMAIC {phase.label}</dd>
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
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
