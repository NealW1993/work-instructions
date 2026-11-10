import { expect, test } from "@playwright/test";

import { evaluateFormulaExpression, FORMULA_CONSTANTS } from "../src/lib/formula-expression";
import {
  calculateDpmoMetrics,
  calculateCapabilityMetrics,
  calculateYieldMetrics,
  calculateIndividualsLimits,
  calculateOeeMetrics,
  calculateOeeSummary,
  parseFiniteNumber,
  parseMeasurementSeries,
} from "../src/lib/manufacturing-calculations";
import { getUserSettingAtPath, parseUserSettingsPath, setUserSettingAtPath } from "../src/lib/user-settings";
import { escapeDelimitedCell } from "../src/lib/export-format";

const recording = {
  plannedMinutes: "480", runMinutes: "420", idealCycleSeconds: "45", totalCount: "500", goodCount: "480",
};

test("OEE matches a known production shift and handles all-scrap output", () => {
  const result = calculateOeeMetrics(recording);
  expect(result.error).toBeNull();
  expect(result.oee).toBeCloseTo(0.75);
  expect(result.availability).toBeCloseTo(0.875);
  expect(result.quality).toBeCloseTo(0.96);
  expect(calculateOeeMetrics({ ...recording, goodCount: "0" }).oee).toBe(0);
  expect(calculateOeeMetrics({ ...recording, goodCount: "0" }).quality).toBe(0);
});

test("a stopped shift contributes zero OEE rather than disappearing from totals", () => {
  const stopped = { ...recording, runMinutes: "0", totalCount: "0", goodCount: "0" };
  expect(calculateOeeMetrics(stopped).oee).toBe(0);
  expect(calculateOeeSummary([recording, stopped]).oee).toBeCloseTo(0.375);
});

test("inconsistent production data cannot be clamped into plausible OEE", () => {
  for (const invalid of [
    { runMinutes: "481" }, { goodCount: "501" }, { totalCount: "500.5" },
    { runMinutes: "0" }, { idealCycleSeconds: "1000" }, { goodCount: "-1" }, { totalCount: "500widgets" },
  ]) {
    const result = calculateOeeMetrics({ ...recording, ...invalid });
    expect(result.error).toBeTruthy();
    expect(result.oee).toBeNull();
  }
});

test("OEE aggregation excludes entire incomplete recordings", () => {
  const result = calculateOeeSummary([recording, { ...recording, totalCount: "" }]);
  expect(result.count).toBe(1);
  expect(result.excludedCount).toBe(1);
  expect(result.plannedMinutes).toBe(480);
  expect(result.oee).toBeCloseTo(0.75);
});

test("mixed-product OEE weights good production by each product's ideal cycle", () => {
  const result = calculateOeeSummary([
    { plannedMinutes: "10", runMinutes: "10", idealCycleSeconds: "60", totalCount: "10", goodCount: "0" },
    { plannedMinutes: "10", runMinutes: "10", idealCycleSeconds: "6", totalCount: "100", goodCount: "100" },
  ]);
  expect(result.oee).toBeCloseTo(0.5);
});

test("zero defects gives zero DPMO and counts cannot exceed opportunities", () => {
  expect(calculateDpmoMetrics("0", "100", "3")).toEqual({ dpmo: 0, yieldPercent: 100 });
  expect(calculateDpmoMetrics("7", "100", "3").dpmo).toBeCloseTo(23333.333333);
  expect(calculateDpmoMetrics("301", "100", "3").dpmo).toBeNull();
  expect(calculateDpmoMetrics("1", "0", "3").dpmo).toBeNull();
});

test("Individuals control limits use consecutive moving ranges", () => {
  const result = calculateIndividualsLimits([1, 2, 3, 4]);
  expect(result?.centerline).toBe(2.5);
  expect(result?.sigma).toBeCloseTo(1 / 1.128);
  expect(result?.ucl).toBeCloseTo(2.5 + 3 / 1.128);
  expect(calculateIndividualsLimits([1])).toBeNull();
});

test("capability validates specification limits and preserves one-sided studies", () => {
  const bilateral = calculateCapabilityMetrics([14, 16, 18], "8", "20");
  expect(bilateral?.mean).toBe(16);
  expect(bilateral?.sigma).toBe(2);
  expect(bilateral?.cp).toBe(1);
  expect(bilateral?.cpk).toBeCloseTo(2 / 3);
  expect(calculateCapabilityMetrics([14, 16, 18], "", "20")?.cpk).toBeCloseTo(2 / 3);
  expect(calculateCapabilityMetrics([14, 16, 18], "20", "8")).toBeNull();
  expect(calculateCapabilityMetrics([14, 16, 18], "8mm", "20")).toBeNull();
  expect(calculateCapabilityMetrics([16, 16, 16], "8", "20")?.cp).toBeNull();
});

test("yield rejects invalid stages and avoids inventing perfect or zero results", () => {
  expect(calculateYieldMetrics("100", "0", "", "0").fpy).toBe(1);
  expect(calculateYieldMetrics("100", "101", "", "101").fpy).toBeNull();
  expect(calculateYieldMetrics("100", "3", "", "-1").dpu).toBeNull();
  expect(calculateYieldMetrics("100", "3", "95%, 0.98", "4").rty).toBeCloseTo(0.931);
  expect(calculateYieldMetrics("100", "3", "0.98, broken, 0.95", "4").rty).toBeNull();
  expect(calculateYieldMetrics("100", "3", "120%", "4").rty).toBeNull();
});

test("first pass yield counts failed units separately from defects per unit", () => {
  const multipleDefects = calculateYieldMetrics("100", "3", "", "40");
  expect(multipleDefects.fpy).toBe(0.97);
  expect(multipleDefects.dpu).toBe(0.4);
  expect(calculateYieldMetrics("100", "3", "", "140").dpu).toBe(1.4);
  const historicalFormula = calculateYieldMetrics("100", "", "", "40");
  expect(historicalFormula.fpy).toBeNull();
  expect(historicalFormula.rty).toBeNull();
  expect(historicalFormula.dpu).toBe(0.4);
  expect(calculateYieldMetrics("100", "3.5", "", "40").fpy).toBeNull();
  expect(calculateYieldMetrics("0", "0", "", "0").fpy).toBeNull();
});

test("measurement parsing rejects partial numbers instead of silently dropping observations", () => {
  expect(parseFiniteNumber("12widgets")).toBeNull();
  expect(parseFiniteNumber("")).toBeNull();
  expect(parseFiniteNumber("1e-3")).toBe(0.001);
  expect(parseMeasurementSeries("1, 2, broken, 3")).toEqual([]);
  expect(parseMeasurementSeries("1, 2; 3\n4")).toEqual([1, 2, 3, 4]);
});

test("formula arithmetic supports precedence, powers, scientific notation, and helpers", () => {
  expect(evaluateFormulaExpression("(good / total) * 100", { good: 90, total: 100 }).value).toBe(90);
  expect(evaluateFormulaExpression("2 + 3 * 4", {}).value).toBe(14);
  expect(evaluateFormulaExpression("2^3^2", {}).value).toBe(512);
  expect(evaluateFormulaExpression("-2^2", {}).value).toBe(-4);
  expect(evaluateFormulaExpression("sqrt(9) + max(2, 4) + 1e-3", {}).value).toBeCloseTo(7.001);
  expect(evaluateFormulaExpression("sin(pi / 2)", FORMULA_CONSTANTS).value).toBeCloseTo(1);
});

test("formulas cannot access browser globals, object properties, or execute code", () => {
  for (const expression of ["window.alert(1)", "constructor(1)", "abs.constructor(1)", "globalThis", "process.exit()", "1,2", "x.toString()"] ) {
    expect(evaluateFormulaExpression(expression, { x: 3 }).error).toBeTruthy();
  }
  expect(evaluateFormulaExpression("1 / 0", {}).value).toBeNull();
  expect(evaluateFormulaExpression("sqrt(-1)", {}).value).toBeNull();
  expect(evaluateFormulaExpression("missing + 1", {}).value).toBeNull();
  expect(evaluateFormulaExpression("(".repeat(100) + "1" + ")".repeat(100), {}).error).toBeTruthy();
});

test("settings paths reject prototype traversal and malformed segments", () => {
  for (const path of ["__proto__.polluted", "constructor.prototype.polluted", "a..b", ".a", "a.", "a.".repeat(100)]) {
    expect(parseUserSettingsPath(path)).toBeNull();
  }
  expect(parseUserSettingsPath("notifications.pendingApprovals")).toEqual(["notifications", "pendingApprovals"]);
  expect(getUserSettingAtPath({}, ["constructor"])).toBeUndefined();
  expect(() => setUserSettingAtPath({}, ["__proto__", "polluted"], true)).toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("spreadsheet exports protect formulas and preserve numeric values", () => {
  for (const text of ["=WEBSERVICE(\"https://example.invalid\")", "+1", "@SUM(A1)", "  -1+1", "\t=1"]) {
    expect(escapeDelimitedCell(text, ",")).toContain("'");
  }
  expect(escapeDelimitedCell(-12.5, ",")).toBe("-12.5");
  expect(escapeDelimitedCell(null, ",")).toBe("");
  expect(escapeDelimitedCell('Drawing "A", rev 1', ",")).toBe('"Drawing ""A"", rev 1"');
  expect(escapeDelimitedCell("cell\tvalue", "\t")).toBe('"cell\tvalue"');
});
