import { z } from "zod";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const nullableStringSchema = z.string().min(1).nullable();
const coercingNullableString = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().min(1).nullable(),
);
const stringRecordSchema = z.record(z.string(), z.string());
const nullableMetadataSchema = z.preprocess(
  (value) => (value === "" || value == null ? {} : value),
  stringRecordSchema,
);

export const campaignKindValues = ["newsletter", "project"] as const;
export const campaignKindSchema = z.enum(campaignKindValues);
export type CampaignKind = z.infer<typeof campaignKindSchema>;

export const launchTypeValues = ["normal_email", "html_email", "sms"] as const;
export const launchTypeSchema = z.enum(launchTypeValues);
export type LaunchType = z.infer<typeof launchTypeSchema>;

export const runStateValues = [
  "draft",
  "scheduled",
  "sending",
  "complete",
  "finalized",
  "cancelled",
] as const;
export const runStateSchema = z.enum(runStateValues);
export type RunState = z.infer<typeof runStateSchema>;

export const consentScopeTypeValues = ["project", "newsletter", "all"] as const;
export const consentScopeTypeSchema = z.enum(consentScopeTypeValues);
export type ConsentScopeType = z.infer<typeof consentScopeTypeSchema>;

export const consentSourceValues = [
  "recipient_click",
  "admin_action",
  "provider_event",
  "import",
] as const;
export const consentSourceSchema = z.enum(consentSourceValues);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

export const suppressionReasonValues = [
  "hard_bounce",
  "soft_bounce_strike3",
  "complaint",
  "manual",
] as const;
export const suppressionReasonSchema = z.enum(suppressionReasonValues);
export type SuppressionReason = z.infer<typeof suppressionReasonSchema>;

export const postmarkSenderStatusValues = [
  "unverified",
  "pending",
  "verified",
  "rejected",
] as const;
export const postmarkSenderStatusSchema = z.enum(postmarkSenderStatusValues);
export type PostmarkSenderStatus = z.infer<typeof postmarkSenderStatusSchema>;

export const webhookDeadLetterFailureKindValues = [
  "snapshot_not_found",
  "schema_error",
  "processing_error",
  "unknown_event_type",
] as const;
export const webhookDeadLetterFailureKindSchema = z.enum(
  webhookDeadLetterFailureKindValues,
);
export type WebhookDeadLetterFailureKind = z.infer<
  typeof webhookDeadLetterFailureKindSchema
>;

export const webhookDeadLetterStatusValues = [
  "pending",
  "retried",
  "terminal",
] as const;
export const webhookDeadLetterStatusSchema = z.enum(
  webhookDeadLetterStatusValues,
);
export type WebhookDeadLetterStatus = z.infer<
  typeof webhookDeadLetterStatusSchema
>;

export const deliveryStatusValues = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "unsubscribed",
  "failed",
  "suppressed_at_send",
] as const;
export const deliveryStatusSchema = z.enum(deliveryStatusValues);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const subjectVariantValues = ["a", "b"] as const;
export const subjectVariantSchema = z.enum(subjectVariantValues);
export type SubjectVariant = z.infer<typeof subjectVariantSchema>;

export const campaignRunProjectionProviderValues = [
  "postmark",
  "mailchimp",
] as const;
export const campaignRunProjectionProviderSchema = z.enum(
  campaignRunProjectionProviderValues,
);
export type CampaignRunProjectionProvider = z.infer<
  typeof campaignRunProjectionProviderSchema
>;

export const expeditionMemberStatusValues = [
  "Waitlist",
  "Lead",
  "Applied",
  "Pending Acceptance",
  "Accepted",
  "Confirmed",
  "In Training",
  "In Progress",
  "Trip Planning",
  "In the Field",
  "Successful",
  "Completed",
  "Returning Gear",
  "Denied",
  "Aborted",
  "Soft Denied",
  "Failed",
] as const;
const expeditionMemberStatusEnumSchema = z.enum(expeditionMemberStatusValues);
export const expeditionMemberStatusSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "Soft Dened" ? "Soft Denied" : trimmed;
}, expeditionMemberStatusEnumSchema);
export type ExpeditionMemberStatus = z.infer<
  typeof expeditionMemberStatusSchema
>;

export function normalizeExpeditionMemberStatus(
  value: string | null | undefined,
): ExpeditionMemberStatus | null {
  if (value == null) {
    return null;
  }

  const result = expeditionMemberStatusSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const audienceLastActivityWindowValues = [
  "all_time",
  "last_year",
  "last_90_days",
  "last_30_days",
] as const;
export const audienceLastActivityWindowSchema = z.enum(
  audienceLastActivityWindowValues,
);
export type AudienceLastActivityWindow = z.infer<
  typeof audienceLastActivityWindowSchema
>;

export const audienceTriStateValues = ["either", "yes", "no"] as const;
export const audienceTriStateSchema = z.enum(audienceTriStateValues);
export type AudienceTriState = z.infer<typeof audienceTriStateSchema>;

const audienceCriteriaDefaults = {
  projectId: null,
  projectIds: [],
  statuses: [],
  contactIds: [],
  newsletterSubscriberIds: [],
  expeditionIds: [],
  lastActivityWindow: "all_time" as const,
  hasReplied: "either" as const,
  hasClicked: "either" as const,
};

export const audienceCriteriaSchema = z
  .preprocess((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const input = value as Record<string, unknown>;
    const projectId =
      typeof input.projectId === "string" && input.projectId.trim().length > 0
        ? input.projectId.trim()
        : null;
    const normalizedProjectIds = [
      ...(projectId === null ? [] : [projectId]),
      ...(Array.isArray(input.projectIds)
        ? input.projectIds.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0,
          )
        : []),
    ].filter((entry, index, values) => values.indexOf(entry) === index);

    const filteredStatuses = Array.isArray(input.statuses)
      ? input.statuses.filter(
          (entry) => expeditionMemberStatusSchema.safeParse(entry).success,
        )
      : input.statuses;

    return {
      ...input,
      projectId: normalizedProjectIds[0] ?? null,
      projectIds: normalizedProjectIds,
      statuses: filteredStatuses,
    };
  }, z.object({
    projectId: coercingNullableString.default(audienceCriteriaDefaults.projectId),
    projectIds: z
      .array(z.string().min(1))
      .default(audienceCriteriaDefaults.projectIds),
    statuses: z
      .array(expeditionMemberStatusSchema)
      .default(audienceCriteriaDefaults.statuses),
    contactIds: z
      .array(z.string().min(1))
      .default(audienceCriteriaDefaults.contactIds),
    newsletterSubscriberIds: z
      .array(z.string().uuid())
      .default(audienceCriteriaDefaults.newsletterSubscriberIds),
    expeditionIds: z
      .array(z.string().min(1))
      .default(audienceCriteriaDefaults.expeditionIds),
    lastActivityWindow: audienceLastActivityWindowSchema.default(
      audienceCriteriaDefaults.lastActivityWindow,
    ),
    hasReplied: audienceTriStateSchema.default(
      audienceCriteriaDefaults.hasReplied,
    ),
    hasClicked: audienceTriStateSchema.default(
      audienceCriteriaDefaults.hasClicked,
    ),
    initialFilter: z
      .enum([
        "project_status",
        "specific",
        "all_approved",
        "all_available",
        "csv_upload",
      ])
      .optional(),
  }))
  .transform((value) => ({
    ...value,
    projectIds: [
      ...(value.projectId === null ? [] : [value.projectId]),
      ...value.projectIds,
    ].filter((entry, index, values) => values.indexOf(entry) === index),
  }));
type ParsedAudienceCriteria = z.infer<typeof audienceCriteriaSchema>;
export type AudienceCriteria = Omit<
  ParsedAudienceCriteria,
  "projectId" | "contactIds" | "newsletterSubscriberIds"
> & {
  readonly projectId?: string | null;
  readonly contactIds?: string[];
  readonly newsletterSubscriberIds?: string[];
};

const campaignRunProjectScopeSchema = z
  .object({
    kind: campaignKindSchema,
    projectId: nullableStringSchema.default(null),
  })
  .superRefine((value, context) => {
    if (value.kind === "project" && value.projectId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "projectId is required when kind='project'.",
      });
    }

    if (value.kind === "newsletter" && value.projectId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "projectId must be null when kind='newsletter'.",
      });
    }
  });

const campaignRunEditableFieldsSchema = z.object({
  kind: campaignKindSchema,
  launchType: launchTypeSchema,
  projectId: nullableStringSchema.default(null),
  name: nullableStringSchema.default(null),
  fromEmail: z.string().email().nullable().default(null),
  fromName: nullableStringSchema.default(null),
  replyToEmail: z.string().email().nullable().default(null),
  subjectTemplate: nullableStringSchema.default(null),
  subjectTemplateB: nullableStringSchema.default(null),
  abTestEnabled: z.boolean().default(false),
  bodyHtmlTemplate: nullableStringSchema.default(null),
  bodyDesignJson: z.unknown().nullable().default(null),
  bodyTextTemplate: nullableStringSchema.default(null),
  preheader: nullableStringSchema.default(null),
  audienceCriteria: audienceCriteriaSchema.default(audienceCriteriaDefaults),
  audienceSize: z.number().int().nonnegative().nullable().default(null),
});

export const campaignRunRecordSchema = campaignRunEditableFieldsSchema
  .extend({
    id: idSchema,
    state: runStateSchema,
    scheduledAt: nullableTimestampSchema.default(null),
    startedAt: nullableTimestampSchema.default(null),
    completedAt: nullableTimestampSchema.default(null),
    finalizedAt: nullableTimestampSchema.default(null),
    cancelledAt: nullableTimestampSchema.default(null),
    cancelledReason: nullableStringSchema.default(null),
    createdByUserId: nullableStringSchema.default(null),
    lastEditedByUserId: nullableStringSchema.default(null),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, context) => {
    if (
      value.state === "draft" &&
      value.kind === "project" &&
      value.projectId === null
    ) {
      return;
    }

    const result = campaignRunProjectScopeSchema.safeParse(value);

    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue(issue);
      }
    }
  });
export type CampaignRunRecord = z.infer<typeof campaignRunRecordSchema>;

function validateAudienceSnapshotRecipient(
  value: {
    readonly contactId: string | null;
    readonly newsletterSubscriberId: string | null;
  },
  context: z.RefinementCtx,
): void {
  const recipientCount =
    (value.contactId === null ? 0 : 1) +
    (value.newsletterSubscriberId === null ? 0 : 1);

  if (recipientCount <= 1) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["contactId"],
    message:
      "At most one of contactId or newsletterSubscriberId may be provided.",
  });
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["newsletterSubscriberId"],
    message:
      "At most one of contactId or newsletterSubscriberId may be provided.",
  });
}

const audienceSnapshotSchemaBase = z.object({
  id: idSchema,
  campaignRunId: idSchema,
  contactId: nullableStringSchema.default(null),
  newsletterSubscriberId: nullableStringSchema.default(null),
  frozenEmail: z.string().email(),
  frozenFirstName: nullableStringSchema.default(null),
  frozenProjectName: nullableStringSchema.default(null),
  frozenProjectId: nullableStringSchema.default(null),
  frozenAliasEmail: z.string().email().nullable().default(null),
  unsubscribeToken: z.string().min(1),
  subjectVariant: subjectVariantSchema.nullable().default(null),
  deliveryStatus: deliveryStatusSchema.default("pending"),
  providerMessageId: nullableStringSchema.default(null),
  sentAt: nullableTimestampSchema.default(null),
  deliveredAt: nullableTimestampSchema.default(null),
  bouncedAt: nullableTimestampSchema.default(null),
  openedAt: nullableTimestampSchema.default(null),
  clickedAt: nullableTimestampSchema.default(null),
  complainedAt: nullableTimestampSchema.default(null),
  unsubscribedAt: nullableTimestampSchema.default(null),
  lastEventAt: nullableTimestampSchema.default(null),
  createdAt: timestampSchema,
});

export const audienceSnapshotRecordSchema = audienceSnapshotSchemaBase.superRefine(
  validateAudienceSnapshotRecipient,
);
export type AudienceSnapshotRecord = z.infer<
  typeof audienceSnapshotRecordSchema
>;

export const newAudienceSnapshotSchema = audienceSnapshotSchemaBase
  .omit({
    campaignRunId: true,
    createdAt: true,
  })
  .partial({
    subjectVariant: true,
  })
  .extend({
    deliveryStatus: deliveryStatusSchema.optional(),
    providerMessageId: nullableStringSchema.optional(),
    sentAt: nullableTimestampSchema.optional(),
    deliveredAt: nullableTimestampSchema.optional(),
    bouncedAt: nullableTimestampSchema.optional(),
    openedAt: nullableTimestampSchema.optional(),
    clickedAt: nullableTimestampSchema.optional(),
    complainedAt: nullableTimestampSchema.optional(),
    unsubscribedAt: nullableTimestampSchema.optional(),
    lastEventAt: nullableTimestampSchema.optional(),
  })
  .superRefine(validateAudienceSnapshotRecipient);
export type NewAudienceSnapshot = z.input<typeof newAudienceSnapshotSchema>;

export const contactConsentRecordSchema = z
  .object({
    id: idSchema,
    contactId: idSchema,
    scopeType: consentScopeTypeSchema,
    scopeId: nullableStringSchema.default(null),
    source: consentSourceSchema,
    sourceRunId: nullableStringSchema.default(null),
    optedOutAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .superRefine((value, context) => {
    if (value.scopeType === "project" && value.scopeId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "scopeId is required when scopeType='project'.",
      });
    }

    if (
      (value.scopeType === "newsletter" || value.scopeType === "all") &&
      value.scopeId !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "scopeId must be null unless scopeType='project'.",
      });
    }
  });
export type ContactConsentRecord = z.infer<typeof contactConsentRecordSchema>;

export const suppressionListRecordSchema = z.object({
  id: idSchema,
  normalizedEmail: z.string().email(),
  reason: suppressionReasonSchema,
  firstEventAt: timestampSchema,
  lastEventAt: timestampSchema,
  lastProviderEventId: nullableStringSchema.default(null),
  notes: nullableStringSchema.default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type SuppressionListRecord = z.infer<typeof suppressionListRecordSchema>;

export const orgSettingsRecordSchema = z.object({
  id: z.literal("singleton"),
  physicalAddressLine1: z.string(),
  physicalAddressLine2: z.string(),
  physicalCity: z.string(),
  physicalState: z.string(),
  physicalZip: z.string(),
  physicalCountry: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type OrgSettingsRecord = z.infer<typeof orgSettingsRecordSchema>;

export const postmarkWebhookDeadLetterRecordSchema = z.object({
  id: z.string().uuid(),
  receivedAt: timestampSchema,
  recordType: nullableStringSchema.default(null),
  messageId: nullableStringSchema.default(null),
  sourceEvidenceId: nullableStringSchema.default(null),
  payloadJson: z.unknown(),
  failureKind: webhookDeadLetterFailureKindSchema,
  failureMessage: z.string().min(1),
  retryCount: z.number().int().nonnegative(),
  lastRetryAt: nullableTimestampSchema.default(null),
  status: webhookDeadLetterStatusSchema,
  terminalReason: nullableStringSchema.default(null),
});
export type PostmarkWebhookDeadLetterRecord = z.infer<
  typeof postmarkWebhookDeadLetterRecordSchema
>;

export const campaignRunProjectionRowSchema = z.object({
  runId: idSchema,
  provider: campaignRunProjectionProviderSchema,
  kind: campaignKindSchema,
  launchType: launchTypeSchema,
  state: runStateSchema,
  projectId: nullableStringSchema.default(null),
  sender: z.string(),
  subject: z.string(),
  audienceSize: z.number().int().nullable(),
  scheduledAt: nullableTimestampSchema.default(null),
  startedAt: nullableTimestampSchema.default(null),
  completedAt: nullableTimestampSchema.default(null),
  cancelledAt: nullableTimestampSchema.default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CampaignRunProjectionRow = z.infer<
  typeof campaignRunProjectionRowSchema
>;

export const createDraftInputSchema = campaignRunEditableFieldsSchema
  .pick({
    kind: true,
    launchType: true,
    projectId: true,
    name: true,
    fromEmail: true,
    fromName: true,
    replyToEmail: true,
    subjectTemplate: true,
    subjectTemplateB: true,
    abTestEnabled: true,
    bodyHtmlTemplate: true,
    bodyDesignJson: true,
    bodyTextTemplate: true,
    preheader: true,
    audienceCriteria: true,
    audienceSize: true,
  })
  .extend({
    id: idSchema,
    createdByUserId: nullableStringSchema.default(null),
    lastEditedByUserId: nullableStringSchema.default(null),
  });
export type CreateDraftInput = z.input<typeof createDraftInputSchema>;

export const updateDraftInputSchema = z.object({
  kind: campaignKindSchema.optional(),
  launchType: launchTypeSchema.optional(),
  projectId: nullableStringSchema.optional(),
  name: nullableStringSchema.optional(),
  fromEmail: z.string().email().nullable().optional(),
  fromName: nullableStringSchema.optional(),
  replyToEmail: z.string().email().nullable().optional(),
  subjectTemplate: nullableStringSchema.optional(),
  subjectTemplateB: nullableStringSchema.optional(),
  abTestEnabled: z.boolean().optional(),
  bodyHtmlTemplate: nullableStringSchema.optional(),
  bodyDesignJson: z.unknown().optional(),
  bodyTextTemplate: nullableStringSchema.optional(),
  preheader: nullableStringSchema.optional(),
  audienceCriteria: audienceCriteriaSchema.optional(),
  audienceSize: z.number().int().nonnegative().nullable().optional(),
  scheduledAt: nullableTimestampSchema.optional(),
  lastEditedByUserId: nullableStringSchema.optional(),
});
export type UpdateDraftInput = z.input<typeof updateDraftInputSchema>;

export const scheduleSendInputSchema = z.object({
  runId: idSchema,
  scheduledAt: timestampSchema,
  actorUserId: nullableStringSchema.default(null),
});
export type ScheduleSendInput = z.infer<typeof scheduleSendInputSchema>;

export const sendNowInputSchema = z.object({
  runId: idSchema,
  actorUserId: nullableStringSchema.default(null),
});
export type SendNowInput = z.infer<typeof sendNowInputSchema>;

export const cancelRunInputSchema = z.object({
  runId: idSchema,
  actorUserId: nullableStringSchema.default(null),
  reason: nullableStringSchema.default(null),
});
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;

export const recordUnsubscribeInputSchema = z
  .object({
    token: z.string().min(1),
    scopeType: consentScopeTypeSchema,
    scopeId: nullableStringSchema.default(null),
  })
  .superRefine((value, context) => {
    if (value.scopeType === "project" && value.scopeId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "scopeId is required when scopeType='project'.",
      });
    }

    if (
      (value.scopeType === "newsletter" || value.scopeType === "all") &&
      value.scopeId !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "scopeId must be null unless scopeType='project'.",
      });
    }
  });
export type RecordUnsubscribeInput = z.infer<
  typeof recordUnsubscribeInputSchema
>;

export const testSendInputSchema = z.object({
  runId: idSchema,
  recipientEmail: z.string().email(),
  actorUserId: nullableStringSchema.default(null),
});
export type TestSendInput = z.infer<typeof testSendInputSchema>;

export const campaignSendJobName = "campaign-send" as const;
export const campaignSendJobMaxAttempts = 5 as const;
export const campaignSendPayloadSchema = z.object({
  runId: idSchema,
});
export type CampaignSendPayload = z.infer<typeof campaignSendPayloadSchema>;

export const smsBroadcastSendJobName = "sms-broadcast-send" as const;
export const smsBroadcastSendJobMaxAttempts = campaignSendJobMaxAttempts;
export const smsBroadcastSendPayloadSchema = z.object({
  runId: z.string().min(1),
});
export type SmsBroadcastSendPayload = z.infer<
  typeof smsBroadcastSendPayloadSchema
>;

export const pollPostmarkSenderStatusJobName =
  "poll-postmark-sender-status" as const;
export const pollPostmarkSenderStatusPayloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  trigger: z.enum(["cron", "manual"]).default("cron"),
});
export type PollPostmarkSenderStatusPayload = z.infer<
  typeof pollPostmarkSenderStatusPayloadSchema
>;

const postmarkRecordTypeSchema = z.enum([
  "Delivery",
  "Bounce",
  "SpamComplaint",
  "Open",
  "Click",
  "SubscriptionChange",
]);

const postmarkWebhookBaseSchema = z.object({
  RecordType: postmarkRecordTypeSchema,
  MessageID: z.string().uuid(),
  MessageStream: coercingNullableString.default(null),
  Tag: coercingNullableString.default(null),
  Recipient: z.string().email(),
  Metadata: nullableMetadataSchema.default({}),
});

export const postmarkDeliveryEventSchema = postmarkWebhookBaseSchema.extend({
  RecordType: z.literal("Delivery"),
  DeliveredAt: timestampSchema,
  Details: coercingNullableString.default(null),
  ServerID: z.number().int().nonnegative(),
});
export type PostmarkDeliveryEvent = z.infer<typeof postmarkDeliveryEventSchema>;

export const postmarkBounceEventSchema = postmarkWebhookBaseSchema.extend({
  RecordType: z.literal("Bounce"),
  ID: z.number().int().nonnegative(),
  Type: z.string().min(1),
  TypeCode: z.number().int().nonnegative(),
  Name: z.string().min(1),
  Description: coercingNullableString.default(null),
  Details: coercingNullableString.default(null),
  Email: z.string().email(),
  BouncedAt: timestampSchema,
  DumpAvailable: z.boolean().default(false),
  Inactive: z.boolean().default(false),
  CanActivate: z.boolean().default(false),
  Content: coercingNullableString.default(null),
  Subject: coercingNullableString.default(null),
  ServerID: z.number().int().nonnegative(),
});
export type PostmarkBounceEvent = z.infer<typeof postmarkBounceEventSchema>;

export const postmarkSpamComplaintEventSchema =
  postmarkWebhookBaseSchema.extend({
    RecordType: z.literal("SpamComplaint"),
    ID: z.number().int().nonnegative(),
    Type: z.string().min(1),
    TypeCode: z.number().int().nonnegative(),
    Name: z.string().min(1),
    Description: coercingNullableString.default(null),
    Details: coercingNullableString.default(null),
    Email: z.string().email(),
    BouncedAt: timestampSchema,
    DumpAvailable: z.boolean().default(false),
    Inactive: z.boolean().default(false),
    CanActivate: z.boolean().default(false),
    Content: coercingNullableString.default(null),
    Subject: coercingNullableString.default(null),
    ServerID: z.number().int().nonnegative(),
  });
export type PostmarkSpamComplaintEvent = z.infer<
  typeof postmarkSpamComplaintEventSchema
>;

const postmarkClientSchema = z.object({
  Name: coercingNullableString.default(null),
  Company: coercingNullableString.default(null),
  Family: coercingNullableString.default(null),
});

const postmarkGeoSchema = z.object({
  CountryISOCode: coercingNullableString.default(null),
  Country: coercingNullableString.default(null),
  RegionISOCode: coercingNullableString.default(null),
  Region: coercingNullableString.default(null),
  City: coercingNullableString.default(null),
  Zip: coercingNullableString.default(null),
  Coords: coercingNullableString.default(null),
  IP: coercingNullableString.default(null),
});

export const postmarkOpenEventSchema = postmarkWebhookBaseSchema.extend({
  RecordType: z.literal("Open"),
  FirstOpen: z.boolean(),
  Client: postmarkClientSchema.optional(),
  OS: postmarkClientSchema.optional(),
  Platform: coercingNullableString.default(null),
  UserAgent: coercingNullableString.default(null),
  Geo: postmarkGeoSchema.optional(),
  ReceivedAt: timestampSchema,
});
export type PostmarkOpenEvent = z.infer<typeof postmarkOpenEventSchema>;

export const postmarkClickEventSchema = postmarkWebhookBaseSchema.extend({
  RecordType: z.literal("Click"),
  OriginalLink: z.string().url(),
  ClickLocation: coercingNullableString.default(null),
  Client: postmarkClientSchema.optional(),
  OS: postmarkClientSchema.optional(),
  Platform: coercingNullableString.default(null),
  UserAgent: coercingNullableString.default(null),
  Geo: postmarkGeoSchema.optional(),
  ReceivedAt: timestampSchema,
});
export type PostmarkClickEvent = z.infer<typeof postmarkClickEventSchema>;

export const postmarkSubscriptionChangeEventSchema = postmarkWebhookBaseSchema
  .omit({ MessageID: true })
  .extend({
    RecordType: z.literal("SubscriptionChange"),
    MessageID: z.string().uuid().nullable(),
    ChangedAt: timestampSchema,
    SuppressSending: z.boolean(),
    SuppressionReason: coercingNullableString.default(null),
    Origin: coercingNullableString.default(null),
  });
export type PostmarkSubscriptionChangeEvent = z.infer<
  typeof postmarkSubscriptionChangeEventSchema
>;

export const postmarkWebhookEventSchema = z.discriminatedUnion("RecordType", [
  postmarkDeliveryEventSchema,
  postmarkBounceEventSchema,
  postmarkSpamComplaintEventSchema,
  postmarkOpenEventSchema,
  postmarkClickEventSchema,
  postmarkSubscriptionChangeEventSchema,
]);
export type PostmarkWebhookEvent = z.infer<typeof postmarkWebhookEventSchema>;
