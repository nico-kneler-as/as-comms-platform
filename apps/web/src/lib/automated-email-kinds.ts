import type { AutomatedEmailKind } from "@as-comms/contracts";

export interface AutomatedEmailKindDefinition {
  readonly kind: Exclude<AutomatedEmailKind, "custom">;
  readonly label: string;
  readonly phase: "Application" | "Decision" | "Training" | "Field" | "After";
  readonly blurb: string;
}

/** Exact operator copy from the automated-emails design handoff. */
export const AUTOMATED_EMAIL_KIND_DEFINITIONS = [
  {
    kind: "application_received",
    label: "Application received",
    phase: "Application",
    blurb: "Confirms the application landed.",
  },
  {
    kind: "application_nudge",
    label: "Application nudge",
    phase: "Application",
    blurb: "Started but never submitted.",
  },
  {
    kind: "application_submitted",
    label: "Application submitted",
    phase: "Application",
    blurb: "Full application is in review.",
  },
  {
    kind: "accepted",
    label: "Accepted",
    phase: "Decision",
    blurb: "Welcome + first step.",
  },
  {
    kind: "denied",
    label: "Denied",
    phase: "Decision",
    blurb: "Kind no, with what to try next.",
  },
  {
    kind: "training_reminder",
    label: "Training reminder",
    phase: "Training",
    blurb: "Training assigned, not finished.",
  },
  {
    kind: "training_passed",
    label: "Training passed",
    phase: "Training",
    blurb: "Cleared to plan a trip.",
  },
  {
    kind: "trip_planning",
    label: "Trip planning / gear",
    phase: "Field",
    blurb: "Logistics and the gear checklist.",
  },
  {
    kind: "data_reminder",
    label: "Data reminder",
    phase: "Field",
    blurb: "Trip logged, records not submitted.",
  },
  {
    kind: "first_record",
    label: "First record",
    phase: "Field",
    blurb: "Celebrates the first submission.",
  },
  {
    kind: "post_trip",
    label: "Post-trip",
    phase: "After",
    blurb: "Thanks, season wrap, what happens to the data.",
  },
] as const satisfies readonly AutomatedEmailKindDefinition[];

export const AUTOMATED_EMAIL_PHASES = [
  "Application",
  "Decision",
  "Training",
  "Field",
  "After",
] as const;
