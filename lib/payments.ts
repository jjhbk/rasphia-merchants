import { createHmac, timingSafeEqual } from "crypto";
import postgres from "postgres";
import { decryptIntegrationSecret } from "./integration-crypto";

export type PaymentProvider = "stripe" | "razorpay";
type Connection = { id: string; provider: PaymentProvider; api_key_id_encrypted: string | null; api_secret_encrypted: string; webhook_secret_encrypted: string; currency: string };

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
const basic = (first: string, second = "") => `Basic ${Buffer.from(`${first}:${second}`).toString("base64")}`;
const equals = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export async function paymentConnection(sql: postgres.Sql, workspaceId: string, provider?: PaymentProvider) {
  const rows = provider ? await sql<Connection[]>`select id, provider, api_key_id_encrypted, api_secret_encrypted, webhook_secret_encrypted, currency from payment_connections where workspace_id = ${workspaceId} and provider = ${provider} and status = 'active' limit 1` : await sql<Connection[]>`select id, provider, api_key_id_encrypted, api_secret_encrypted, webhook_secret_encrypted, currency from payment_connections where workspace_id = ${workspaceId} and status = 'active' order by updated_at desc limit 1`;
  return rows[0] || null;
}

export async function createProviderPaymentLink(connection: Connection, input: { amount: number; currency?: string; description: string; customerEmail: string; customerName: string; customerPhone?: string | null; referenceId: string; successUrl: string; cancelUrl: string }) {
  const currency = (input.currency || connection.currency).toLowerCase();
  if (connection.provider === "stripe") {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: basic(decryptIntegrationSecret(connection.api_secret_encrypted)), "Content-Type": "application/x-www-form-urlencoded" }, body: form({ mode: "payment", success_url: input.successUrl, cancel_url: input.cancelUrl, customer_email: input.customerEmail, client_reference_id: input.referenceId, "line_items[0][price_data][currency]": currency, "line_items[0][price_data][product_data][name]": input.description.slice(0, 250), "line_items[0][price_data][unit_amount]": String(input.amount), "line_items[0][quantity]": "1", "metadata[rasphia_reference]": input.referenceId }), cache: "no-store" });
    if (!response.ok) throw new Error("Stripe could not create the payment link."); const data = await response.json() as { id?: string; url?: string; expires_at?: number }; if (!data.id || !data.url) throw new Error("Stripe returned an incomplete payment link.");
    return { providerLinkId: data.id, providerSubscriptionId: null, providerPlanId: null, url: data.url, expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null };
  }
  const keyId = connection.api_key_id_encrypted ? decryptIntegrationSecret(connection.api_key_id_encrypted) : "";
  const response = await fetch("https://api.razorpay.com/v1/payment_links", { method: "POST", headers: { Authorization: basic(keyId, decryptIntegrationSecret(connection.api_secret_encrypted)), "Content-Type": "application/json" }, body: JSON.stringify({ amount: input.amount, currency: currency.toUpperCase(), reference_id: input.referenceId.slice(0, 40), description: input.description.slice(0, 2048), customer: { name: input.customerName, email: input.customerEmail, contact: input.customerPhone || undefined }, notify: { sms: false, email: false }, reminder_enable: true, callback_url: input.successUrl, callback_method: "get", notes: { rasphia_reference: input.referenceId } }), cache: "no-store" });
  if (!response.ok) throw new Error("Razorpay could not create the payment link."); const data = await response.json() as { id?: string; short_url?: string; expire_by?: number }; if (!data.id || !data.short_url) throw new Error("Razorpay returned an incomplete payment link.");
  return { providerLinkId: data.id, providerSubscriptionId: null, providerPlanId: null, url: data.short_url, expiresAt: data.expire_by ? new Date(data.expire_by * 1000) : null };
}

export async function createProviderSubscriptionLink(connection: Connection, input: { amount: number; currency: string; description: string; customerEmail: string; referenceId: string; interval: "day" | "week" | "month" | "year"; intervalCount: number; totalCycles?: number | null; trialDays?: number | null; providerPlanId?: string | null; successUrl: string; cancelUrl: string }) {
  const currency = input.currency.toLowerCase();
  if (connection.provider === "stripe") {
    const values: Record<string, string> = { mode: "subscription", success_url: input.successUrl, cancel_url: input.cancelUrl, customer_email: input.customerEmail, client_reference_id: input.referenceId, "line_items[0][price_data][currency]": currency, "line_items[0][price_data][product_data][name]": input.description.slice(0, 250), "line_items[0][price_data][unit_amount]": String(input.amount), "line_items[0][price_data][recurring][interval]": input.interval, "line_items[0][price_data][recurring][interval_count]": String(input.intervalCount), "line_items[0][quantity]": "1", "metadata[rasphia_reference]": input.referenceId, "subscription_data[metadata][rasphia_reference]": input.referenceId };
    if (input.trialDays) values["subscription_data[trial_period_days]"] = String(input.trialDays);
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: basic(decryptIntegrationSecret(connection.api_secret_encrypted)), "Content-Type": "application/x-www-form-urlencoded" }, body: form(values), cache: "no-store" });
    if (!response.ok) throw new Error("Stripe could not create the subscription checkout link."); const data = await response.json() as { id?: string; url?: string; expires_at?: number }; if (!data.id || !data.url) throw new Error("Stripe returned an incomplete subscription link.");
    return { providerLinkId: data.id, providerSubscriptionId: null, providerPlanId: null, url: data.url, expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null };
  }
  if (!input.totalCycles) throw new Error("Razorpay subscriptions require a total number of billing cycles.");
  const keyId = connection.api_key_id_encrypted ? decryptIntegrationSecret(connection.api_key_id_encrypted) : ""; const authorization = basic(keyId, decryptIntegrationSecret(connection.api_secret_encrypted));
  let providerPlanId = input.providerPlanId || null;
  if (!providerPlanId) {
    const period = input.interval === "day" ? "daily" : input.interval === "week" ? "weekly" : input.interval === "month" ? "monthly" : "yearly";
    const planResponse = await fetch("https://api.razorpay.com/v1/plans", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ period, interval: input.intervalCount, item: { name: input.description.slice(0, 250), amount: input.amount, currency: currency.toUpperCase(), description: input.description.slice(0, 2048) }, notes: { rasphia_reference: input.referenceId } }), cache: "no-store" });
    if (!planResponse.ok) throw new Error("Razorpay could not create the subscription plan."); const plan = await planResponse.json() as { id?: string }; if (!plan.id) throw new Error("Razorpay returned an incomplete subscription plan."); providerPlanId = plan.id;
  }
  const subscriptionResponse = await fetch("https://api.razorpay.com/v1/subscriptions", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: providerPlanId, total_count: input.totalCycles, quantity: 1, customer_notify: 1, notes: { rasphia_reference: input.referenceId } }), cache: "no-store" });
  if (!subscriptionResponse.ok) throw new Error("Razorpay could not create the subscription link."); const subscription = await subscriptionResponse.json() as { id?: string; short_url?: string }; if (!subscription.id || !subscription.short_url) throw new Error("Razorpay returned an incomplete subscription link.");
  return { providerLinkId: subscription.id, providerSubscriptionId: subscription.id, providerPlanId, url: subscription.short_url, expiresAt: null };
}

export function verifyWebhook(provider: PaymentProvider, rawBody: string, signature: string | null, secretEncrypted: string) {
  if (!signature) return false; const secret = decryptIntegrationSecret(secretEncrypted);
  if (provider === "razorpay") return equals(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
  const timestamp = signature.split(",").find((value) => value.startsWith("t="))?.slice(2); const signatures = signature.split(",").filter((value) => value.startsWith("v1=")).map((value) => value.slice(3)); if (!timestamp || !signatures.length) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"); return signatures.some((value) => equals(expected, value));
}
