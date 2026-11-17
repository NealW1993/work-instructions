/*
 * The optional details an author can add to a work instruction, in the words used on the shop floor.
 * One list keeps the form, the instruction page, the printout and the change history saying the same thing.
 * (The database columns keep their original names.)
 */

export const INSTRUCTION_DETAILS = {
  processScope: {
    label: "Where this applies",
    placeholder: "Machine, line, cell or shift this covers",
  },
  acceptanceCriteria: {
    label: "What good looks like",
    placeholder: "How to tell the job was done right",
  },
  verificationRecords: {
    label: "Records to fill out",
    placeholder: "Forms, logs or travelers to complete",
  },
  riskControls: {
    label: "Safety and what to do if something goes wrong",
    placeholder: "Hazards, protection needed and who to call",
  },
} as const;

export type InstructionDetailKey = keyof typeof INSTRUCTION_DETAILS;

/** The filled-in details of an instruction as label and value pairs, in display order. */
export function instructionDetailRows(values: {
  processScope?: string | null;
  acceptanceCriteria?: string | null;
  verificationRecords?: string | null;
  riskControls?: string | null;
}): Array<{ key: InstructionDetailKey; label: string; value: string }> {
  return (Object.keys(INSTRUCTION_DETAILS) as InstructionDetailKey[])
    .map((key) => ({ key, label: INSTRUCTION_DETAILS[key].label, value: (values[key] ?? "").trim() }))
    .filter((row) => row.value.length > 0);
}
