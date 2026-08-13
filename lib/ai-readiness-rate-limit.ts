const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIMIT = 3;

type Store = Map<string, number[]>;
const globalStore = globalThis as typeof globalThis & { aiReadinessRateLimit?: Store };
const attempts = globalStore.aiReadinessRateLimit ?? new Map<string, number[]>();
globalStore.aiReadinessRateLimit = attempts;

/** Per-process protection for the public v1 audit endpoint. */
export function allowAiReadinessCheck(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) { attempts.set(ip, recent); return false; }
  recent.push(now); attempts.set(ip, recent);
  return true;
}
