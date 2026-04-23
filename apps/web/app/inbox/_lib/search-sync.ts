export function shouldApplyUrlSearchQuery(input: {
  readonly urlQuery: string;
  readonly previousUrlQuery: string;
}): boolean {
  return input.urlQuery !== input.previousUrlQuery;
}
