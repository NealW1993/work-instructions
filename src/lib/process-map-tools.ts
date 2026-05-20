export type DmaicPhase = "define" | "measure" | "analyze" | "improve" | "control";

export type DiagramType =
  | "sipoc"
  | "process_map"
  | "flowchart"
  | "swimlane"
  | "value_stream_map"
  | "project_charter"
  | "ctq_tree"
  | "fishbone"
  | "pareto"
  | "histogram"
  | "run_chart"
  | "control_chart"
  | "scatter_plot"
  | "fmea"
  | "control_plan"
  | "solution_matrix";

export interface DmaicPhaseOption {
  id: DmaicPhase;
  label: string;
  purpose: string;
}

export interface DiagramDefinition {
  id: DiagramType;
  label: string;
  shortLabel: string;
  category: "Process" | "Six Sigma" | "Data" | "Risk";
  dmaicPhases: DmaicPhase[];
  description: string;
  whenToUse: string;
  isoUse: string;
  starterItems: string[];
  keyFields: string[];
}

export interface DiagramRecommendation {
  diagramType: DiagramType;
  dmaicPhase: DmaicPhase;
  confidence: number;
  reason: string;
  suggestedTitle: string;
  starterItems: string[];
  keyFields: string[];
  setupSteps: string[];
  formulaTool?: "none" | "capability" | "dpmo" | "takt_time" | "control_limits" | "oee";
  metricRows?: string[];
  specLower?: number | null;
  specUpper?: number | null;
  target?: number | null;
  layerSuggestions?: string[];
  mode: "ai" | "rules";
  warning?: string | null;
  openAiConfigured?: boolean;
}

export const DMAIC_PHASE_OPTIONS: DmaicPhaseOption[] = [
  {
    id: "define",
    label: "Define",
    purpose: "Clarify the customer, problem, project scope, high-level process, and CTQs.",
  },
  {
    id: "measure",
    label: "Measure",
    purpose: "Plan data collection and understand baseline performance.",
  },
  {
    id: "analyze",
    label: "Analyze",
    purpose: "Find likely root causes, relationships, and drivers of variation.",
  },
  {
    id: "improve",
    label: "Improve",
    purpose: "Select, test, and document the future-state process or countermeasure.",
  },
  {
    id: "control",
    label: "Control",
    purpose: "Lock the gain with monitoring, reaction plans, and ownership.",
  },
];

export const DIAGRAM_DEFINITIONS: DiagramDefinition[] = [
  {
    id: "sipoc",
    label: "SIPOC Diagram",
    shortLabel: "SIPOC",
    category: "Six Sigma",
    dmaicPhases: ["define"],
    description: "Suppliers, Inputs, Process, Outputs, and Customers on one page.",
    whenToUse: "Use early in Define when scope, customers, or process boundaries are unclear.",
    isoUse: "Supports ISO 9001 process definition, inputs, outputs, and interaction mapping.",
    starterItems: ["Supplier", "Input", "Process step", "Output", "Customer"],
    keyFields: ["Suppliers", "Inputs", "5-7 major process steps", "Outputs", "Customers"],
  },
  {
    id: "process_map",
    label: "High-Level Process Map",
    shortLabel: "Process Map",
    category: "Process",
    dmaicPhases: ["define", "measure", "improve", "control"],
    description: "A simple top-level sequence showing the current or future process.",
    whenToUse: "Use when stakeholders need a shared view of process sequence and ownership.",
    isoUse: "Good controlled document evidence for process approach and operational planning.",
    starterItems: ["Trigger", "Receive request", "Prepare work", "Perform work", "Verify output", "Release"],
    keyFields: ["Trigger", "Steps", "Decision points", "Owner", "Output"],
  },
  {
    id: "flowchart",
    label: "Detailed Flowchart",
    shortLabel: "Flowchart",
    category: "Process",
    dmaicPhases: ["measure", "analyze", "improve", "control"],
    description: "Step-by-step process boxes and decision points.",
    whenToUse: "Use when handoffs, rework loops, decisions, or failure points need detail.",
    isoUse: "Useful for controlled work instructions and process-control references.",
    starterItems: ["Start", "Inspect request", "Decision", "Perform task", "Record result", "End"],
    keyFields: ["Start/end", "Tasks", "Decision criteria", "Records", "Escalation path"],
  },
  {
    id: "swimlane",
    label: "Swimlane Map",
    shortLabel: "Swimlane",
    category: "Process",
    dmaicPhases: ["measure", "analyze", "improve"],
    description: "Process steps organized by role, department, or system lane.",
    whenToUse: "Use when delays, handoffs, or unclear responsibilities are the main concern.",
    isoUse: "Clarifies responsibility and interaction between processes.",
    starterItems: ["Operator: Receive work", "Quality: Verify requirements", "Supervisor: Approve release"],
    keyFields: ["Lanes", "Handoffs", "Approvals", "Queue points", "Records"],
  },
  {
    id: "value_stream_map",
    label: "Value Stream Map",
    shortLabel: "VSM",
    category: "Six Sigma",
    dmaicPhases: ["measure", "analyze", "improve"],
    description: "Maps material/information flow with time, waiting, yield, or inventory metrics.",
    whenToUse: "Use when lead time, queues, waste, or throughput are central to the problem.",
    isoUse: "Connects process flow with performance measures and improvement evidence.",
    starterItems: ["Customer demand", "Order intake", "Queue", "Process", "Inspection", "Shipment"],
    keyFields: ["Cycle time", "Wait time", "Yield", "Inventory/WIP", "Information flow"],
  },
  {
    id: "project_charter",
    label: "DMAIC Project Charter",
    shortLabel: "Charter",
    category: "Six Sigma",
    dmaicPhases: ["define"],
    description: "Problem statement, goal, scope, business case, team, and timeline.",
    whenToUse: "Use at Define kickoff when the project still needs formal alignment.",
    isoUse: "Creates traceability for improvement objectives, scope, and ownership.",
    starterItems: ["Problem", "Goal", "Scope", "Business impact", "Team", "Timeline"],
    keyFields: ["Problem statement", "Goal statement", "Scope", "Sponsor", "Timeline"],
  },
  {
    id: "ctq_tree",
    label: "CTQ Tree",
    shortLabel: "CTQ",
    category: "Six Sigma",
    dmaicPhases: ["define", "measure"],
    description: "Breaks customer needs into critical-to-quality requirements and measures.",
    whenToUse: "Use when the voice of customer must become measurable requirements.",
    isoUse: "Links customer requirements to process controls and objective measures.",
    starterItems: ["Customer need", "Quality driver", "CTQ requirement", "Metric", "Target"],
    keyFields: ["Need", "Drivers", "CTQs", "Metric", "Specification"],
  },
  {
    id: "fishbone",
    label: "Fishbone Root-Cause Diagram",
    shortLabel: "Fishbone",
    category: "Six Sigma",
    dmaicPhases: ["analyze"],
    description: "Cause-and-effect diagram for structured root-cause brainstorming.",
    whenToUse: "Use in Analyze when the team needs to organize possible root causes.",
    isoUse: "Supports corrective action analysis and risk-based thinking evidence.",
    starterItems: ["People", "Methods", "Machines", "Materials", "Measurement", "Environment"],
    keyFields: ["Effect/problem", "Cause categories", "Potential causes", "Evidence needed"],
  },
  {
    id: "pareto",
    label: "Pareto Chart",
    shortLabel: "Pareto",
    category: "Data",
    dmaicPhases: ["measure", "analyze", "improve"],
    description: "Ranks defect, delay, or issue categories by count or impact.",
    whenToUse: "Use when deciding which few categories deserve the most attention.",
    isoUse: "Shows data-based prioritization for improvement and corrective action.",
    starterItems: ["Defect A", "Defect B", "Defect C", "Defect D", "Other"],
    keyFields: ["Categories", "Counts", "Cumulative percent", "Date range", "Data source"],
  },
  {
    id: "histogram",
    label: "Histogram",
    shortLabel: "Histogram",
    category: "Data",
    dmaicPhases: ["measure", "analyze"],
    description: "Shows the distribution of measured process data.",
    whenToUse: "Use when checking spread, skew, centering, or outliers.",
    isoUse: "Provides objective evidence for baseline process performance.",
    starterItems: ["Bin 1", "Bin 2", "Bin 3", "Bin 4", "Bin 5"],
    keyFields: ["Measurement", "Bins", "Frequency", "Specification limits", "Sample size"],
  },
  {
    id: "run_chart",
    label: "Run Chart",
    shortLabel: "Run Chart",
    category: "Data",
    dmaicPhases: ["measure", "improve", "control"],
    description: "Plots process performance over time without control limits.",
    whenToUse: "Use when you need to see trend, shift, or baseline behavior over time.",
    isoUse: "Useful for monitoring process objectives and improvement progress.",
    starterItems: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6"],
    keyFields: ["Time period", "Metric", "Median/target", "Notes", "Data source"],
  },
  {
    id: "control_chart",
    label: "Control Chart",
    shortLabel: "Control Chart",
    category: "Data",
    dmaicPhases: ["measure", "control"],
    description: "Tracks process stability over time with centerline and control limits.",
    whenToUse: "Use when monitoring variation and detecting special causes matters.",
    isoUse: "Strong evidence for ongoing process control and reaction planning.",
    starterItems: ["Sample 1", "Sample 2", "Sample 3", "Sample 4", "Sample 5", "Sample 6"],
    keyFields: ["Metric", "Subgroup", "Centerline", "UCL/LCL", "Reaction plan"],
  },
  {
    id: "scatter_plot",
    label: "Scatter Plot",
    shortLabel: "Scatter",
    category: "Data",
    dmaicPhases: ["analyze"],
    description: "Compares two variables to look for a relationship.",
    whenToUse: "Use when testing whether one factor may influence an outcome.",
    isoUse: "Supports evidence-based analysis of process variables.",
    starterItems: ["Factor 1", "Factor 2", "Factor 3", "Factor 4", "Factor 5"],
    keyFields: ["X variable", "Y variable", "Sample", "Stratification", "Hypothesis"],
  },
  {
    id: "fmea",
    label: "Process FMEA",
    shortLabel: "FMEA",
    category: "Risk",
    dmaicPhases: ["analyze", "improve", "control"],
    description: "Failure modes, effects, causes, controls, and risk priority.",
    whenToUse: "Use when risk reduction, prevention, or control planning is required.",
    isoUse: "Supports risk-based thinking, operational control, and corrective action.",
    starterItems: ["Process step", "Failure mode", "Effect", "Cause", "Current control", "Action"],
    keyFields: ["Severity", "Occurrence", "Detection", "RPN", "Recommended action"],
  },
  {
    id: "control_plan",
    label: "Control Plan",
    shortLabel: "Control Plan",
    category: "Risk",
    dmaicPhases: ["control"],
    description: "Documents process controls, measures, owners, frequency, and reaction plans.",
    whenToUse: "Use after improvement to sustain performance and clarify monitoring.",
    isoUse: "Directly supports controlled operation, monitoring, and documented information.",
    starterItems: ["Process step", "Control characteristic", "Method", "Frequency", "Owner", "Reaction"],
    keyFields: ["Characteristic", "Specification", "Control method", "Frequency", "Reaction plan"],
  },
  {
    id: "solution_matrix",
    label: "Solution Selection Matrix",
    shortLabel: "Matrix",
    category: "Six Sigma",
    dmaicPhases: ["improve"],
    description: "Scores improvement options against weighted decision criteria.",
    whenToUse: "Use when selecting among countermeasures or future-state options.",
    isoUse: "Documents objective selection criteria and decision rationale.",
    starterItems: ["Option A", "Option B", "Option C", "Impact", "Effort", "Risk"],
    keyFields: ["Options", "Criteria", "Weight", "Score", "Decision"],
  },
];

export function isDmaicPhase(value: unknown): value is DmaicPhase {
  return DMAIC_PHASE_OPTIONS.some((phase) => phase.id === value);
}

export function isDiagramType(value: unknown): value is DiagramType {
  return DIAGRAM_DEFINITIONS.some((definition) => definition.id === value);
}

export function getDiagramDefinition(diagramType: DiagramType) {
  return (
    DIAGRAM_DEFINITIONS.find((definition) => definition.id === diagramType) ??
    DIAGRAM_DEFINITIONS[0]
  );
}

export function getDmaicPhaseOption(phase: DmaicPhase) {
  return (
    DMAIC_PHASE_OPTIONS.find((option) => option.id === phase) ?? DMAIC_PHASE_OPTIONS[0]
  );
}

export function splitListInput(value: string, fallback: string[] = []) {
  const items = value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : fallback;
}

function textIncludesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function recommendDiagramByRules(input: {
  prompt: string;
  dmaicPhase?: DmaicPhase | null;
  dmaicEnabled?: boolean;
  processArea?: string;
}): DiagramRecommendation {
  const prompt = `${input.prompt} ${input.processArea ?? ""}`.toLowerCase();
  const phase = input.dmaicPhase ?? "define";
  let diagramType: DiagramType = "process_map";
  let formulaTool: DiagramRecommendation["formulaTool"] = "none";
  let reasonSuffix = "";

  if (textIncludesAny(prompt, ["oee", "overall equipment effectiveness", "availability", "performance", "quality"])) {
    diagramType = textIncludesAny(prompt, ["trend", "over time", "shift", "daily", "weekly"])
      ? "run_chart"
      : "control_chart";
    formulaTool = "oee";
    reasonSuffix =
      " It also needs an OEE layer using Availability, Performance, and Quality.";
  } else if (
    textIncludesAny(prompt, [
      "cpk",
      "cp ",
      " cp",
      "capability",
      "process capability",
      "spec limit",
      "specification",
      "lsl",
      "usl",
      "tolerance",
    ])
  ) {
    diagramType = textIncludesAny(prompt, ["time", "trend", "control chart", "stability"])
      ? "control_chart"
      : "histogram";
    formulaTool = "capability";
    reasonSuffix =
      " It also needs a capability calculation layer for Cp, Cpu, Cpl, and Cpk.";
  } else if (input.dmaicEnabled === false) {
    diagramType = textIncludesAny(prompt, ["handoff", "department", "role", "responsibility"])
      ? "swimlane"
      : textIncludesAny(prompt, ["defect", "top", "frequency", "largest"])
        ? "pareto"
        : textIncludesAny(prompt, ["risk", "failure", "prevent"])
          ? "fmea"
          : textIncludesAny(prompt, ["trend", "time", "monitor"])
            ? "run_chart"
            : textIncludesAny(prompt, ["decision", "approve", "branch"])
              ? "flowchart"
              : "process_map";
  } else if (phase === "define") {
    diagramType = textIncludesAny(prompt, ["customer", "supplier", "input", "output", "scope"])
      ? "sipoc"
      : textIncludesAny(prompt, ["project", "charter", "goal", "sponsor"])
        ? "project_charter"
        : textIncludesAny(prompt, ["ctq", "voice of customer", "requirement"])
          ? "ctq_tree"
          : "process_map";
  } else if (phase === "measure") {
    diagramType = textIncludesAny(prompt, ["stability", "variation", "control"])
      ? "control_chart"
      : textIncludesAny(prompt, ["distribution", "spread", "capability"])
        ? "histogram"
        : textIncludesAny(prompt, ["defect", "top", "most common", "frequency"])
          ? "pareto"
          : "run_chart";
  } else if (phase === "analyze") {
    diagramType = textIncludesAny(prompt, ["relationship", "correlation", "factor", "variable"])
      ? "scatter_plot"
      : textIncludesAny(prompt, ["risk", "failure", "prevent"])
        ? "fmea"
        : textIncludesAny(prompt, ["defect", "frequency", "largest"])
          ? "pareto"
          : "fishbone";
  } else if (phase === "improve") {
    diagramType = textIncludesAny(prompt, ["choose", "select", "compare", "options"])
      ? "solution_matrix"
      : textIncludesAny(prompt, ["handoff", "department", "role"])
        ? "swimlane"
        : textIncludesAny(prompt, ["lead time", "waste", "queue", "flow"])
          ? "value_stream_map"
          : "flowchart";
  } else if (phase === "control") {
    diagramType = textIncludesAny(prompt, ["chart", "monitor", "variation", "stability"])
      ? "control_chart"
      : "control_plan";
  }

  const definition = getDiagramDefinition(diagramType);
  const phaseOption = getDmaicPhaseOption(phase);

  return {
    diagramType,
    dmaicPhase: phase,
    confidence: 78,
    reason:
      input.dmaicEnabled === false
        ? `${definition.label} fits this request because ${definition.whenToUse.toLowerCase()}${reasonSuffix}`
        : `${definition.label} fits the ${phaseOption.label} phase because ${definition.whenToUse.toLowerCase()}${reasonSuffix}`,
    suggestedTitle:
      input.dmaicEnabled === false
        ? `${definition.shortLabel} Draft`
        : `${phaseOption.label} - ${definition.shortLabel}`,
    starterItems: definition.starterItems,
    keyFields: definition.keyFields,
    setupSteps: [
      "Confirm the business problem and process boundary.",
      "Collect the minimum data or stakeholder inputs needed for the chart.",
      "Review the draft with the process owner before controlled approval.",
    ],
    formulaTool,
    metricRows:
      formulaTool === "capability"
        ? ["Sample 1,10.01,0", "Sample 2,10.03,0", "Sample 3,9.99,0", "Sample 4,10.02,0", "Sample 5,10.00,0"]
        : [],
    specLower: null,
    specUpper: null,
    target: null,
    layerSuggestions:
      formulaTool === "capability"
        ? ["Measurement data", "Specification limits", "Capability formulas", "Histogram or control chart"]
        : ["Content", "Data", "Style", "Controlled document output"],
    mode: "rules",
    openAiConfigured: false,
  };
}
