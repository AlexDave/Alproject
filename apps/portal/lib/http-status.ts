export function normalizeHttpStatus(status: number, fallback = 502): number {
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return status;
  }
  return fallback;
}
