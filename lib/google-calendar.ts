import postgres from "postgres";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integration-crypto";

type CalendarConnection = { id: string; access_token_encrypted: string; refresh_token_encrypted: string | null; token_expires_at: Date | null; selected_calendar_id: string | null };

async function refreshAccessToken(sql: postgres.Sql, connection: CalendarConnection) {
  if (!connection.refresh_token_encrypted) throw new Error("Reconnect Google Calendar to continue booking.");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: decryptIntegrationSecret(connection.refresh_token_encrypted), grant_type: "refresh_token" }), cache: "no-store" });
  if (!response.ok) throw new Error("Google Calendar authorization expired. Reconnect the calendar.");
  const token = await response.json() as { access_token: string; expires_in?: number };
  await sql`update google_calendar_connections set access_token_encrypted = ${encryptIntegrationSecret(token.access_token)}, token_expires_at = ${new Date(Date.now() + (token.expires_in || 3600) * 1000)}, updated_at = now() where id = ${connection.id}`;
  return token.access_token;
}

async function activeAccessToken(sql: postgres.Sql, connection: CalendarConnection) {
  if (connection.token_expires_at && connection.token_expires_at.getTime() > Date.now() + 60_000) return decryptIntegrationSecret(connection.access_token_encrypted);
  return refreshAccessToken(sql, connection);
}

export async function createCalendarBooking(input: { workspaceId: string; businessName: string; serviceName: string; customerName: string; customerEmail: string; startsAt: Date; endsAt: Date; timezone: string }) {
  if (!process.env.DATABASE_URL) return null;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const connections = await sql<CalendarConnection[]>`select id, access_token_encrypted, refresh_token_encrypted, token_expires_at, selected_calendar_id from google_calendar_connections where workspace_id = ${input.workspaceId} and selected_calendar_id is not null limit 1`;
    const connection = connections[0]; if (!connection) return null;
    const accessToken = await activeAccessToken(sql, connection);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.selected_calendar_id!)}/events`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ summary: `${input.serviceName} — ${input.customerName}`, description: `Booked through Rasphia for ${input.businessName}.\nCustomer: ${input.customerName}\nEmail: ${input.customerEmail}`, start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone }, end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone }, attendees: [{ email: input.customerEmail }], reminders: { useDefault: true } }), cache: "no-store" });
    if (!response.ok) return null;
    const event = await response.json() as { id?: string }; return event.id || null;
  } catch { return null; } finally { await sql.end(); }
}
