/** Quote spreadsheet text without allowing formulas to run when opened in Excel. */
export function escapeDelimitedCell(value: string | number | boolean | null | undefined, delimiter: string) {
  const text = value == null ? "" : String(value);
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return safe.includes(delimiter) || /["\r\n]/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}
