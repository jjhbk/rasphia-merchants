import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { GEMINI_MODEL } from "@/app/lib/gemini";
import { prisma } from "@/app/lib/prisma";
import { ensureUniqueMerchantSlug } from "@/app/lib/merchantSlug";
import { generateProductEmbedding } from "@/app/lib/generateEmbeddings";
import { embedQuery } from "@/app/lib/queryEmbeddings";
import { searchProductEmbeddings } from "@/app/lib/product-vector-store";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { uploadWhatsAppMediaToBlob } from "@/app/lib/whatsapp";
import {
  buildSeedhapePaymentLinks,
  createSeedhapeOrderWithConfig,
  getSeedhapeOrderStatusWithConfig,
  isSeedhapePaidStatus,
} from "@/app/lib/seedhape";
import { finalizeOrderAsPaid } from "@/app/lib/order-payment";
import { ensureMerchantSeedhapeDefaults, getMerchantSeedhapeConfig } from "@/app/lib/merchant-seedhape";
import { getMerchantRazorpayConfig } from "@/app/lib/merchant-razorpay";
import {
  createRazorpayOrderWithConfig,
  getRazorpayPaymentLinkWithConfig,
} from "@/app/lib/razorpay";
import { getMerchantAnalyticsSummary } from "@/app/lib/merchant-analytics";
import { createWhatsAppCheckoutToken } from "@/app/lib/whatsapp-checkout";
import { queryCustomerOrders } from "@/app/lib/customer-order-query";

const geminiApiKey =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
const gemini = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

export const WA_INTENTS = [
  "user_register",
  "user_persona_update",
  "user_discover_products",
  "user_discover_merchants",
  "user_order_create",
  "user_order_query",
  "user_payment_confirm",
  "user_refund_request",
  "user_replacement_request",
  "user_cancellation_request",
  "user_wishlist_add",
  "user_wishlist_remove",
  "user_wishlist_view",
  "merchant_register",
  "merchant_storefront_update",
  "product_upload",
  "product_update",
  "product_query",
  "stock_update",
  "stock_query",
  "order_query_active",
  "order_update_status",
  "merchant_bulk_upload_help",
  "merchant_analytics_query",
  "help",
  "unknown",
] as const;

export type WaIntent = (typeof WA_INTENTS)[number];

const MerchantRegistrationSchema = z.object({
  businessName: z.string().min(2),
  email: z.string().email(),
  addressLine1: z.string().min(3),
  addressLine2: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  zipCode: z.string().regex(/^[A-Za-z0-9\- ]{4,12}$/),
  locationLink: z.string().url().optional(),
});

const UserRegistrationSchema = z.object({
  userName: z.string().min(2),
  userEmail: z.string().email(),
});

const UserPersonaSchema = z.object({
  personaText: z.string().min(3),
});

const ProductUploadSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  price: z.coerce.number().positive(),
  stockQuantity: z.coerce.number().int().min(0),
  brand: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

const StockUpdateSchema = z.object({
  productName: z.string().min(2),
  stockQuantity: z.coerce.number().int().min(0),
});

const OrderUpdateSchema = z.object({
  orderId: z.string().min(4),
  status: z.enum([
    "created",
    "paid",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled",
    "Refunded",
    "Replacement",
  ]),
});

const StorefrontUpdateSchema = z
  .object({
    storeName: z.string().min(2).optional(),
    logoUrl: z.string().url().optional(),
    coverImageUrl: z.string().url().optional(),
  })
  .refine(
    (value) =>
      Boolean(
        (value.storeName && value.storeName.trim().length > 0) ||
          (value.logoUrl && value.logoUrl.trim().length > 0) ||
          (value.coverImageUrl && value.coverImageUrl.trim().length > 0)
      ),
    {
      message:
        "Please share at least one field to update: storeName, logoUrl, or coverImageUrl.",
    }
  );

type SessionData = {
  activeRole?: "merchant" | "user";
  activeIntent?: WaIntent;
  draft?: Record<string, unknown>;
  lastPrompt?: string;
  processedMessageIds?: string[];
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  activeMerchantName?: string;
  pendingRoleSelection?: boolean;
  pendingConfirmation?: {
    type: "stock_update_zero" | "order_status_update";
    intent: WaIntent;
    draft: Record<string, unknown>;
  } | null;
};

type IntentParse = {
  intent: WaIntent;
  fields: Record<string, unknown>;
};

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type MerchantChatContext = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

type AddressBookEntry = {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  address: string;
};

type CheckoutCustomerSnapshot = {
  name: string;
  email: string;
  phone: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
};

const WHATSAPP_CONTEXT_WINDOW = Number(process.env.WHATSAPP_CONTEXT_WINDOW || 20);
const WHATSAPP_CONTEXT_KEEP = Number(process.env.WHATSAPP_CONTEXT_KEEP || 40);
const WHATSAPP_TOP_USER_PRODUCT_SUGGESTIONS = 3;

function formatWhatsAppMarkdown(text: string) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const formatted = raw
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (
        /^https?:\/\//i.test(trimmed) ||
        /^intent:\/\//i.test(trimmed) ||
        /^upi:\/\//i.test(trimmed)
      ) {
        return trimmed;
      }
      const afterPaymentMatch = /^After payment,\s*reply:\s*(.+)$/i.exec(trimmed);
      if (afterPaymentMatch) {
        return `After payment, reply with:\n\`${afterPaymentMatch[1].trim()}\``;
      }
      const keyValueMatch = /^([A-Za-z][A-Za-z0-9 /_-]{1,40}):\s*(.+)$/.exec(trimmed);
      if (keyValueMatch) {
        return `*${keyValueMatch[1]}:* ${keyValueMatch[2]}`;
      }
      const headingMatch = /^([A-Za-z][A-Za-z0-9 /_-]{1,40}):$/.exec(trimmed);
      if (headingMatch) {
        return `*${headingMatch[1]}*`;
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return formatted;
}

const REQUIRED_BY_INTENT: Record<WaIntent, string[]> = {
  user_register: ["userName", "userEmail"],
  user_persona_update: ["personaText"],
  user_discover_products: [],
  user_discover_merchants: [],
  user_order_create: ["productName", "upiVerifiedName"],
  user_order_query: [],
  user_payment_confirm: [],
  user_refund_request: ["orderId", "reason"],
  user_replacement_request: ["orderId", "reason"],
  user_cancellation_request: ["orderId", "reason"],
  user_wishlist_add: ["productName"],
  user_wishlist_remove: ["productName"],
  user_wishlist_view: [],
  merchant_register: [
    "businessName",
    "email",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "zipCode",
  ],
  merchant_storefront_update: [],
  product_upload: ["name", "category", "price", "stockQuantity"],
  product_update: ["productName"],
  product_query: [],
  stock_update: ["productName", "stockQuantity"],
  stock_query: [],
  order_query_active: [],
  order_update_status: ["orderId", "status"],
  merchant_bulk_upload_help: [],
  merchant_analytics_query: [],
  help: [],
  unknown: [],
};

const OPTIONAL_BY_INTENT: Partial<Record<WaIntent, string[]>> = {
  user_discover_products: ["query", "category", "maxPrice", "tag", "merchantSlug"],
  user_discover_merchants: ["query", "city"],
  user_order_create: [
    "quantity",
    "merchantSlug",
    "shippingAddress",
    "addressChoice",
    "paymentRail",
  ],
  user_order_query: ["orderId", "activeOnly", "merchantSlug"],
  user_payment_confirm: ["orderId", "txHash", "payerAddress"],
  user_refund_request: ["details"],
  user_replacement_request: ["details"],
  user_cancellation_request: ["details"],
  user_persona_update: ["personaTags"],
  merchant_register: ["locationLink"],
  product_upload: ["brand", "description", "imageUrl"],
  product_update: ["price", "stockQuantity", "category", "brand", "description", "imageUrl"],
  merchant_storefront_update: ["storeName", "logoUrl", "coverImageUrl"],
  stock_query: ["productName"],
  merchant_analytics_query: ["analyticsQuery"],
};

const FIELD_PROMPTS: Record<string, string> = {
  userName: "Next step: send your name.",
  userEmail: "Next step: send your email address.",
  personaText: "Next step: describe your preferences in one line.",
  personaTags: "Optionally share persona tags separated by commas.",
  query: "Next step: tell me what you want to find.",
  quantity: "Optionally share quantity (default is 1).",
  upiVerifiedName:
    "Next step: send your UPI verified name exactly as shown in your UPI app.",
  shippingAddress:
    "Next step: send your full delivery address.",
  addressChoice:
    "Next step: choose a saved address by number, for example addressOption=1, or send shippingAddress=...",
  paymentRail:
    "Optional payment rail: paymentRail=razorpay (default), paymentRail=seedhape, or paymentRail=x402.",
  maxPrice: "Optionally share a max price.",
  tag: "Optionally share a tag (for example: gift, decor, skincare).",
  businessName: "Next step: send your business name.",
  email: "Next step: send your business email address.",
  addressLine1: "Next step: send address line 1.",
  addressLine2: "Next step: send address line 2.",
  city: "Next step: send your city.",
  state: "Next step: send your state.",
  zipCode: "Next step: send your ZIP or postal code.",
  locationLink: "Optionally share your Google Maps location link.",
  storeName: "Next step: send your storefront display name.",
  logoUrl: "Next step: send the storefront logo URL.",
  coverImageUrl: "Next step: send the storefront cover image URL.",
  name: "Next step: send the product name.",
  category: "Next step: send the product category.",
  price: "Next step: send the product price.",
  stockQuantity: "Next step: send stock quantity.",
  productName: "Next step: send the product name.",
  orderId: "Next step: send the order ID.",
  reason: "Next step: send the reason.",
  details: "Optionally share extra details for this request.",
  merchantSlug: "Share merchant slug to continue in that merchant chat context.",
  activeOnly: "Set activeOnly=true to fetch active orders only.",
  analyticsQuery:
    "Ask about sales, best sellers, low stock, or users with active carts.",
  status:
    "Next step: send the target status: created, paid, Processing, Shipped, Delivered, Cancelled, Refunded, or Replacement.",
};

function prettyFieldName(field: string) {
  const labels: Record<string, string> = {
    userName: "Name",
    userEmail: "Email",
    personaText: "Persona Summary",
    personaTags: "Persona Tags",
    query: "Search Query",
    quantity: "Quantity",
    upiVerifiedName: "UPI Verified Name",
    shippingAddress: "Shipping Address",
    addressChoice: "Address Option",
    maxPrice: "Max Price",
    tag: "Tag",
    city: "City",
    businessName: "Business Name",
    addressLine1: "Address Line 1",
    addressLine2: "Address Line 2",
    zipCode: "ZIP Code",
    locationLink: "Google Maps Location Link",
    storeName: "Storefront Name",
    logoUrl: "Logo URL",
    coverImageUrl: "Cover Image URL",
    productName: "Product Name",
    stockQuantity: "Stock Quantity",
    imageUrl: "Image URL",
    orderId: "Order ID",
    reason: "Reason",
    details: "Details",
    merchantSlug: "Merchant Slug",
    activeOnly: "Active Orders Only",
    analyticsQuery: "Analytics Query",
  };
  return labels[field] || `${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function buildIntentChecklist(intent: WaIntent, draft: Record<string, unknown>) {
  let required = REQUIRED_BY_INTENT[intent] || [];
  const optional = OPTIONAL_BY_INTENT[intent] || [];
  if (intent === "user_order_create") {
    const rail = normalizePaymentRail(draft.paymentRail);
    if (rail.startsWith("x402") || rail.startsWith("razorpay")) {
      required = required.filter((field) => field !== "upiVerifiedName");
    }
  }
  if (!required.length && !optional.length) return "";

  const mark = (field: string) => {
    const value = draft[field];
    const filled =
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" || value.trim().length > 0);
    return filled ? "[x]" : "[ ]";
  };

  const requiredLines = required.map(
    (field) => `${mark(field)} ${prettyFieldName(field)}`
  );
  const optionalLines = optional
    .filter((field) => !required.includes(field))
    .map((field) => `${mark(field)} ${prettyFieldName(field)} (optional)`);

  return [
    "",
    "Needed now:",
    ...requiredLines,
    ...(optionalLines.length ? ["", "Optional:", ...optionalLines] : []),
  ].join("\n");
}

function buildUnclearIntentTemplate(merchantStatus?: string) {
  const isApproved = merchantStatus === "approved";
  const merchantLine = isApproved
    ? "Merchant account detected and approved for this number."
    : "If this number is for a merchant, start with merchant registration first.";

  return [
    "I could not clearly identify your request. Use one of these templates:",
    "",
    "USER FLOW",
    "1) User registration: userName, userEmail",
    "Example: register userName=Rahul userEmail=rahul@example.com",
    "2) Persona create/update",
    "Example: update persona personaText=I like minimal decor under 1500",
    "3) Discover products",
    "Example: discover products query=gift for mom category=home maxPrice=2000",
    "3a) Enter merchant chat context",
    "Example: shop acme-decor",
    "4) Discover merchants",
    "Example: discover merchants city=Hyderabad query=wallpapers",
    "5) Query my orders",
    "Example: my orders",
    "Example: track order orderId=wa_merchant_1722330000_1234",
    "6) Create an order and pay",
    "Example: buy productName=Canvas Lamp quantity=2 shippingAddress=Flat 4B, MG Road, Hyderabad 500001",
    "If saved addresses are shown, select with: addressOption=1",
    "7) Confirm payment",
    "Example: confirm payment orderId=wa_merchant_1722330000_1234",
    "8) Request refund",
    "Example: refund orderId=wa_merchant_1722330000_1234 reason=Received damaged item",
    "9) Request replacement",
    "Example: replacement orderId=wa_merchant_1722330000_1234 reason=Wrong size received",
    "10) Request cancellation",
    "Example: cancel order orderId=wa_merchant_1722330000_1234 reason=Ordered by mistake",
    "11) Wishlist",
    "Example: add wishlist productName=Guts Wallpaper",
    "Example: remove wishlist productName=Guts Wallpaper",
    "Example: view wishlist",
    "",
    "MERCHANT FLOW",
    `1) Merchant registration${isApproved ? " (already completed for this number)" : ""}`,
    "businessName, email, addressLine1, addressLine2, city, state, zipCode (+ optional locationLink as Google Maps URL)",
    "Example: Register businessName=Acme Decor, email=a@b.com, addressLine1=..., addressLine2=..., city=Hyderabad, state=Telangana, zipCode=500001, locationLink=https://maps.google.com/...",
    "",
    "2) Product upload/update/query",
    "name, category, price, stockQuantity (+ optional brand, description, image)",
    "Example: Add product name=Canvas Lamp, category=home, price=1499, stockQuantity=20",
    "Example: Update productName=Canvas Lamp price=1299 stockQuantity=15",
    "Example: Query product Canvas Lamp",
    "",
    "3) Storefront settings update",
    "Example: update storefront storeName=Acme Decor logoUrl=https://... coverImageUrl=https://...",
    "",
    "4) Stock update/query",
    "Example: Stock update productName=Canvas Lamp stockQuantity=0",
    "Example: Stock query Canvas Lamp",
    "",
    "5) Orders",
    "Example: Active orders",
    "Example: Update order status orderId=ORD123 status=Shipped",
    "6) Business insights",
    "Example: total sales today",
    "Example: best selling items",
    "Example: what needs restocking",
    "Example: users with active carts",
    "7) Bulk product import (CSV)",
    "Example: bulk upload help",
    "",
    "Notes:",
    "- I auto-detect whether this number is acting as a user or merchant from your message + registration state.",
    "- For merchant-scoped user flows, set merchant context first: shop <merchant-slug>.",
    "- To reset chat and session context: clear context",
    "- For sensitive actions (stock=0, order status change), I will ask YES/NO confirmation.",
    "- You can also send a product image; I will attach it to product upload/update draft.",
    "",
    merchantLine,
  ].join("\n");
}

function buildInitialUsageInstructions(args: {
  merchantStatus?: string;
  hasUserProfile: boolean;
  hasMerchantProfile: boolean;
}) {
  const merchantStatusLine = args.hasMerchantProfile
    ? `Merchant profile detected (${args.merchantStatus || "unknown status"}).`
    : "No merchant profile linked to this number yet.";
  const userStatusLine = args.hasUserProfile
    ? "User profile detected for this number."
    : "No user profile linked to this number yet.";

  return [
    "Welcome to Rasphia WhatsApp Assistant.",
    "I support both USER and MERCHANT workflows in this same chat.",
    "",
    "USER FUNCTIONS",
    "1) Register user",
    "Example: register userName=Rahul userEmail=rahul@example.com",
    "2) Update persona",
    "Example: update persona personaText=I like minimal decor under 1500",
    "3) Discover products",
    "Example: discover products query=gift for mom category=home maxPrice=2000",
    "3a) Enter merchant chat context",
    "Example: shop acme-decor",
    "4) Create order + get payment link",
    "Example: buy productName=Canvas Lamp quantity=2 shippingAddress=Flat 4B, MG Road, Hyderabad 500001",
    "If saved addresses are shown, select with: addressOption=1",
    "5) Confirm payment",
    "Example: confirm payment orderId=wa_merchant_1722330000_1234",
    "6) Track orders",
    "Example: my orders",
    "7) Request refund",
    "Example: refund orderId=wa_merchant_1722330000_1234 reason=Received damaged item",
    "8) Request replacement",
    "Example: replacement orderId=wa_merchant_1722330000_1234 reason=Wrong size received",
    "9) Request cancellation",
    "Example: cancel order orderId=wa_merchant_1722330000_1234 reason=Ordered by mistake",
    "10) Wishlist",
    "Example: add wishlist productName=Guts Wallpaper",
    "",
    "MERCHANT FUNCTIONS",
    "1) Register merchant",
    "Example: register merchant businessName=Acme Decor email=a@b.com addressLine1=... addressLine2=... city=Hyderabad state=Telangana zipCode=500001 locationLink=https://maps.google.com/... (optional)",
    "2) Upload product",
    "Example: add product name=Canvas Lamp category=home price=1499 stockQuantity=20",
    "3) Update product",
    "Example: update product productName=Canvas Lamp price=1299 stockQuantity=15",
    "4) Query products/stock",
    "Example: stock query Canvas Lamp",
    "5) Update stock",
    "Example: stock update productName=Canvas Lamp stockQuantity=0",
    "6) Manage orders",
    "Example: active orders",
    "Example: update order status orderId=ORD123 status=Shipped",
    "7) Bulk product import help",
    "Example: bulk upload help",
    "8) Update storefront settings",
    "Example: update storefront storeName=Acme Decor logoUrl=https://... coverImageUrl=https://...",
    "",
    "NOTES",
    "- For sensitive actions, I will ask YES/NO confirmation.",
    "- To use merchant-scoped user flows, first set context: shop <merchant-slug>. Use 'clear merchant' to exit.",
    "- To restart WhatsApp context from scratch: clear context",
    "- You can send product images and I will attach them to product drafts.",
    `- ${userStatusLine}`,
    `- ${merchantStatusLine}`,
    "",
    "Reply with your next command directly.",
  ].join("\n");
}

function buildRoleSpecificQuickGuide(role: "merchant" | "user") {
  if (role === "merchant") {
    return [
      "*Merchant*",
      "Choose one:",
      "1) add product",
      "2) active orders",
      "3) stock query <product name>",
      "4) total sales today",
      "5) best selling items",
      "",
      "Examples:",
      "add product name=Canvas Lamp category=home price=1499 stockQuantity=20",
      "update order status orderId=ORD123 status=Shipped",
      "update storefront storeName=Acme Decor",
    ].join("\n");
  }

  return [
    "*Shopping*",
    "Choose one:",
    "1) discover products",
    "2) buy a product",
    "3) my orders",
    "4) refund or replacement",
    "",
    "Examples:",
    "discover products query=gift under 1500",
    "buy productName=Canvas Lamp quantity=1 shippingAddress=Flat 4B, MG Road, Hyderabad, Telangana, 500001",
    "confirm payment orderId=<orderId>",
    ].join("\n");
}

function normalizePhone(input: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

function phoneVariants(input: string) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  // India normalization support:
  // - incoming WA often sends 91xxxxxxxxxx
  // - existing DB may store +91xxxxxxxxxx, 91xxxxxxxxxx, or xxxxxxxxxx
  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`+${local}`);
  }
  if (digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
  }

  return Array.from(variants).filter(Boolean);
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isAffirmative(text: string) {
  const t = text.trim().toLowerCase();
  return ["yes", "y", "confirm", "ok", "okay", "proceed"].includes(t);
}

function isNegative(text: string) {
  const t = text.trim().toLowerCase();
  return ["no", "n", "cancel", "stop"].includes(t);
}

function detectRoleChoice(text: string): "merchant" | "user" | null {
  const t = text.trim().toLowerCase();
  if (/\bmerchant\b/.test(t) || /\bseller\b/.test(t) || /\bvendor\b/.test(t)) {
    return "merchant";
  }
  if (/\buser\b/.test(t) || /\bcustomer\b/.test(t) || /\bbuyer\b/.test(t)) {
    return "user";
  }
  return null;
}

function detectRoleSwitch(text: string): "merchant" | "user" | null {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (!/\b(switch|change|set)\b/.test(t)) return null;
  return detectRoleChoice(t);
}

function detectRoleFromProfiles(args: {
  hasMerchant: boolean;
  hasUser: boolean;
}): "merchant" | "user" | null {
  if (args.hasMerchant && !args.hasUser) return "merchant";
  if (args.hasUser && !args.hasMerchant) return "user";
  return null;
}

function buildRoleConfirmationPrompt(args: {
  hasMerchantProfile: boolean;
  hasUserProfile: boolean;
}) {
  const profileLine =
    args.hasMerchantProfile && args.hasUserProfile
      ? "I found both merchant and user profiles for this number."
      : !args.hasMerchantProfile && !args.hasUserProfile
      ? "I could not match this number to a merchant or user profile yet."
      : "I need explicit role confirmation before continuing.";
  return [
    profileLine,
    "Reply with exactly one word:",
    "USER",
    "or",
    "MERCHANT",
  ].join("\n");
}

function shouldSendInitialGuide(text: string) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  if (t.length <= 2) return true;
  if (["hi", "hey", "hello", "start", "menu", "help", "hii", "yo"].includes(t)) {
    return true;
  }
  return false;
}

function extractMerchantSlugFromText(text: string) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return "";
  const directLink = raw.match(/\/storefronts\/([a-z0-9_-]{3,60})/i)?.[1];
  if (directLink) return directLink;
  const cmd = raw.match(
    /\b(?:merchant|shop|store|from)\s*(?:=|:)?\s*([a-z0-9_-]{3,60})\b/i
  )?.[1];
  return cmd || "";
}

function shouldClearMerchantContext(text: string) {
  const t = String(text || "").trim().toLowerCase();
  return /\b(clear|exit|leave|reset)\s+(merchant|shop|store)\b/.test(t);
}

function shouldResetWhatsAppContext(text: string) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (
    [
      "clear context",
      "reset context",
      "restart chat",
      "reset chat",
      "clear chat",
      "restart session",
      "reset session",
      "start over",
    ].includes(t)
  ) {
    return true;
  }
  return /\b(clear|reset|restart)\b.*\b(chat|context|session)\b/.test(t);
}

async function resolveMerchantContext(args: {
  draft: Record<string, unknown>;
  session: SessionData;
}) {
  const draftSlug = String(args.draft.merchantSlug || "").trim().toLowerCase();
  const sessionSlug = String(args.session.activeMerchantSlug || "").trim().toLowerCase();
  const sessionId = String(args.session.activeMerchantId || "").trim();

  let merchant:
    | {
        id: string;
        slug: string;
        name: string;
        status: string;
      }
    | null = null;
  if (draftSlug) {
    merchant = await prisma.merchant.findFirst({
      where: { slug: draftSlug },
      select: { id: true, slug: true, name: true, status: true },
    });
  } else if (sessionId) {
    merchant = await prisma.merchant.findFirst({
      where: { id: sessionId },
      select: { id: true, slug: true, name: true, status: true },
    });
  } else if (sessionSlug) {
    merchant = await prisma.merchant.findFirst({
      where: { slug: sessionSlug },
      select: { id: true, slug: true, name: true, status: true },
    });
  }

  if (!merchant) return null;
  return merchant as MerchantChatContext;
}

function missingRequired(intent: WaIntent, draft: Record<string, unknown>) {
  let required = REQUIRED_BY_INTENT[intent] || [];
  if (intent === "user_order_create") {
    const rail = normalizePaymentRail(draft.paymentRail);
    if (rail.startsWith("x402") || rail.startsWith("razorpay")) {
      required = required.filter((field) => field !== "upiVerifiedName");
    }
  }
  return required.filter((field) => {
    const value = draft[field];
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  });
}

function normalizePaymentRail(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "razorpay_whatsapp";
  if (raw.includes("x402") || raw.includes("agentic")) return "x402_agentic";
  if (raw.includes("razorpay")) return "razorpay_whatsapp";
  if (raw.includes("seedhape")) return "seedhape_whatsapp";
  return "razorpay_whatsapp";
}

async function getMerchantByPhone(phone: string) {
  const variants = phoneVariants(phone);
  return prisma.merchant.findFirst({
    where: {
      OR: variants.map((p) => ({ phone: p })),
    },
  });
}

async function getUserByPhone(phone: string) {
  const variants = phoneVariants(phone);
  return prisma.userProfile.findFirst({
    where: {
      OR: variants.map((p) => ({ phone: p })),
    },
  });
}

async function getSession(phone: string) {
  const normalized = normalizePhone(phone) || phone;
  const existing = await prisma.whatsappSession.upsert({
    where: { phone: normalized },
    create: {
      phone: normalized,
      data: {
        activeIntent: undefined,
        draft: {},
      } as Prisma.InputJsonValue,
    },
    update: {},
  });
  const data: SessionData =
    existing && typeof existing.data === "object" && existing.data
      ? (existing.data as SessionData)
      : { activeIntent: undefined, draft: {} };
  return {
    phone: normalized,
    record: existing,
    data,
  };
}

async function saveSession(phone: string, data: SessionData) {
  await prisma.whatsappSession.upsert({
    where: { phone },
    create: {
      phone,
      data: data as Prisma.InputJsonValue,
    },
    update: {
      data: data as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
}

async function appendConversationMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  options?: { intent?: WaIntent; messageId?: string }
) {
  const text = String(content || "").trim();
  if (!text) return;

  await prisma.whatsappChatMessage.create({
    data: {
      sessionId,
      role,
      content: text,
      intent: options?.intent,
      messageId: options?.messageId,
    },
  });
}

async function getConversationContext(sessionId: string) {
  const take = Math.max(1, Math.min(WHATSAPP_CONTEXT_WINDOW, 100));
  const rows = await prisma.whatsappChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      role: true,
      content: true,
    },
  });

  return rows
    .reverse()
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
    })) as ConversationTurn[];
}

async function pruneConversation(sessionId: string) {
  const keep = Math.max(10, Math.min(WHATSAPP_CONTEXT_KEEP, 200));
  const staleRows = await prisma.whatsappChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (!staleRows.length) return;
  await prisma.whatsappChatMessage.deleteMany({
    where: {
      id: { in: staleRows.map((row) => row.id) },
    },
  });
}

function fallbackIntent(message: string): IntentParse {
  const text = message.toLowerCase();
  if (
    text.includes("user register") ||
    text.includes("register me") ||
    text.includes("signup")
  ) {
    return { intent: "user_register", fields: {} };
  }
  if (text.includes("persona")) {
    return { intent: "user_persona_update", fields: {} };
  }
  if (
    (text.includes("my order") || text.includes("track order") || text.includes("order status")) &&
    !text.includes("update")
  ) {
    return { intent: "user_order_query", fields: {} };
  }
  if (text.includes("my active order") || text.includes("active my order")) {
    return { intent: "user_order_query", fields: { activeOnly: true } };
  }
  if (
    text.includes("confirm payment") ||
    text.includes("verify payment") ||
    text.includes("payment confirm")
  ) {
    const txHash =
      text.match(/(?:txhash|tx|transaction)\s*[:=]?\s*(0x[a-f0-9]{16,})/i)?.[1] || "";
    const payerAddress =
      text.match(/(?:payeraddress|payer|address)\s*[:=]?\s*(0x[a-f0-9]{16,})/i)?.[1] || "";
    return {
      intent: "user_payment_confirm",
      fields: {
        ...(txHash ? { txHash: txHash.trim() } : {}),
        ...(payerAddress ? { payerAddress: payerAddress.trim() } : {}),
      },
    };
  }
  if (
    text.includes("refund") ||
    text.includes("return money") ||
    text.includes("money back")
  ) {
    return { intent: "user_refund_request", fields: {} };
  }
  if (
    text.includes("replacement") ||
    text.includes("replace order") ||
    text.includes("replace item")
  ) {
    return { intent: "user_replacement_request", fields: {} };
  }
  if (
    (text.includes("cancel") && text.includes("order")) ||
    text.includes("order cancellation")
  ) {
    return { intent: "user_cancellation_request", fields: {} };
  }
  if (
    text.includes("buy") ||
    text.includes("create order") ||
    text.includes("place order") ||
    text.includes("order product")
  ) {
    const qty = text.match(/(?:qty|quantity|x)\s*[:=]?\s*(\d{1,3})/)?.[1];
    const optionMatch = text.match(
      /(?:addressoption|addresschoice|use\s+address)\s*[:=]?\s*(\d{1,2})/i
    )?.[1];
    const productName =
      text.match(/(?:productname|product|item|name)\s*[:=]\s*([^,\n]+)/i)?.[1] || "";
    const upiVerifiedName =
      text.match(/(?:upiverifiedname|upi\s*name|verified\s*name)\s*[:=]\s*([^,\n]+)/i)?.[1] ||
      "";
    const shippingAddress =
      text.match(/(?:shippingaddress|address)\s*[:=]\s*(.+)$/i)?.[1] || "";
    const paymentRail =
      text.includes("x402") || text.includes("agentic")
        ? "x402_agentic"
        : text.includes("seedhape")
        ? "seedhape_whatsapp"
        : "";
    return {
      intent: "user_order_create",
      fields: {
        ...(qty ? { quantity: Number(qty) } : {}),
        ...(optionMatch ? { addressChoice: Number(optionMatch) } : {}),
        ...(productName ? { productName: productName.trim() } : {}),
        ...(upiVerifiedName ? { upiVerifiedName: upiVerifiedName.trim() } : {}),
        ...(shippingAddress ? { shippingAddress: shippingAddress.trim() } : {}),
        ...(paymentRail ? { paymentRail } : {}),
      },
    };
  }
  if (text.includes("wishlist") && (text.includes("view") || text.includes("show"))) {
    return { intent: "user_wishlist_view", fields: {} };
  }
  if (text.includes("wishlist") && (text.includes("remove") || text.includes("delete"))) {
    return { intent: "user_wishlist_remove", fields: {} };
  }
  if (text.includes("wishlist")) {
    return { intent: "user_wishlist_add", fields: {} };
  }
  if (
    (text.includes("sales") && (text.includes("today") || text.includes("month") || text.includes("revenue"))) ||
    text.includes("best selling") ||
    text.includes("best-selling") ||
    text.includes("top selling") ||
    text.includes("restock") ||
    text.includes("low stock") ||
    text.includes("active carts") ||
    text.includes("active cart") ||
    text.includes("abandoned cart")
  ) {
    return {
      intent: "merchant_analytics_query",
      fields: { analyticsQuery: message.trim() },
    };
  }
  if (text.includes("discover merchant") || text.includes("find merchant")) {
    return { intent: "user_discover_merchants", fields: {} };
  }
  if (text.includes("discover") || text.includes("find product") || text.includes("recommend")) {
    return { intent: "user_discover_products", fields: {} };
  }
  if (text.includes("register") || text.includes("onboard")) {
    return { intent: "merchant_register", fields: {} };
  }
  if (
    text.includes("update storefront") ||
    text.includes("storefront update") ||
    text.includes("update store name") ||
    text.includes("update logo") ||
    text.includes("change logo") ||
    text.includes("update cover") ||
    text.includes("change cover")
  ) {
    const storeName =
      text.match(/(?:storename|store\s*name|businessname)\s*[:=]\s*([^,\n]+)/i)?.[1] || "";
    const logoUrl = text.match(/(?:logourl|logo)\s*[:=]\s*(https?:\/\/[^\s,]+)/i)?.[1] || "";
    const coverImageUrl =
      text.match(
        /(?:coverimageurl|coverurl|cover|bannerurl|banner)\s*[:=]\s*(https?:\/\/[^\s,]+)/i
      )?.[1] || "";
    return {
      intent: "merchant_storefront_update",
      fields: {
        ...(storeName ? { storeName: storeName.trim() } : {}),
        ...(logoUrl ? { logoUrl: logoUrl.trim() } : {}),
        ...(coverImageUrl ? { coverImageUrl: coverImageUrl.trim() } : {}),
      },
    };
  }
  if (text.includes("stock") && (text.includes("how much") || text.includes("check") || text.includes("query") || text.includes("available"))) {
    return { intent: "stock_query", fields: {} };
  }
  if (text.includes("stock")) {
    const qty = text.match(/(\d+)/)?.[1];
    return {
      intent: "stock_update",
      fields: qty ? { stockQuantity: Number(qty) } : {},
    };
  }
  if (
    (text.includes("bulk") || text.includes("csv")) &&
    (text.includes("upload") || text.includes("import") || text.includes("product"))
  ) {
    return { intent: "merchant_bulk_upload_help", fields: {} };
  }
  if (text.includes("upload") || text.includes("add product")) {
    return { intent: "product_upload", fields: {} };
  }
  if (text.includes("update product")) {
    return { intent: "product_update", fields: {} };
  }
  if (text.includes("order") && text.includes("active")) {
    return { intent: "order_query_active", fields: {} };
  }
  if (text.includes("order") && text.includes("status")) {
    return { intent: "order_update_status", fields: {} };
  }
  if (text.includes("product")) {
    return { intent: "product_query", fields: {} };
  }
  return { intent: "unknown", fields: {} };
}

async function inferIntent(
  message: string,
  activeIntent?: WaIntent,
  history: ConversationTurn[] = [],
  roleHint?: "merchant" | "user" | null
): Promise<IntentParse> {
  if (!gemini) return fallbackIntent(message);

  const fieldKeys = [
    "userName",
    "userEmail",
    "personaText",
    "personaTags",
    "query",
    "quantity",
    "upiVerifiedName",
    "shippingAddress",
    "addressChoice",
    "maxPrice",
    "tag",
    "businessName",
    "email",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "zipCode",
    "locationLink",
    "storeName",
    "logoUrl",
    "coverImageUrl",
    "name",
    "productName",
    "category",
    "brand",
    "description",
    "price",
    "stockQuantity",
    "orderId",
    "merchantSlug",
    "activeOnly",
    "analyticsQuery",
    "reason",
    "details",
    "status",
    "paymentRail",
    "txHash",
    "payerAddress",
  ] as const;

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      `You are an intent parser for Rasphia WhatsApp automation (user + merchant flows).
Pick one intent from this enum only: ${WA_INTENTS.join(", ")}.
Extract only explicit fields from user message.
If continuation message likely belongs to prior intent (${activeIntent || "none"}), keep same intent unless user clearly switched.
Current confirmed role hint for this conversation: ${roleHint || "none"}.
If role hint is merchant, prefer merchant intents.
If role hint is user, prefer user intents.

Return strict JSON with shape:
{
  "intent": "<enum value>",
  "fields": {
    "userName": string|null,
    "userEmail": string|null,
    "personaText": string|null,
    "personaTags": string|null,
    "query": string|null,
    "quantity": number|null,
    "upiVerifiedName": string|null,
    "shippingAddress": string|null,
    "addressChoice": number|null,
    "maxPrice": number|null,
    "tag": string|null,
    "businessName": string|null,
    "email": string|null,
    "addressLine1": string|null,
    "addressLine2": string|null,
    "city": string|null,
    "state": string|null,
    "zipCode": string|null,
    "locationLink": string|null,
    "storeName": string|null,
    "logoUrl": string|null,
    "coverImageUrl": string|null,
    "name": string|null,
    "productName": string|null,
    "category": string|null,
    "brand": string|null,
    "description": string|null,
    "price": number|null,
    "stockQuantity": number|null,
    "orderId": string|null,
    "merchantSlug": string|null,
    "activeOnly": boolean|null,
    "analyticsQuery": string|null,
    "reason": string|null,
    "details": string|null,
    "status": string|null
    "paymentRail": string|null,
    "txHash": string|null,
    "payerAddress": string|null
  }
}`,
      ...history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`),
      `User: ${message}`,
    ].join("\n\n"),
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const raw = response.text || "{}";
  const parsed = JSON.parse(raw) as IntentParse;
  if (!WA_INTENTS.includes(parsed.intent)) {
    return fallbackIntent(message);
  }

  const allowedFieldKeys = new Set(fieldKeys);
  const normalizedFields = Object.fromEntries(
    Object.entries(parsed.fields || {}).filter(
      ([key, value]) =>
        allowedFieldKeys.has(key as (typeof fieldKeys)[number]) &&
        value !== null &&
        value !== undefined
    )
  );

  return {
    intent: parsed.intent,
    fields: normalizedFields,
  };
}

function parseStringArray(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

async function buildWhatsAppPaymentConfirmationReply(args: {
  orderId: string;
  invoiceWarning?: string | null;
}) {
  const order = await findOrderByCustomerReference({
    reference: args.orderId,
    select: {
      id: true,
      receipt: true,
      orderId: true,
      status: true,
      amount: true,
      currency: true,
      verifiedAt: true,
      invoiceNumber: true,
      invoicePdfUrl: true,
      invoiceSyncStatus: true,
      customer: true,
      products: true,
    },
  });

  if (!order) {
    return `Payment confirmed for ${args.orderId}.`;
  }

  const customer = (order.customer || {}) as {
    email?: string;
  };
  const productSummary = Array.isArray(order.products)
    ? (order.products as Array<{ name?: string; quantity?: number }>)
        .map((item) => `${String(item.name || "Item")} x${Math.max(1, Number(item.quantity || 1))}`)
        .join(", ")
    : "";

  const lines = [
    `Payment confirmed for ${getCustomerFacingOrderId(order)}.`,
    `Order status: ${String(order.status || "paid").toUpperCase()}`,
    `Amount: ${formatInr(Number(order.amount || 0))}`,
    `Payment order ref: ${order.orderId}`,
    ...(productSummary ? [`Items: ${productSummary}`] : []),
    ...(order.verifiedAt
      ? [`Verified at: ${new Date(order.verifiedAt).toLocaleString("en-IN")}`]
      : []),
  ];

  if (args.invoiceWarning) {
    lines.push(args.invoiceWarning);
    lines.push("Invoice status: generation or email failed. Please contact support if needed.");
    return lines.join("\n");
  }

  if (order.invoiceNumber) {
    lines.push(`Invoice status: generated (${order.invoiceNumber})`);
    if (customer.email) {
      lines.push(`Invoice email: sent to ${customer.email}`);
    }
    if (order.invoicePdfUrl) {
      lines.push("Invoice:");
      lines.push(order.invoicePdfUrl);
    }
    return lines.join("\n");
  }

  lines.push(
    order.invoiceSyncStatus
      ? `Invoice status: ${order.invoiceSyncStatus}`
      : "Invoice status: pending"
  );
  return lines.join("\n");
}

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function detectMerchantAnalyticsTopic(text: string) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return "overview" as const;
  if (
    normalized.includes("best selling") ||
    normalized.includes("best-selling") ||
    normalized.includes("top selling") ||
    normalized.includes("top products")
  ) {
    return "best_sellers" as const;
  }
  if (
    normalized.includes("restock") ||
    normalized.includes("low stock") ||
    normalized.includes("out of stock")
  ) {
    return "restock" as const;
  }
  if (
    normalized.includes("active carts") ||
    normalized.includes("active cart") ||
    normalized.includes("abandoned cart")
  ) {
    return "active_carts" as const;
  }
  if (normalized.includes("last month")) {
    return "sales_last_month" as const;
  }
  if (normalized.includes("this month")) {
    return "sales_this_month" as const;
  }
  if (normalized.includes("yesterday")) {
    return "sales_yesterday" as const;
  }
  if (normalized.includes("today")) {
    return "sales_today" as const;
  }
  return "overview" as const;
}

async function handleUserRegister(phone: string, draft: Record<string, unknown>) {
  const missing = missingRequired("user_register", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("user_register", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share missing user details."}${checklist}`,
      nextIntent: "user_register" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = UserRegistrationSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid user registration details.";
    const checklist = buildIntentChecklist("user_register", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "user_register" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const email = payload.userEmail.toLowerCase();

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: payload.userName,
      phone,
      address: "",
      metadata: Prisma.JsonNull,
    },
    update: {
      name: payload.userName,
      phone,
      updatedAt: new Date(),
    },
  });

  await prisma.userProfile.upsert({
    where: { email },
    create: {
      email,
      name: payload.userName,
      phone,
      address: "",
      role: "user",
      credits: 0,
      wishlist: [],
    },
    update: {
      name: payload.userName,
      phone,
      role: "user",
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: `User registration complete for ${payload.userName}. You can now discover products, merchants, update persona, and manage wishlist.`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserPersonaUpdate(
  user: { email: string },
  draft: Record<string, unknown>
) {
  const missing = missingRequired("user_persona_update", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("user_persona_update", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share missing persona details."}${checklist}`,
      nextIntent: "user_persona_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = UserPersonaSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid persona details.";
    const checklist = buildIntentChecklist("user_persona_update", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid persona details.${checklist}`,
      nextIntent: "user_persona_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const existing = await prisma.userPersona.findUnique({
    where: { email: user.email },
  });
  const current =
    existing && typeof existing.data === "object" && existing.data
      ? (existing.data as Record<string, unknown>)
      : {};

  const tags = parseStringArray(
    typeof draft.personaTags === "string"
      ? String(draft.personaTags).split(",")
      : draft.personaTags
  );

  const nextData = {
    ...current,
    whatsappPersona: {
      summary: parsed.data.personaText,
      tags,
      updatedAt: new Date().toISOString(),
    },
  };

  await prisma.userPersona.upsert({
    where: { email: user.email },
    create: {
      email: user.email,
      data: nextData as Prisma.InputJsonValue,
    },
    update: {
      data: nextData as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: "Persona updated successfully. I will use this context in future product conversations.",
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserDiscoverProducts(
  draft: Record<string, unknown>,
  merchantContext?: MerchantChatContext | null
) {
  const query = String(draft.query || draft.productName || draft.name || "").trim();
  const category = String(draft.category || "").trim();
  const maxPrice = safeNumber(draft.maxPrice);
  const tag = String(draft.tag || "").trim().toLowerCase();

  if (!query) {
    const checklist = buildIntentChecklist("user_discover_products", draft);
    return {
      done: false,
      reply: `Please share what you want to discover (for example: \"gift for mom under 1500\").${checklist}`,
      nextIntent: "user_discover_products" as WaIntent,
      nextDraft: draft,
    };
  }

  // Reuse the same curation pipeline foundation as /api/curate:
  // query embedding -> vector retrieval -> filtered product projection.
  const queryEmbedding = await embedQuery(query);
  const vectorHits = await searchProductEmbeddings(queryEmbedding, 20);
  const rankedIds = vectorHits.map((hit) => hit._id);

  if (!rankedIds.length) {
    return {
      done: true,
      reply: merchantContext?.name
        ? `I could not find matching products in ${merchantContext.name}. Try rephrasing your need.`
        : "I could not find matching products from the curated catalog. Try rephrasing your need.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const products = await prisma.product.findMany({
    where: {
      id: { in: rankedIds },
      isAvailable: true,
      ...(merchantContext?.id ? { merchantId: merchantContext.id } : {}),
      ...(category ? { category: { contains: category, mode: "insensitive" } } : {}),
      ...(maxPrice !== null ? { price: { lte: maxPrice } } : {}),
    },
  });

  const byId = new Map(products.map((product) => [product.id, product] as const));
  const rankedProducts = rankedIds
    .map((id) => byId.get(id))
    .filter((product): product is (typeof products)[number] => Boolean(product));

  const filtered = tag
    ? rankedProducts.filter((p) =>
        parseStringArray(p.tags).map((t) => t.toLowerCase()).includes(tag)
      )
    : rankedProducts;

  if (!filtered.length) {
    return {
      done: true,
      reply: merchantContext?.name
        ? `I found related products in ${merchantContext.name} but none matched your filters. Try broader category/tag or a higher max price.`
        : "I found related products but none matched your filters. Try broader category/tag or a higher max price.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = filtered
    .slice(0, WHATSAPP_TOP_USER_PRODUCT_SUGGESTIONS)
    .map((p, idx) => {
      const description = String(p.description || "").trim();
      const shortDescription =
        description.length > 120 ? `${description.slice(0, 117)}...` : description;
      const productLink = buildPublicProductLink(p.id);
      return [
        `${idx + 1}) ${p.name}`,
        `Price: ₹${p.price || 0} | Category: ${p.category || "General"} | Stock: ${p.stockQuantity}`,
        `Description: ${shortDescription || "No description"}`,
        `Product link: ${productLink}`,
        p.imageUrl ? `Image: ${p.imageUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
  return {
    done: true,
    reply: `${merchantContext?.name ? `Merchant: ${merchantContext.name}\n` : ""}Top product matches:\n\n${lines.join("\n\n")}\n\nReply with: use product 1`,
    nextIntent: undefined,
    nextDraft: {
      __productOptions: filtered
        .slice(0, WHATSAPP_TOP_USER_PRODUCT_SUGGESTIONS)
        .map((p) => ({
        id: p.id,
        name: p.name,
      })),
    },
  };
}

async function handleUserDiscoverMerchants(draft: Record<string, unknown>) {
  const query = String(draft.query || "").trim();
  const city = String(draft.city || "").trim();

  const merchants = await prisma.merchant.findMany({
    where: {
      status: "approved",
      ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { storefrontDescription: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  if (!merchants.length) {
    return {
      done: true,
      reply: "No approved merchants found for that query yet.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = merchants
    .slice(0, 6)
    .map((m, idx) => `${idx + 1}) ${m.name} (${m.city}, ${m.state}) | /storefronts/${m.slug}`);
  return {
    done: true,
    reply: `Merchant results:\n${lines.join("\n")}`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserWishlistAdd(
  user: { email: string; wishlist: Prisma.JsonValue | null },
  draft: Record<string, unknown>
) {
  const missing = missingRequired("user_wishlist_add", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("user_wishlist_add", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share the product name to add."}${checklist}`,
      nextIntent: "user_wishlist_add" as WaIntent,
      nextDraft: draft,
    };
  }

  const productName = String(draft.productName || draft.name || "").trim();
  const product = await prisma.product.findFirst({
    where: {
      name: { contains: productName, mode: "insensitive" },
      isAvailable: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!product) {
    return {
      done: true,
      reply: `No available product found matching "${productName}".`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const existing = Array.isArray(user.wishlist)
    ? (user.wishlist as Array<Record<string, unknown>>)
    : [];
  const hasAlready = existing.some((item) => item?.id === product.id);
  const nextWishlist = hasAlready
    ? existing
    : [
        ...existing,
        {
          id: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl || "",
          merchantId: product.merchantId || null,
        },
      ];

  await prisma.userProfile.update({
    where: { email: user.email },
    data: {
      wishlist: nextWishlist as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: hasAlready
      ? `${product.name} is already in your wishlist.`
      : `${product.name} added to your wishlist.`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserWishlistView(user: {
  wishlist: Prisma.JsonValue | null;
}) {
  const items = Array.isArray(user.wishlist)
    ? (user.wishlist as Array<Record<string, unknown>>)
    : [];
  if (!items.length) {
    return {
      done: true,
      reply: "Your wishlist is empty.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = items.slice(0, 15).map((item, idx) => {
    const name = String(item.name || "Unknown");
    const price = Number(item.price || 0);
    return `${idx + 1}) ${name}${price > 0 ? ` | ₹${price}` : ""}`;
  });

  return {
    done: true,
    reply: `Your wishlist:\n${lines.join("\n")}`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserWishlistRemove(
  user: { email: string; wishlist: Prisma.JsonValue | null },
  draft: Record<string, unknown>
) {
  const missing = missingRequired("user_wishlist_remove", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("user_wishlist_remove", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share the product name to remove."}${checklist}`,
      nextIntent: "user_wishlist_remove" as WaIntent,
      nextDraft: draft,
    };
  }

  const productName = String(draft.productName || draft.name || "").trim().toLowerCase();
  const existing = Array.isArray(user.wishlist)
    ? (user.wishlist as Array<Record<string, unknown>>)
    : [];

  const nextWishlist = existing.filter((item) => {
    const itemName = String(item.name || "").trim().toLowerCase();
    return !itemName.includes(productName);
  });

  if (nextWishlist.length === existing.length) {
    return {
      done: true,
      reply: `I could not find "${String(draft.productName || draft.name || "").trim()}" in your wishlist.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  await prisma.userProfile.update({
    where: { email: user.email },
    data: {
      wishlist: nextWishlist as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: "Wishlist updated. Item removed successfully.",
    nextIntent: undefined,
    nextDraft: {},
  };
}

function customerEmailFromOrderCustomer(customer: Prisma.JsonValue) {
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    return "";
  }
  const obj = customer as Record<string, unknown>;
  return String(obj.email || "").trim().toLowerCase();
}

function customerNameFromOrderCustomer(customer: Prisma.JsonValue) {
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    return "";
  }
  const obj = customer as Record<string, unknown>;
  return String(obj.name || "").trim().toLowerCase();
}

function pickPositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function pickAddressChoice(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const n = Math.floor(parsed);
  if (n < 1) return null;
  return n;
}

function parseIndexedSelection(text: string, type: "product" | "order"): number | null {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  const match = t.match(
    new RegExp(`(?:use|select|pick|choose)\\s+(?:${type})\\s*(\\d{1,3})`, "i")
  );
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function readDraftOptions<T>(draft: Record<string, unknown>, key: string): T[] {
  const value = draft[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function buildUpiAppLinks(upiUri: string) {
  if (!upiUri.startsWith("upi://")) {
    return { gpay: "", phonepe: "", paytm: "" };
  }
  const pathAndQuery = upiUri.slice("upi://".length);
  return {
    gpay: `tez://${pathAndQuery}`,
    phonepe: `phonepe://${pathAndQuery}`,
    paytm: `paytmmp://${pathAndQuery}`,
  };
}

function resolvePublicBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.RASPHIA_BASE_URL ||
    "";
  return String(configured || "").trim().replace(/\/+$/, "");
}

function buildPublicProductLink(productId: string) {
  const base = resolvePublicBaseUrl();
  const id = String(productId || "").trim();
  if (!id) return "";
  return base ? `${base}/products/${id}` : `/products/${id}`;
}

function buildUpiChooserLink(upiUri: string, orderId: string) {
  const base = resolvePublicBaseUrl();
  if (!base || !upiUri.startsWith("upi://")) return "";
  const params = new URLSearchParams({
    upi: upiUri,
    orderId,
  });
  return `${base}/api/upi-launch?${params.toString()}`;
}

function buildUpiQrImageLink(orderId: string) {
  const base = resolvePublicBaseUrl();
  if (!base || !orderId) return "";
  const params = new URLSearchParams({ orderId });
  return `${base}/api/upi-qr?${params.toString()}`;
}

function readOrderProducts(products: Prisma.JsonValue | null) {
  const items = Array.isArray(products)
    ? (products as Array<Record<string, unknown>>)
    : [];
  return items.map((item) => {
    const name = String(item.name || item.productName || "Item").trim() || "Item";
    const quantity = Math.max(1, Number(item.quantity || 1) || 1);
    const productId = String(item.productId || item.id || "").trim();
    return { name, quantity, productId };
  });
}

function readOrderCustomer(customer: Prisma.JsonValue) {
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    return { name: "", email: "", phone: "", address: "" };
  }
  const obj = customer as Record<string, unknown>;
  return {
    name: String(obj.name || "").trim(),
    email: String(obj.email || "").trim(),
    phone: String(obj.phone || "").trim(),
    address: String(obj.address || "").trim(),
  };
}

function normalizeAddressKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",");
}

function composeAddress(parts: {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}) {
  return [
    String(parts.addressLine1 || "").trim(),
    String(parts.addressLine2 || "").trim(),
    [
      String(parts.city || "").trim(),
      String(parts.state || "").trim(),
      String(parts.zipCode || "").trim(),
    ]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(", ");
}

function toAddressBookEntry(raw: unknown): AddressBookEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const addressLine1 = String(entry.addressLine1 || "").trim();
  const addressLine2 = String(entry.addressLine2 || "").trim();
  const city = String(entry.city || "").trim();
  const state = String(entry.state || "").trim();
  const zipCode = String(entry.zipCode || "").trim();
  const address =
    String(entry.address || "").trim() ||
    composeAddress({ addressLine1, addressLine2, city, state, zipCode });
  if (!address) return null;
  return {
    name: String(entry.name || "").trim(),
    phone: String(entry.phone || "").trim(),
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    address,
  };
}

function parseShippingAddress(address: string): AddressBookEntry | null {
  const raw = String(address || "").trim();
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 4) return null;

  let addressLine1 = parts[0] || "";
  let addressLine2 = parts[1] || "";
  let city = "";
  let state = "";
  let zipCode = "";

  if (parts.length >= 5) {
    city = parts[parts.length - 3] || "";
    state = parts[parts.length - 2] || "";
    zipCode = parts[parts.length - 1] || "";
    addressLine2 =
      parts.slice(1, Math.max(parts.length - 3, 2)).join(", ") || addressLine2;
  } else {
    city = parts[2] || "";
    const stateZip = parts[3] || "";
    const stateZipMatch = stateZip.match(/^(.+?)\s+([A-Za-z0-9\- ]{4,12})$/);
    if (stateZipMatch) {
      state = stateZipMatch[1].trim();
      zipCode = stateZipMatch[2].trim();
    } else {
      state = stateZip.trim();
    }
  }

  const entry: AddressBookEntry = {
    name: "",
    phone: "",
    addressLine1,
    addressLine2,
    city: city.trim(),
    state: state.trim(),
    zipCode: zipCode.trim(),
    address: raw,
  };
  if (
    entry.addressLine1.length < 3 ||
    entry.addressLine2.length < 2 ||
    entry.city.length < 2 ||
    entry.state.length < 2 ||
    !/^[A-Za-z0-9\- ]{4,12}$/.test(entry.zipCode)
  ) {
    return null;
  }
  return entry;
}

function buildOrderDetailLines(
  order: {
    id?: string;
    orderId: string;
    receipt?: string | null;
    status: string;
    amount: number;
    currency?: string | null;
    merchantId?: string | null;
    paymentId?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    shippingProvider?: string | null;
    estimatedDelivery?: Date | string | null;
    products?: Prisma.JsonValue | null;
    customer?: Prisma.JsonValue | null;
  },
  options?: { index?: number; merchantName?: string | null; includeCustomer?: boolean }
) {
  const products = readOrderProducts(order.products || null);
  const customer = readOrderCustomer(order.customer as Prisma.JsonValue);
  const productLines = products.length
    ? products
        .slice(0, 5)
        .map((p, i) => {
          const link = p.productId ? buildPublicProductLink(p.productId) : "";
          return `${i + 1}. ${p.name} x${p.quantity}${link ? ` (${link})` : ""}`;
        })
    : ["1. Item details unavailable"];
  const moneyPrefix = String(order.currency || "").toUpperCase() === "INR" ? "₹" : "";
  const trackingLine = order.trackingNumber
    ? `${order.shippingProvider ? `${order.shippingProvider} ` : ""}${order.trackingNumber}`
    : "";
  const links: string[] = [];
  if (order.trackingUrl) links.push(`Tracking URL: ${order.trackingUrl}`);
  const titlePrefix = options?.index ? `${options.index}) ` : "";

  const customerFacingOrderId = String(order.id || order.receipt || order.orderId || "").trim();
  const lines = [
    `${titlePrefix}Order ID: ${customerFacingOrderId}`,
    `Status: ${order.status}`,
    `Amount: ${moneyPrefix}${order.amount}`,
    options?.merchantName ? `Merchant: ${options.merchantName}` : "",
    order.orderId ? `Payment Order Ref: ${order.orderId}` : "",
    order.receipt ? `Legacy App Ref: ${order.receipt}` : "",
    trackingLine ? `Tracking: ${trackingLine}` : "",
    order.estimatedDelivery
      ? `Estimated delivery: ${new Date(order.estimatedDelivery).toLocaleDateString()}`
      : "",
    order.paymentId ? `Payment Ref: ${order.paymentId}` : "",
    options?.includeCustomer && customer.name ? `Customer: ${customer.name}` : "",
    options?.includeCustomer && customer.email ? `Customer Email: ${customer.email}` : "",
    options?.includeCustomer && customer.phone ? `Customer Phone: ${customer.phone}` : "",
    options?.includeCustomer && customer.address ? `Address: ${customer.address}` : "",
    "Products:",
    ...productLines,
    ...(links.length ? ["Links:", ...links] : []),
  ].filter(Boolean);

  return lines.join("\n");
}

function getCustomerFacingOrderId(order: {
  id?: string | null;
  receipt?: string | null;
  orderId?: string | null;
}) {
  return String(order.id || order.receipt || order.orderId || "").trim();
}

async function findOrderByCustomerReference<T extends object>(args: {
  reference: string;
  select?: T;
}) {
  const reference = String(args.reference || "").trim();
  if (!reference) return null;
  return prisma.order.findFirst({
    where: {
      OR: [{ receipt: reference }, { orderId: reference }, { id: reference }],
    },
    orderBy: { createdAt: "desc" },
    ...(args.select ? { select: args.select } : {}),
  });
}

async function getSavedAddressesForUser(user: {
  email: string;
  address?: string | null;
}) {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const v = String(value || "").trim();
    if (!v) return;
    const key = normalizeAddressKey(v);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  if (user.address) {
    push(user.address);
  }

  if (!user.email) return out;

  const profile = await prisma.userProfile.findUnique({
    where: { email: user.email },
    select: { addressBook: true },
  });

  const addressBookEntries = Array.isArray(profile?.addressBook)
    ? (profile.addressBook as unknown[])
    : [];
  for (const rawEntry of addressBookEntries) {
    const entry = toAddressBookEntry(rawEntry);
    if (!entry) continue;
    push(entry.address);
    if (out.length >= 5) break;
  }

  return out;
}

async function getSavedAddressEntriesForUser(user: {
  email: string;
  address?: string | null;
  name?: string | null;
  phone?: string | null;
}) {
  const seen = new Set<string>();
  const out: AddressBookEntry[] = [];
  const push = (entry: AddressBookEntry | null) => {
    if (!entry) return;
    const key = normalizeAddressKey(entry.address);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  if (!user.email) return out;

  const profile = await prisma.userProfile.findUnique({
    where: { email: user.email },
    select: { addressBook: true, name: true, phone: true, address: true },
  });

  const addressBookEntries = Array.isArray(profile?.addressBook)
    ? (profile.addressBook as unknown[])
    : [];
  for (const rawEntry of addressBookEntries) {
    const entry = toAddressBookEntry(rawEntry);
    if (entry) {
      if (!entry.name) entry.name = String(profile?.name || user.name || "").trim();
      if (!entry.phone) entry.phone = String(profile?.phone || user.phone || "").trim();
    }
    push(entry);
  }

  if (!out.length) {
    const parsed = parseShippingAddress(String(profile?.address || user.address || "").trim());
    if (parsed) {
      parsed.name = String(profile?.name || user.name || "").trim();
      parsed.phone = String(profile?.phone || user.phone || "").trim();
      push(parsed);
    }
  }

  return out;
}

async function resolveWhatsAppCheckoutCustomer(args: {
  user: { email: string; name?: string | null; phone?: string | null; address?: string | null };
  shippingAddress: string;
}) {
  const savedEntries = await getSavedAddressEntriesForUser(args.user);
  const normalizedTarget = normalizeAddressKey(args.shippingAddress);
  const matchedEntry =
    savedEntries.find((entry) => normalizeAddressKey(entry.address) === normalizedTarget) ||
    null;
  const parsedEntry = matchedEntry || parseShippingAddress(args.shippingAddress);
  if (!parsedEntry) return null;

  const name = String(args.user.name || parsedEntry.name || "").trim();
  const phone = String(args.user.phone || parsedEntry.phone || "").trim();
  const addressLine1 = String(parsedEntry.addressLine1 || "").trim();
  const addressLine2 = String(parsedEntry.addressLine2 || "").trim();
  const city = String(parsedEntry.city || "").trim();
  const state = String(parsedEntry.state || "").trim();
  const zipCode = String(parsedEntry.zipCode || "").trim();
  const address =
    String(parsedEntry.address || "").trim() ||
    composeAddress({ addressLine1, addressLine2, city, state, zipCode });

  if (
    !name ||
    !phone ||
    addressLine1.length < 3 ||
    addressLine2.length < 2 ||
    city.length < 2 ||
    state.length < 2 ||
    !/^[A-Za-z0-9\- ]{4,12}$/.test(zipCode)
  ) {
    return null;
  }

  return {
    name,
    email: args.user.email,
    phone,
    address,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
  } satisfies CheckoutCustomerSnapshot;
}

async function upsertWhatsAppCheckoutCustomerProfile(customer: CheckoutCustomerSnapshot) {
  const addressEntry: AddressBookEntry = {
    name: customer.name,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    state: customer.state,
    zipCode: customer.zipCode,
    address: customer.address,
  };

  await prisma.user.upsert({
    where: { email: customer.email },
    create: {
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      metadata: Prisma.JsonNull,
    },
    update: {
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      updatedAt: new Date(),
    },
  });

  const existingProfile = await prisma.userProfile.findUnique({
    where: { email: customer.email },
    select: { addressBook: true },
  });
  const existingAddressBook: AddressBookEntry[] = Array.isArray(existingProfile?.addressBook)
    ? (existingProfile.addressBook as AddressBookEntry[])
    : [];
  const mergedAddressBook = existingAddressBook.some(
    (entry) => normalizeAddressKey(entry.address) === normalizeAddressKey(addressEntry.address)
  )
    ? existingAddressBook.map((entry) =>
        normalizeAddressKey(entry.address) === normalizeAddressKey(addressEntry.address)
          ? addressEntry
          : entry
      )
    : [addressEntry, ...existingAddressBook];

  await prisma.userProfile.upsert({
    where: { email: customer.email },
    create: {
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      addressBook: mergedAddressBook,
      credits: 0,
    },
    update: {
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      addressBook: mergedAddressBook,
      updatedAt: new Date(),
    },
  });
}

const TERMINAL_SERVICE_REQUEST_STATUSES = new Set(["completed", "rejected"]);
const REFUND_ELIGIBLE_ORDER_STATUSES = new Set([
  "paid",
  "Processing",
  "Shipped",
  "Delivered",
]);
const REPLACEMENT_ELIGIBLE_ORDER_STATUSES = new Set([
  "paid",
  "Processing",
  "Shipped",
  "Delivered",
]);
const CANCELLATION_ELIGIBLE_ORDER_STATUSES = new Set([
  "created",
  "paid",
  "Processing",
]);

function buildServiceRequestNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 900000) + 100000;
  return `RR-${y}${m}${day}-${rand}`;
}

async function resolveMerchantEmailForOrder(order: {
  merchantId: string | null;
  products: Prisma.JsonValue | null;
}) {
  if (order.merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: order.merchantId },
      select: { email: true },
    });
    return merchant?.email || null;
  }

  const orderProducts = Array.isArray(order.products)
    ? (order.products as Array<{ productId?: string; name?: string }>)
    : [];
  const ids = orderProducts
    .map((p) => p.productId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const names = orderProducts
    .map((p) => p.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const productOwnersById = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { merchantEmail: true },
      })
    : [];
  const productOwnersByName =
    !productOwnersById.length && names.length
      ? await prisma.product.findMany({
          where: { name: { in: names } },
          select: { merchantEmail: true },
        })
      : [];
  const productOwners = productOwnersById.length
    ? productOwnersById
    : productOwnersByName;

  const uniqueMerchantEmails = Array.from(
    new Set(
      productOwners
        .map((p) => p.merchantEmail)
        .filter((e): e is string => typeof e === "string" && e.length > 0)
    )
  );
  return uniqueMerchantEmails.length === 1 ? uniqueMerchantEmails[0] : null;
}

async function handleUserServiceRequest(
  user: { email: string },
  draft: Record<string, unknown>,
  requestType: "refund" | "replacement" | "cancellation",
  merchantContext?: MerchantChatContext | null
) {
  const intentKey: WaIntent = requestType === "refund"
    ? "user_refund_request"
    : requestType === "replacement"
    ? "user_replacement_request"
    : "user_cancellation_request";

  const missing = missingRequired(intentKey, draft);
  if (missing.length) {
    const checklist = buildIntentChecklist(intentKey, draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share the missing details."}${checklist}`,
      nextIntent: intentKey,
      nextDraft: draft,
    };
  }

  const orderId = String(draft.orderId || "").trim();
  const reason = String(draft.reason || "").trim();
  const details = String(draft.details || "").trim();
  const order = await findOrderByCustomerReference({
    reference: orderId,
    select: {
      id: true,
      orderId: true,
      receipt: true,
      status: true,
      amount: true,
      currency: true,
      merchantId: true,
      customer: true,
      products: true,
      createdAt: true,
    },
  });

  if (!order) {
    return {
      done: true,
      reply: `Order not found: ${orderId}`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const customerFacingOrderId = getCustomerFacingOrderId(order);

  if (merchantContext?.id && String(order.merchantId || "") !== merchantContext.id) {
    return {
      done: true,
      reply: `Order ${customerFacingOrderId} does not belong to merchant ${merchantContext.name}.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (customerEmailFromOrderCustomer(order.customer) !== user.email.toLowerCase()) {
    return {
      done: true,
      reply: "You can request service only for your own order.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const eligibleStatuses =
    requestType === "refund"
      ? REFUND_ELIGIBLE_ORDER_STATUSES
      : requestType === "replacement"
      ? REPLACEMENT_ELIGIBLE_ORDER_STATUSES
      : CANCELLATION_ELIGIBLE_ORDER_STATUSES;
  if (!eligibleStatuses.has(String(order.status || ""))) {
    return {
      done: true,
      reply:
        requestType === "refund"
          ? "This order is not eligible for refund at its current status."
          : requestType === "replacement"
          ? "This order is not eligible for replacement at its current status."
          : "This order is not eligible for cancellation at its current status.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const existingOpen = await prisma.orderServiceRequest.findFirst({
    where: {
      orderId: order.orderId,
      type: requestType,
      status: { notIn: Array.from(TERMINAL_SERVICE_REQUEST_STATUSES) },
    },
    select: { requestId: true },
  });
  if (existingOpen) {
    return {
      done: true,
      reply: `A ${requestType} request is already open for this order. Please wait for review.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const requestId = `SR-${randomUUID()}`;
  const requestNumber = buildServiceRequestNumber();
  const merchantEmail = await resolveMerchantEmailForOrder({
    merchantId: order.merchantId || null,
    products: order.products,
  });
  const orderProducts = Array.isArray(order.products)
    ? (order.products as Array<Record<string, unknown>>)
    : [];
  const timeline = [
    {
      action: "requested",
      by: user.email,
      note: reason,
      at: new Date().toISOString(),
      source: "whatsapp",
    },
  ];

  await prisma.orderServiceRequest.create({
    data: {
      requestId,
      requestNumber,
      orderId: order.orderId,
      merchantId: order.merchantId || null,
      type: requestType,
      reason,
      details: details || null,
      requestedAmount: Number(order.amount || 0),
      requestedByEmail: user.email,
      merchantEmail,
      timeline: timeline as Prisma.InputJsonValue,
      orderSnapshot: {
        id: order.id,
        orderId: order.orderId,
        receipt: order.receipt,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        merchantId: order.merchantId,
        createdAt: order.createdAt,
      } as Prisma.InputJsonValue,
      customerSnapshot: (order.customer || {}) as Prisma.InputJsonValue,
      requestedItems: orderProducts as Prisma.InputJsonValue,
    },
  });

  return {
    done: true,
    reply: `${
      requestType === "refund"
        ? "Refund"
        : requestType === "replacement"
        ? "Replacement"
        : "Cancellation"
    } request submitted successfully.\nRequest number: ${requestNumber}\nOrder ID: ${customerFacingOrderId}\nStatus: requested`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserOrderCreate(
  user: { email: string; name?: string | null; phone?: string | null; address?: string | null },
  draft: Record<string, unknown>,
  merchantContext?: MerchantChatContext | null
) {
  const paymentRail = normalizePaymentRail(draft.paymentRail);
  const missing = missingRequired("user_order_create", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("user_order_create", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share the product name to buy."}${checklist}`,
      nextIntent: "user_order_create" as WaIntent,
      nextDraft: draft,
    };
  }

  const productName = String(draft.productName || draft.name || "").trim();
  const quantity = pickPositiveInt(draft.quantity, 1);
  const upiVerifiedName = String(draft.upiVerifiedName || "").trim();
  const directShippingAddress = String(draft.shippingAddress || "").trim();
  const addressChoice = pickAddressChoice(draft.addressChoice);
  const savedAddresses = await getSavedAddressesForUser(user);
  const autoSelectedAddress =
    !directShippingAddress && !addressChoice && savedAddresses.length === 1
      ? savedAddresses[0]
      : "";
  const chosenSavedAddress =
    addressChoice && addressChoice <= savedAddresses.length
      ? savedAddresses[addressChoice - 1]
      : "";
  const shippingAddress = directShippingAddress || chosenSavedAddress || autoSelectedAddress;
  const product = await prisma.product.findFirst({
    where: {
      name: { contains: productName, mode: "insensitive" },
      isAvailable: true,
      ...(merchantContext?.id ? { merchantId: merchantContext.id } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!product) {
    return {
      done: true,
      reply: `No available product found matching "${productName}".`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (!shippingAddress) {
    const checklist = buildIntentChecklist("user_order_create", draft);
    const savedBlock = savedAddresses.length
      ? [
          "Saved addresses:",
          ...savedAddresses.map((addr, idx) => `${idx + 1}) ${addr}`),
          "Reply with: addressOption=1",
          "",
        ].join("\n")
      : "";
    return {
      done: false,
      reply: [
        "I need a delivery address before I can create this order.",
        savedBlock,
        "Reply with one of these:",
        "1) addressOption=<number>",
        "2) shippingAddress=<full address>",
        "",
        "Example:",
        "shippingAddress=Flat 4B, MG Road, Hyderabad, Telangana, 500001",
        checklist,
      ]
        .filter(Boolean)
        .join("\n"),
      nextIntent: "user_order_create" as WaIntent,
      nextDraft: draft,
    };
  }

  const checkoutCustomer = await resolveWhatsAppCheckoutCustomer({
    user,
    shippingAddress,
  });
  if (!checkoutCustomer) {
    return {
      done: false,
      reply: [
        "I could not prepare your checkout details from the current address.",
        "Next step: send your address in this format:",
        "shippingAddress=Flat 4B, MG Road, Hyderabad, Telangana, 500001",
        "",
        "I use this to auto-fill payment verification and invoice details.",
      ].join("\n"),
      nextIntent: "user_order_create" as WaIntent,
      nextDraft: draft,
    };
  }

  if ((product.stockQuantity || 0) < quantity) {
    return {
      done: true,
      reply: `Insufficient stock for ${product.name}. Available quantity is ${product.stockQuantity}.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const totalRupees = Number(product.price || 0) * quantity;
  const totalPaise = Math.max(100, Math.round(totalRupees * 100));
  const merchantId = String(product.merchantId || "").trim();
  if (!merchantId) {
    return {
      done: true,
      reply: `Product ${product.name} is not linked to a merchant account.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, slug: true },
  });

  if (paymentRail === "x402_agentic") {
    const appBaseUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
    const merchantSlug = String(merchant?.slug || merchantContext?.slug || "").trim();
    const x402BuyUrl =
      appBaseUrl && merchantSlug
        ? `${appBaseUrl}/api/agent/merchants/${encodeURIComponent(
            merchantSlug
          )}/products/${encodeURIComponent(product.id)}/buy`
        : null;

    return {
      done: true,
      reply: [
        "x402 payment rail selected.",
        `Merchant: ${merchant?.name || merchantId}`,
        `Item: ${product.name} x${quantity}`,
        `Amount: ₹${totalRupees}`,
        "",
        "To complete this on agentic rail, have your agent call the x402 checkout endpoint.",
        ...(x402BuyUrl ? [`Endpoint: ${x402BuyUrl}`] : []),
        "That endpoint returns 402 first, then accepts X-PAYMENT for settlement.",
        "",
        "If you want to pay by UPI in WhatsApp now, retry with paymentRail=seedhape",
      ].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const externalOrderId = `wa_${Date.now()}`;
  const customerName = String(user.name || "").trim();
  const customerPhone = String(user.phone || "").trim();
  let providerOrderId = "";
  let orderMode = "";
  let paymentMessageLines: string[] = [];
  let customerPayload: Record<string, unknown> = {
    name: checkoutCustomer.name,
    email: checkoutCustomer.email,
    phone: checkoutCustomer.phone,
    address: checkoutCustomer.address,
    addressLine1: checkoutCustomer.addressLine1,
    addressLine2: checkoutCustomer.addressLine2,
    city: checkoutCustomer.city,
    state: checkoutCustomer.state,
    zipCode: checkoutCustomer.zipCode,
    channel: "whatsapp",
  };

  if (paymentRail === "razorpay_whatsapp") {
    let merchantConfig: Awaited<ReturnType<typeof getMerchantRazorpayConfig>>;
    try {
      merchantConfig = await getMerchantRazorpayConfig(merchantId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Merchant payment not configured.";
      return {
        done: true,
        reply: `Merchant Razorpay setup is incomplete for this product. (${message})`,
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const razorpayOrder = await createRazorpayOrderWithConfig(
      {
        amount: totalPaise,
        currency: "INR",
        receipt: externalOrderId,
        notes: {
          source: "whatsapp",
          merchantId,
          customerEmail: checkoutCustomer.email,
          customerPhone: checkoutCustomer.phone || "",
          shippingAddress: checkoutCustomer.address,
          productId: product.id,
          quantities: String(quantity),
          productName: product.name,
        },
      },
      {
        keyId: merchantConfig.keyId,
        keySecret: merchantConfig.keySecret,
      }
    );

    providerOrderId = razorpayOrder.id;
    orderMode = "razorpay";
    customerPayload = {
      ...customerPayload,
      paymentRail: "razorpay",
      paymentProvider: "razorpay",
    };
  } else {
    let merchantConfig: Awaited<ReturnType<typeof getMerchantSeedhapeConfig>>;
    try {
      merchantConfig = await getMerchantSeedhapeConfig(merchantId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Merchant payment not configured.";
      return {
        done: true,
        reply: `Merchant payment setup is incomplete for this product. (${message})`,
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const seedhapeOrder = await createSeedhapeOrderWithConfig(
      {
        amount: totalPaise,
        description: `WhatsApp order: ${product.name} x${quantity}`,
        externalOrderId,
        expectedSenderName: upiVerifiedName || customerName || undefined,
        customerEmail: checkoutCustomer.email,
        customerPhone: checkoutCustomer.phone || customerPhone || undefined,
        expiresInMinutes: 30,
        metadata: {
          source: "whatsapp",
          customerEmail: checkoutCustomer.email,
          merchantId,
          productId: product.id,
          quantity,
        },
      },
      {
        apiKey: merchantConfig.apiKey,
        baseUrl: merchantConfig.baseUrl,
      }
    );

    providerOrderId = seedhapeOrder.id;
    orderMode = "seedhape";
    customerPayload = {
      ...customerPayload,
      upiVerifiedName: upiVerifiedName || null,
      paymentQrCode: seedhapeOrder.qrCode,
      paymentRail: "seedhape",
      paymentProvider: "seedhape",
    };

    const links = buildSeedhapePaymentLinks(
      seedhapeOrder.id,
      seedhapeOrder.upiUri,
      merchantConfig.baseUrl
    );
    const upiChooserLink = buildUpiChooserLink(seedhapeOrder.upiUri, seedhapeOrder.id);
    const qrImageLink = buildUpiQrImageLink(seedhapeOrder.id);
    const primaryPayLink = upiChooserLink || links.hostedStatusUrl;
    paymentMessageLines = [
      "Order ready:",
      `Merchant: ${merchant?.name || merchantId}`,
      `Item: ${product.name} x${quantity}`,
      `Amount: ₹${totalRupees}`,
      `UPI name: ${upiVerifiedName}`,
      `Delivery: ${checkoutCustomer.address}`,
      `Payment order ref: ${seedhapeOrder.id}`,
      "",
      "Pay now:",
      primaryPayLink,
    ];
    if (qrImageLink) {
      paymentMessageLines.push("", "Scan or save QR image:", qrImageLink);
    }
    paymentMessageLines.push(
      "",
      "Next step: confirm payment orderId=<orderId>"
    );
  }

  const createdOrder = await prisma.order.create({
    data: {
      orderId: providerOrderId,
      merchantId,
      paymentId: null,
      amount: totalRupees,
      currency: "INR",
      receipt: externalOrderId,
      status: "created",
      mode: orderMode,
      products: [
        {
          productId: product.id,
          name: product.name,
          brand: product.brand,
          price: product.price,
          imageUrl: product.imageUrl,
          quantity,
        },
      ],
      customer: customerPayload as Prisma.InputJsonValue,
      statusHistory: [
        {
          status: "created",
          note: `Order created via WhatsApp with ${orderMode === "razorpay" ? "Razorpay" : "SeedhaPe"}`,
          by: "whatsapp_user",
          at: new Date().toISOString(),
        },
      ],
      isReviewed: false,
      createdAt: new Date(),
    },
  });

  if (orderMode === "razorpay") {
    const checkoutToken = createWhatsAppCheckoutToken({
      orderId: createdOrder.orderId,
      internalOrderId: createdOrder.id,
      email: checkoutCustomer.email,
      expiresInSeconds: 60 * 60,
    });
    const checkoutBase = resolvePublicBaseUrl();
    const hostedCheckoutUrl = checkoutBase
      ? `${checkoutBase}/checkout/whatsapp?token=${encodeURIComponent(checkoutToken)}`
      : `/checkout/whatsapp?token=${encodeURIComponent(checkoutToken)}`;

    customerPayload = {
      ...customerPayload,
      hostedCheckoutUrl,
    };

    await prisma.order.update({
      where: { id: createdOrder.id },
      data: {
        customer: customerPayload as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    paymentMessageLines = [
      `Order ready: ${createdOrder.id}`,
      `Merchant: ${merchant?.name || merchantId}`,
      `Item: ${product.name} x${quantity}`,
      `Amount: ₹${totalRupees}`,
      `Delivery: ${checkoutCustomer.address}`,
      `Payment order ref: ${createdOrder.orderId}`,
      "",
      "Pay on Rasphia:",
      hostedCheckoutUrl,
      "",
      "After payment, Rasphia checkout will verify the order automatically.",
      `If you come back here, you can also reply: confirm payment orderId=${createdOrder.id}`,
    ];
  }
  if (orderMode === "seedhape") {
    paymentMessageLines[0] = `Order ready: ${createdOrder.id}`;
    paymentMessageLines[paymentMessageLines.length - 1] = `Next step: confirm payment orderId=${createdOrder.id}`;
  }

  await upsertWhatsAppCheckoutCustomerProfile(checkoutCustomer);

  return {
    done: true,
    reply: paymentMessageLines.join("\n"),
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserPaymentConfirm(
  user: { email: string; name?: string | null },
  draft: Record<string, unknown>
) {
  const orderId = String(draft.orderId || "").trim();
  if (!orderId) {
    const orders = await prisma.order.findMany({
      where: {
        customer: {
          path: ["email"],
          equals: user.email.toLowerCase(),
        },
        status: { in: ["created", "pending"] },
      },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: {
        id: true,
        orderId: true,
        receipt: true,
        status: true,
        amount: true,
        merchantId: true,
        customer: true,
      },
    });

    const pendingOrders = orders;

    if (!pendingOrders.length) {
      return {
        done: true,
        reply:
          "No pending payment orders found.\nIf needed, reply with: confirm payment orderId=<orderId>",
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const merchantIds = Array.from(
      new Set(
        pendingOrders
          .map((order) => String(order.merchantId || "").trim())
          .filter((id) => id.length > 0)
      )
    );
    const merchants = merchantIds.length
      ? await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: { id: true, name: true },
        })
      : [];
    const merchantNameById = new Map(merchants.map((m) => [m.id, m.name]));
    const lines = [
      "Pending payment orders:",
      ...pendingOrders.slice(0, 10).map((order, index) => {
        const merchantName =
          merchantNameById.get(String(order.merchantId || "").trim()) ||
          String(order.merchantId || "Store");
        return `${index + 1}. ${getCustomerFacingOrderId(order)} • ₹${order.amount} • ${merchantName}`;
      }),
      "",
      "Next step:",
      "use order 1",
      "or confirm payment orderId=<orderId>",
    ];

    return {
      done: false,
      reply: lines.join("\n"),
      nextIntent: "user_payment_confirm" as WaIntent,
      nextDraft: {
        __orderOptions: pendingOrders.slice(0, 10).map((order) => ({
          orderId: getCustomerFacingOrderId(order),
        })),
      },
    };
  }

  const order = await findOrderByCustomerReference({ reference: orderId });
  if (!order) {
    return {
      done: true,
      reply: `Order not found: ${orderId}`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const customerFacingOrderId = getCustomerFacingOrderId(order);

  const orderEmail = customerEmailFromOrderCustomer(order.customer);
  if (!orderEmail || orderEmail !== user.email.toLowerCase()) {
    return {
      done: true,
      reply: "You are not allowed to verify this order.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const merchantId = String(order.merchantId || "").trim();
  if (!merchantId) {
    return {
      done: true,
      reply: "Merchant not found for this order. Please contact support.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const mode = String(order.mode || "").toLowerCase();
  if (mode.startsWith("x402")) {
    if (String(order.status || "").toLowerCase() === "paid") {
      return {
        done: true,
        reply: `Payment already confirmed for ${customerFacingOrderId}.`,
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const txHash = String(draft.txHash || "").trim();
    const payerAddress = String(draft.payerAddress || "").trim();
    if (!/^0x[a-fA-F0-9]{32,}$/.test(txHash)) {
      return {
        done: false,
        reply: [
          "For x402 orders, share a valid transaction hash to confirm payment.",
          "Example: confirm payment orderId=<orderId> txHash=0x...",
        ].join("\n"),
        nextIntent: "user_payment_confirm" as WaIntent,
        nextDraft: { ...draft, orderId },
      };
    }

    await finalizeOrderAsPaid({
      orderId: order.orderId,
      paymentId: `x402_${txHash}`,
      by: user.email,
      note: `x402 payment confirmed via WhatsApp${payerAddress ? ` (payer ${payerAddress})` : ""}`,
      verifiedAt: new Date(),
    });

    return {
      done: true,
      reply: await buildWhatsAppPaymentConfirmationReply({ orderId }),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (mode.startsWith("razorpay")) {
    if (String(order.status || "").toLowerCase() === "paid") {
      return {
        done: true,
        reply: await buildWhatsAppPaymentConfirmationReply({ orderId }),
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const orderCustomer =
      order.customer && typeof order.customer === "object" && !Array.isArray(order.customer)
        ? (order.customer as Record<string, unknown>)
        : {};
    const hostedCheckoutUrl = String(orderCustomer.hostedCheckoutUrl || "").trim();
    const legacyPaymentLinkUrl = String(orderCustomer.paymentLinkUrl || "").trim();

    if (hostedCheckoutUrl) {
      return {
        done: true,
        reply: [
          `I still show order ${customerFacingOrderId} as pending.`,
          "Next step: reopen your Rasphia checkout page and complete payment there.",
          hostedCheckoutUrl,
          "",
          "That page uses the same Razorpay verification flow as the website.",
        ].join("\n"),
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const merchantConfig = await getMerchantRazorpayConfig(merchantId);
    const paymentLink = await getRazorpayPaymentLinkWithConfig(orderId, {
      keyId: merchantConfig.keyId,
      keySecret: merchantConfig.keySecret,
    });
    const paymentStatus = String(paymentLink.status || "").toLowerCase();

    if (paymentStatus !== "paid") {
      if (paymentStatus === "cancelled" || paymentStatus === "expired") {
        return {
          done: true,
          reply: `Order ${customerFacingOrderId} is ${paymentStatus.toUpperCase()}. Create a new order to continue.`,
          nextIntent: undefined,
          nextDraft: {},
        };
      }
      return {
        done: true,
        reply: [
          `Payment is still ${String(paymentLink.status || "pending").toUpperCase()}.`,
          legacyPaymentLinkUrl ? "Complete payment here:" : "Please complete payment and retry in a few seconds.",
          legacyPaymentLinkUrl || "",
        ]
          .filter(Boolean)
          .join("\n"),
        nextIntent: undefined,
        nextDraft: {},
      };
    }

    const result = await finalizeOrderAsPaid({
      orderId: order.orderId,
      paymentId: order.paymentId || `razorpay_link_${order.orderId}`,
      by: user.email,
      note: "Razorpay payment link confirmed via WhatsApp",
      verifiedAt: new Date(),
    });

    return {
      done: true,
      reply: await buildWhatsAppPaymentConfirmationReply({
        orderId: customerFacingOrderId,
        invoiceWarning: result.invoiceWarning,
      }),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const merchantConfig = await getMerchantSeedhapeConfig(merchantId);
  const providerStatus = await getSeedhapeOrderStatusWithConfig(order.orderId, {
    apiKey: merchantConfig.apiKey,
    baseUrl: merchantConfig.baseUrl,
  });
  if (!isSeedhapePaidStatus(providerStatus.status)) {
    if (providerStatus.status === "EXPIRED" || providerStatus.status === "REJECTED") {
      return {
        done: true,
        reply: `Order ${customerFacingOrderId} is ${providerStatus.status}. Create a new order to continue.`,
        nextIntent: undefined,
        nextDraft: {},
      };
    }
    return {
      done: true,
      reply: `Payment is still ${providerStatus.status}. Please complete payment and retry in a few seconds.`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const result = await finalizeOrderAsPaid({
    orderId: order.orderId,
    paymentId: order.paymentId || `seedhape_${order.orderId}`,
    by: user.email,
    note: `SeedhaPe payment ${providerStatus.status.toLowerCase()} via WhatsApp`,
    verifiedAt: providerStatus.verifiedAt
      ? new Date(providerStatus.verifiedAt)
      : new Date(),
  });

  return {
    done: true,
    reply: await buildWhatsAppPaymentConfirmationReply({
      orderId: customerFacingOrderId,
      invoiceWarning: result.invoiceWarning,
    }),
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleUserOrderQuery(
  user: { email: string; name?: string | null; phone?: string | null },
  draft: Record<string, unknown>,
  merchantContext?: MerchantChatContext | null
) {
  const inputOrderId = String(draft.orderId || "").trim().toLowerCase();
  const activeOnly = Boolean(draft.activeOnly);
  const ordersResult = await queryCustomerOrders({
    customerEmail: user.email,
    customerPhone: user.phone,
    customerName: user.name,
    merchantId: merchantContext?.id || null,
    orderRef: inputOrderId || null,
    scope: activeOnly ? "active" : "history",
    page: 1,
    pageSize: inputOrderId ? 20 : 5,
  });
  const orders = ordersResult.items;

  const userOrders = orders.filter((order) => {
    if (!inputOrderId) return true;
    return String(getCustomerFacingOrderId(order) || "").toLowerCase().includes(inputOrderId);
  });

  if (!userOrders.length) {
    return {
      done: true,
      reply: inputOrderId
        ? `No orders found for order ID "${draft.orderId}".`
        : activeOnly
        ? "No paid or in-transit orders found for your account."
        : "No paid, shipped, or delivered orders found for your account yet.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (inputOrderId && userOrders.length) {
    const order = userOrders[0];
    return {
      done: true,
      reply: `Order details:\n${buildOrderDetailLines(order)}`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const merchantIds = Array.from(
    new Set(
      userOrders
        .map((order) => String(order.merchantId || "").trim())
        .filter((id) => id.length > 0)
    )
  );
  const merchants = merchantIds.length
    ? await prisma.merchant.findMany({
        where: { id: { in: merchantIds } },
        select: { id: true, name: true },
      })
    : [];
  const merchantNameById = new Map(merchants.map((m) => [m.id, m.name]));

  const lines = userOrders.slice(0, 5).map((order, idx) =>
    buildOrderDetailLines(order, {
      index: idx + 1,
      merchantName:
        merchantNameById.get(String(order.merchantId || "").trim()) ||
        String(order.merchantId || "").trim() ||
        null,
    })
  );

  return {
    done: true,
    reply: `${merchantContext?.name ? `Merchant: ${merchantContext.name}\n` : ""}${activeOnly ? "Your current fulfilled orders:\n\n" : "Your latest 5 orders:\n\n"}${lines.join("\n\n")}\n\nReply with: use order 1`,
    nextIntent: undefined,
    nextDraft: {
      __orderOptions: userOrders.slice(0, 5).map((order) => ({
        orderId: getCustomerFacingOrderId(order),
      })),
    },
  };
}

async function handleRegister(phone: string, draft: Record<string, unknown>) {
  const missing = missingRequired("merchant_register", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("merchant_register", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share the missing details."}${checklist}`,
      nextIntent: "merchant_register" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = MerchantRegistrationSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid registration details.";
    const checklist = buildIntentChecklist("merchant_register", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "merchant_register" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const slug = await ensureUniqueMerchantSlug(payload.businessName);
  const composedAddress = [
    payload.addressLine1,
    payload.addressLine2,
    `${payload.city}, ${payload.state} ${payload.zipCode}`,
  ]
    .filter(Boolean)
    .join(", ");

  const merchantRecord = await prisma.merchant.upsert({
    where: { email: payload.email.toLowerCase() },
    create: {
      slug,
      name: payload.businessName,
      phone,
      email: payload.email.toLowerCase(),
      address: composedAddress,
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2,
      city: payload.city,
      state: payload.state,
      zipCode: payload.zipCode,
      locationLink: payload.locationLink || "",
      status: "pending",
      chatbotWelcomeMessage:
        "Hi, welcome to our store. Tell me what you are looking for and I will help you quickly.",
    },
    update: {
      slug,
      name: payload.businessName,
      phone,
      address: composedAddress,
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2,
      city: payload.city,
      state: payload.state,
      zipCode: payload.zipCode,
      locationLink: payload.locationLink || "",
      status: "pending",
      approvedAt: null,
      approvedBy: null,
      updatedAt: new Date(),
    },
  });
  await ensureMerchantSeedhapeDefaults(merchantRecord.id);

  await prisma.userProfile.upsert({
    where: { email: payload.email.toLowerCase() },
    create: {
      email: payload.email.toLowerCase(),
      name: payload.businessName,
      phone,
      address: composedAddress,
      role: "merchant",
      credits: 0,
    },
    update: {
      name: payload.businessName,
      phone,
      address: composedAddress,
      role: "merchant",
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply:
      "Registration submitted successfully. Your merchant profile is now pending admin approval.",
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleMerchantBulkUploadHelp(merchant: {
  id: string;
  status: string;
  name?: string | null;
}) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Bulk CSV import will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const base = resolvePublicBaseUrl();
  const storefrontUrl = base
    ? `${base}/admin#bulk-product-upload`
    : "/admin#bulk-product-upload";
  const templateUrl = base
    ? `${base}/templates/merchant-products-bulk-upload-sample.csv`
    : "/templates/merchant-products-bulk-upload-sample.csv";

  return {
    done: true,
    reply: [
      `Bulk upload is available for ${merchant.name || "your store"}.`,
      "Steps:",
      "1) Download CSV template",
      templateUrl,
      "2) Fill product rows",
      "3) Open merchant dashboard bulk upload section",
      storefrontUrl,
      "4) Preview CSV, then import valid rows",
    ].join("\n"),
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleMerchantStorefrontUpdate(
  merchant: { id: string; status: string; slug?: string | null; name?: string | null },
  draft: Record<string, unknown>
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Storefront settings can be updated once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const mappedDraft = {
    storeName: String(draft.storeName || draft.businessName || "").trim() || undefined,
    logoUrl: String(draft.logoUrl || "").trim() || undefined,
    coverImageUrl: String(draft.coverImageUrl || "").trim() || undefined,
  };

  const parsed = StorefrontUpdateSchema.safeParse(mappedDraft);
  if (!parsed.success) {
    const issue =
      parsed.error.issues[0]?.message ||
      "Invalid storefront update details.";
    const checklist = buildIntentChecklist("merchant_storefront_update", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "merchant_storefront_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      ...(payload.storeName ? { name: payload.storeName } : {}),
      ...(payload.logoUrl ? { logoUrl: payload.logoUrl } : {}),
      ...(payload.coverImageUrl ? { coverImageUrl: payload.coverImageUrl } : {}),
      updatedAt: new Date(),
    },
    select: {
      name: true,
      slug: true,
      logoUrl: true,
      coverImageUrl: true,
    },
  });

  const base = resolvePublicBaseUrl();
  const storefrontUrl = base
    ? `${base}/storefronts/${updated.slug}`
    : `/storefronts/${updated.slug}`;

  const changed: string[] = [];
  if (payload.storeName) changed.push(`Store name: ${updated.name}`);
  if (payload.logoUrl) changed.push(`Logo URL updated`);
  if (payload.coverImageUrl) changed.push(`Cover image URL updated`);

  return {
    done: true,
    reply: [
      "Storefront updated successfully.",
      ...changed.map((line) => `- ${line}`),
      `Storefront: ${storefrontUrl}`,
    ].join("\n"),
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleProductUpload(
  merchant: { id: string; email: string; status: string },
  draft: Record<string, unknown>
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Product upload will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const missing = missingRequired("product_upload", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("product_upload", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share missing product details."}${checklist}`,
      nextIntent: "product_upload" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = ProductUploadSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid product details.";
    const checklist = buildIntentChecklist("product_upload", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "product_upload" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const product = await prisma.product.create({
    data: {
      merchantId: merchant.id,
      merchantEmail: merchant.email,
      name: payload.name,
      category: payload.category,
      price: payload.price,
      stockQuantity: payload.stockQuantity,
      isAvailable: payload.stockQuantity > 0,
      brand: payload.brand || "Unknown",
      description: payload.description || "",
      imageUrl: payload.imageUrl || "",
      tags: [],
      occasion: [],
      recipient: "Anyone",
      story: "",
      affiliateLink: "",
      embedding: Prisma.JsonNull,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  generateProductEmbedding(product.id).catch(() => {});

  return {
    done: true,
    reply: `Product created successfully: ${product.name} (₹${product.price || 0}, stock ${product.stockQuantity}).`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleStockQuery(
  merchant: { id: string; status: string },
  draft: Record<string, unknown>
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Stock query will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const productName = String(draft.productName || draft.name || "").trim();

  if (productName) {
    const products = await prisma.product.findMany({
      where: {
        merchantId: merchant.id,
        name: { contains: productName, mode: "insensitive" },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    if (!products.length) {
      return {
        done: true,
        reply: `No products found for "${productName}".`,
        nextIntent: undefined,
        nextDraft: {},
      };
    }
    const lines = products.map(
      (p, idx) =>
        `${idx + 1}) ${p.name}: stock ${p.stockQuantity}, ${p.isAvailable ? "available" : "unavailable"}`
    );
    return {
      done: true,
      reply: `Stock results:\n${lines.join("\n")}`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id },
    orderBy: [{ stockQuantity: "asc" }, { updatedAt: "desc" }],
    take: 10,
  });

  if (!products.length) {
    return {
      done: true,
      reply: "No products found in your catalog yet.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = products.map(
    (p, idx) =>
      `${idx + 1}) ${p.name}: stock ${p.stockQuantity}, ${p.isAvailable ? "available" : "unavailable"}`
  );
  return {
    done: true,
    reply: `Top stock snapshot:\n${lines.join("\n")}\n\nYou can ask: "stock for <product name>"`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleStockUpdate(
  merchant: { id: string; status: string },
  draft: Record<string, unknown>,
  options?: { skipConfirmation?: boolean }
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Stock updates will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const missing = missingRequired("stock_update", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("stock_update", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share missing stock details."}${checklist}`,
      nextIntent: "stock_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = StockUpdateSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid stock details.";
    const checklist = buildIntentChecklist("stock_update", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "stock_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const product = await prisma.product.findFirst({
    where: {
      merchantId: merchant.id,
      name: { contains: payload.productName, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!product) {
    return {
      done: true,
      reply: `No product found matching "${payload.productName}".`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (payload.stockQuantity === 0 && !options?.skipConfirmation) {
    return {
      done: false,
      reply: `You are about to set stock of ${product.name} to 0 (unavailable). Reply YES to confirm or NO to cancel.`,
      nextIntent: "stock_update" as WaIntent,
      nextDraft: draft,
      pendingConfirmation: {
        type: "stock_update_zero" as const,
        intent: "stock_update" as WaIntent,
        draft,
      },
    };
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      stockQuantity: payload.stockQuantity,
      isAvailable: payload.stockQuantity > 0,
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: `Stock updated: ${updated.name} now has ${updated.stockQuantity} units and is ${updated.isAvailable ? "available" : "unavailable"}.`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleProductQuery(
  merchant: { id: string; status: string },
  draft: Record<string, unknown>
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Product query will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const q = String(draft.productName || draft.name || "").trim();
  const products = await prisma.product.findMany({
    where: {
      merchantId: merchant.id,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (!products.length) {
    return {
      done: true,
      reply: q ? `No products found for "${q}".` : "No products found.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = products.map((p, idx) => {
    const description = String(p.description || "").trim();
    const shortDescription =
      description.length > 120 ? `${description.slice(0, 117)}...` : description;
    const productLink = buildPublicProductLink(p.id);
    return [
      `${idx + 1}) ${p.name}`,
      `Price: ₹${p.price || 0} | stock ${p.stockQuantity}`,
      `Description: ${shortDescription || "No description"}`,
      `Product link: ${productLink}`,
      p.imageUrl ? `Image: ${p.imageUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return {
    done: true,
    reply: `Product results:\n\n${lines.join("\n\n")}\n\nReply with: use product 1`,
    nextIntent: undefined,
    nextDraft: {
      __productOptions: products.map((p) => ({
        id: p.id,
        name: p.name,
      })),
    },
  };
}

async function handleProductUpdate(
  merchant: { id: string; status: string },
  draft: Record<string, unknown>,
  options?: { skipConfirmation?: boolean }
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Product update will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const productName = String(draft.productName || draft.name || "").trim();
  if (!productName) {
    const checklist = buildIntentChecklist("product_update", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS.productName}${checklist}`,
      nextIntent: "product_update" as WaIntent,
      nextDraft: draft,
    };
  }

  const product = await prisma.product.findFirst({
    where: {
      merchantId: merchant.id,
      name: { contains: productName, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!product) {
    return {
      done: true,
      reply: `No product found matching "${productName}".`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const nextPrice = safeNumber(draft.price);
  const nextStock = safeNumber(draft.stockQuantity);
  const nextCategory =
    typeof draft.category === "string" ? String(draft.category).trim() : "";
  const nextDescription =
    typeof draft.description === "string"
      ? String(draft.description).trim()
      : "";
  const nextBrand =
    typeof draft.brand === "string" ? String(draft.brand).trim() : "";
  const nextImageUrl =
    typeof draft.imageUrl === "string" ? String(draft.imageUrl).trim() : "";

  const hasAnyChange =
    nextPrice !== null ||
    nextStock !== null ||
    nextCategory.length > 0 ||
    nextDescription.length > 0 ||
    nextBrand.length > 0 ||
    nextImageUrl.length > 0;

  if (!hasAnyChange) {
    const checklist = buildIntentChecklist("product_update", draft);
    return {
      done: false,
      reply:
        `Please share what to update, for example: price 499, stock 12, category decor, or description.${checklist}`,
      nextIntent: "product_update" as WaIntent,
      nextDraft: draft,
    };
  }

  if (nextStock === 0 && !options?.skipConfirmation) {
    return {
      done: false,
      reply: `You are about to set stock of ${product.name} to 0 (unavailable). Reply YES to confirm or NO to cancel.`,
      nextIntent: "product_update" as WaIntent,
      nextDraft: draft,
      pendingConfirmation: {
        type: "stock_update_zero" as const,
        intent: "product_update" as WaIntent,
        draft,
      },
    };
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      ...(nextPrice !== null && { price: nextPrice }),
      ...(nextStock !== null && {
        stockQuantity: Math.max(0, Math.floor(nextStock)),
        isAvailable: nextStock > 0,
      }),
      ...(nextCategory && { category: nextCategory }),
      ...(nextDescription && { description: nextDescription }),
      ...(nextBrand && { brand: nextBrand }),
      ...(nextImageUrl && { imageUrl: nextImageUrl }),
      updatedAt: new Date(),
    },
  });

  if (
    nextPrice !== null ||
    nextCategory.length > 0 ||
    nextDescription.length > 0 ||
    nextBrand.length > 0 ||
    nextImageUrl.length > 0
  ) {
    generateProductEmbedding(updated.id).catch(() => {});
  }

  return {
    done: true,
    reply: `Updated ${updated.name}. Current price: ₹${updated.price || 0}, stock: ${updated.stockQuantity}.`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

function canMerchantManageOrder(
  merchantProductIds: Set<string>,
  merchantProductNames: Set<string>,
  orderProducts: unknown
) {
  const items = Array.isArray(orderProducts)
    ? (orderProducts as Array<{ productId?: string; name?: string }>)
    : [];
  return items.some((p) => {
    if (typeof p?.productId === "string" && merchantProductIds.has(p.productId)) {
      return true;
    }
    return typeof p?.name === "string" && merchantProductNames.has(p.name);
  });
}

async function getMerchantProductOwnershipSets(merchantId: string) {
  const merchantProducts = await prisma.product.findMany({
    where: { merchantId },
    select: { id: true, name: true },
  });
  const ids = new Set(merchantProducts.map((p) => p.id));
  const names = new Set(
    merchantProducts
      .map((p) => p.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
  );
  return { ids, names };
}

function isOrderOwnedByMerchant(
  order: { merchantId?: string | null; products?: unknown },
  merchantId: string,
  merchantProductIds: Set<string>,
  merchantProductNames: Set<string>
) {
  if (String(order.merchantId || "").trim() === merchantId) return true;
  return canMerchantManageOrder(
    merchantProductIds,
    merchantProductNames,
    order.products
  );
}

async function handleOrderQueryActive(merchant: { id: string; status: string }) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Order query will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const activeStatuses = ["created", "paid", "Processing", "Shipped"];
  const directOrders = await prisma.order.findMany({
    where: {
      merchantId: merchant.id,
      status: { in: activeStatuses },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  let filtered = directOrders;
  if (!filtered.length) {
    // Legacy fallback for older orders where merchantId may be null.
    const { ids, names } = await getMerchantProductOwnershipSets(merchant.id);
    const legacyOrders = await prisma.order.findMany({
      where: {
        merchantId: null,
        status: { in: activeStatuses },
      },
      orderBy: { createdAt: "desc" },
      take: 150,
    });
    filtered = legacyOrders
      .filter((o) => isOrderOwnedByMerchant(o, merchant.id, ids, names))
      .slice(0, 50);
  }

  if (!filtered.length) {
    return {
      done: true,
      reply: "No active orders found for your catalog right now.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const lines = filtered.slice(0, 5).map((o, idx) =>
    buildOrderDetailLines(o, {
      index: idx + 1,
      includeCustomer: true,
    })
  );
  return {
    done: true,
    reply: `Active orders:\n\n${lines.join("\n\n")}\n\nReply with: use order 1`,
    nextIntent: undefined,
    nextDraft: {
      __orderOptions: filtered.slice(0, 5).map((o) => ({
        orderId: getCustomerFacingOrderId(o),
      })),
    },
  };
}

async function handleOrderUpdateStatus(
  merchant: { id: string; status: string },
  draft: Record<string, unknown>,
  options?: { skipConfirmation?: boolean }
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Order updates will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const missing = missingRequired("order_update_status", draft);
  if (missing.length) {
    const checklist = buildIntentChecklist("order_update_status", draft);
    return {
      done: false,
      reply: `${FIELD_PROMPTS[missing[0]] || "Please share missing order details."}${checklist}`,
      nextIntent: "order_update_status" as WaIntent,
      nextDraft: draft,
    };
  }

  const parsed = OrderUpdateSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid order details.";
    const checklist = buildIntentChecklist("order_update_status", draft);
    return {
      done: false,
      reply: `I found an issue: ${issue}. Please share valid details.${checklist}`,
      nextIntent: "order_update_status" as WaIntent,
      nextDraft: draft,
    };
  }

  const payload = parsed.data;
  const order = await findOrderByCustomerReference({ reference: payload.orderId });
  if (!order) {
    return {
      done: true,
      reply: `Order not found: ${payload.orderId}`,
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const customerFacingOrderId = getCustomerFacingOrderId(order);

  const { ids, names } = await getMerchantProductOwnershipSets(merchant.id);
  if (!isOrderOwnedByMerchant(order, merchant.id, ids, names)) {
    return {
      done: true,
      reply: "You are not allowed to update this order.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (!options?.skipConfirmation) {
    return {
      done: false,
      reply: `You are about to update order ${customerFacingOrderId} to ${payload.status}. Reply YES to confirm or NO to cancel.`,
      nextIntent: "order_update_status" as WaIntent,
      nextDraft: draft,
      pendingConfirmation: {
        type: "order_status_update" as const,
        intent: "order_update_status" as WaIntent,
        draft,
      },
    };
  }

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as Array<Record<string, unknown>>)
    : [];
  const nextHistory = [
    ...history,
    {
      status: payload.status,
      by: "whatsapp_merchant",
      note: "Updated via WhatsApp",
      at: new Date().toISOString(),
    },
  ];

  await prisma.order.update({
    where: { orderId: order.orderId },
    data: {
      status: payload.status,
      ...(payload.status === "Shipped" && { shippedAt: new Date() }),
      ...(payload.status === "Delivered" && { deliveredAt: new Date() }),
      statusHistory: nextHistory as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return {
    done: true,
    reply: `Order ${customerFacingOrderId} updated to ${payload.status}.`,
    nextIntent: undefined,
    nextDraft: {},
  };
}

async function handleMerchantAnalyticsQuery(
  merchant: { id: string; email: string; status: string },
  draft: Record<string, unknown>,
  rawText: string
) {
  if (merchant.status !== "approved") {
    return {
      done: true,
      reply:
        "Your merchant account is pending approval. Business insights will be enabled once approved.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const summary = await getMerchantAnalyticsSummary({
    merchantId: merchant.id,
    merchantEmail: merchant.email,
  });
  const topic = detectMerchantAnalyticsTopic(
    String(draft.analyticsQuery || rawText || "").trim()
  );
  const now = new Date();
  const todayLabel = now.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const thisMonthLabel = now.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
  });
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLabel = lastMonthDate.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
  });

  if (topic === "sales_today") {
    return {
      done: true,
      reply: [
        `Sales today (${todayLabel})`,
        `Revenue: ${formatInr(summary.totals.salesToday)}`,
        `Paid orders: ${summary.totals.paidOrdersToday}`,
        `Yesterday: ${formatInr(summary.totals.salesYesterday)}`,
      ].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (topic === "sales_this_month") {
    return {
      done: true,
      reply: [
        `Sales this month (${thisMonthLabel})`,
        `Revenue: ${formatInr(summary.totals.salesThisMonth)}`,
        `Paid orders: ${summary.totals.paidOrdersThisMonth}`,
      ].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (topic === "sales_last_month" || topic === "sales_yesterday") {
    return {
      done: true,
      reply:
        topic === "sales_yesterday"
          ? [
              `Sales yesterday`,
              `Revenue: ${formatInr(summary.totals.salesYesterday)}`,
              `Today so far (${todayLabel}): ${formatInr(summary.totals.salesToday)}`,
            ].join("\n")
          : [
              `Sales last month (${lastMonthLabel})`,
              `Revenue: ${formatInr(summary.totals.salesLastMonth)}`,
              `This month so far (${thisMonthLabel}): ${formatInr(summary.totals.salesThisMonth)}`,
            ].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (topic === "best_sellers") {
    const lines = summary.topProducts.length
      ? summary.topProducts
          .slice(0, 5)
          .map(
            (item, index) =>
              `${index + 1}) ${item.name}: ${item.unitsSold} units, ${formatInr(item.revenue)}`
          )
      : ["No paid order data yet."];
    return {
      done: true,
      reply: [`Best selling items`, ...lines].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (topic === "restock") {
    const lines = summary.restockItems.length
      ? summary.restockItems
          .slice(0, 8)
          .map(
            (item, index) =>
              `${index + 1}) ${item.name}: stock ${item.stockQuantity}${item.isAvailable ? "" : " (unavailable)"}`
          )
      : ["No low-stock items right now."];
    return {
      done: true,
      reply: [`Items that need restocking`, ...lines].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  if (topic === "active_carts") {
    const lines = summary.activeCartUsers.length
      ? summary.activeCartUsers.slice(0, 8).map((user, index) => {
          const itemList = user.items.length ? ` - ${user.items.join(", ")}` : "";
          return `${index + 1}) ${user.name} (${user.email}): ${user.quantity} items${itemList}`;
        })
      : ["No active carts found for your catalog right now."];
    return {
      done: true,
      reply: [`Users with active carts`, ...lines].join("\n"),
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  return {
    done: true,
    reply: [
      `Business snapshot`,
      `Today (${todayLabel}): ${formatInr(summary.totals.salesToday)} from ${summary.totals.paidOrdersToday} paid orders`,
      `This month (${thisMonthLabel}): ${formatInr(summary.totals.salesThisMonth)}`,
      `Last month (${lastMonthLabel}): ${formatInr(summary.totals.salesLastMonth)}`,
      summary.topProducts[0]
        ? `Top item: ${summary.topProducts[0].name} (${summary.topProducts[0].unitsSold} units)`
        : `Top item: No paid orders yet`,
      summary.restockItems[0]
        ? `Needs restock: ${summary.restockItems[0].name} (stock ${summary.restockItems[0].stockQuantity})`
        : `Needs restock: Nothing urgent`,
      `Active carts: ${summary.activeCartUsers.length}`,
      "",
      `You can also ask: total sales today, total sales last month, best selling items, what needs restocking, users with active carts.`,
    ].join("\n"),
    nextIntent: undefined,
    nextDraft: {},
  };
}

export async function processMerchantWhatsAppMessage(input: {
  fromPhone: string;
  recipientPhone?: string;
  recipientPhoneNumberId?: string;
  text: string;
  messageId?: string;
  mediaId?: string;
  mediaCaption?: string;
}) {
  const phone = normalizePhone(input.fromPhone) || input.fromPhone;
  const { data: session, record: sessionRecord } = await getSession(phone);
  const sessionId = sessionRecord.id;
  const processedMessageIds = Array.isArray(session.processedMessageIds)
    ? session.processedMessageIds
    : [];

  if (input.messageId && processedMessageIds.includes(input.messageId)) {
    return session.lastPrompt || "Already processed.";
  }

  const merchant = await getMerchantByPhone(phone);
  const recipientMerchant = input.recipientPhone
    ? await getMerchantByPhone(input.recipientPhone)
    : null;
  const isMerchantInboxMode = Boolean(
    recipientMerchant && (!merchant || merchant.id !== recipientMerchant.id)
  );
  const userProfile = await getUserByPhone(phone);
  const roleFromProfiles = detectRoleFromProfiles({
    hasMerchant: Boolean(merchant),
    hasUser: Boolean(userProfile),
  });
  const effectiveRole: "merchant" | "user" | null =
    session.activeRole || roleFromProfiles;
  const inboundText = String(input.text || input.mediaCaption || "").trim();
  const inboundContextText =
    inboundText || (input.mediaId ? "Image uploaded for product workflow" : "");
  const explicitMerchantSlug = extractMerchantSlugFromText(inboundContextText);
  const activeOnlyHint =
    /\bmy active orders?\b/.test(inboundContextText.toLowerCase()) ||
    /\bactive orders?\b/.test(inboundContextText.toLowerCase());
  const roleSwitchRequest = detectRoleSwitch(inboundContextText);

  if (inboundContextText) {
    await appendConversationMessage(sessionId, "user", inboundContextText, {
      messageId: input.messageId,
      intent: session.activeIntent,
    });
  }

  if (shouldResetWhatsAppContext(inboundContextText)) {
    await prisma.whatsappChatMessage.deleteMany({
      where: { sessionId },
    });
    const reply =
      "Context cleared and session restarted.\nReply USER or MERCHANT to continue.";
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      activeRole: undefined,
      activeIntent: undefined,
      draft: {},
      activeMerchantId: undefined,
      activeMerchantSlug: undefined,
      activeMerchantName: undefined,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId ? [input.messageId] : [],
      pendingRoleSelection: true,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (shouldClearMerchantContext(inboundContextText)) {
    const reply = "Merchant context cleared. You can continue with global Rasphia discovery.";
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      activeMerchantId: undefined,
      activeMerchantSlug: undefined,
      activeMerchantName: undefined,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: false,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (!session.lastPrompt && shouldSendInitialGuide(inboundContextText)) {
    const reply = roleFromProfiles
      ? buildRoleSpecificQuickGuide(roleFromProfiles)
      : buildRoleConfirmationPrompt({
          hasMerchantProfile: Boolean(merchant),
          hasUserProfile: Boolean(userProfile),
        });
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      activeRole: roleFromProfiles || session.activeRole,
      activeIntent: undefined,
      draft: {},
      activeMerchantId: session.activeMerchantId,
      activeMerchantSlug: session.activeMerchantSlug,
      activeMerchantName: session.activeMerchantName,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: !roleFromProfiles,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (session.pendingConfirmation && inboundText) {
    if (isAffirmative(inboundText)) {
      let confirmationResult:
        | {
            done: boolean;
            reply: string;
            nextIntent: WaIntent | undefined;
            nextDraft: Record<string, unknown>;
          }
        | undefined;

      if (!merchant) {
        confirmationResult = {
          done: true,
          reply: "Merchant account not found. Please register first.",
          nextIntent: undefined,
          nextDraft: {},
        };
      } else if (session.pendingConfirmation.intent === "stock_update") {
        confirmationResult = await handleStockUpdate(
          merchant,
          session.pendingConfirmation.draft,
          { skipConfirmation: true }
        );
      } else if (session.pendingConfirmation.intent === "order_update_status") {
        confirmationResult = await handleOrderUpdateStatus(
          merchant,
          session.pendingConfirmation.draft,
          { skipConfirmation: true }
        );
      } else if (session.pendingConfirmation.intent === "product_update") {
        confirmationResult = await handleProductUpdate(
          merchant,
          session.pendingConfirmation.draft,
          { skipConfirmation: true }
        );
      }

      const finalResult = confirmationResult || {
        done: true,
        reply: "Nothing to confirm.",
        nextIntent: undefined,
        nextDraft: {},
      };
      const formattedReply = formatWhatsAppMarkdown(finalResult.reply);

      await saveSession(phone, {
        activeIntent: finalResult.nextIntent,
        draft: finalResult.nextDraft,
        activeMerchantId: session.activeMerchantId,
        activeMerchantSlug: session.activeMerchantSlug,
        activeMerchantName: session.activeMerchantName,
        lastPrompt: formattedReply,
        processedMessageIds: input.messageId
          ? [...processedMessageIds, input.messageId].slice(-50)
          : processedMessageIds,
        pendingConfirmation: null,
        pendingRoleSelection: false,
      });
      await appendConversationMessage(
        sessionId,
        "assistant",
        formattedReply,
        { intent: finalResult.nextIntent }
      );
      await pruneConversation(sessionId);
      return formattedReply;
    }

    if (isNegative(inboundText)) {
      const reply = "Update cancelled. No changes were made.";
      const formattedReply = formatWhatsAppMarkdown(reply);
      await saveSession(phone, {
        activeIntent: undefined,
        draft: {},
        activeMerchantId: session.activeMerchantId,
        activeMerchantSlug: session.activeMerchantSlug,
        activeMerchantName: session.activeMerchantName,
        lastPrompt: formattedReply,
        processedMessageIds: input.messageId
          ? [...processedMessageIds, input.messageId].slice(-50)
          : processedMessageIds,
        pendingConfirmation: null,
        pendingRoleSelection: false,
      });
      await appendConversationMessage(sessionId, "assistant", formattedReply);
      await pruneConversation(sessionId);
      return formattedReply;
    }

    const reply =
      "Please reply YES to confirm or NO to cancel the pending update.";
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply, {
      intent: session.activeIntent,
    });
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (session.pendingConfirmation && !inboundText) {
    const reply =
      "Please reply YES to confirm or NO to cancel the pending update.";
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply, {
      intent: session.activeIntent,
    });
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (session.pendingRoleSelection) {
    const chosenRole = detectRoleChoice(inboundText);
    if (!chosenRole) {
      const reply =
        "Please confirm your role by replying with one word: USER or MERCHANT.";
      const formattedReply = formatWhatsAppMarkdown(reply);
      await saveSession(phone, {
        ...session,
        lastPrompt: formattedReply,
        processedMessageIds: input.messageId
          ? [...processedMessageIds, input.messageId].slice(-50)
          : processedMessageIds,
        pendingRoleSelection: true,
      });
      await appendConversationMessage(sessionId, "assistant", formattedReply);
      await pruneConversation(sessionId);
      return formattedReply;
    }

    const nextIntent: WaIntent =
      chosenRole === "merchant"
        ? merchant
          ? "product_query"
          : "merchant_register"
        : userProfile
        ? "user_discover_products"
        : "user_register";
    const reply =
      chosenRole === "merchant"
        ? merchant
          ? "Great, I will continue in merchant mode. Tell me what product/stock/order action you want."
          : "Great, merchant mode selected. Please share businessName and email to start merchant registration."
        : userProfile
        ? "Great, I will continue in user mode. Tell me what you want to discover."
        : "Great, user mode selected. Please share userName and userEmail to register.";
    const formattedReply = formatWhatsAppMarkdown(reply);

    await saveSession(phone, {
      ...session,
      activeRole: chosenRole,
      activeIntent: nextIntent,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: false,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply, {
      intent: nextIntent,
    });
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (effectiveRole && roleSwitchRequest && roleSwitchRequest !== effectiveRole) {
    const nextIntent: WaIntent =
      roleSwitchRequest === "merchant"
        ? merchant
          ? "product_query"
          : "merchant_register"
        : userProfile
        ? "user_discover_products"
        : "user_register";
    const reply =
      roleSwitchRequest === "merchant"
        ? merchant
          ? "Switched to MERCHANT mode."
          : "Switched to MERCHANT mode. Please complete merchant registration with businessName and email."
        : userProfile
        ? "Switched to USER mode."
        : "Switched to USER mode. Please register with userName and userEmail.";
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      activeRole: roleSwitchRequest,
      activeIntent: nextIntent,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: false,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply, {
      intent: nextIntent,
    });
    await pruneConversation(sessionId);
    return formattedReply;
  }

  if (!effectiveRole) {
    const reply = buildRoleConfirmationPrompt({
      hasMerchantProfile: Boolean(merchant),
      hasUserProfile: Boolean(userProfile),
    });
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: true,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  let mediaUrl = "";
  if (input.mediaId) {
    try {
      mediaUrl = await uploadWhatsAppMediaToBlob(input.mediaId);
    } catch {
      mediaUrl = "";
    }
  }

  const history = await getConversationContext(sessionId);
  const historyForIntent =
    history.length &&
    history[history.length - 1]?.role === "user" &&
    history[history.length - 1]?.content === inboundContextText
      ? history.slice(0, -1)
      : history;
  const parsed = await inferIntent(
    inboundContextText,
    session.activeIntent,
    historyForIntent,
    effectiveRole
  );
  const merchantIntents = new Set<WaIntent>([
    "merchant_register",
    "merchant_storefront_update",
    "product_upload",
    "product_update",
    "product_query",
    "stock_update",
    "stock_query",
    "order_query_active",
    "order_update_status",
    "merchant_bulk_upload_help",
    "merchant_analytics_query",
  ]);
  const userIntents = new Set<WaIntent>([
    "user_register",
    "user_persona_update",
    "user_discover_products",
    "user_discover_merchants",
    "user_order_create",
    "user_order_query",
    "user_payment_confirm",
    "user_refund_request",
    "user_replacement_request",
    "user_cancellation_request",
    "user_wishlist_add",
    "user_wishlist_remove",
    "user_wishlist_view",
  ]);

  const lowerInbound = inboundContextText.toLowerCase();
  const asksMerchantRole =
    /\bmerchant\b/.test(lowerInbound) ||
    /\bstock\b/.test(lowerInbound) ||
    /\bbulk\b/.test(lowerInbound) ||
    /\bcsv\b/.test(lowerInbound) ||
    /\bstorefront\b/.test(lowerInbound) ||
    /\bstore name\b/.test(lowerInbound) ||
    /\blogo\b/.test(lowerInbound) ||
    /\bcover\b/.test(lowerInbound) ||
    /\bbanner\b/.test(lowerInbound) ||
    /\border\s+update\b/.test(lowerInbound) ||
    /\bactive orders\b/.test(lowerInbound) ||
    /\bupload\b/.test(lowerInbound) ||
    /\bsales\b/.test(lowerInbound) ||
    /\brevenue\b/.test(lowerInbound) ||
    /\bbest selling\b/.test(lowerInbound) ||
    /\brestock\b/.test(lowerInbound) ||
    /\bactive carts?\b/.test(lowerInbound);
  const asksUserRole =
    /\buser\b/.test(lowerInbound) ||
    /\bwishlist\b/.test(lowerInbound) ||
    /\bpersona\b/.test(lowerInbound) ||
    /\bdiscover\b/.test(lowerInbound) ||
    /\bbuy\b/.test(lowerInbound) ||
    /\bcreate order\b/.test(lowerInbound) ||
    /\bconfirm payment\b/.test(lowerInbound) ||
    /\brefund\b/.test(lowerInbound) ||
    /\breplacement\b/.test(lowerInbound) ||
    /\breplace\b/.test(lowerInbound) ||
    /\bmy active orders?\b/.test(lowerInbound) ||
    (/\bcancel\b/.test(lowerInbound) && /\border\b/.test(lowerInbound)) ||
    /\bmy order\b/.test(lowerInbound) ||
    /\btrack order\b/.test(lowerInbound);

  let intent: WaIntent =
    session.activeIntent && parsed.intent === "unknown"
      ? session.activeIntent
      : parsed.intent;

  if (
    effectiveRole === "merchant" &&
    intent === "user_order_query" &&
    (activeOnlyHint || /\bactive orders?\b/.test(lowerInbound) || /\border\b/.test(lowerInbound))
  ) {
    intent = "order_query_active";
  }

  let forceUserActiveOnly = false;
  let merchantInboxBlockedAction = false;
  if (isMerchantInboxMode && merchantIntents.has(intent) && intent !== "merchant_register") {
    if (intent === "order_query_active") {
      intent = "user_order_query";
      forceUserActiveOnly = true;
    } else if (intent === "order_update_status") {
      intent = "user_order_query";
    } else if (intent === "product_query" || intent === "stock_query") {
      intent = "user_discover_products";
    } else {
      merchantInboxBlockedAction = true;
      intent = "help";
    }
  }
  if (effectiveRole === "merchant" && userIntents.has(intent)) {
    intent = "help";
  }
  if (effectiveRole === "user" && merchantIntents.has(intent) && intent !== "merchant_register") {
    intent = "help";
  }
  if (!merchant && merchantIntents.has(intent) && intent !== "merchant_register") {
    intent = "merchant_register";
  }
  if (!userProfile && userIntents.has(intent) && intent !== "user_register") {
    intent = "user_register";
  }
  if (intent === "unknown") {
    if (isMerchantInboxMode) {
      intent = userProfile ? "user_discover_products" : "user_register";
    } else if (asksMerchantRole && !asksUserRole) {
      intent = merchant ? "product_query" : "merchant_register";
    } else if (asksUserRole || userProfile) {
      intent = userProfile ? "user_discover_products" : "user_register";
    }
  }

  const selectedProductIndex = parseIndexedSelection(inboundContextText, "product");
  const selectedOrderIndex = parseIndexedSelection(inboundContextText, "order");
  const sessionDraft = (session.draft || {}) as Record<string, unknown>;
  const productOptions = readDraftOptions<{ id?: string; name?: string }>(
    sessionDraft,
    "__productOptions"
  );
  const orderOptions = readDraftOptions<{ orderId?: string }>(
    sessionDraft,
    "__orderOptions"
  );
  const selectedProduct =
    selectedProductIndex && selectedProductIndex <= productOptions.length
      ? productOptions[selectedProductIndex - 1]
      : null;
  const selectedOrder =
    selectedOrderIndex && selectedOrderIndex <= orderOptions.length
      ? orderOptions[selectedOrderIndex - 1]
      : null;

  if ((intent === "unknown" || intent === "help") && selectedOrder) {
    intent =
      session.activeIntent ||
      (effectiveRole === "merchant" ? "order_update_status" : "user_order_query");
  }
  if ((intent === "unknown" || intent === "help") && selectedProduct) {
    intent =
      session.activeIntent ||
      (effectiveRole === "merchant" ? "product_query" : "user_order_create");
  }

  const draft = {
    ...(session.draft || {}),
    ...(parsed.fields || {}),
    ...(selectedProduct?.name ? { productName: selectedProduct.name } : {}),
    ...(selectedProduct?.id ? { productId: selectedProduct.id } : {}),
    ...(selectedOrder?.orderId ? { orderId: selectedOrder.orderId } : {}),
    ...(explicitMerchantSlug ? { merchantSlug: explicitMerchantSlug } : {}),
    ...(activeOnlyHint ? { activeOnly: true } : {}),
    ...(forceUserActiveOnly ? { activeOnly: true } : {}),
    ...(mediaUrl ? { imageUrl: mediaUrl } : {}),
  };
  const merchantContext = isMerchantInboxMode
    ? {
        id: recipientMerchant!.id,
        slug: recipientMerchant!.slug,
        name: recipientMerchant!.name,
        status: recipientMerchant!.status,
      }
    : await resolveMerchantContext({
        draft,
        session,
      });

  if (explicitMerchantSlug && !merchantContext) {
    const reply = `Merchant context "${explicitMerchantSlug}" not found. Share a valid merchant slug (example: shop acme-decor).`;
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  const merchantSwitchOnly = Boolean(
    explicitMerchantSlug &&
      /^(?:shop|store|merchant|switch)(?:\s+to)?\s*[a-z0-9_-]{3,60}$/i.test(
        inboundContextText.trim()
      )
  );
  if (!isMerchantInboxMode && merchantSwitchOnly && merchantContext) {
    const reply = `Merchant context set to ${merchantContext.name} (${merchantContext.slug}).\nYou can now discover products, place orders, track active orders, and request refund/replacement/cancellation for this merchant.`;
    const formattedReply = formatWhatsAppMarkdown(reply);
    await saveSession(phone, {
      ...session,
      activeMerchantId: merchantContext.id,
      activeMerchantSlug: merchantContext.slug,
      activeMerchantName: merchantContext.name,
      lastPrompt: formattedReply,
      processedMessageIds: input.messageId
        ? [...processedMessageIds, input.messageId].slice(-50)
        : processedMessageIds,
      pendingRoleSelection: false,
      pendingConfirmation: null,
    });
    await appendConversationMessage(sessionId, "assistant", formattedReply);
    await pruneConversation(sessionId);
    return formattedReply;
  }

  let result:
    | {
        done: boolean;
        reply: string;
        nextIntent: WaIntent | undefined;
        nextDraft: Record<string, unknown>;
        pendingConfirmation?: SessionData["pendingConfirmation"];
      }
    | undefined;

  if (intent === "help" || intent === "unknown") {
    result = {
      done: !mediaUrl,
      reply: merchantInboxBlockedAction
        ? "This is a merchant customer chat. Merchant stock/product management actions are not available here. You can discover products, place orders, track orders, and request refund/replacement/cancellation."
        : effectiveRole === "merchant" && asksUserRole
        ? "You are in MERCHANT mode. User actions are blocked here. Reply 'switch to user' if you want user flow."
        : effectiveRole === "user" && asksMerchantRole
        ? "You are in USER mode. Merchant actions are blocked here. Reply 'switch to merchant' if you want merchant flow."
        : mediaUrl
        ? `Image received and attached. ${merchant?.status === "approved" ? "Tell me product details like name/category/price/stock." : "Please continue with registration details."}`
        : effectiveRole
        ? buildRoleSpecificQuickGuide(effectiveRole)
        : buildRoleConfirmationPrompt({
            hasMerchantProfile: Boolean(merchant),
            hasUserProfile: Boolean(userProfile),
          }),
      nextIntent: mediaUrl
        ? merchant?.status === "approved"
          ? "product_upload"
          : merchant
          ? "merchant_register"
          : "user_register"
        : undefined,
      nextDraft: mediaUrl ? draft : {},
    };
  } else if (intent === "user_register") {
    result = await handleUserRegister(phone, draft);
  } else if (intent === "user_persona_update") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserPersonaUpdate({ email: userProfile.email }, draft);
    }
  } else if (intent === "user_discover_products") {
    result = await handleUserDiscoverProducts(draft, merchantContext);
  } else if (intent === "user_discover_merchants") {
    result = await handleUserDiscoverMerchants(draft);
  } else if (intent === "user_order_create") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserOrderCreate(
        {
          email: userProfile.email,
          name: userProfile.name,
          phone: userProfile.phone,
          address: userProfile.address,
        },
        draft,
        merchantContext
      );
    }
  } else if (intent === "user_order_query") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserOrderQuery(
        {
          email: userProfile.email,
          name: userProfile.name,
          phone: userProfile.phone,
        },
        draft,
        merchantContext
      );
    }
  } else if (intent === "user_payment_confirm") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserPaymentConfirm(
        { email: userProfile.email, name: userProfile.name },
        draft
      );
    }
  } else if (intent === "user_refund_request") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserServiceRequest(
        { email: userProfile.email },
        draft,
        "refund",
        merchantContext
      );
    }
  } else if (intent === "user_replacement_request") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserServiceRequest(
        { email: userProfile.email },
        draft,
        "replacement",
        merchantContext
      );
    }
  } else if (intent === "user_cancellation_request") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserServiceRequest(
        { email: userProfile.email },
        draft,
        "cancellation",
        merchantContext
      );
    }
  } else if (intent === "user_wishlist_add") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserWishlistAdd(
        { email: userProfile.email, wishlist: userProfile.wishlist || null },
        draft
      );
    }
  } else if (intent === "user_wishlist_remove") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserWishlistRemove(
        { email: userProfile.email, wishlist: userProfile.wishlist || null },
        draft
      );
    }
  } else if (intent === "user_wishlist_view") {
    if (!userProfile) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleUserWishlistView({
        wishlist: userProfile.wishlist || null,
      });
    }
  } else if (intent === "merchant_register") {
    result = await handleRegister(phone, draft);
  } else if (intent === "merchant_bulk_upload_help") {
    if (!merchant) {
      result = {
        done: false,
        reply:
          "Merchant profile not found for this number. Share businessName and email to register merchant.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleMerchantBulkUploadHelp(merchant);
    }
  } else if (intent === "merchant_analytics_query") {
    if (!merchant) {
      result = {
        done: false,
        reply:
          "Merchant profile not found for this number. Share businessName and email to register merchant.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleMerchantAnalyticsQuery(merchant, draft, inboundContextText);
    }
  } else if (intent === "merchant_storefront_update") {
    if (!merchant) {
      result = {
        done: false,
        reply:
          "Merchant profile not found for this number. Share businessName and email to register merchant.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleMerchantStorefrontUpdate(merchant, draft);
    }
  } else if (intent === "product_upload") {
    if (!merchant) {
      result = {
        done: false,
        reply: "Merchant profile not found for this number. Share businessName and email to register merchant.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
    result = await handleProductUpload(merchant, draft);
    }
  } else if (intent === "product_update") {
    if (!merchant) {
      result = {
        done: false,
        reply: "Merchant profile not found for this number. Share businessName and email to register merchant.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleProductUpdate(merchant, draft);
    }
  } else if (intent === "product_query") {
    if (!merchant) {
      result = await handleUserDiscoverProducts(draft);
    } else {
      result = await handleProductQuery(merchant, draft);
    }
  } else if (intent === "stock_update") {
    if (!merchant) {
      result = {
        done: false,
        reply: "Stock updates are merchant-only. Register merchant first with businessName and email.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleStockUpdate(merchant, draft);
    }
  } else if (intent === "stock_query") {
    if (!merchant) {
      result = await handleUserDiscoverProducts(draft);
    } else {
      result = await handleStockQuery(merchant, draft);
    }
  } else if (intent === "order_query_active") {
    if (effectiveRole === "merchant" && merchant && !isMerchantInboxMode) {
      result = await handleOrderQueryActive(merchant);
    } else if (userProfile) {
      result = await handleUserOrderQuery(
        {
          email: userProfile.email,
          name: userProfile.name,
          phone: userProfile.phone,
        },
        { ...draft, activeOnly: true },
        merchantContext
      );
    } else if (!merchant) {
      result = {
        done: false,
        reply: "Please register as user first. Share: userName and userEmail.",
        nextIntent: "user_register",
        nextDraft: draft,
      };
    } else {
      result = await handleOrderQueryActive(merchant);
    }
  } else if (intent === "order_update_status") {
    if (!merchant) {
      result = {
        done: false,
        reply: "Order status update is merchant-only. Register merchant first.",
        nextIntent: "merchant_register",
        nextDraft: draft,
      };
    } else {
      result = await handleOrderUpdateStatus(merchant, draft);
    }
  } else {
    result = {
      done: true,
      reply:
        "I could not map that request yet. Please try one of: register, upload product, query stock, update stock, query active orders, bulk upload help.",
      nextIntent: undefined,
      nextDraft: {},
    };
  }

  const formattedResultReply = formatWhatsAppMarkdown(result.reply);
  await saveSession(phone, {
    activeRole: effectiveRole,
    activeIntent: result.nextIntent,
    draft: result.nextDraft,
    activeMerchantId: merchantContext?.id || session.activeMerchantId,
    activeMerchantSlug: merchantContext?.slug || session.activeMerchantSlug,
    activeMerchantName: merchantContext?.name || session.activeMerchantName,
    lastPrompt: formattedResultReply,
    processedMessageIds: input.messageId
      ? [...processedMessageIds, input.messageId].slice(-50)
      : processedMessageIds,
    pendingConfirmation: result.pendingConfirmation || null,
    pendingRoleSelection: false,
  });
  await appendConversationMessage(sessionId, "assistant", formattedResultReply, {
    intent: result.nextIntent,
  });
  await pruneConversation(sessionId);

  return formattedResultReply;
}

export async function buildRoleAwareWhatsAppUsageTemplate(fromPhone: string) {
  const phone = normalizePhone(fromPhone) || fromPhone;
  const merchant = await getMerchantByPhone(phone);
  const userProfile = await getUserByPhone(phone);
  const session = await prisma.whatsappSession.findUnique({
    where: { phone },
    select: { data: true },
  });
  const sessionData =
    session?.data && typeof session.data === "object"
      ? (session.data as SessionData)
      : null;
  const role = sessionData?.activeRole;

  const merchantTemplate = buildRoleSpecificQuickGuide("merchant");
  const userTemplate = buildRoleSpecificQuickGuide("user");

  if (role === "merchant") return merchantTemplate;
  if (role === "user") return userTemplate;
  if (merchant && !userProfile) return merchantTemplate;
  if (userProfile && !merchant) return userTemplate;

  return [
    "*Rasphia Assistant*",
    "Please confirm your role first:",
    "Reply USER or MERCHANT",
    "",
    "Then I will show only the relevant quick commands.",
  ].join("\n");
}
