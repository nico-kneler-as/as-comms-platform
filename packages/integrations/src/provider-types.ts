export const stage0ProviderKeys = [
  "gmail",
  "salesforce",
  "simpletexting",
  "mailchimp"
] as const;

export type Stage0ProviderKey = (typeof stage0ProviderKeys)[number];

export interface ProviderPlaceholder {
  readonly provider: Stage0ProviderKey;
  readonly stage: 0;
  readonly status: "placeholder";
  readonly notes: string;
}
