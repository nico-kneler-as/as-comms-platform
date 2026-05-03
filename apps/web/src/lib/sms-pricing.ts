export function estimateSmsCostUsd(
  segments: number,
  outboundRateUsdPerSegment: number,
): number {
  if (segments <= 0) {
    return 0;
  }

  return segments * outboundRateUsdPerSegment;
}

export function formatSmsEstimatedCostUsd(value: number): string {
  return value.toFixed(4);
}

export function formatUsdAmount(value: number): string {
  return value.toFixed(2);
}
