export const SUPPORTED_TIMEZONES = [
  ["UTC", "UTC"], ["America/New_York", "Eastern Time (US & Canada)"], ["America/Chicago", "Central Time (US & Canada)"], ["America/Denver", "Mountain Time (US & Canada)"], ["America/Los_Angeles", "Pacific Time (US & Canada)"], ["America/Toronto", "Toronto"], ["America/Vancouver", "Vancouver"], ["America/Sao_Paulo", "São Paulo"], ["Europe/London", "London"], ["Europe/Paris", "Paris"], ["Europe/Berlin", "Berlin"], ["Africa/Johannesburg", "Johannesburg"], ["Asia/Dubai", "Dubai"], ["Asia/Kolkata", "India Standard Time"], ["Asia/Singapore", "Singapore"], ["Asia/Tokyo", "Tokyo"], ["Australia/Sydney", "Sydney"],
] as const;

export const isSupportedTimezone = (value: string) => SUPPORTED_TIMEZONES.some(([zone]) => zone === value);

const LEGACY_TIMEZONES: Record<string, string> = { India: "Asia/Kolkata", IST: "Asia/Kolkata", "Indian Standard Time": "Asia/Kolkata", "Asia/Calcutta": "Asia/Kolkata" };

export function normalizeTimezone(value: string | null | undefined) {
  if (!value) return "UTC";
  const normalized = LEGACY_TIMEZONES[value] || value;
  return isSupportedTimezone(normalized) ? normalized : "UTC";
}
