"use client";

import { useState } from "react";
import { ModalDialog as EditorDialog } from "@/components/ui/modal-dialog";
import { normalizeChartData, type ChartPoint, type InstructionChartType } from "@/lib/instruction-chart";

export { ModalDialog as EditorDialog } from "@/components/ui/modal-dialog";

export interface ChartValue { title: string; type: InstructionChartType; data: ChartPoint[] }

export function ChartDialog({ initial, onSave, onClose }: { initial?: ChartValue; onSave: (value: ChartValue) => void; onClose: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<InstructionChartType>(initial?.type ?? "bar");
  const [rows, setRows] = useState(initial?.data.map((point) => `${point.label}, ${point.value}`).join("\n") ?? "");
  const [error, setError] = useState("");
  const save = () => {
    const values = rows.trim().split(/\r?\n/).map((row) => {
      const separator = Math.max(row.lastIndexOf(","), row.lastIndexOf(":"));
      const rawValue = row.slice(separator + 1).trim();
      return { label: separator > 0 ? row.slice(0, separator).trim() : "", value: rawValue ? Number(rawValue) : NaN };
    });
    const data = normalizeChartData(values);
    if (!title.trim() || !data) { setError("Enter a chart title and 1–24 rows in Label, numeric value format. Labels must be 80 characters or fewer."); return; }
    onSave({ title: title.trim(), type, data });
    onClose();
  };
  const inputClass = "min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700";
  return <EditorDialog title="Chart" onClose={onClose}>
    <p className="text-sm text-slate-600 dark:text-slate-400">Plot supplied process data. Every value is also kept in a readable table for printing and review. The chart is saved as a <code>```chart</code> block you can edit later as text.</p>
    <label className="grid gap-1 text-sm font-medium">Chart title<input autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></label>
    <label className="grid gap-1 text-sm font-medium">Chart type<select value={type} onChange={(event) => setType(event.target.value as InstructionChartType)} className={inputClass}><option value="bar">Bar chart</option><option value="line">Line chart</option></select></label>
    <label className="grid gap-1 text-sm font-medium">Chart data<textarea aria-label="Chart data" value={rows} onChange={(event) => setRows(event.target.value)} rows={7} placeholder={"Station A, 12\nStation B, 15\nStation C, 9"} className={`${inputClass} font-mono`} /></label>
    <p className="text-xs text-slate-500">One Label, value per line. Use a period as the decimal separator. Include measurement units in the title.</p>
    {error ? <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4">Cancel</button><button type="button" onClick={save} className="min-h-11 rounded-lg bg-cyan-700 px-4 font-semibold text-white">{initial ? "Update chart" : "Insert chart"}</button></div>
  </EditorDialog>;
}
