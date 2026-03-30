export class Stage1RetryableJobError extends Error {
  override readonly name = "Stage1RetryableJobError";
}

export class Stage1NonRetryableJobError extends Error {
  override readonly name = "Stage1NonRetryableJobError";
}
