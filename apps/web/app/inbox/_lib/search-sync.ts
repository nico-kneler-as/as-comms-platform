export function shouldApplyUrlSearchQuery(input: {
  readonly urlQuery: string;
  readonly previousUrlQuery: string;
  readonly currentQuery: string;
}): boolean {
  return (
    input.urlQuery !== input.previousUrlQuery &&
    input.currentQuery === input.previousUrlQuery
  );
}
