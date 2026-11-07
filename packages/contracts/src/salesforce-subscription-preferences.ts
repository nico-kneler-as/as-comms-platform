import { z } from "zod";

export const salesforceSubscriptionBoxValues = [
  "PNW Forest Monitoring",
  "Beech and Butternut",
  "Tracking Whitebark Pine",
  "Coral Reef Expansion",
  "Monitoring Killer Whales Project",
] as const;
export type SalesforceSubscriptionBox =
  (typeof salesforceSubscriptionBoxValues)[number];

export const salesforceSubscriptionBoxFieldByValue: Readonly<
  Record<SalesforceSubscriptionBox, string>
> = {
  "PNW Forest Monitoring": "PNW_Forest_Monitoring__c",
  "Beech and Butternut": "Beech_and_Butternut__c",
  "Tracking Whitebark Pine": "Tracking_Whitebark_Pine__c",
  "Coral Reef Expansion": "Coral_Reef_Expansion__c",
  "Monitoring Killer Whales Project": "Monitoring_Killer_Whales_Project__c",
};

const subscriptionBoxSchema = z.enum(salesforceSubscriptionBoxValues);

export const subscriptionPreferenceChangeSchema = z
  .object({
    email: z.string(),
    contactId: z.string().min(1).nullable().optional(),
    generalNewsletter: z.boolean().optional(),
    projectBoxes: z
      .object({
        "PNW Forest Monitoring": z.boolean().optional(),
        "Beech and Butternut": z.boolean().optional(),
        "Tracking Whitebark Pine": z.boolean().optional(),
        "Coral Reef Expansion": z.boolean().optional(),
        "Monitoring Killer Whales Project": z.boolean().optional(),
      })
      .strict()
      .optional(),
    oregonShoresNewsletter: z.boolean().optional(),
    unsubscribedFromAll: z.boolean().optional(),
    unsubscribedAt: z.string().datetime().nullable().optional(),
    emailBounced: z.boolean().optional(),
    creationSource: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const hasProjectBoxChange =
      value.projectBoxes !== undefined &&
      Object.values(value.projectBoxes).some((box) => box !== undefined);
    const hasChange =
      [
        "contactId",
        "generalNewsletter",
        "oregonShoresNewsletter",
        "unsubscribedFromAll",
        "unsubscribedAt",
        "emailBounced",
        "creationSource",
      ].some(
        (key) =>
          Object.prototype.hasOwnProperty.call(value, key) &&
          value[key as keyof typeof value] !== undefined,
      ) || hasProjectBoxChange;
    if (!hasChange) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Subscription preference changes must include at least one field.",
      });
    }
  });
export type SubscriptionPreferenceChange = z.infer<
  typeof subscriptionPreferenceChangeSchema
>;

export const salesforceProjectSubscriptionBoxRowSchema = z.object({
  projectId: z.string().min(1),
  subscriptionBox: z.string().nullable(),
});
export type SalesforceProjectSubscriptionBoxRow = z.infer<
  typeof salesforceProjectSubscriptionBoxRowSchema
>;

export const salesforceProjectBoxesCaptureResponseSchema = z.object({
  rows: z.array(salesforceProjectSubscriptionBoxRowSchema),
  capturedAt: z.string().datetime(),
});
export type SalesforceProjectBoxesCaptureResponse = z.infer<
  typeof salesforceProjectBoxesCaptureResponseSchema
>;

export const salesforceProjectBoxesSyncPayloadSchema = z.object({
  version: z.literal(1).default(1),
});
export type SalesforceProjectBoxesSyncPayload = z.infer<
  typeof salesforceProjectBoxesSyncPayloadSchema
>;

export const salesforceProjectBoxesSyncJobName =
  "salesforce-project-boxes-sync" as const;
export const salesforceProjectBoxesSyncJobMaxAttempts = 3;

export { subscriptionBoxSchema };
