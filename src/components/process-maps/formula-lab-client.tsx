"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Plus, Printer, RefreshCw, Save, Trash2 } from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface OeeRow {
  id: string;
  operator: string;
  plannedMinutes: string;
  runMinutes: string;
  idealCycleSeconds: string;
  totalCount: string;
  goodCount: string;
}

type FormulaTab = "oee" | "capability" | "dpmo" | "takt";

interface SavedFormula {
  id: string;
  name: string;
  formulaType: FormulaTab;
  payload: unknown;
  updatedAt: string;
}

interface FormulaApiResponse {
  formulas?: SavedFormula[];
  formula?: SavedFormula | null;
  success?: boolean;
  error?: string;
}

const DEFAULT_OEE_ROWS: OeeRow[] = [
  {
    id: "operator-1",
    operator: "Operator 1",
    plannedMinutes: "480",
    runMinutes: "420",
    idealCycleSeconds: "45",
    totalCount: "520",
    goodCount: "498",
  },
  {
    id: "operator-2",
    operator: "Operator 2",
    plannedMinutes: "480",
    runMinutes: "435",
    idealCycleSeconds: "45",
    totalCount: "545",
    goodCount: "526",
  },
  {
    id: "operator-3",
    operator: "Operator 3",
    plannedMinutes: "480",
    runMinutes: "410",
    idealCycleSeconds: "45",
    totalCount: "500",
    goodCount: "482",
  },
];

const DEFAULT_FORMULA_NAMES: Record<FormulaTab, string> = {
  oee: "OEE calculator",
  capability: "Cp Cpk calculator",
  dpmo: "DPMO calculator",
  takt: "Takt time calculator",
};

function parsePositive(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null, digits = 2) {
  return value === null || !Number.isFinite(value) ? "N/A" : value.toFixed(digits);
}

function calculateOee(row: OeeRow) {
  const planned = parsePositive(row.plannedMinutes);
  const run = parsePositive(row.runMinutes);
  const idealCycle = parsePositive(row.idealCycleSeconds);
  const total = parsePositive(row.totalCount);
  const good = parsePositive(row.goodCount);
  const availability = planned && run ? Math.min(1, run / planned) : null;
  const performance = run && idealCycle && total ? Math.min(1, (idealCycle * total) / (run * 60)) : null;
  const quality = total && good ? Math.min(1, good / total) : null;
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

function average(values: Array<number | null>) {
  const usableValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (usableValues.length === 0) {
    return null;
  }

  return usableValues.reduce((sum, value) => sum + value, 0) / usableValues.length;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function csvEscape(value: string) {
  return value.includes(",") || value.includes('"') || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function FormulaLabClient() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [activeTab, setActiveTab] = useState<FormulaTab>("oee");
  const [oeeRows, setOeeRows] = useState<OeeRow[]>(DEFAULT_OEE_ROWS);
  const [capabilityData, setCapabilityData] = useState("10.01\n10.03\n9.99\n10.02\n10.00\n10.04");
  const [lsl, setLsl] = useState("9.95");
  const [usl, setUsl] = useState("10.05");
  const [dpmoDefects, setDpmoDefects] = useState("7");
  const [dpmoUnits, setDpmoUnits] = useState("100");
  const [dpmoOpps, setDpmoOpps] = useState("3");
  const [taktMinutes, setTaktMinutes] = useState("420");
  const [taktDemand, setTaktDemand] = useState("210");
  const [formulaName, setFormulaName] = useState("OEE calculator");
  const [savedFormulas, setSavedFormulas] = useState<SavedFormula[]>([]);
  const [selectedFormulaId, setSelectedFormulaId] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const oeeResults = useMemo(() => oeeRows.map((row) => ({ row, stats: calculateOee(row) })), [oeeRows]);
  const oeeAverage = useMemo(
    () => ({
      availability: average(oeeResults.map((entry) => entry.stats.availability)),
      performance: average(oeeResults.map((entry) => entry.stats.performance)),
      quality: average(oeeResults.map((entry) => entry.stats.quality)),
      oee: average(oeeResults.map((entry) => entry.stats.oee)),
    }),
    [oeeResults],
  );
  const capabilityStats = useMemo(
    () => calculateCapability(parseMeasurementValues(capabilityData), lsl, usl),
    [capabilityData, lsl, usl],
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
      const response = await fetch("/api/process-maps/formulas", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
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

  function updateOeeRow(rowId: string, key: keyof OeeRow, value: string) {
    setOeeRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)),
    );
  }

  function addOeeRow() {
    setOeeRows((current) => [
      ...current,
      {
        id: `operator-${Date.now()}`,
        operator: `Operator ${current.length + 1}`,
        plannedMinutes: "480",
        runMinutes: "",
        idealCycleSeconds: "45",
        totalCount: "",
        goodCount: "",
      },
    ]);
  }

  function removeOeeRow(rowId: string) {
    setOeeRows((current) =>
      current.length <= 1 ? current : current.filter((row) => row.id !== rowId),
    );
  }

  function buildFormulaPayload() {
    return {
      version: 1,
      oeeRows,
      capabilityData,
      lsl,
      usl,
      dpmoDefects,
      dpmoUnits,
      dpmoOpps,
      taktMinutes,
      taktDemand,
    };
  }

  function applySavedFormula(formula: SavedFormula) {
    const payload = isRecord(formula.payload) ? formula.payload : {};
    setSelectedFormulaId(formula.id);
    setFormulaName(formula.name);
    setActiveTab(formula.formulaType);

    if (Array.isArray(payload.oeeRows)) {
      const nextRows = payload.oeeRows
        .filter(isRecord)
        .map((row, index) => ({
          id: typeof row.id === "string" ? row.id : `operator-${index + 1}`,
          operator: typeof row.operator === "string" ? row.operator : `Operator ${index + 1}`,
          plannedMinutes: typeof row.plannedMinutes === "string" ? row.plannedMinutes : "",
          runMinutes: typeof row.runMinutes === "string" ? row.runMinutes : "",
          idealCycleSeconds:
            typeof row.idealCycleSeconds === "string" ? row.idealCycleSeconds : "",
          totalCount: typeof row.totalCount === "string" ? row.totalCount : "",
          goodCount: typeof row.goodCount === "string" ? row.goodCount : "",
        }));
      if (nextRows.length > 0) {
        setOeeRows(nextRows);
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
            payload: buildFormulaPayload(),
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
      setLibraryMessage("Formula saved.");
    } catch (caughtError) {
      setLibraryError(caughtError instanceof Error ? caughtError.message : "Unable to save formula.");
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

  function startNewFormula(tab: FormulaTab = activeTab) {
    setSelectedFormulaId("");
    setFormulaName(DEFAULT_FORMULA_NAMES[tab]);
    setActiveTab(tab);
  }

  function exportOeeCsv() {
    const rows = [
      ["operator", "availability_percent", "performance_percent", "quality_percent", "oee_percent"],
      ...oeeResults.map(({ row, stats }) => [
        row.operator,
        formatNumber(stats.availability === null ? null : stats.availability * 100),
        formatNumber(stats.performance === null ? null : stats.performance * 100),
        formatNumber(stats.quality === null ? null : stats.quality * 100),
        formatNumber(stats.oee === null ? null : stats.oee * 100),
      ]),
      [
        "Average",
        formatNumber(oeeAverage.availability === null ? null : oeeAverage.availability * 100),
        formatNumber(oeeAverage.performance === null ? null : oeeAverage.performance * 100),
        formatNumber(oeeAverage.quality === null ? null : oeeAverage.quality * 100),
        formatNumber(oeeAverage.oee === null ? null : oeeAverage.oee * 100),
      ],
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? "");
            return value.includes(",") || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value;
          })
          .join(","),
      )
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
        ["Operator", "Planned min", "Run min", "Ideal sec", "Total", "Good", "Availability", "Performance", "Quality", "OEE"],
        ...oeeResults.map(({ row, stats }) => [
          row.operator,
          row.plannedMinutes,
          row.runMinutes,
          row.idealCycleSeconds,
          row.totalCount,
          row.goodCount,
          formatPercent(stats.availability),
          formatPercent(stats.performance),
          formatPercent(stats.quality),
          formatPercent(stats.oee),
        ]),
        [
          "Average",
          "",
          "",
          "",
          "",
          "",
          formatPercent(oeeAverage.availability),
          formatPercent(oeeAverage.performance),
          formatPercent(oeeAverage.quality),
          formatPercent(oeeAverage.oee),
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

    return [
      ["Metric", "Value"],
      ["Available production minutes", taktMinutes],
      ["Customer demand", taktDemand],
      ["Minutes / unit", formatNumber(taktStats.minutesPerUnit, 3)],
      ["Seconds / unit", formatNumber(taktStats.secondsPerUnit, 1)],
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
    const rows = getActiveFormulaRows();
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1000,height=760");
    if (!printWindow) {
      setLibraryError("Unable to open print window. Check your browser popup settings.");
      return;
    }

    const table = `<table>${rows
      .map((row, index) =>
        `<tr>${row
          .map((cell) =>
            index === 0
              ? `<th>${escapeHtml(cell)}</th>`
              : `<td>${escapeHtml(cell)}</td>`,
          )
          .join("")}</tr>`,
      )
      .join("")}</table>`;
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(formulaName || DEFAULT_FORMULA_NAMES[activeTab])}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
    h1 { font-size: 24px; margin: 0 0 6px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 18px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
    th { background: #f1f5f9; }
    @media print { body { margin: 16mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(formulaName || DEFAULT_FORMULA_NAMES[activeTab])}</h1>
  <div class="meta">Calculator: ${escapeHtml(activeTab.toUpperCase())} | Printed ${escapeHtml(new Date().toLocaleString())}</div>
  ${table}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Formula Tools
          </h1>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Use quick calculators for process data. OEE supports multiple operator rows and
            calculates the actual average percentage across recorded rows.
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
              {savedFormulas.map((formula) => (
                <option key={formula.id} value={formula.id}>
                  {formula.name} ({formula.formulaType.toUpperCase()})
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
        </div>
      </section>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-300/70 bg-white/90 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
        {(
          [
            ["oee", "OEE"],
            ["capability", "Cp / Cpk"],
            ["dpmo", "DPMO"],
            ["takt", "Takt Time"],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => startNewFormula(tab)}
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

      {activeTab === "oee" ? (
        <section className="grid gap-4 rounded-2xl border border-slate-300/70 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                OEE by Operator
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                OEE = Availability x Performance x Quality.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addOeeRow}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-100"
              >
                <Plus size={14} />
                Add row
              </button>
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[62rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-2 py-2">Operator</th>
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
                {oeeResults.map(({ row, stats }) => (
                  <tr key={row.id} className="border-b border-slate-200 dark:border-slate-800">
                    {(
                      [
                        ["operator", row.operator],
                        ["plannedMinutes", row.plannedMinutes],
                        ["runMinutes", row.runMinutes],
                        ["idealCycleSeconds", row.idealCycleSeconds],
                        ["totalCount", row.totalCount],
                        ["goodCount", row.goodCount],
                      ] as const
                    ).map(([key, value]) => (
                      <td key={key} className="px-2 py-2">
                        <input
                          value={value}
                          onChange={(event) => updateOeeRow(row.id, key, event.target.value)}
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
                        onClick={() => removeOeeRow(row.id)}
                        disabled={oeeRows.length <= 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                        aria-label={`Remove ${row.operator}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-cyan-500/10 text-sm font-extrabold text-slate-950 dark:text-slate-50">
                  <td className="px-2 py-3" colSpan={6}>
                    Average
                  </td>
                  <td className="px-2 py-3 text-right">{formatPercent(oeeAverage.availability)}</td>
                  <td className="px-2 py-3 text-right">{formatPercent(oeeAverage.performance)}</td>
                  <td className="px-2 py-3 text-right">{formatPercent(oeeAverage.quality)}</td>
                  <td className="px-2 py-3 text-right">{formatPercent(oeeAverage.oee)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
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
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Measurements</span>
              <textarea value={capabilityData} onChange={(event) => setCapabilityData(event.target.value)} rows={10} className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
            </label>
          </div>
          <FormulaResults
            rows={[
              ["N", String(capabilityStats?.count ?? 0)],
              ["Mean", formatNumber(capabilityStats?.mean ?? null, 3)],
              ["Sigma", formatNumber(capabilityStats?.sigma ?? null, 3)],
              ["Cp", formatNumber(capabilityStats?.cp ?? null, 3)],
              ["Cpk", formatNumber(capabilityStats?.cpk ?? null, 3)],
            ]}
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
            rows={[
              ["DPMO", formatNumber(dpmoStats.dpmo, 0)],
              ["Yield", dpmoStats.yieldPercent === null ? "N/A" : `${formatNumber(dpmoStats.yieldPercent, 2)}%`],
            ]}
          />
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
            rows={[
              ["Minutes / unit", formatNumber(taktStats.minutesPerUnit, 3)],
              ["Seconds / unit", formatNumber(taktStats.secondsPerUnit, 1)],
            ]}
          />
        </section>
      ) : null}
    </div>
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

function FormulaResults({ rows }: { rows: Array<[string, string]> }) {
  return (
    <aside className="grid content-start gap-3 rounded-xl border border-slate-300/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/45">
      <h3 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">Results</h3>
      <dl className="grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-300/70 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
            <dt className="text-sm text-slate-600 dark:text-slate-300">{label}</dt>
            <dd className="font-extrabold text-slate-950 dark:text-slate-50">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
