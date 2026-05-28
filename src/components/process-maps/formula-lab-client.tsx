"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface OeeRecording {
  id: string;
  plannedMinutes: string;
  runMinutes: string;
  idealCycleSeconds: string;
  totalCount: string;
  goodCount: string;
}

interface OeeOperatorGroup {
  id: string;
  operator: string;
  recordings: OeeRecording[];
}

type FormulaTab =
  | "oee"
  | "capability"
  | "dpmo"
  | "takt"
  | "yield"
  | "little_law"
  | "normal_curve"
  | "control_limits"
  | "custom";

type CustomFormulaApprovalStatus = "pending_review" | "approved" | "rejected";

interface CustomFormulaInput {
  id: string;
  name: string;
  label: string;
  value: string;
}

interface CustomFormulaOutput {
  id: string;
  name: string;
  label: string;
  expression: string;
}

interface SavedFormula {
  id: string;
  ownerUserId?: string;
  name: string;
  formulaType: FormulaTab;
  payload: unknown;
  createdAt?: string;
  updatedAt: string;
}

interface FormulaApiResponse {
  formulas?: SavedFormula[];
  formula?: SavedFormula | null;
  success?: boolean;
  error?: string;
}

const DEFAULT_OEE_GROUPS: OeeOperatorGroup[] = [
  {
    id: "operator-1",
    operator: "Operator 1",
    recordings: [
      {
        id: "operator-1-study-1",
        plannedMinutes: "96",
        runMinutes: "84",
        idealCycleSeconds: "45",
        totalCount: "104",
        goodCount: "99",
      },
      {
        id: "operator-1-study-2",
        plannedMinutes: "96",
        runMinutes: "86",
        idealCycleSeconds: "45",
        totalCount: "108",
        goodCount: "103",
      },
      {
        id: "operator-1-study-3",
        plannedMinutes: "96",
        runMinutes: "83",
        idealCycleSeconds: "45",
        totalCount: "101",
        goodCount: "97",
      },
      {
        id: "operator-1-study-4",
        plannedMinutes: "96",
        runMinutes: "85",
        idealCycleSeconds: "45",
        totalCount: "105",
        goodCount: "101",
      },
      {
        id: "operator-1-study-5",
        plannedMinutes: "96",
        runMinutes: "82",
        idealCycleSeconds: "45",
        totalCount: "102",
        goodCount: "98",
      },
    ],
  },
  {
    id: "operator-2",
    operator: "Operator 2",
    recordings: [
      {
        id: "operator-2-study-1",
        plannedMinutes: "96",
        runMinutes: "87",
        idealCycleSeconds: "45",
        totalCount: "109",
        goodCount: "105",
      },
      {
        id: "operator-2-study-2",
        plannedMinutes: "96",
        runMinutes: "88",
        idealCycleSeconds: "45",
        totalCount: "112",
        goodCount: "108",
      },
      {
        id: "operator-2-study-3",
        plannedMinutes: "96",
        runMinutes: "86",
        idealCycleSeconds: "45",
        totalCount: "107",
        goodCount: "103",
      },
      {
        id: "operator-2-study-4",
        plannedMinutes: "96",
        runMinutes: "89",
        idealCycleSeconds: "45",
        totalCount: "111",
        goodCount: "107",
      },
      {
        id: "operator-2-study-5",
        plannedMinutes: "96",
        runMinutes: "85",
        idealCycleSeconds: "45",
        totalCount: "106",
        goodCount: "103",
      },
    ],
  },
];

const DEFAULT_FORMULA_NAMES: Record<FormulaTab, string> = {
  oee: "OEE calculator",
  capability: "Cp Cpk calculator",
  dpmo: "DPMO calculator",
  takt: "Takt time calculator",
  yield: "FPY and RTY calculator",
  little_law: "Little's Law calculator",
  normal_curve: "Normal curve calculator",
  control_limits: "Control limits calculator",
  custom: "Custom formula",
};

const DEFAULT_CUSTOM_INPUTS: CustomFormulaInput[] = [
  {
    id: "custom-input-1",
    name: "x",
    label: "Input X",
    value: "10",
  },
];

const DEFAULT_CUSTOM_OUTPUTS: CustomFormulaOutput[] = [
  {
    id: "custom-output-1",
    name: "result",
    label: "Result",
    expression: "x",
  },
];

interface FormulaGuide {
  title: string;
  formula: string;
  calculation: string;
  whenToUse: string;
  scenario: string;
  inputHints: string[];
  resultHints: Record<string, string>;
}

const FORMULA_GUIDES: Record<FormulaTab, FormulaGuide> = {
  oee: {
    title: "Overall Equipment Effectiveness",
    formula: "OEE = Availability x Performance x Quality",
    calculation:
      "Availability compares run time to planned time. Performance compares ideal output to actual run time. Quality compares good parts to total parts.",
    whenToUse:
      "Use OEE when equipment output is below plan and you need to separate downtime, speed loss, and scrap loss.",
    scenario:
      "A CNC cell is scheduled for 480 minutes, runs 420 minutes, produces 520 parts, and ships 498 good parts. OEE shows whether the biggest loss came from downtime, slow cycle time, or defects.",
    inputHints: [
      "Planned minutes should exclude planned breaks if those breaks are not production time.",
      "Ideal cycle seconds should be the best demonstrated or engineered cycle for one good unit.",
      "Good count should exclude scrap, rework that is not yet accepted, and rejected units.",
    ],
    resultHints: {
      "Availability": "Run time divided by planned production time.",
      "Performance": "Ideal cycle time times total count divided by run time.",
      "Quality": "Good count divided by total count.",
      "OEE": "Combined effective output after downtime, speed, and quality losses.",
    },
  },
  capability: {
    title: "Cp / Cpk Capability",
    formula: "Cp = (USL - LSL) / (6 x sigma); Cpk = min(Cpu, Cpl)",
    calculation:
      "Cp compares tolerance width to process spread. Cpk also checks whether the process average is centered between the specification limits.",
    whenToUse:
      "Use capability after the process is stable and you need to know whether normal variation fits inside customer specifications.",
    scenario:
      "A turned shaft has a 10.00 mm target with 9.95 to 10.05 mm specs. Capability shows if the lathe can hold tolerance before raising inspection frequency or changing tooling.",
    inputHints: [
      "Use measurements from a stable process, not mixed setups or obvious special-cause events.",
      "Enter LSL and USL in the same units as the measurements.",
      "At least two measurements are required; larger samples make the estimate more useful.",
    ],
    resultHints: {
      "N": "Number of measurements used.",
      "Mean": "Average measured value.",
      "Sigma": "Sample standard deviation, used as estimated process spread.",
      "Cp": "Potential capability if the process were centered.",
      "Cpk": "Actual capability after accounting for off-center average.",
    },
  },
  dpmo: {
    title: "Defects Per Million Opportunities",
    formula: "DPMO = defects / (units x opportunities per unit) x 1,000,000",
    calculation:
      "DPMO normalizes defect counts so parts with different numbers of possible defect locations can be compared fairly.",
    whenToUse:
      "Use DPMO when each unit has multiple possible defect opportunities and you need a normalized defect rate.",
    scenario:
      "A harness has three inspected terminals per unit. Seven terminal defects found across 100 harnesses becomes a DPMO rate that can be compared with other products.",
    inputHints: [
      "Count opportunities as the number of defined defect chances on one unit.",
      "Use the same defect definition every time or the trend will be misleading.",
      "Defects can exceed units when one unit has multiple issues.",
    ],
    resultHints: {
      "DPMO": "Defects normalized to one million opportunities.",
      "Yield": "Approximate percent of opportunities without defects.",
    },
  },
  takt: {
    title: "Takt Time",
    formula: "Takt time = available production time / customer demand",
    calculation:
      "Takt converts demand into the pace the process must sustain to meet customer need during the available production window.",
    whenToUse:
      "Use takt when staffing a line, balancing work content, or checking whether cycle time can meet demand.",
    scenario:
      "A packaging line has 420 available minutes and must ship 210 kits. Takt is 2 minutes per kit, so each station must be balanced around that pace.",
    inputHints: [
      "Available production minutes should reflect actual scheduled production time.",
      "Customer demand should match the same time period as available time.",
      "Compare takt to actual cycle time to find capacity gaps.",
    ],
    resultHints: {
      "Minutes / unit": "Required production pace in minutes per finished unit.",
      "Seconds / unit": "The same pace converted to seconds for line balancing.",
    },
  },
  yield: {
    title: "First Pass Yield and Rolled Throughput Yield",
    formula: "FPY = (units - defects) / units; RTY = product of step yields",
    calculation:
      "First pass yield estimates the percent accepted without defects at one point. Rolled throughput yield multiplies step yields to show the chance a unit passes the whole route without rework.",
    whenToUse:
      "Use yield when scrap or rework is hiding the true cost of a multi-step manufacturing process.",
    scenario:
      "A coated part passes prep, coating, and final inspection at 98%, 97.5%, and 99%. RTY shows the end-to-end pass rate before rework masks the loss.",
    inputHints: [
      "Step yields can be entered as percentages such as 98 or decimals such as 0.98.",
      "Defects should match the same population as units started.",
      "Use RTY when a unit must pass multiple operations.",
    ],
    resultHints: {
      "First pass yield": "Percent of started units not counted as defective at this point.",
      "Defects / unit": "Average defects per started unit.",
      "Step count": "Number of step yields included in RTY.",
      "Rolled throughput yield": "Probability a unit passes all listed steps without a defect.",
    },
  },
  little_law: {
    title: "Little's Law",
    formula: "WIP = throughput x lead time",
    calculation:
      "Any one missing value can be estimated when the other two are known: lead time, work in process, or throughput rate.",
    whenToUse:
      "Use Little's Law when queues, WIP, or lead time are the main constraint and you need a quick flow estimate.",
    scenario:
      "A fabrication queue has 120 orders in process and completes 30 orders per hour. Lead time is about 4 hours before an order clears the queue.",
    inputHints: [
      "Keep units consistent: if throughput is per hour, lead time is in hours.",
      "Use average WIP and average throughput for the same process window.",
      "Leave one field blank when you want the calculator to solve it.",
    ],
    resultHints: {
      "WIP": "Average work in process estimated or entered.",
      "Throughput / hour": "Average completed units per hour estimated or entered.",
      "Lead time hours": "Average time a unit spends in the process.",
    },
  },
  normal_curve: {
    title: "Normal Curve Probability",
    formula: "Z = (spec - mean) / standard deviation",
    calculation:
      "Specification limits are converted into z-scores, then the normal curve estimates the probability inside or outside those limits.",
    whenToUse:
      "Use this for a quick expected fallout estimate when measurements are approximately normal.",
    scenario:
      "A pin diameter averages 1.000 inch with 0.005 inch standard deviation and specs of 0.995 to 1.005. The normal curve estimates expected PPM outside spec.",
    inputHints: [
      "Mean, standard deviation, and specs must use the same unit of measure.",
      "Use only when the measurement distribution is reasonably normal.",
      "A very small standard deviation will make z-scores highly sensitive.",
    ],
    resultHints: {
      "Z lower": "Lower spec distance from the mean in standard deviations.",
      "Z upper": "Upper spec distance from the mean in standard deviations.",
      "Probability within": "Estimated percent of output inside both specs.",
      "Probability outside": "Estimated percent below LSL or above USL.",
      "PPM outside": "Estimated out-of-spec units per million produced.",
    },
  },
  control_limits: {
    title: "Control Limits",
    formula: "UCL = centerline + 3 x sigma; LCL = centerline - 3 x sigma",
    calculation:
      "The calculator estimates the process center and spread from the sample values, then places three-sigma limits around the centerline.",
    whenToUse:
      "Use control limits when monitoring stability and looking for special-cause variation over time.",
    scenario:
      "A press brake bend angle is checked every hour. Control limits help distinguish routine variation from a drift that needs reaction before parts fail inspection.",
    inputHints: [
      "Enter measurements in time order when using them for a control chart.",
      "Control limits are not customer specification limits.",
      "Investigate points outside limits or non-random patterns inside limits.",
    ],
    resultHints: {
      "N": "Number of values used.",
      "Centerline": "Average of the entered values.",
      "Sigma": "Sample standard deviation of the entered values.",
      "UCL": "Upper three-sigma control limit.",
      "LCL": "Lower three-sigma control limit.",
    },
  },
  custom: {
    title: "Custom Formula",
    formula: "Define inputs, then calculate outputs with expressions such as (good / total) * 100.",
    calculation:
      "Custom formulas evaluate named inputs with basic arithmetic and common math helpers such as min, max, sqrt, pow, abs, round, floor, and ceil.",
    whenToUse:
      "Use a custom formula when a shop-specific calculation is useful enough to save, review, approve, and reuse.",
    scenario:
      "A team can define a custom scrap cost formula from material cost, labor cost, and rejected count, then submit it for review before other users rely on it.",
    inputHints: [
      "Use simple variable names such as total_count, good_count, or cycle_seconds.",
      "Expressions can reference any input variable by name.",
      "Saved custom formulas are marked pending review until an authorized reviewer approves them.",
    ],
    resultHints: {
      "Status": "Approval state for the saved custom formula.",
      "Output": "Calculated result from the expression and current input values.",
    },
  },
};

function parsePositive(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegative(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null, digits = 2) {
  return value === null || !Number.isFinite(value) ? "N/A" : value.toFixed(digits);
}

function createBlankOeeRecording(id: string): OeeRecording {
  return {
    id,
    plannedMinutes: "480",
    runMinutes: "",
    idealCycleSeconds: "45",
    totalCount: "",
    goodCount: "",
  };
}

function calculateOee(row: OeeRecording) {
  const planned = parsePositive(row.plannedMinutes);
  const run = parsePositive(row.runMinutes);
  const idealCycle = parsePositive(row.idealCycleSeconds);
  const total = parseNonNegative(row.totalCount);
  const good = parseNonNegative(row.goodCount);
  const availability = planned && run ? Math.min(1, run / planned) : null;
  const performance =
    run && idealCycle && total !== null ? Math.min(1, (idealCycle * total) / (run * 60)) : null;
  const quality = total && good !== null ? Math.min(1, good / total) : null;
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

function calculateOeeAggregate(recordings: OeeRecording[]) {
  let plannedMinutes = 0;
  let runMinutes = 0;
  let idealRunSeconds = 0;
  let totalCount = 0;
  let goodCount = 0;
  let usableRecordings = 0;

  for (const recording of recordings) {
    const planned = parsePositive(recording.plannedMinutes);
    const run = parsePositive(recording.runMinutes);
    const idealCycle = parsePositive(recording.idealCycleSeconds);
    const total = parseNonNegative(recording.totalCount);
    const good = parseNonNegative(recording.goodCount);

    if (planned !== null) {
      plannedMinutes += planned;
    }
    if (run !== null) {
      runMinutes += run;
    }
    if (idealCycle !== null && total !== null) {
      idealRunSeconds += idealCycle * total;
    }
    if (total !== null) {
      totalCount += total;
    }
    if (good !== null) {
      goodCount += good;
    }
    if (planned !== null || run !== null || total !== null || good !== null) {
      usableRecordings += 1;
    }
  }

  const availability = plannedMinutes > 0 ? Math.min(1, runMinutes / plannedMinutes) : null;
  const performance = runMinutes > 0 ? Math.min(1, idealRunSeconds / (runMinutes * 60)) : null;
  const quality = totalCount > 0 ? Math.min(1, goodCount / totalCount) : null;
  const oee =
    availability !== null && performance !== null && quality !== null
      ? availability * performance * quality
      : null;

  return {
    count: usableRecordings,
    plannedMinutes,
    runMinutes,
    totalCount,
    goodCount,
    availability,
    performance,
    quality,
    oee,
  };
}

function parseMeasurementValues(value: string) {
  return value
    .split(/[\s,\t;|]+/)
    .map((entry) => Number.parseFloat(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function calculateCapability(values: number[], lslText: string, uslText: string) {
  if (values.length < 2) {
    return null;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);
  const lsl = lslText.trim() ? Number.parseFloat(lslText) : null;
  const usl = uslText.trim() ? Number.parseFloat(uslText) : null;
  const hasLsl = lsl !== null && Number.isFinite(lsl);
  const hasUsl = usl !== null && Number.isFinite(usl);
  const cp = hasLsl && hasUsl && sigma > 0 ? ((usl as number) - (lsl as number)) / (6 * sigma) : null;
  const cpu = hasUsl && sigma > 0 ? ((usl as number) - mean) / (3 * sigma) : null;
  const cpl = hasLsl && sigma > 0 ? (mean - (lsl as number)) / (3 * sigma) : null;
  const cpk = cpu !== null && cpl !== null ? Math.min(cpu, cpl) : cpu ?? cpl;

  return {
    count: values.length,
    mean,
    sigma,
    cp,
    cpk,
  };
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

function parseRateValues(value: string) {
  return value
    .split(/[\s,\t;|]+/)
    .map((entry) => Number.parseFloat(entry.trim()))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => (entry > 1 ? entry / 100 : entry))
    .filter((entry) => entry >= 0 && entry <= 1);
}

function calculateYield(unitsText: string, defectsText: string, stepYieldsText: string) {
  const units = parsePositive(unitsText);
  const defects = Number.parseFloat(defectsText);
  const stepYields = parseRateValues(stepYieldsText);
  const fpy = units && Number.isFinite(defects) ? Math.max(0, Math.min(1, (units - defects) / units)) : null;
  const dpu = units && Number.isFinite(defects) ? defects / units : null;
  const rty = stepYields.length
    ? stepYields.reduce((product, stepYield) => product * stepYield, 1)
    : fpy;

  return { fpy, dpu, rty, stepCount: stepYields.length };
}

function calculateLittleLaw(wipText: string, throughputText: string, leadTimeText: string) {
  const wip = parsePositive(wipText);
  const throughput = parsePositive(throughputText);
  const leadTime = parsePositive(leadTimeText);

  return {
    leadTime: wip && throughput ? wip / throughput : leadTime,
    wip: throughput && leadTime ? throughput * leadTime : wip,
    throughput: wip && leadTime ? wip / leadTime : throughput,
  };
}

function calculateNormalCurve(
  meanText: string,
  sigmaText: string,
  lowerText: string,
  upperText: string,
) {
  const mean = Number.parseFloat(meanText);
  const sigma = parsePositive(sigmaText);
  const lower = lowerText.trim() ? Number.parseFloat(lowerText) : null;
  const upper = upperText.trim() ? Number.parseFloat(upperText) : null;
  const hasLower = lower !== null && Number.isFinite(lower);
  const hasUpper = upper !== null && Number.isFinite(upper);
  const zLower = sigma && hasLower ? ((lower as number) - mean) / sigma : null;
  const zUpper = sigma && hasUpper ? ((upper as number) - mean) / sigma : null;
  const belowLower = zLower === null ? null : normalCdf(zLower);
  const aboveUpper = zUpper === null ? null : 1 - normalCdf(zUpper);
  const between =
    zLower !== null && zUpper !== null ? Math.max(0, normalCdf(zUpper) - normalCdf(zLower)) : null;

  return {
    zLower,
    zUpper,
    belowLower,
    aboveUpper,
    between,
    outside: belowLower !== null || aboveUpper !== null ? (belowLower ?? 0) + (aboveUpper ?? 0) : null,
  };
}

function calculateControlLimits(valuesText: string) {
  const values = parseMeasurementValues(valuesText);
  if (values.length < 2) {
    return null;
  }

  const centerline = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - centerline) ** 2, 0) /
    Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);

  return {
    count: values.length,
    centerline,
    sigma,
    ucl: centerline + 3 * sigma,
    lcl: centerline - 3 * sigma,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function csvEscape(value: string) {
  return value.includes(",") || value.includes('"') || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function normalizeImportedCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return String(value).trim();
}

async function readSpreadsheetRows(file: File) {
  const workbookParser = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = workbookParser.read(buffer, { type: "array", raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = workbookParser.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
  }) as unknown[][];

  return rows.map((row) => row.map(normalizeImportedCell));
}

function extractNumbersFromSpreadsheetRows(rows: string[][]) {
  return rows
    .flatMap((row) => row)
    .map((cell) => Number.parseFloat(cell.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function numberListToText(values: number[]) {
  return values.map((value) => String(value)).join("\n");
}

function cloneDefaultOeeGroups() {
  return DEFAULT_OEE_GROUPS.map((group) => ({
    ...group,
    recordings: group.recordings.map((recording) => ({ ...recording })),
  }));
}

function cloneDefaultCustomInputs() {
  return DEFAULT_CUSTOM_INPUTS.map((input) => ({ ...input }));
}

function cloneDefaultCustomOutputs() {
  return DEFAULT_CUSTOM_OUTPUTS.map((output) => ({ ...output }));
}

function normalizeCustomVariableName(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^[^a-zA-Z_]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return normalized || fallback;
}

function getCustomApprovalStatus(value: unknown): CustomFormulaApprovalStatus {
  return value === "approved" || value === "rejected" ? value : "pending_review";
}

function getSavedFormulaApprovalStatus(formula: SavedFormula | null | undefined) {
  if (!formula || formula.formulaType !== "custom" || !isRecord(formula.payload)) {
    return null;
  }

  const customFormula = isRecord(formula.payload.customFormula)
    ? formula.payload.customFormula
    : {};
  return getCustomApprovalStatus(customFormula.approvalStatus);
}

const CUSTOM_FORMULA_HELPERS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  log: Math.log,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sqrt: Math.sqrt,
};

function evaluateCustomExpression(
  expression: string,
  variables: Record<string, number>,
): { value: number | null; error: string | null } {
  const trimmedExpression = expression.trim();
  if (!trimmedExpression) {
    return { value: null, error: "Expression is required." };
  }

  if (!/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(trimmedExpression)) {
    return { value: null, error: "Only numbers, variables, math helpers, and operators are allowed." };
  }

  if (
    /\b(?:constructor|document|eval|function|globalThis|import|new|process|return|this|window)\b/i.test(
      trimmedExpression,
    )
  ) {
    return { value: null, error: "Expression contains a blocked keyword." };
  }

  try {
    const helperNames = Object.keys(CUSTOM_FORMULA_HELPERS);
    const variableNames = Object.keys(variables);
    const evaluator = new Function(
      ...helperNames,
      ...variableNames,
      `"use strict"; return (${trimmedExpression});`,
    );
    const result = evaluator(
      ...helperNames.map((name) => CUSTOM_FORMULA_HELPERS[name]),
      ...variableNames.map((name) => variables[name]),
    ) as unknown;
    const numericResult = typeof result === "number" ? result : Number(result);

    return Number.isFinite(numericResult)
      ? { value: numericResult, error: null }
      : { value: null, error: "Result is not a finite number." };
  } catch (caughtError) {
    return {
      value: null,
      error: caughtError instanceof Error ? caughtError.message : "Expression could not be evaluated.",
    };
  }
}

function calculateCustomFormulaResults(
  inputs: CustomFormulaInput[],
  outputs: CustomFormulaOutput[],
) {
  const variables: Record<string, number> = {};
  inputs.forEach((input, index) => {
    const variableName = normalizeCustomVariableName(input.name, `input_${index + 1}`);
    const parsedValue = Number.parseFloat(input.value);
    variables[variableName] = Number.isFinite(parsedValue) ? parsedValue : 0;
  });

  return outputs.map((output, index) => {
    const outputName = normalizeCustomVariableName(output.name, `output_${index + 1}`);
    const evaluated = evaluateCustomExpression(output.expression, variables);
    return {
      ...output,
      name: outputName,
      value: evaluated.value,
      error: evaluated.error,
    };
  });
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) =>
    normalizedCandidates.some((candidate) => normalizeHeader(header).includes(candidate)),
  );
}

function cellAt(row: string[], index: number) {
  return index >= 0 ? row[index]?.trim() ?? "" : "";
}

function rowsToOeeGroups(rows: string[][]) {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmptyRows.length === 0) {
    return [];
  }

  const headerIndex = nonEmptyRows.findIndex((row) =>
    row.some((cell) => {
      const header = normalizeHeader(cell);
      return (
        header.includes("operator") ||
        header.includes("planned") ||
        header.includes("runtime") ||
        header.includes("ideal") ||
        header.includes("totalcount") ||
        header.includes("goodcount")
      );
    }),
  );
  const headers = headerIndex >= 0 ? nonEmptyRows[headerIndex] : [];
  const dataRows = nonEmptyRows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  const operatorColumn = headerIndex >= 0 ? findColumn(headers, ["operator", "group", "name"]) : 0;
  const plannedColumn = headerIndex >= 0 ? findColumn(headers, ["planned", "plannedmin"]) : 1;
  const runColumn = headerIndex >= 0 ? findColumn(headers, ["runmin", "runtime", "run"]) : 2;
  const idealColumn = headerIndex >= 0 ? findColumn(headers, ["idealsec", "idealcycle", "cycle"]) : 3;
  const totalColumn = headerIndex >= 0 ? findColumn(headers, ["totalcount", "total"]) : 4;
  const goodColumn = headerIndex >= 0 ? findColumn(headers, ["goodcount", "good"]) : 5;
  const groups = new Map<string, OeeOperatorGroup>();

  for (const [rowIndex, row] of dataRows.entries()) {
    const operator =
      cellAt(row, operatorColumn) || `Operator ${Math.min(groups.size + 1, rowIndex + 1)}`;
    const recording: OeeRecording = {
      id: `imported-study-${rowIndex + 1}-${Date.now()}`,
      plannedMinutes: cellAt(row, plannedColumn),
      runMinutes: cellAt(row, runColumn),
      idealCycleSeconds: cellAt(row, idealColumn),
      totalCount: cellAt(row, totalColumn),
      goodCount: cellAt(row, goodColumn),
    };

    if (
      !recording.plannedMinutes &&
      !recording.runMinutes &&
      !recording.idealCycleSeconds &&
      !recording.totalCount &&
      !recording.goodCount
    ) {
      continue;
    }

    const existingGroup = groups.get(operator);
    if (existingGroup) {
      existingGroup.recordings.push(recording);
    } else {
      groups.set(operator, {
        id: `imported-group-${groups.size + 1}-${Date.now()}`,
        operator,
        recordings: [recording],
      });
    }
  }

  return Array.from(groups.values());
}

interface FormulaLabClientProps {
  canApproveCustomFormulas?: boolean;
}

export function FormulaLabClient({ canApproveCustomFormulas = false }: FormulaLabClientProps) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [activeTab, setActiveTab] = useState<FormulaTab>("oee");
  const [oeeGroups, setOeeGroups] = useState<OeeOperatorGroup[]>(() => cloneDefaultOeeGroups());
  const [capabilityData, setCapabilityData] = useState("10.01\n10.03\n9.99\n10.02\n10.00\n10.04");
  const [lsl, setLsl] = useState("9.95");
  const [usl, setUsl] = useState("10.05");
  const [dpmoDefects, setDpmoDefects] = useState("7");
  const [dpmoUnits, setDpmoUnits] = useState("100");
  const [dpmoOpps, setDpmoOpps] = useState("3");
  const [taktMinutes, setTaktMinutes] = useState("420");
  const [taktDemand, setTaktDemand] = useState("210");
  const [yieldUnits, setYieldUnits] = useState("1000");
  const [yieldDefects, setYieldDefects] = useState("24");
  const [yieldStepYields, setYieldStepYields] = useState("98\n97.5\n99");
  const [littleWip, setLittleWip] = useState("120");
  const [littleThroughput, setLittleThroughput] = useState("30");
  const [littleLeadTime, setLittleLeadTime] = useState("");
  const [normalMean, setNormalMean] = useState("10");
  const [normalSigma, setNormalSigma] = useState("0.05");
  const [normalLower, setNormalLower] = useState("9.95");
  const [normalUpper, setNormalUpper] = useState("10.05");
  const [controlLimitValues, setControlLimitValues] = useState("50\n49\n51\n48\n52\n50");
  const [customDescription, setCustomDescription] = useState("Shop-specific calculation");
  const [customInputs, setCustomInputs] = useState<CustomFormulaInput[]>(() =>
    cloneDefaultCustomInputs(),
  );
  const [customOutputs, setCustomOutputs] = useState<CustomFormulaOutput[]>(() =>
    cloneDefaultCustomOutputs(),
  );
  const [formulaName, setFormulaName] = useState("OEE calculator");
  const [savedFormulas, setSavedFormulas] = useState<SavedFormula[]>([]);
  const [selectedFormulaId, setSelectedFormulaId] = useState("");
  const [savedFormulaFilter, setSavedFormulaFilter] = useState<
    "all" | "system" | "user" | "pending"
  >("all");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [printRequestedAt, setPrintRequestedAt] = useState<number | null>(null);

  const oeeGroupResults = useMemo(
    () =>
      oeeGroups.map((group) => ({
        group,
        recordings: group.recordings.map((recording) => ({
          recording,
          stats: calculateOee(recording),
        })),
        aggregate: calculateOeeAggregate(group.recordings),
      })),
    [oeeGroups],
  );
  const oeeTotal = useMemo(
    () => calculateOeeAggregate(oeeGroups.flatMap((group) => group.recordings)),
    [oeeGroups],
  );
  const capabilityValues = useMemo(() => parseMeasurementValues(capabilityData), [capabilityData]);
  const controlLimitValueList = useMemo(
    () => parseMeasurementValues(controlLimitValues),
    [controlLimitValues],
  );
  const capabilityStats = useMemo(
    () => calculateCapability(capabilityValues, lsl, usl),
    [capabilityValues, lsl, usl],
  );
  const dpmoStats = useMemo(() => {
    const defects = parsePositive(dpmoDefects);
    const units = parsePositive(dpmoUnits);
    const opportunities = parsePositive(dpmoOpps);
    if (!defects || !units || !opportunities) {
      return { dpmo: null, yieldPercent: null };
    }

    const dpmo = (defects / (units * opportunities)) * 1_000_000;
    return {
      dpmo,
      yieldPercent: Math.max(0, 100 - dpmo / 10_000),
    };
  }, [dpmoDefects, dpmoOpps, dpmoUnits]);
  const taktStats = useMemo(() => {
    const minutes = parsePositive(taktMinutes);
    const demand = parsePositive(taktDemand);
    const minutesPerUnit = minutes && demand ? minutes / demand : null;
    return {
      minutesPerUnit,
      secondsPerUnit: minutesPerUnit === null ? null : minutesPerUnit * 60,
    };
  }, [taktDemand, taktMinutes]);
  const yieldStats = useMemo(
    () => calculateYield(yieldUnits, yieldDefects, yieldStepYields),
    [yieldDefects, yieldStepYields, yieldUnits],
  );
  const littleLawStats = useMemo(
    () => calculateLittleLaw(littleWip, littleThroughput, littleLeadTime),
    [littleLeadTime, littleThroughput, littleWip],
  );
  const normalCurveStats = useMemo(
    () => calculateNormalCurve(normalMean, normalSigma, normalLower, normalUpper),
    [normalLower, normalMean, normalSigma, normalUpper],
  );
  const controlLimitStats = useMemo(
    () => calculateControlLimits(controlLimitValues),
    [controlLimitValues],
  );
  const customFormulaResults = useMemo(
    () => calculateCustomFormulaResults(customInputs, customOutputs),
    [customInputs, customOutputs],
  );
  const selectedFormula = useMemo(
    () => savedFormulas.find((formula) => formula.id === selectedFormulaId) ?? null,
    [savedFormulas, selectedFormulaId],
  );
  const selectedCustomApprovalStatus = getSavedFormulaApprovalStatus(selectedFormula);
  const filteredSavedFormulas = useMemo(
    () =>
      savedFormulas.filter((formula) => {
        if (savedFormulaFilter === "system") {
          return formula.formulaType !== "custom";
        }

        if (savedFormulaFilter === "user") {
          return formula.formulaType === "custom";
        }

        if (savedFormulaFilter === "pending") {
          return getSavedFormulaApprovalStatus(formula) === "pending_review";
        }

        return true;
      }),
    [savedFormulaFilter, savedFormulas],
  );

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return session.access_token;
  }

  async function loadSavedFormulas() {
    setLibraryBusy(true);
    setLibraryError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(
        `/api/process-maps/formulas${canApproveCustomFormulas ? "?includeAll=true" : ""}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as FormulaApiResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load saved formulas.");
      }

      setSavedFormulas(payload.formulas ?? []);
    } catch (caughtError) {
      setLibraryError(
        caughtError instanceof Error ? caughtError.message : "Unable to load saved formulas.",
      );
    } finally {
      setLibraryBusy(false);
    }
  }

  useEffect(() => {
    void loadSavedFormulas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (printRequestedAt === null) {
      return;
    }

    const printTimer = window.setTimeout(() => {
      window.print();
    }, 80);

    return () => window.clearTimeout(printTimer);
  }, [printRequestedAt]);

  function updateOeeGroup(groupId: string, operator: string) {
    setOeeGroups((current) =>
      current.map((group) => (group.id === groupId ? { ...group, operator } : group)),
    );
  }

  function updateOeeRecording(
    groupId: string,
    recordingId: string,
    key: keyof OeeRecording,
    value: string,
  ) {
    setOeeGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              recordings: group.recordings.map((recording) =>
                recording.id === recordingId ? { ...recording, [key]: value } : recording,
              ),
            }
          : group,
      ),
    );
  }

  function addOeeGroup() {
    setOeeGroups((current) => [
      ...current,
      {
        id: `operator-group-${Date.now()}`,
        operator: `Operator ${current.length + 1}`,
        recordings: [createBlankOeeRecording(`operator-study-${Date.now()}`)],
      },
    ]);
  }

  function addOeeRecording(groupId: string) {
    setOeeGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              recordings: [
                ...group.recordings,
                createBlankOeeRecording(`${group.id}-study-${Date.now()}`),
              ],
            }
          : group,
      ),
    );
  }

  function removeOeeRecording(groupId: string, recordingId: string) {
    setOeeGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              recordings:
                group.recordings.length <= 1
                  ? group.recordings
                  : group.recordings.filter((recording) => recording.id !== recordingId),
            }
          : group,
      ),
    );
  }

  function removeOeeGroup(groupId: string) {
    setOeeGroups((current) =>
      current.length <= 1 ? current : current.filter((group) => group.id !== groupId),
    );
  }

  function updateCustomInput(
    inputId: string,
    key: keyof Omit<CustomFormulaInput, "id">,
    value: string,
  ) {
    setCustomInputs((current) =>
      current.map((input) =>
        input.id === inputId
          ? {
              ...input,
              [key]: key === "name" ? normalizeCustomVariableName(value, input.name) : value,
            }
          : input,
      ),
    );
  }

  function updateCustomOutput(
    outputId: string,
    key: keyof Omit<CustomFormulaOutput, "id">,
    value: string,
  ) {
    setCustomOutputs((current) =>
      current.map((output) =>
        output.id === outputId
          ? {
              ...output,
              [key]: key === "name" ? normalizeCustomVariableName(value, output.name) : value,
            }
          : output,
      ),
    );
  }

  function addCustomInput() {
    setCustomInputs((current) => [
      ...current,
      {
        id: `custom-input-${Date.now()}`,
        name: `input_${current.length + 1}`,
        label: `Input ${current.length + 1}`,
        value: "",
      },
    ]);
  }

  function addCustomOutput() {
    setCustomOutputs((current) => [
      ...current,
      {
        id: `custom-output-${Date.now()}`,
        name: `output_${current.length + 1}`,
        label: `Output ${current.length + 1}`,
        expression: "",
      },
    ]);
  }

  function removeCustomInput(inputId: string) {
    setCustomInputs((current) =>
      current.length <= 1 ? current : current.filter((input) => input.id !== inputId),
    );
  }

  function removeCustomOutput(outputId: string) {
    setCustomOutputs((current) =>
      current.length <= 1 ? current : current.filter((output) => output.id !== outputId),
    );
  }

  function buildFormulaPayload(customApprovalStatus: CustomFormulaApprovalStatus = "pending_review") {
    return {
      version: 2,
      oeeGroups,
      capabilityData,
      lsl,
      usl,
      dpmoDefects,
      dpmoUnits,
      dpmoOpps,
      taktMinutes,
      taktDemand,
      yieldUnits,
      yieldDefects,
      yieldStepYields,
      littleWip,
      littleThroughput,
      littleLeadTime,
      normalMean,
      normalSigma,
      normalLower,
      normalUpper,
      controlLimitValues,
      customFormula: {
        description: customDescription.trim(),
        inputs: customInputs.map((input, index) => ({
          ...input,
          name: normalizeCustomVariableName(input.name, `input_${index + 1}`),
        })),
        outputs: customOutputs.map((output, index) => ({
          ...output,
          name: normalizeCustomVariableName(output.name, `output_${index + 1}`),
        })),
        approvalStatus: customApprovalStatus,
      },
    };
  }

  function applySavedFormula(formula: SavedFormula) {
    const payload = isRecord(formula.payload) ? formula.payload : {};
    setSelectedFormulaId(formula.id);
    setFormulaName(formula.name);
    setActiveTab(formula.formulaType);

    if (Array.isArray(payload.oeeGroups)) {
      const nextGroups = payload.oeeGroups
        .filter(isRecord)
        .map((group, index) => ({
          id: typeof group.id === "string" ? group.id : `operator-${index + 1}`,
          operator: typeof group.operator === "string" ? group.operator : `Operator ${index + 1}`,
          recordings: Array.isArray(group.recordings)
            ? group.recordings.filter(isRecord).map((recording, recordingIndex) => ({
                id:
                  typeof recording.id === "string"
                    ? recording.id
                    : `operator-${index + 1}-study-${recordingIndex + 1}`,
                plannedMinutes:
                  typeof recording.plannedMinutes === "string" ? recording.plannedMinutes : "",
                runMinutes: typeof recording.runMinutes === "string" ? recording.runMinutes : "",
                idealCycleSeconds:
                  typeof recording.idealCycleSeconds === "string"
                    ? recording.idealCycleSeconds
                    : "",
                totalCount: typeof recording.totalCount === "string" ? recording.totalCount : "",
                goodCount: typeof recording.goodCount === "string" ? recording.goodCount : "",
              }))
            : [],
        }));
      if (nextGroups.length > 0) {
        setOeeGroups(
          nextGroups.map((group) => ({
            ...group,
            recordings:
              group.recordings.length > 0
                ? group.recordings
                : [createBlankOeeRecording(`${group.id}-study-1`)],
          })),
        );
      }
    } else if (Array.isArray(payload.oeeRows)) {
      const legacyRows = payload.oeeRows
        .filter(isRecord)
        .map((row, index) => ({
          id: typeof row.id === "string" ? row.id : `operator-${index + 1}`,
          operator: typeof row.operator === "string" ? row.operator : `Operator ${index + 1}`,
          recordings: [
            {
              id: `${typeof row.id === "string" ? row.id : `operator-${index + 1}`}-study-1`,
              plannedMinutes: typeof row.plannedMinutes === "string" ? row.plannedMinutes : "",
              runMinutes: typeof row.runMinutes === "string" ? row.runMinutes : "",
              idealCycleSeconds:
                typeof row.idealCycleSeconds === "string" ? row.idealCycleSeconds : "",
              totalCount: typeof row.totalCount === "string" ? row.totalCount : "",
              goodCount: typeof row.goodCount === "string" ? row.goodCount : "",
            },
          ],
        }));
      if (legacyRows.length > 0) {
        setOeeGroups(legacyRows);
      }
    }

    if (typeof payload.capabilityData === "string") setCapabilityData(payload.capabilityData);
    if (typeof payload.lsl === "string") setLsl(payload.lsl);
    if (typeof payload.usl === "string") setUsl(payload.usl);
    if (typeof payload.dpmoDefects === "string") setDpmoDefects(payload.dpmoDefects);
    if (typeof payload.dpmoUnits === "string") setDpmoUnits(payload.dpmoUnits);
    if (typeof payload.dpmoOpps === "string") setDpmoOpps(payload.dpmoOpps);
    if (typeof payload.taktMinutes === "string") setTaktMinutes(payload.taktMinutes);
    if (typeof payload.taktDemand === "string") setTaktDemand(payload.taktDemand);
    if (typeof payload.yieldUnits === "string") setYieldUnits(payload.yieldUnits);
    if (typeof payload.yieldDefects === "string") setYieldDefects(payload.yieldDefects);
    if (typeof payload.yieldStepYields === "string") setYieldStepYields(payload.yieldStepYields);
    if (typeof payload.littleWip === "string") setLittleWip(payload.littleWip);
    if (typeof payload.littleThroughput === "string") setLittleThroughput(payload.littleThroughput);
    if (typeof payload.littleLeadTime === "string") setLittleLeadTime(payload.littleLeadTime);
    if (typeof payload.normalMean === "string") setNormalMean(payload.normalMean);
    if (typeof payload.normalSigma === "string") setNormalSigma(payload.normalSigma);
    if (typeof payload.normalLower === "string") setNormalLower(payload.normalLower);
    if (typeof payload.normalUpper === "string") setNormalUpper(payload.normalUpper);
    if (typeof payload.controlLimitValues === "string") {
      setControlLimitValues(payload.controlLimitValues);
    }
    if (isRecord(payload.customFormula)) {
      const customFormula = payload.customFormula;
      if (typeof customFormula.description === "string") {
        setCustomDescription(customFormula.description);
      }
      if (Array.isArray(customFormula.inputs)) {
        const nextInputs = customFormula.inputs.filter(isRecord).map((input, index) => ({
          id: typeof input.id === "string" ? input.id : `custom-input-${index + 1}`,
          name:
            typeof input.name === "string"
              ? normalizeCustomVariableName(input.name, `input_${index + 1}`)
              : `input_${index + 1}`,
          label: typeof input.label === "string" ? input.label : `Input ${index + 1}`,
          value: typeof input.value === "string" ? input.value : "",
        }));
        setCustomInputs(nextInputs.length > 0 ? nextInputs : cloneDefaultCustomInputs());
      }
      if (Array.isArray(customFormula.outputs)) {
        const nextOutputs = customFormula.outputs.filter(isRecord).map((output, index) => ({
          id: typeof output.id === "string" ? output.id : `custom-output-${index + 1}`,
          name:
            typeof output.name === "string"
              ? normalizeCustomVariableName(output.name, `output_${index + 1}`)
              : `output_${index + 1}`,
          label: typeof output.label === "string" ? output.label : `Output ${index + 1}`,
          expression: typeof output.expression === "string" ? output.expression : "",
        }));
        setCustomOutputs(nextOutputs.length > 0 ? nextOutputs : cloneDefaultCustomOutputs());
      }
    }
    setLibraryMessage(`Loaded ${formula.name}.`);
  }

  async function saveFormula() {
    const normalizedName = formulaName.trim();
    if (!normalizedName) {
      setLibraryError("Formula name is required.");
      return;
    }

    setLibraryBusy(true);
    setLibraryError(null);
    setLibraryMessage(null);

    try {
      const token = await getAccessToken();
      const existingId = selectedFormulaId.trim();
      const response = await fetch(
        existingId ? `/api/process-maps/formulas/${existingId}` : "/api/process-maps/formulas",
        {
          method: existingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: normalizedName,
            formulaType: activeTab,
            payload: buildFormulaPayload(
              activeTab === "custom"
                ? "pending_review"
                : getSavedFormulaApprovalStatus(selectedFormula) ?? "approved",
            ),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as FormulaApiResponse;

      if (!response.ok || !payload.formula) {
        throw new Error(payload.error ?? "Unable to save formula.");
      }

      setSelectedFormulaId(payload.formula.id);
      setFormulaName(payload.formula.name);
      setSavedFormulas((current) => {
        const others = current.filter((entry) => entry.id !== payload.formula?.id);
        return [payload.formula as SavedFormula, ...others];
      });
      setLibraryMessage(
        activeTab === "custom" ? "Custom formula saved for approval." : "Formula saved.",
      );
    } catch (caughtError) {
      setLibraryError(caughtError instanceof Error ? caughtError.message : "Unable to save formula.");
    } finally {
      setLibraryBusy(false);
    }
  }

  async function updateCustomFormulaApproval(status: CustomFormulaApprovalStatus) {
    const existingId = selectedFormulaId.trim();
    if (!existingId || activeTab !== "custom") {
      return;
    }

    setLibraryBusy(true);
    setLibraryError(null);
    setLibraryMessage(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/process-maps/formulas/${existingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formulaName.trim() || DEFAULT_FORMULA_NAMES.custom,
          formulaType: "custom",
          payload: buildFormulaPayload(status),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as FormulaApiResponse;

      if (!response.ok || !payload.formula) {
        throw new Error(payload.error ?? "Unable to update formula approval.");
      }

      setSavedFormulas((current) => {
        const others = current.filter((entry) => entry.id !== payload.formula?.id);
        return [payload.formula as SavedFormula, ...others];
      });
      setLibraryMessage(status === "approved" ? "Custom formula approved." : "Custom formula rejected.");
    } catch (caughtError) {
      setLibraryError(
        caughtError instanceof Error ? caughtError.message : "Unable to update formula approval.",
      );
    } finally {
      setLibraryBusy(false);
    }
  }

  async function deleteSelectedFormula() {
    const existingId = selectedFormulaId.trim();
    if (!existingId) {
      return;
    }

    setLibraryBusy(true);
    setLibraryError(null);
    setLibraryMessage(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/process-maps/formulas/${existingId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as FormulaApiResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete formula.");
      }

      setSavedFormulas((current) => current.filter((entry) => entry.id !== existingId));
      setSelectedFormulaId("");
      setFormulaName(DEFAULT_FORMULA_NAMES[activeTab]);
      setLibraryMessage("Formula deleted.");
    } catch (caughtError) {
      setLibraryError(
        caughtError instanceof Error ? caughtError.message : "Unable to delete formula.",
      );
    } finally {
      setLibraryBusy(false);
    }
  }

  function resetFormulaInputs(tab: FormulaTab) {
    if (tab === "oee") {
      setOeeGroups(cloneDefaultOeeGroups());
    } else if (tab === "capability") {
      setCapabilityData("10.01\n10.03\n9.99\n10.02\n10.00\n10.04");
      setLsl("9.95");
      setUsl("10.05");
    } else if (tab === "dpmo") {
      setDpmoDefects("7");
      setDpmoUnits("100");
      setDpmoOpps("3");
    } else if (tab === "takt") {
      setTaktMinutes("420");
      setTaktDemand("210");
    } else if (tab === "yield") {
      setYieldUnits("1000");
      setYieldDefects("24");
      setYieldStepYields("98\n97.5\n99");
    } else if (tab === "little_law") {
      setLittleWip("120");
      setLittleThroughput("30");
      setLittleLeadTime("");
    } else if (tab === "normal_curve") {
      setNormalMean("10");
      setNormalSigma("0.05");
      setNormalLower("9.95");
      setNormalUpper("10.05");
    } else if (tab === "control_limits") {
      setControlLimitValues("50\n49\n51\n48\n52\n50");
    } else {
      setCustomDescription("Shop-specific calculation");
      setCustomInputs(cloneDefaultCustomInputs());
      setCustomOutputs(cloneDefaultCustomOutputs());
    }
  }

  function startNewFormula(tab: FormulaTab = activeTab) {
    setSelectedFormulaId("");
    setFormulaName(DEFAULT_FORMULA_NAMES[tab]);
    setActiveTab(tab);
    resetFormulaInputs(tab);
    setLibraryMessage(`New ${DEFAULT_FORMULA_NAMES[tab]} started.`);
    setLibraryError(null);
  }

  function selectFormulaTab(tab: FormulaTab) {
    setActiveTab(tab);
    if (!selectedFormulaId) {
      setFormulaName(DEFAULT_FORMULA_NAMES[tab]);
    }
  }

  function exportOeeCsv() {
    const rows = [
      [
        "operator",
        "recording",
        "planned_minutes",
        "run_minutes",
        "ideal_cycle_seconds",
        "total_count",
        "good_count",
        "availability_percent",
        "performance_percent",
        "quality_percent",
        "oee_percent",
      ],
      ...oeeGroupResults.flatMap(({ group, recordings }) =>
        recordings.map(({ recording, stats }, index) => [
          group.operator,
          String(index + 1),
          recording.plannedMinutes,
          recording.runMinutes,
          recording.idealCycleSeconds,
          recording.totalCount,
          recording.goodCount,
          formatNumber(stats.availability === null ? null : stats.availability * 100),
          formatNumber(stats.performance === null ? null : stats.performance * 100),
          formatNumber(stats.quality === null ? null : stats.quality * 100),
          formatNumber(stats.oee === null ? null : stats.oee * 100),
        ]),
      ),
      ...oeeGroupResults.map(({ group, aggregate }) => [
        `${group.operator} total`,
        "",
        formatNumber(aggregate.plannedMinutes, 2),
        formatNumber(aggregate.runMinutes, 2),
        "",
        formatNumber(aggregate.totalCount, 0),
        formatNumber(aggregate.goodCount, 0),
        formatNumber(aggregate.availability === null ? null : aggregate.availability * 100),
        formatNumber(aggregate.performance === null ? null : aggregate.performance * 100),
        formatNumber(aggregate.quality === null ? null : aggregate.quality * 100),
        formatNumber(aggregate.oee === null ? null : aggregate.oee * 100),
      ]),
      [
        "All operators total",
        "",
        formatNumber(oeeTotal.plannedMinutes, 2),
        formatNumber(oeeTotal.runMinutes, 2),
        "",
        formatNumber(oeeTotal.totalCount, 0),
        formatNumber(oeeTotal.goodCount, 0),
        formatNumber(oeeTotal.availability === null ? null : oeeTotal.availability * 100),
        formatNumber(oeeTotal.performance === null ? null : oeeTotal.performance * 100),
        formatNumber(oeeTotal.quality === null ? null : oeeTotal.quality * 100),
        formatNumber(oeeTotal.oee === null ? null : oeeTotal.oee * 100),
      ],
    ];
    const csv = rows
      .map((row) => row.map((cell) => csvEscape(String(cell ?? ""))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "oee-formula-results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function getActiveFormulaRows(): string[][] {
    if (activeTab === "oee") {
      return [
        [
          "Operator",
          "Recording",
          "Planned min",
          "Run min",
          "Ideal sec",
          "Total",
          "Good",
          "Availability",
          "Performance",
          "Quality",
          "OEE",
        ],
        ...oeeGroupResults.flatMap(({ group, recordings }) =>
          recordings.map(({ recording, stats }, index) => [
            group.operator,
            String(index + 1),
            recording.plannedMinutes,
            recording.runMinutes,
            recording.idealCycleSeconds,
            recording.totalCount,
            recording.goodCount,
            formatPercent(stats.availability),
            formatPercent(stats.performance),
            formatPercent(stats.quality),
            formatPercent(stats.oee),
          ]),
        ),
        ...oeeGroupResults.map(({ group, aggregate }) => [
          `${group.operator} total`,
          "",
          formatNumber(aggregate.plannedMinutes, 2),
          formatNumber(aggregate.runMinutes, 2),
          "",
          formatNumber(aggregate.totalCount, 0),
          formatNumber(aggregate.goodCount, 0),
          formatPercent(aggregate.availability),
          formatPercent(aggregate.performance),
          formatPercent(aggregate.quality),
          formatPercent(aggregate.oee),
        ]),
        [
          "All operators total",
          "",
          formatNumber(oeeTotal.plannedMinutes, 2),
          formatNumber(oeeTotal.runMinutes, 2),
          "",
          formatNumber(oeeTotal.totalCount, 0),
          formatNumber(oeeTotal.goodCount, 0),
          formatPercent(oeeTotal.availability),
          formatPercent(oeeTotal.performance),
          formatPercent(oeeTotal.quality),
          formatPercent(oeeTotal.oee),
        ],
      ];
    }

    if (activeTab === "capability") {
      return [
        ["Metric", "Value"],
        ["LSL", lsl],
        ["USL", usl],
        ["N", String(capabilityStats?.count ?? 0)],
        ["Mean", formatNumber(capabilityStats?.mean ?? null, 3)],
        ["Sigma", formatNumber(capabilityStats?.sigma ?? null, 3)],
        ["Cp", formatNumber(capabilityStats?.cp ?? null, 3)],
        ["Cpk", formatNumber(capabilityStats?.cpk ?? null, 3)],
        ["Measurements", capabilityData.replace(/\s+/g, " ").trim()],
      ];
    }

    if (activeTab === "dpmo") {
      return [
        ["Metric", "Value"],
        ["Defects", dpmoDefects],
        ["Units", dpmoUnits],
        ["Opportunities per unit", dpmoOpps],
        ["DPMO", formatNumber(dpmoStats.dpmo, 0)],
        ["Yield", dpmoStats.yieldPercent === null ? "N/A" : `${formatNumber(dpmoStats.yieldPercent, 2)}%`],
      ];
    }

    if (activeTab === "takt") {
      return [
        ["Metric", "Value"],
        ["Available production minutes", taktMinutes],
        ["Customer demand", taktDemand],
        ["Minutes / unit", formatNumber(taktStats.minutesPerUnit, 3)],
        ["Seconds / unit", formatNumber(taktStats.secondsPerUnit, 1)],
      ];
    }

    if (activeTab === "yield") {
      return [
        ["Metric", "Value"],
        ["Units started", yieldUnits],
        ["Defects", yieldDefects],
        ["First pass yield", formatPercent(yieldStats.fpy)],
        ["Defects per unit", formatNumber(yieldStats.dpu, 4)],
        ["Step count", String(yieldStats.stepCount)],
        ["Rolled throughput yield", formatPercent(yieldStats.rty)],
      ];
    }

    if (activeTab === "little_law") {
      return [
        ["Metric", "Value"],
        ["WIP", formatNumber(littleLawStats.wip, 3)],
        ["Throughput / hour", formatNumber(littleLawStats.throughput, 3)],
        ["Lead time hours", formatNumber(littleLawStats.leadTime, 3)],
      ];
    }

    if (activeTab === "normal_curve") {
      return [
        ["Metric", "Value"],
        ["Mean", normalMean],
        ["Sigma", normalSigma],
        ["Lower spec", normalLower],
        ["Upper spec", normalUpper],
        ["Z lower", formatNumber(normalCurveStats.zLower, 3)],
        ["Z upper", formatNumber(normalCurveStats.zUpper, 3)],
        ["Probability within", formatPercent(normalCurveStats.between)],
        ["Probability outside", formatPercent(normalCurveStats.outside)],
        [
          "PPM outside",
          normalCurveStats.outside === null
            ? "N/A"
            : formatNumber(normalCurveStats.outside * 1_000_000, 0),
        ],
      ];
    }

    if (activeTab === "custom") {
      return [
        ["Metric", "Value"],
        ["Description", customDescription.trim() || "N/A"],
        ["Approval status", selectedCustomApprovalStatus ?? "pending_review"],
        ...customInputs.map((input, index) => [
          input.label.trim() || `Input ${index + 1}`,
          input.value.trim() || "0",
        ]),
        ...customFormulaResults.map((output, index) => [
          output.label.trim() || `Output ${index + 1}`,
          output.error ?? formatNumber(output.value, 4),
        ]),
      ];
    }

    return [
      ["Metric", "Value"],
      ["N", String(controlLimitStats?.count ?? 0)],
      ["Centerline", formatNumber(controlLimitStats?.centerline ?? null, 3)],
      ["Sigma", formatNumber(controlLimitStats?.sigma ?? null, 3)],
      ["UCL", formatNumber(controlLimitStats?.ucl ?? null, 3)],
      ["LCL", formatNumber(controlLimitStats?.lcl ?? null, 3)],
      ["Measurements", controlLimitValues.replace(/\s+/g, " ").trim()],
    ];
  }

  function exportActiveFormulaCsv() {
    const csv = getActiveFormulaRows()
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${formulaName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || activeTab}-formula.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printActiveFormula() {
    setLibraryError(null);
    setPrintRequestedAt(Date.now());
  }

  function renderActiveFormulaChart() {
    if (activeTab === "oee") {
      return <OeeSummaryChart groupResults={oeeGroupResults} total={oeeTotal} />;
    }

    if (activeTab === "capability") {
      return (
        <CapabilityChart
          values={capabilityValues}
          stats={capabilityStats}
          lslText={lsl}
          uslText={usl}
        />
      );
    }

    if (activeTab === "dpmo") {
      return (
        <MetricBarChart
          title="DPMO View"
          bars={[
            { label: "DPMO", value: dpmoStats.dpmo, suffix: "" },
            { label: "Yield", value: dpmoStats.yieldPercent, suffix: "%" },
          ]}
        />
      );
    }

    if (activeTab === "takt") {
      return (
        <MetricBarChart
          title="Takt View"
          bars={[
            { label: "Minutes / unit", value: taktStats.minutesPerUnit, suffix: " min" },
            { label: "Seconds / unit", value: taktStats.secondsPerUnit, suffix: " sec" },
          ]}
        />
      );
    }

    if (activeTab === "yield") {
      return (
        <MetricBarChart
          title="Yield View"
          bars={[
            { label: "First pass yield", value: yieldStats.fpy === null ? null : yieldStats.fpy * 100, suffix: "%" },
            { label: "RTY", value: yieldStats.rty === null ? null : yieldStats.rty * 100, suffix: "%" },
          ]}
        />
      );
    }

    if (activeTab === "little_law") {
      return (
        <MetricBarChart
          title="Flow View"
          bars={[
            { label: "WIP", value: littleLawStats.wip, suffix: "" },
            { label: "Throughput / hour", value: littleLawStats.throughput, suffix: "" },
            { label: "Lead time hours", value: littleLawStats.leadTime, suffix: " hr" },
          ]}
        />
      );
    }

    if (activeTab === "normal_curve") {
      return (
        <NormalCurveChart
          meanText={normalMean}
          sigmaText={normalSigma}
          lowerText={normalLower}
          upperText={normalUpper}
          stats={normalCurveStats}
        />
      );
    }

    if (activeTab === "custom") {
      return <CustomFormulaChart results={customFormulaResults} />;
    }

    return <ControlLimitChart values={controlLimitValueList} stats={controlLimitStats} />;
  }

  return (
    <div className="grid gap-5">
      <style>{`
        @media screen {
          .formula-print-page {
            display: none;
          }
        }

        @media print {
          body {
            background: #ffffff !important;
          }

          body * {
            visibility: hidden !important;
          }

          .formula-print-page,
          .formula-print-page * {
            visibility: visible !important;
          }

          .formula-print-page {
            display: block !important;
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            min-height: 100%;
            padding: 14mm;
            background: #ffffff !important;
            color: #0f172a !important;
          }

          .formula-print-page section,
          .formula-print-page aside,
          .formula-print-page div {
            box-shadow: none !important;
          }

          .formula-print-page svg {
            max-width: 100%;
            break-inside: avoid;
          }
        }
      `}</style>
      <FormulaPrintPage
        title={formulaName.trim() || DEFAULT_FORMULA_NAMES[activeTab]}
        formulaType={activeTab}
        printedAt={new Date(printRequestedAt ?? Date.now())}
        rows={getActiveFormulaRows()}
      >
        {renderActiveFormulaChart()}
      </FormulaPrintPage>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Formula Tools
          </h1>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Use quick calculators for OEE, capability, defects, takt, yield, flow, normal
            probability, and control-limit checks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={printActiveFormula}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Printer size={16} />
            Print data
          </button>
          <button
            type="button"
            onClick={exportActiveFormulaCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Download size={16} />
            CSV
          </button>
          <Link
            href="/process-maps"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            Back to process maps
          </Link>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Formula name</span>
            <input
              value={formulaName}
              onChange={(event) => setFormulaName(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => void saveFormula()}
              disabled={libraryBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200"
            >
              {libraryBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
            <button
              type="button"
              onClick={() => startNewFormula()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <Plus size={14} />
              New
            </button>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Saved formulas</span>
            <button
              type="button"
              onClick={() => void loadSavedFormulas()}
              disabled={libraryBusy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-slate-300/70 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/50">
            {(
              [
                ["all", "All"],
                ["system", "System"],
                ["user", "User"],
                ["pending", "Pending"],
              ] as const
            ).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSavedFormulaFilter(filter)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-semibold transition",
                  savedFormulaFilter === filter
                    ? "bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              value={selectedFormulaId}
              onChange={(event) => {
                const formula = savedFormulas.find((entry) => entry.id === event.target.value);
                if (formula) {
                  applySavedFormula(formula);
                } else {
                  setSelectedFormulaId("");
                }
              }}
              className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">Select saved formula</option>
              {filteredSavedFormulas.map((formula) => (
                <option key={formula.id} value={formula.id}>
                  {formula.name} ({formula.formulaType === "custom" ? "USER" : "SYSTEM"}
                  {formula.formulaType === "custom"
                    ? `, ${getSavedFormulaApprovalStatus(formula)?.replace("_", " ").toUpperCase()}`
                    : ""}
                  )
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void deleteSelectedFormula()}
              disabled={!selectedFormulaId || libraryBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
          {libraryMessage ? (
            <p className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
              {libraryMessage}
            </p>
          ) : null}
          {libraryError ? (
            <p className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
              {libraryError}
            </p>
          ) : null}
          {activeTab === "custom" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300/70 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/50">
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                Status: {(selectedCustomApprovalStatus ?? "pending_review").replace("_", " ")}
              </span>
              {canApproveCustomFormulas && selectedFormulaId ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateCustomFormulaApproval("approved")}
                    disabled={libraryBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-800 transition hover:bg-emerald-500/25 disabled:opacity-60 dark:text-emerald-200"
                  >
                    <CheckCircle2 size={12} />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateCustomFormulaApproval("rejected")}
                    disabled={libraryBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-semibold text-rose-800 transition hover:bg-rose-500/20 disabled:opacity-60 dark:text-rose-200"
                  >
                    <XCircle size={12} />
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-300/70 bg-white/90 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
        {(
          [
            ["oee", "OEE"],
            ["capability", "Cp / Cpk"],
            ["dpmo", "DPMO"],
            ["takt", "Takt Time"],
            ["yield", "Yield / RTY"],
            ["little_law", "Little's Law"],
            ["normal_curve", "Normal Curve"],
            ["control_limits", "Control Limits"],
            ["custom", "Custom"],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => selectFormulaTab(tab)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold transition",
              activeTab === tab
                ? "bg-cyan-500/20 text-cyan-900 dark:text-cyan-100"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <FormulaGuidePanel guide={FORMULA_GUIDES[activeTab]} />

      {activeTab === "oee" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                OEE by Operator Group
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Record time studies inside each operator group. Group totals and all-operator totals are weighted from the underlying recordings.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addOeeGroup}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
              >
                <Plus size={14} />
                Add operator
              </button>
              <SpreadsheetImportButton
                label="Import Excel/CSV"
                onRows={(rows) => {
                  const groups = rowsToOeeGroups(rows);
                  if (groups.length === 0) {
                    throw new Error("No OEE rows found in the imported file.");
                  }
                  setOeeGroups(groups);
                  setLibraryMessage(`Imported ${groups.length} OEE operator group${groups.length === 1 ? "" : "s"}.`);
                  setLibraryError(null);
                }}
                onError={(message) => setLibraryError(message)}
              />
              <button
                type="button"
                onClick={exportOeeCsv}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <Download size={14} />
                CSV
              </button>
            </div>
          </div>

          <FormulaResults
            hints={FORMULA_GUIDES.oee.resultHints}
            rows={[
              ["Availability", formatPercent(oeeTotal.availability)],
              ["Performance", formatPercent(oeeTotal.performance)],
              ["Quality", formatPercent(oeeTotal.quality)],
              ["OEE", formatPercent(oeeTotal.oee)],
            ]}
          />
          {renderActiveFormulaChart()}

          <div className="grid gap-4">
            {oeeGroupResults.map(({ group, recordings, aggregate }) => (
              <section
                key={group.id}
                className="grid gap-3 rounded-xl border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/45"
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="grid min-w-64 flex-1 gap-1 text-sm">
                    <span className="font-semibold">Operator group</span>
                    <input
                      value={group.operator}
                      onChange={(event) => updateOeeGroup(group.id, event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addOeeRecording(group.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                    >
                      <Plus size={14} />
                      Add recording
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOeeGroup(group.id)}
                      disabled={oeeGroups.length <= 1}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                    >
                      <Trash2 size={14} />
                      Remove group
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ["Availability", formatPercent(aggregate.availability)],
                    ["Performance", formatPercent(aggregate.performance)],
                    ["Quality", formatPercent(aggregate.quality)],
                    ["Group OEE", formatPercent(aggregate.oee)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-slate-300/70 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {label}
                      </p>
                      <p className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[62rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-300 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="px-2 py-2">Recording</th>
                        <th className="px-2 py-2">Planned min</th>
                        <th className="px-2 py-2">Run min</th>
                        <th className="px-2 py-2">Ideal sec</th>
                        <th className="px-2 py-2">Total count</th>
                        <th className="px-2 py-2">Good count</th>
                        <th className="px-2 py-2 text-right">Avail.</th>
                        <th className="px-2 py-2 text-right">Perf.</th>
                        <th className="px-2 py-2 text-right">Quality</th>
                        <th className="px-2 py-2 text-right">OEE</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {recordings.map(({ recording, stats }, recordingIndex) => (
                        <tr
                          key={recording.id}
                          className="border-b border-slate-200 dark:border-slate-800"
                        >
                          <td className="px-2 py-2 font-semibold text-slate-500 dark:text-slate-400">
                            {recordingIndex + 1}
                          </td>
                          {(
                            [
                              ["plannedMinutes", recording.plannedMinutes],
                              ["runMinutes", recording.runMinutes],
                              ["idealCycleSeconds", recording.idealCycleSeconds],
                              ["totalCount", recording.totalCount],
                              ["goodCount", recording.goodCount],
                            ] as const
                          ).map(([key, value]) => (
                            <td key={key} className="px-2 py-2">
                              <input
                                value={value}
                                onChange={(event) =>
                                  updateOeeRecording(
                                    group.id,
                                    recording.id,
                                    key,
                                    event.target.value,
                                  )
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right font-semibold">{formatPercent(stats.availability)}</td>
                          <td className="px-2 py-2 text-right font-semibold">{formatPercent(stats.performance)}</td>
                          <td className="px-2 py-2 text-right font-semibold">{formatPercent(stats.quality)}</td>
                          <td className="px-2 py-2 text-right font-extrabold text-cyan-800 dark:text-cyan-100">
                            {formatPercent(stats.oee)}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => removeOeeRecording(group.id, recording.id)}
                              disabled={group.recordings.length <= 1}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                              aria-label={`Remove recording ${recordingIndex + 1}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "capability" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <div className="grid gap-3">
            <h2 className="text-lg font-extrabold">Cp / Cpk Capability</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">LSL</span>
                <input value={lsl} onChange={(event) => setLsl(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">USL</span>
                <input value={usl} onChange={(event) => setUsl(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
            </div>
            <NumberListInput
              label="Measurements"
              value={capabilityData}
              onChange={setCapabilityData}
              minRows={8}
            />
          </div>
          <FormulaResults
            hints={FORMULA_GUIDES.capability.resultHints}
            rows={[
              ["N", String(capabilityStats?.count ?? 0)],
              ["Mean", formatNumber(capabilityStats?.mean ?? null, 3)],
              ["Sigma", formatNumber(capabilityStats?.sigma ?? null, 3)],
              ["Cp", formatNumber(capabilityStats?.cp ?? null, 3)],
              ["Cpk", formatNumber(capabilityStats?.cpk ?? null, 3)],
            ]}
          />
          <CapabilityChart
            values={capabilityValues}
            stats={capabilityStats}
            lslText={lsl}
            uslText={usl}
          />
        </section>
      ) : null}

      {activeTab === "dpmo" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <FormulaInputGrid
            fields={[
              ["Defects", dpmoDefects, setDpmoDefects],
              ["Units", dpmoUnits, setDpmoUnits],
              ["Opportunities per unit", dpmoOpps, setDpmoOpps],
            ]}
          />
          <FormulaResults
            hints={FORMULA_GUIDES.dpmo.resultHints}
            rows={[
              ["DPMO", formatNumber(dpmoStats.dpmo, 0)],
              ["Yield", dpmoStats.yieldPercent === null ? "N/A" : `${formatNumber(dpmoStats.yieldPercent, 2)}%`],
            ]}
          />
          {renderActiveFormulaChart()}
        </section>
      ) : null}

      {activeTab === "takt" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <FormulaInputGrid
            fields={[
              ["Available production minutes", taktMinutes, setTaktMinutes],
              ["Customer demand", taktDemand, setTaktDemand],
            ]}
          />
          <FormulaResults
            hints={FORMULA_GUIDES.takt.resultHints}
            rows={[
              ["Minutes / unit", formatNumber(taktStats.minutesPerUnit, 3)],
              ["Seconds / unit", formatNumber(taktStats.secondsPerUnit, 1)],
            ]}
          />
          {renderActiveFormulaChart()}
        </section>
      ) : null}

      {activeTab === "yield" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-4">
            <FormulaInputGrid
              fields={[
                ["Units started", yieldUnits, setYieldUnits],
                ["Defects", yieldDefects, setYieldDefects],
              ]}
            />
            <NumberListInput
              label="Step yields"
              value={yieldStepYields}
              onChange={setYieldStepYields}
              minRows={5}
            />
          </div>
          <FormulaResults
            hints={FORMULA_GUIDES.yield.resultHints}
            rows={[
              ["First pass yield", formatPercent(yieldStats.fpy)],
              ["Defects / unit", formatNumber(yieldStats.dpu, 4)],
              ["Step count", String(yieldStats.stepCount)],
              ["Rolled throughput yield", formatPercent(yieldStats.rty)],
            ]}
          />
          {renderActiveFormulaChart()}
        </section>
      ) : null}

      {activeTab === "little_law" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <FormulaInputGrid
            fields={[
              ["WIP", littleWip, setLittleWip],
              ["Throughput / hour", littleThroughput, setLittleThroughput],
              ["Lead time hours", littleLeadTime, setLittleLeadTime],
            ]}
          />
          <FormulaResults
            hints={FORMULA_GUIDES.little_law.resultHints}
            rows={[
              ["WIP", formatNumber(littleLawStats.wip, 3)],
              ["Throughput / hour", formatNumber(littleLawStats.throughput, 3)],
              ["Lead time hours", formatNumber(littleLawStats.leadTime, 3)],
            ]}
          />
          {renderActiveFormulaChart()}
        </section>
      ) : null}

      {activeTab === "normal_curve" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <FormulaInputGrid
            fields={[
              ["Mean", normalMean, setNormalMean],
              ["Std dev", normalSigma, setNormalSigma],
              ["Lower spec", normalLower, setNormalLower],
              ["Upper spec", normalUpper, setNormalUpper],
            ]}
          />
          <FormulaResults
            hints={FORMULA_GUIDES.normal_curve.resultHints}
            rows={[
              ["Z lower", formatNumber(normalCurveStats.zLower, 3)],
              ["Z upper", formatNumber(normalCurveStats.zUpper, 3)],
              ["Probability within", formatPercent(normalCurveStats.between)],
              ["Probability outside", formatPercent(normalCurveStats.outside)],
              [
                "PPM outside",
                normalCurveStats.outside === null
                  ? "N/A"
                  : formatNumber(normalCurveStats.outside * 1_000_000, 0),
              ],
            ]}
          />
          <NormalCurveChart
            meanText={normalMean}
            sigmaText={normalSigma}
            lowerText={normalLower}
            upperText={normalUpper}
            stats={normalCurveStats}
          />
        </section>
      ) : null}

      {activeTab === "control_limits" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[1fr_20rem]">
          <NumberListInput
            label="Measurements"
            value={controlLimitValues}
            onChange={setControlLimitValues}
            minRows={10}
          />
          <FormulaResults
            hints={FORMULA_GUIDES.control_limits.resultHints}
            rows={[
              ["N", String(controlLimitStats?.count ?? 0)],
              ["Centerline", formatNumber(controlLimitStats?.centerline ?? null, 3)],
              ["Sigma", formatNumber(controlLimitStats?.sigma ?? null, 3)],
              ["UCL", formatNumber(controlLimitStats?.ucl ?? null, 3)],
              ["LCL", formatNumber(controlLimitStats?.lcl ?? null, 3)],
            ]}
          />
          <ControlLimitChart values={controlLimitValueList} stats={controlLimitStats} />
        </section>
      ) : null}

      {activeTab === "custom" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid content-start gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Description</span>
              <input
                value={customDescription}
                onChange={(event) => setCustomDescription(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-extrabold">Custom inputs</h2>
                <button
                  type="button"
                  onClick={addCustomInput}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                >
                  <Plus size={14} />
                  Add input
                </button>
              </div>
              <div className="grid gap-2">
                {customInputs.map((input) => (
                  <div
                    key={input.id}
                    className="grid gap-2 rounded-xl border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/45 md:grid-cols-[1fr_12rem_10rem_auto]"
                  >
                    <label className="grid gap-1 text-xs">
                      <span className="font-semibold">Label</span>
                      <input
                        value={input.label}
                        onChange={(event) => updateCustomInput(input.id, "label", event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="font-semibold">Variable</span>
                      <input
                        value={input.name}
                        onChange={(event) => updateCustomInput(input.id, "name", event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="font-semibold">Value</span>
                      <input
                        value={input.value}
                        inputMode="decimal"
                        onChange={(event) => updateCustomInput(input.id, "value", event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCustomInput(input.id)}
                      disabled={customInputs.length <= 1}
                      className="inline-flex h-10 w-10 self-end items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                      aria-label={`Remove ${input.label || input.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-extrabold">Custom outputs</h2>
                <button
                  type="button"
                  onClick={addCustomOutput}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
                >
                  <Plus size={14} />
                  Add output
                </button>
              </div>
              <div className="grid gap-2">
                {customOutputs.map((output) => {
                  const result = customFormulaResults.find((entry) => entry.id === output.id);
                  return (
                    <div
                      key={output.id}
                      className="grid gap-2 rounded-xl border border-slate-300/70 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/45 md:grid-cols-[1fr_12rem_minmax(14rem,1.5fr)_auto]"
                    >
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold">Label</span>
                        <input
                          value={output.label}
                          onChange={(event) => updateCustomOutput(output.id, "label", event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold">Name</span>
                        <input
                          value={output.name}
                          onChange={(event) => updateCustomOutput(output.id, "name", event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="font-semibold">Expression</span>
                        <input
                          value={output.expression}
                          onChange={(event) => updateCustomOutput(output.id, "expression", event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeCustomOutput(output.id)}
                        disabled={customOutputs.length <= 1}
                        className="inline-flex h-10 w-10 self-end items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                        aria-label={`Remove ${output.label || output.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                      <p className="md:col-span-4 rounded-lg border border-slate-300/70 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/60">
                        <span className="font-semibold">Result: </span>
                        {result?.error ?? formatNumber(result?.value ?? null, 4)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <FormulaResults
            hints={FORMULA_GUIDES.custom.resultHints}
            rows={[
              ["Status", (selectedCustomApprovalStatus ?? "pending_review").replace("_", " ")],
              ...customFormulaResults.map((output, index) => [
                output.label.trim() || `Output ${index + 1}`,
                output.error ?? formatNumber(output.value, 4),
              ] as [string, string]),
            ]}
          />
          {renderActiveFormulaChart()}
        </section>
      ) : null}
    </div>
  );
}

function FormulaPrintPage({
  title,
  formulaType,
  printedAt,
  rows,
  children,
}: {
  title: string;
  formulaType: FormulaTab;
  printedAt: Date;
  rows: string[][];
  children: ReactNode;
}) {
  return (
    <section className="formula-print-page">
      <div className="grid gap-4">
        <header>
          <h1 className="text-2xl font-extrabold text-slate-950">{title}</h1>
          <p className="text-sm text-slate-600">
            Calculator: {formulaType.toUpperCase()} | Printed {printedAt.toLocaleString()}
          </p>
        </header>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}:${row.join("|")}`}>
                {row.map((cell, cellIndex) =>
                  rowIndex === 0 ? (
                    <th
                      key={`${rowIndex}:${cellIndex}`}
                      className="border border-slate-300 bg-slate-100 px-2 py-1.5 text-left font-bold text-slate-950"
                    >
                      {cell}
                    </th>
                  ) : (
                    <td
                      key={`${rowIndex}:${cellIndex}`}
                      className="border border-slate-300 px-2 py-1.5 text-left text-slate-950"
                    >
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="print-chart grid gap-3">{children}</div>
      </div>
    </section>
  );
}

function SpreadsheetImportButton({
  label,
  onRows,
  onError,
  className,
}: {
  label: string;
  onRows: (rows: string[][]) => void;
  onError?: (message: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      const rows = await readSpreadsheetRows(file);
      onRows(rows);
    } catch (caughtError) {
      onError?.(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to import spreadsheet data.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200",
        busy ? "cursor-wait opacity-70" : "",
        className,
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
      {label}
      <input
        type="file"
        accept=".csv,.tsv,.txt,.xls,.xlsx"
        onChange={(event) => void handleImport(event)}
        className="sr-only"
      />
    </label>
  );
}

function NumberListInput({
  label,
  value,
  onChange,
  minRows = 6,
}: {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  minRows?: number;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const rows = useMemo(() => {
    const nextRows = value.split(/\r?\n/);
    while (nextRows.length < minRows) {
      nextRows.push("");
    }
    return nextRows;
  }, [minRows, value]);

  function commitRows(nextRows: string[]) {
    onChange(nextRows.join("\n"));
  }

  function updateRow(index: number, nextValue: string) {
    const nextRows = [...rows];
    nextRows[index] = nextValue;
    commitRows(nextRows);
  }

  function addRow(focusIndex = rows.length) {
    commitRows([...rows, ""]);
    window.setTimeout(() => inputRefs.current[focusIndex]?.focus(), 0);
  }

  function removeRow(index: number) {
    if (rows.length <= 1) {
      commitRows([""]);
      return;
    }

    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    commitRows(nextRows);
    window.setTimeout(() => inputRefs.current[Math.max(0, index - 1)]?.focus(), 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter" && !(event.key === "Tab" && !event.shiftKey)) {
      return;
    }

    event.preventDefault();
    if (index >= rows.length - 1) {
      addRow(index + 1);
      return;
    }

    inputRefs.current[index + 1]?.focus();
  }

  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <div className="flex flex-wrap gap-2">
          <SpreadsheetImportButton
            label="Import Excel/CSV"
            onRows={(spreadsheetRows) => {
              const importedNumbers = extractNumbersFromSpreadsheetRows(spreadsheetRows);
              if (importedNumbers.length === 0) {
                throw new Error("No numeric values were found in the imported file.");
              }
              onChange(numberListToText(importedNumbers));
              setImportError(null);
            }}
            onError={setImportError}
          />
          <button
            type="button"
            onClick={() => addRow()}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
          >
            <Plus size={14} />
            Add value
          </button>
        </div>
      </div>
      <div className="grid max-h-96 gap-2 overflow-y-auto rounded-xl border border-slate-300/70 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/60">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2">
            <span className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400">
              {index + 1}.
            </span>
            <input
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              value={row}
              inputMode="decimal"
              onKeyDown={(event) => handleKeyDown(event, index)}
              onChange={(event) => updateRow(index, event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
              aria-label={`Remove ${label} value ${index + 1}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {importError ? (
        <p className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {importError}
        </p>
      ) : null}
    </div>
  );
}

function normalPdf(x: number, mean: number, sigma: number) {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / sigma) ** 2);
}

function chartX(value: number, min: number, max: number, width: number, pad: number) {
  return pad + ((value - min) / Math.max(0.000001, max - min)) * (width - pad * 2);
}

function chartY(value: number, min: number, max: number, height: number, pad: number) {
  return height - pad - ((value - min) / Math.max(0.000001, max - min)) * (height - pad * 2);
}

function ChartShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2 rounded-xl border border-slate-300/70 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/45 lg:col-span-2">
      <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">{title}</h3>
      {children}
    </section>
  );
}

function MetricBarChart({
  title,
  bars,
}: {
  title: string;
  bars: Array<{ label: string; value: number | null; suffix?: string }>;
}) {
  const validBars = bars.filter((bar) => bar.value !== null && Number.isFinite(bar.value));
  const maxValue = Math.max(...validBars.map((bar) => Math.abs(bar.value ?? 0)), 1);

  return (
    <ChartShell title={title}>
      {validBars.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter valid values to draw the chart.
        </p>
      ) : (
        <div className="grid gap-2">
          {bars.map((bar) => {
            const value = bar.value;
            const percentWidth =
              value === null || !Number.isFinite(value)
                ? 0
                : Math.min(100, (Math.abs(value) / maxValue) * 100);
            return (
              <div key={bar.label} className="grid gap-1">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>{bar.label}</span>
                  <span>
                    {formatNumber(value, value !== null && Math.abs(value) >= 100 ? 0 : 2)}
                    {value === null ? "" : bar.suffix ?? ""}
                  </span>
                </div>
                <div className="h-4 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-500"
                    style={{ width: `${percentWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartShell>
  );
}

function OeeSummaryChart({
  groupResults,
  total,
}: {
  groupResults: Array<{
    group: OeeOperatorGroup;
    aggregate: ReturnType<typeof calculateOeeAggregate>;
  }>;
  total: ReturnType<typeof calculateOeeAggregate>;
}) {
  return (
    <MetricBarChart
      title="OEE by Operator Group"
      bars={[
        ...groupResults.map(({ group, aggregate }) => ({
          label: group.operator || "Operator",
          value: aggregate.oee === null ? null : aggregate.oee * 100,
          suffix: "%",
        })),
        {
          label: "Total OEE",
          value: total.oee === null ? null : total.oee * 100,
          suffix: "%",
        },
      ]}
    />
  );
}

function CustomFormulaChart({
  results,
}: {
  results: ReturnType<typeof calculateCustomFormulaResults>;
}) {
  return (
    <MetricBarChart
      title="Custom Output View"
      bars={results.map((result, index) => ({
        label: result.label.trim() || `Output ${index + 1}`,
        value: result.value,
        suffix: "",
      }))}
    />
  );
}

function NormalCurveChart({
  meanText,
  sigmaText,
  lowerText,
  upperText,
  stats,
}: {
  meanText: string;
  sigmaText: string;
  lowerText: string;
  upperText: string;
  stats: ReturnType<typeof calculateNormalCurve>;
}) {
  const mean = Number.parseFloat(meanText);
  const sigma = parsePositive(sigmaText);
  const lower = lowerText.trim() ? Number.parseFloat(lowerText) : null;
  const upper = upperText.trim() ? Number.parseFloat(upperText) : null;

  if (!Number.isFinite(mean) || !sigma) {
    return (
      <ChartShell title="Normal Curve">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter a valid mean and standard deviation to draw the normal curve.
        </p>
      </ChartShell>
    );
  }

  const width = 820;
  const height = 260;
  const pad = 42;
  const xMin = Math.min(mean - 4 * sigma, Number.isFinite(lower ?? NaN) ? (lower as number) : mean);
  const xMax = Math.max(mean + 4 * sigma, Number.isFinite(upper ?? NaN) ? (upper as number) : mean);
  const yMax = normalPdf(mean, mean, sigma) * 1.08;
  const points = Array.from({ length: 120 }, (_, index) => {
    const x = xMin + ((xMax - xMin) * index) / 119;
    return [chartX(x, xMin, xMax, width, pad), chartY(normalPdf(x, mean, sigma), 0, yMax, height, pad)];
  });
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const lowerX = lower !== null && Number.isFinite(lower) ? chartX(lower, xMin, xMax, width, pad) : null;
  const upperX = upper !== null && Number.isFinite(upper) ? chartX(upper, xMin, xMax, width, pad) : null;
  const meanX = chartX(mean, xMin, xMax, width, pad);

  return (
    <ChartShell title="Normal Curve">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full overflow-visible">
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} rx="10" className="fill-white dark:fill-slate-950" />
        {lowerX !== null && upperX !== null ? (
          <rect
            x={Math.min(lowerX, upperX)}
            y={pad}
            width={Math.abs(upperX - lowerX)}
            height={height - pad * 2}
            className="fill-emerald-500/10"
          />
        ) : null}
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-slate-300 dark:stroke-slate-700" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-600 dark:text-cyan-300" />
        {[
          ["LSL", lowerX, "text-rose-600 dark:text-rose-300"],
          ["Mean", meanX, "text-slate-700 dark:text-slate-200"],
          ["USL", upperX, "text-rose-600 dark:text-rose-300"],
        ].map(([label, x, tone]) =>
          typeof x === "number" ? (
            <g key={label}>
              <line x1={x} x2={x} y1={pad} y2={height - pad} stroke="currentColor" strokeDasharray="5 5" className={tone as string} />
              <text x={x} y={pad - 12} textAnchor="middle" className={cn("fill-current text-[13px] font-bold", tone)}>
                {label}
              </text>
            </g>
          ) : null,
        )}
      </svg>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Within specs: {formatPercent(stats.between)} | Outside specs: {formatPercent(stats.outside)}
      </p>
    </ChartShell>
  );
}

function CapabilityChart({
  values,
  stats,
  lslText,
  uslText,
}: {
  values: number[];
  stats: ReturnType<typeof calculateCapability>;
  lslText: string;
  uslText: string;
}) {
  const lsl = lslText.trim() ? Number.parseFloat(lslText) : null;
  const usl = uslText.trim() ? Number.parseFloat(uslText) : null;
  if (!stats || values.length < 2 || stats.sigma <= 0) {
    return (
      <ChartShell title="Cp / Cpk Distribution">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter at least two different measurements to draw the capability chart.
        </p>
      </ChartShell>
    );
  }

  const width = 820;
  const height = 280;
  const pad = 42;
  const valuesMin = Math.min(...values, stats.mean - 4 * stats.sigma);
  const valuesMax = Math.max(...values, stats.mean + 4 * stats.sigma);
  const xMin = Math.min(valuesMin, Number.isFinite(lsl ?? NaN) ? (lsl as number) : valuesMin);
  const xMax = Math.max(valuesMax, Number.isFinite(usl ?? NaN) ? (usl as number) : valuesMax);
  const bucketCount = Math.min(14, Math.max(6, Math.ceil(Math.sqrt(values.length))));
  const bucketWidth = (xMax - xMin) / bucketCount || 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    count: 0,
  }));
  for (const value of values) {
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((value - xMin) / bucketWidth)));
    buckets[bucketIndex].count += 1;
  }
  const maxBucketCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const curveScale = maxBucketCount / normalPdf(stats.mean, stats.mean, stats.sigma);
  const curvePoints = Array.from({ length: 120 }, (_, index) => {
    const xValue = xMin + ((xMax - xMin) * index) / 119;
    const yValue = normalPdf(xValue, stats.mean, stats.sigma) * curveScale;
    return [chartX(xValue, xMin, xMax, width, pad), chartY(yValue, 0, maxBucketCount * 1.2, height, pad)];
  });
  const curvePath = curvePoints.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");

  return (
    <ChartShell title="Cp / Cpk Distribution">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full overflow-visible">
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} rx="10" className="fill-white dark:fill-slate-950" />
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-slate-300 dark:stroke-slate-700" />
        {buckets.map((bucket) => {
          const x0 = chartX(xMin + bucket.index * bucketWidth, xMin, xMax, width, pad);
          const x1 = chartX(xMin + (bucket.index + 1) * bucketWidth, xMin, xMax, width, pad);
          const y = chartY(bucket.count, 0, maxBucketCount * 1.2, height, pad);
          return (
            <rect
              key={bucket.index}
              x={x0 + 2}
              y={y}
              width={Math.max(1, x1 - x0 - 4)}
              height={height - pad - y}
              rx="4"
              className="fill-cyan-500/35"
            />
          );
        })}
        <path d={curvePath} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-700 dark:text-cyan-200" />
        {[
          ["LSL", lsl, "text-rose-600 dark:text-rose-300"],
          ["Mean", stats.mean, "text-slate-700 dark:text-slate-200"],
          ["USL", usl, "text-rose-600 dark:text-rose-300"],
        ].map(([label, value, tone]) =>
          typeof value === "number" && Number.isFinite(value) ? (
            <g key={label}>
              <line
                x1={chartX(value, xMin, xMax, width, pad)}
                x2={chartX(value, xMin, xMax, width, pad)}
                y1={pad}
                y2={height - pad}
                stroke="currentColor"
                strokeDasharray="5 5"
                className={tone as string}
              />
              <text
                x={chartX(value, xMin, xMax, width, pad)}
                y={pad - 12}
                textAnchor="middle"
                className={cn("fill-current text-[13px] font-bold", tone)}
              >
                {label}
              </text>
            </g>
          ) : null,
        )}
      </svg>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Cp {formatNumber(stats.cp, 3)} | Cpk {formatNumber(stats.cpk, 3)} | N {stats.count}
      </p>
    </ChartShell>
  );
}

function ControlLimitChart({
  values,
  stats,
}: {
  values: number[];
  stats: ReturnType<typeof calculateControlLimits>;
}) {
  if (!stats || values.length < 2) {
    return (
      <ChartShell title="Control Chart View">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter at least two measurements to draw the control chart.
        </p>
      </ChartShell>
    );
  }

  const width = 820;
  const height = 280;
  const pad = 42;
  const yMin = Math.min(...values, stats.lcl);
  const yMax = Math.max(...values, stats.ucl);
  const xForIndex = (index: number) =>
    pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
  const points = values.map((value, index) => [
    xForIndex(index),
    chartY(value, yMin, yMax, height, pad),
  ]);
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");

  return (
    <ChartShell title="Control Chart View">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full overflow-visible">
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} rx="10" className="fill-white dark:fill-slate-950" />
        {[
          ["UCL", stats.ucl, "text-rose-600 dark:text-rose-300"],
          ["Centerline", stats.centerline, "text-emerald-700 dark:text-emerald-200"],
          ["LCL", stats.lcl, "text-rose-600 dark:text-rose-300"],
        ].map(([label, value, tone]) => {
          const y = chartY(value as number, yMin, yMax, height, pad);
          return (
            <g key={label}>
              <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="currentColor" strokeDasharray="5 5" className={tone as string} />
              <text x={pad + 8} y={y - 6} className={cn("fill-current text-[12px] font-bold", tone)}>
                {label}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-700 dark:text-cyan-200" />
        {points.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r="4" className="fill-cyan-600 dark:fill-cyan-300" />
        ))}
      </svg>
    </ChartShell>
  );
}

function FormulaInputGrid({
  fields,
}: {
  fields: Array<[string, string, (nextValue: string) => void]>;
}) {
  return (
    <div className="grid content-start gap-3 sm:grid-cols-2">
      {fields.map(([label, value, setter]) => (
        <label key={label} className="grid gap-1 text-sm">
          <span className="font-semibold">{label}</span>
          <input
            value={value}
            onChange={(event) => setter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      ))}
    </div>
  );
}

function FormulaGuidePanel({ guide }: { guide: FormulaGuide }) {
  return (
    <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/90 p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950/80 xl:grid-cols-[1.1fr_0.95fr_1fr]">
      <div className="grid content-start gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Formula guide
        </p>
        <h2 className="text-base font-extrabold text-slate-950 dark:text-slate-50">
          {guide.title}
        </h2>
        <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-semibold text-cyan-900 dark:text-cyan-100">
          {guide.formula}
        </p>
        <p className="text-slate-600 dark:text-slate-300">{guide.calculation}</p>
      </div>
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
          When to use it
        </h3>
        <p className="text-slate-600 dark:text-slate-300">{guide.whenToUse}</p>
        <h3 className="pt-1 text-sm font-extrabold text-slate-950 dark:text-slate-50">
          Manufacturing example
        </h3>
        <p className="text-slate-600 dark:text-slate-300">{guide.scenario}</p>
      </div>
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
          Input hints
        </h3>
        <ul className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
          {guide.inputHints.map((hint) => (
            <li key={hint} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/55">
              {hint}
            </li>
          ))}
        </ul>
        <h3 className="pt-1 text-sm font-extrabold text-slate-950 dark:text-slate-50">
          Calculation outputs
        </h3>
        <dl className="grid gap-1 text-xs">
          {Object.entries(guide.resultHints).map(([label, hint]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/55">
              <dt className="font-bold text-slate-800 dark:text-slate-100">{label}</dt>
              <dd className="text-slate-600 dark:text-slate-300">{hint}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function FormulaResults({
  rows,
  hints,
}: {
  rows: Array<[string, string]>;
  hints?: Record<string, string>;
}) {
  return (
    <aside className="grid content-start gap-3 rounded-xl border border-slate-300/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/45">
      <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">Results</h3>
      <dl className="grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-2 rounded-lg border border-slate-300/70 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <dt className="text-sm text-slate-600 dark:text-slate-300">{label}</dt>
              {hints?.[label] ? (
                <dd className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {hints[label]}
                </dd>
              ) : null}
            </div>
            <dd className="font-extrabold text-slate-950 dark:text-slate-50">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
