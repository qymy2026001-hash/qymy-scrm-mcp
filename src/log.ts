export type LogValue = string | number | boolean | null;

/** Structured log. Callers must pass ids and status codes only, never tokens or message bodies. */
export function logInfo(event: string, fields: Record<string, LogValue> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export function logError(event: string, fields: Record<string, LogValue> = {}): void {
  console.error(JSON.stringify({ event, ...fields }));
}
