const MAX_OPERATOR_ERROR_MESSAGE_LENGTH = 300;

// Drizzle wraps driver errors as "Failed query: <sql>\nparams: <every value>".
// On an audience freeze that is megabytes of recipient emails and names, so it
// is logged here (SQL head and driver cause only, never the params) and the
// browser gets the fallback instead.
export function toOperatorErrorMessage(
  error: unknown,
  fallback: string,
  event: string,
): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const isDriverError = error.message.startsWith("Failed query:");
  if (
    !isDriverError &&
    error.message.length <= MAX_OPERATOR_ERROR_MESSAGE_LENGTH
  ) {
    return error.message;
  }

  const cause = error.cause instanceof Error ? error.cause : null;
  console.error(
    JSON.stringify({
      event,
      query: isDriverError
        ? (error.message.split("\nparams:")[0] ?? "").slice(
            0,
            MAX_OPERATOR_ERROR_MESSAGE_LENGTH,
          )
        : null,
      cause:
        cause?.message.slice(0, MAX_OPERATOR_ERROR_MESSAGE_LENGTH) ?? null,
      messageLength: error.message.length,
    }),
  );
  return fallback;
}
