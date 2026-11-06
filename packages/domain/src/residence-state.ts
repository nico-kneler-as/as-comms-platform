import {
  isResidenceStateCode,
  residenceStateNames,
  type ResidenceStateCode,
} from "@as-comms/contracts";

const residenceStateAliases: Readonly<Record<string, ResidenceStateCode>> = {
  "washington dc": "DC",
  "washington d c": "DC",
  "district of columbia": "DC",
  "washington district of columbia": "DC",
  washington: "WA",
  mass: "MA",
  calif: "CA",
  penn: "PA",
  penna: "PA",
  wash: "WA",
  newfoundland: "NL",
  "newfoundland and labrador": "NL",
  labrador: "NL",
  yukon: "YT",
  "yukon territory": "YT",
  nwt: "NT",
  pei: "PE",
  quebec: "QC",
};

function normalizeResidenceStateInput(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const codeByNormalizedName: Readonly<Record<string, ResidenceStateCode>> = Object.fromEntries(
  Object.entries(residenceStateNames).map(([code, name]) => [
    normalizeResidenceStateInput(name),
    code as ResidenceStateCode,
  ]),
);

export function normalizeStateOfResidence(
  raw: string | null | undefined,
): ResidenceStateCode | null {
  if (raw == null) return null;

  const normalized = normalizeResidenceStateInput(raw);
  if (["", "-", "n/a", "none"].includes(normalized)) return null;

  const code = normalized.toUpperCase();
  if (isResidenceStateCode(code)) return code;

  return codeByNormalizedName[normalized] ?? residenceStateAliases[normalized] ?? null;
}
