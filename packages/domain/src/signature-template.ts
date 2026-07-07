const OPERATOR_FIRST_NAME_TOKEN_PATTERN = /\{\{\s*operatorFirstName\s*\}\}/gu;
const OPERATOR_FIRST_NAME_TOKEN_DETECTOR = /\{\{\s*operatorFirstName\s*\}\}/u;
const CARRIAGE_RETURN_PATTERN = /\r\n?/gu;

export function firstNameFromName(
  fullName: string | null | undefined,
): string | null {
  const trimmed = fullName?.trim() ?? "";

  if (trimmed.length === 0) {
    return null;
  }

  const [firstName] = trimmed.split(/\s+/u);
  return firstName?.length ? firstName : null;
}

function collapseEmptyOperatorTokenLines(template: string): string {
  return template
    .replace(CARRIAGE_RETURN_PATTERN, "\n")
    .split("\n")
    .filter((line) => {
      if (line.trim().length === 0) {
        return true;
      }

      if (!OPERATOR_FIRST_NAME_TOKEN_DETECTOR.test(line)) {
        return true;
      }

      return line.replace(OPERATOR_FIRST_NAME_TOKEN_PATTERN, "").trim().length > 0;
    })
    .map((line) => line.replace(OPERATOR_FIRST_NAME_TOKEN_PATTERN, ""))
    .join("\n");
}

export function renderSignatureTemplate(
  template: string,
  ctx: { operatorFirstName: string | null },
): string {
  const operatorFirstName = ctx.operatorFirstName?.trim() ?? "";

  if (operatorFirstName.length === 0) {
    return collapseEmptyOperatorTokenLines(template);
  }

  return template.replace(OPERATOR_FIRST_NAME_TOKEN_PATTERN, operatorFirstName);
}
