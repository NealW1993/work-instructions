export function parseFiniteNumber(value: string): number | null {
  const text = value.trim();
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function parseMeasurementSeries(text: string): number[] {
  const tokens = text.trim().split(/[\s,;|]+/).filter(Boolean);
  const values = tokens.map(parseFiniteNumber);
  // Do not silently discard bad observations from an engineering study.
  return values.some((value) => value === null) ? [] : values as number[];
}

export interface OeeInputs {
  plannedMinutes: string;
  runMinutes: string;
  idealCycleSeconds: string;
  totalCount: string;
  goodCount: string;
}

export function calculateOeeMetrics(input: OeeInputs) {
  const planned = parseFiniteNumber(input.plannedMinutes);
  const run = parseFiniteNumber(input.runMinutes);
  const ideal = parseFiniteNumber(input.idealCycleSeconds);
  const total = parseFiniteNumber(input.totalCount);
  const good = parseFiniteNumber(input.goodCount);
  let error: string | null = null;
  if (planned === null || run === null || ideal === null || total === null || good === null) {
    error = "Complete all five numeric inputs.";
  } else if (planned <= 0 || ideal <= 0 || run < 0 || total < 0 || good < 0) {
    error = "Planned time and ideal cycle must be positive; other values cannot be negative.";
  } else if (!Number.isSafeInteger(total) || !Number.isSafeInteger(good)) {
    error = "Total and good quantities must be whole numbers.";
  } else if (run > planned || good > total || (run === 0 && total > 0)) {
    error = "Run time cannot exceed planned time; good quantity cannot exceed total quantity.";
  } else if (ideal * total > run * 60 + 1e-9) {
    error = "Performance exceeds 100%. Check ideal cycle time, run time, and quantity.";
  }
  if (error || planned === null || run === null || ideal === null || total === null || good === null) {
    return { availability: null, performance: null, quality: null, oee: null, error };
  }
  const availability = run / planned;
  const performance = run > 0 ? (ideal * total) / (run * 60) : null;
  const quality = total > 0 ? good / total : null;
  // A fully stopped shift or a zero-output shift has zero equipment effectiveness.
  const oee = total === 0 ? 0 : availability * (performance ?? 0) * (quality ?? 0);
  return { availability, performance, quality, oee, error: null };
}

export function calculateOeeSummary(recordings: OeeInputs[]) {
  let plannedMinutes = 0, runMinutes = 0, idealRunSeconds = 0, idealGoodSeconds = 0;
  let totalCount = 0, goodCount = 0, count = 0;
  for (const row of recordings) {
    const result = calculateOeeMetrics(row);
    if (result.error) continue;
    const planned = Number(row.plannedMinutes), run = Number(row.runMinutes);
    const ideal = Number(row.idealCycleSeconds), total = Number(row.totalCount), good = Number(row.goodCount);
    plannedMinutes += planned; runMinutes += run; idealRunSeconds += ideal * total;
    idealGoodSeconds += ideal * good; totalCount += total; goodCount += good; count += 1;
  }
  return {
    count, excludedCount: recordings.length - count, plannedMinutes, runMinutes, totalCount, goodCount,
    availability: plannedMinutes > 0 ? runMinutes / plannedMinutes : null,
    performance: runMinutes > 0 ? idealRunSeconds / (runMinutes * 60) : null,
    quality: totalCount > 0 ? goodCount / totalCount : null,
    // Weight good production by its own ideal cycle when mixed products are aggregated.
    oee: plannedMinutes > 0 ? idealGoodSeconds / (plannedMinutes * 60) : null,
  };
}

export function calculateDpmoMetrics(defectsText: string, unitsText: string, opportunitiesText: string) {
  const defects = parseFiniteNumber(defectsText), units = parseFiniteNumber(unitsText);
  const opportunities = parseFiniteNumber(opportunitiesText);
  if (defects === null || units === null || opportunities === null || defects < 0 || units <= 0 ||
      opportunities <= 0 || ![defects, units, opportunities].every(Number.isSafeInteger) || defects > units * opportunities) {
    return { dpmo: null, yieldPercent: null };
  }
  const dpmo = defects / (units * opportunities) * 1_000_000;
  return { dpmo, yieldPercent: 100 - dpmo / 10_000 };
}

/** Individuals-chart sigma, MR-bar / d2 (two consecutive observations).
 * https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc322.htm
 * Values must be in collection order; this is not a subgroup chart.
 */
export function calculateIndividualsLimits(values: number[]) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return null;
  const centerline = values.reduce((sum, value) => sum + value, 0) / values.length;
  const movingRange = values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0) / (values.length - 1);
  const sigma = movingRange / 1.128;
  return { count: values.length, centerline, sigma, ucl: centerline + 3 * sigma, lcl: centerline - 3 * sigma };
}

/** Sample capability estimates, using sample standard deviation (n - 1).
 * https://www.itl.nist.gov/div898/handbook/pmc/section1/pmc16.htm
 */
export function calculateCapabilityMetrics(values: number[], lslText: string, uslText: string) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return null;
  const lsl = parseFiniteNumber(lslText), usl = parseFiniteNumber(uslText);
  if ((lslText.trim() && lsl === null) || (uslText.trim() && usl === null) ||
    (lsl !== null && usl !== null && lsl >= usl)) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sigma = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  if (!Number.isFinite(mean) || !Number.isFinite(sigma)) return null;
  const cp = lsl !== null && usl !== null && sigma > 0 ? (usl - lsl) / (6 * sigma) : null;
  const cpu = usl !== null && sigma > 0 ? (usl - mean) / (3 * sigma) : null;
  const cpl = lsl !== null && sigma > 0 ? (mean - lsl) / (3 * sigma) : null;
  return { count: values.length, mean, sigma, cp, cpk: cpu !== null && cpl !== null ? Math.min(cpu, cpl) : cpu ?? cpl };
}

/** FPY counts failed units; DPU counts individual defects, including multiple on one unit.
 * https://asq.org/quality-resources/quality-glossary
 */
export function calculateYieldMetrics(
  unitsText: string,
  failedUnitsText: string,
  stepYieldsText: string,
  totalDefectsText = "",
) {
  const units = parseFiniteNumber(unitsText);
  const failedUnits = parseFiniteNumber(failedUnitsText);
  const defects = parseFiniteNumber(totalDefectsText);
  const validUnits = units !== null && units > 0 && Number.isSafeInteger(units);
  const validFailedUnits = validUnits && failedUnits !== null && failedUnits >= 0 &&
    failedUnits <= units && Number.isSafeInteger(failedUnits);
  const validDefects = validUnits && defects !== null && defects >= 0 && Number.isSafeInteger(defects);
  const fpy = validFailedUnits ? (units - failedUnits) / units : null;
  const dpu = validDefects ? defects / units : null;
  const tokens = stepYieldsText.trim().split(/[\s,;|]+/).filter(Boolean);
  const rates = tokens.map((token) => {
    const number = parseFiniteNumber(token.endsWith("%") ? token.slice(0, -1) : token);
    return number === null ? null : token.endsWith("%") || number > 1 ? number / 100 : number;
  });
  const validRates = rates.every((rate) => rate !== null && rate >= 0 && rate <= 1);
  const rty = tokens.length === 0 ? fpy : validRates
    ? (rates as number[]).reduce((product, rate) => product * rate, 1) : null;
  return { fpy, dpu, rty, stepCount: validRates ? rates.length : 0 };
}
