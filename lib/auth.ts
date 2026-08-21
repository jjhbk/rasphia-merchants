import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import postgres from "postgres";

const SESSION_COOKIE = "rasphia_session";
const OAUTH_STATE_COOKIE = "rasphia_google_oauth_state";
const SESSION_DAYS = 30;

type GoogleProfile = { sub: string; email: string; email_verified: boolean; name?: string; picture?: string };
export type CurrentSession = { userId: string; email: string; name: string | null; workspaceId: string; workspaceName: string; workspaceSlug: string; role: "owner" | "admin" | "staff" | "viewer"; onboardingStatus: string };

function database() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured.");
  return postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
}

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return secret;
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stateSignature(state: string) { return createHmac("sha256", authSecret()).update(state).digest("hex"); }
function cookieOptions(maxAge: number) { return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge }; }
function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64) || "business"; }

export function googleAuthConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET && process.env.DATABASE_URL); }

export async function beginGoogleOAuth(origin: string) {
  if (!googleAuthConfigured()) throw new Error("Google sign-in is not configured.");
  const state = randomBytes(32).toString("hex");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, `${state}.${stateSignature(state)}`, cookieOptions(10 * 60));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function completeGoogleOAuth(origin: string, code: string, state: string, userAgent?: string | null) {
  const jar = await cookies();
  const signedState = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!signedState) throw new Error("Your sign-in session expired. Please try again.");
  const [cookieState, cookieSignature] = signedState.split(".");
  const expectedSignature = stateSignature(state);
  const signatureMatches = cookieSignature && cookieSignature.length === expectedSignature.length && timingSafeEqual(Buffer.from(cookieSignature), Buffer.from(expectedSignature));
  if (!signatureMatches || cookieState !== state) throw new Error("Your sign-in session could not be verified. Please try again.");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: "authorization_code" }), cache: "no-store" });
  if (!tokenResponse.ok) throw new Error("Google could not complete sign-in. Please try again.");
  const token = await tokenResponse.json() as { access_token?: string; scope?: string };
  if (!token.access_token) throw new Error("Google did not return an access token.");

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
  if (!profileResponse.ok) throw new Error("Google profile information could not be verified.");
  const profile = await profileResponse.json() as GoogleProfile;
  if (!profile.sub || !profile.email || !profile.email_verified) throw new Error("Please use a Google account with a verified email address.");

  const sql = database();
  try {
    const result = await sql.begin(async (tx) => {
      const accounts = await tx<{ user_id: string }[]>`select user_id from oauth_accounts where provider = 'google' and provider_account_id = ${profile.sub} limit 1`;
      let userId = accounts[0]?.user_id;
      let isNew = false;
      if (!userId) {
        const existing = await tx<{ id: string }[]>`select id from users where lower(email) = lower(${profile.email}) limit 1`;
        if (existing[0]) userId = existing[0].id;
        else {
          const users = await tx<{ id: string }[]>`insert into users (email, name, avatar_url, email_verified_at, last_login_at) values (${profile.email}, ${profile.name || null}, ${profile.picture || null}, now(), now()) returning id`;
          userId = users[0].id; isNew = true;
        }
        await tx`insert into oauth_accounts (user_id, provider, provider_account_id, provider_email, granted_scopes) values (${userId}, 'google', ${profile.sub}, ${profile.email}, ${token.scope?.split(" ") || []}) on conflict (provider, provider_account_id) do update set user_id = excluded.user_id, provider_email = excluded.provider_email, granted_scopes = excluded.granted_scopes, updated_at = now()`;
      } else await tx`update users set name = coalesce(${profile.name || null}, name), avatar_url = coalesce(${profile.picture || null}, avatar_url), last_login_at = now(), updated_at = now() where id = ${userId}`;

      const memberships = await tx<{ workspace_id: string }[]>`select workspace_id from workspace_members where user_id = ${userId} order by created_at asc limit 1`;
      if (!memberships[0]) {
        const baseSlug = slugify(profile.name || profile.email.split("@")[0]);
        const slug = `${baseSlug}-${randomBytes(3).toString("hex")}`;
        const workspaces = await tx<{ id: string }[]>`insert into workspaces (name, slug) values (${profile.name ? `${profile.name}'s business` : "My business"}, ${slug}) returning id`;
        await tx`insert into workspace_members (workspace_id, user_id, role) values (${workspaces[0].id}, ${userId}, 'owner')`;
        await tx`insert into workspace_settings (workspace_id, business_email, booking_slug) values (${workspaces[0].id}, ${profile.email}, ${slug})`;
        isNew = true;
      }
      return { userId, isNew };
    });
    const rawToken = randomBytes(32).toString("hex");
    await sql`insert into user_sessions (user_id, token_hash, expires_at, user_agent) values (${result.userId}, ${hash(rawToken)}, now() + interval '30 days', ${userAgent || null})`;
    const sessionJar = await cookies();
    sessionJar.set(SESSION_COOKIE, rawToken, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
    return result;
  } finally { await sql.end(); }
}

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !process.env.DATABASE_URL) return null;
  const sql = database();
  try {
    const rows = await sql<CurrentSession[]>`select u.id as "userId", u.email, u.name, w.id as "workspaceId", w.name as "workspaceName", w.slug as "workspaceSlug", wm.role, w.onboarding_status as "onboardingStatus" from user_sessions s join users u on u.id = s.user_id join workspace_members wm on wm.user_id = u.id join workspaces w on w.id = wm.workspace_id where s.token_hash = ${hash(token)} and s.revoked_at is null and s.expires_at > now() order by wm.role = 'owner' desc, wm.created_at asc limit 1`;
    if (!rows[0]) return null;
    await sql`update user_sessions set last_seen_at = now() where token_hash = ${hash(token)}`;
    return rows[0];
  } finally { await sql.end(); }
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && process.env.DATABASE_URL) {
    const sql = database();
    try { await sql`update user_sessions set revoked_at = now() where token_hash = ${hash(token)} and revoked_at is null`; } finally { await sql.end(); }
  }
  jar.delete(SESSION_COOKIE);
}
