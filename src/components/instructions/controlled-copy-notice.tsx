import { LocalDateTime } from "@/components/ui/local-date-time";

export function ControlledCopyNotice({
  status, archived, approvedAt, partId, department,
}: {
  status: string | null;
  archived: boolean;
  approvedAt?: string | null;
  partId: string;
  department: string;
}) {
  const released = status === "approved" && !archived;
  return (
    <div className="my-3 break-inside-avoid rounded-lg border-2 border-current p-3 text-sm text-slate-900 dark:text-slate-100 print:text-black">
      <p className="font-bold uppercase tracking-wide">
        {archived ? "Archived revision — reference only" : released ? "Approved revision" : "Unreleased revision — do not use for production"}
      </p>
      <p>Part ID: {partId} · Department: {department}</p>
      {released && approvedAt ? <p>Approved: <LocalDateTime value={approvedAt} mode="dateTime" /></p> : null}
      <p className="mt-1 text-xs">Printed copies are uncontrolled. Verify the current approved revision in the application before use.</p>
    </div>
  );
}
