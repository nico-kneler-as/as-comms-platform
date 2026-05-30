export type CanonicalEventParticipantRole =
  | "sender"
  | "direct_recipient"
  | "cc"
  | "bcc";

export interface CanonicalEventAudienceParticipant {
  readonly email: string;
  readonly role: CanonicalEventParticipantRole;
}

export interface ResolveCanonicalEventAudienceInput {
  readonly fromEmails: readonly string[];
  readonly toEmails: readonly string[];
  readonly ccEmails: readonly string[];
  readonly bccEmails: readonly string[];
}

export interface ResolveCanonicalEventAudienceResult {
  readonly participants: readonly CanonicalEventAudienceParticipant[];
}

const ROLE_PRECEDENCE: Record<CanonicalEventParticipantRole, number> = {
  sender: 0,
  direct_recipient: 1,
  cc: 2,
  bcc: 3,
};

type RoleInput = readonly [
  CanonicalEventParticipantRole,
  readonly string[],
];

function compareParticipants(
  left: CanonicalEventAudienceParticipant,
  right: CanonicalEventAudienceParticipant,
): number {
  const precedenceDifference =
    ROLE_PRECEDENCE[left.role] - ROLE_PRECEDENCE[right.role];

  if (precedenceDifference !== 0) {
    return precedenceDifference;
  }

  return left.email.localeCompare(right.email);
}

export function resolveCanonicalEventAudience(
  input: ResolveCanonicalEventAudienceInput,
): ResolveCanonicalEventAudienceResult {
  const participantsByEmail = new Map<string, CanonicalEventParticipantRole>();
  const roleInputs: readonly RoleInput[] = [
    ["sender", input.fromEmails],
    ["direct_recipient", input.toEmails],
    ["cc", input.ccEmails],
    ["bcc", input.bccEmails],
  ];

  for (const [role, emails] of roleInputs) {
    for (const email of emails) {
      if (!participantsByEmail.has(email)) {
        participantsByEmail.set(email, role);
      }
    }
  }

  const participants = [...participantsByEmail.entries()]
    .map(([email, role]) => ({ email, role }))
    .sort(compareParticipants);

  return { participants };
}
