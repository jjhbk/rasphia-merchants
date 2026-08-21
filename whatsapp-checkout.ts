import crypto from "crypto";

type WhatsAppCheckoutTokenPayload = {
  orderId: string;
  internalOrderId: string;
  email: string;
  exp: number;
};

function getCheckoutSecret() {
  const secret =
    process.env.WHATSAPP_CHECKOUT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    "";
  if (!secret) {
    throw new Error("Missing WhatsApp checkout secret.");
  }
  return secret;
}

function base64UrlEncode(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signPayload(payload: string) {
  return crypto
    .createHmac("sha256", getCheckoutSecret())
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createWhatsAppCheckoutToken(input: {
  orderId: string;
  internalOrderId: string;
  email: string;
  expiresInSeconds?: number;
}) {
  const payload: WhatsAppCheckoutTokenPayload = {
    orderId: input.orderId,
    internalOrderId: input.internalOrderId,
    email: input.email,
    exp: Math.floor(Date.now() / 1000) + Math.max(300, Number(input.expiresInSeconds || 3600)),
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifyWhatsAppCheckoutToken(token: string) {
  const [payloadEncoded, signature] = String(token || "").split(".");
  if (!payloadEncoded || !signature) {
    throw new Error("Invalid checkout token.");
  }
  const expected = signPayload(payloadEncoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid checkout token signature.");
  }
  const parsed = JSON.parse(base64UrlDecode(payloadEncoded)) as WhatsAppCheckoutTokenPayload;
  if (!parsed?.orderId || !parsed?.internalOrderId || !parsed?.email || !parsed?.exp) {
    throw new Error("Malformed checkout token.");
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Checkout token expired.");
  }
  return parsed;
}
