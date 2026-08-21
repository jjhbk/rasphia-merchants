// app/lib/whatsapp.ts
import fetch from "node-fetch";
import { put } from "@vercel/blob";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;

async function parseErrorBody(res: { json: () => Promise<unknown>; text: () => Promise<string> }) {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    return JSON.stringify(data);
  } catch {
    return await res.text();
  }
}

export async function sendText(to: string, text: string) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new Error(`WhatsApp sendText failed (${res.status}): ${body}`);
  }
}

export async function sendImage(to: string, imageUrl: string, caption?: string) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        ...(caption ? { caption } : {}),
      },
    }),
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new Error(`WhatsApp sendImage failed (${res.status}): ${body}`);
  }
}

export async function sendAudio(
  to: string,
  audioUrl: string,
  options?: {
    voice?: boolean;
  }
) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: {
        link: audioUrl,
        ...(options?.voice ? { voice: true } : {}),
      },
    }),
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new Error(`WhatsApp sendAudio failed (${res.status}): ${body}`);
  }
}

// Send an interactive list of product options (max 10 per list)
export async function sendProductList(
  to: string,
  title: string,
  bodyText: string,
  products: { id: string; name: string; subtitle?: string }[]
) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const sections = [
    {
      title,
      rows: products.map((p) => ({
        id: p.id,
        title: p.name,
        description: p.subtitle || "",
      })),
    },
  ];
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: title },
        body: { text: bodyText },
        footer: { text: "Tap any item to pick it." },
        action: { button: "View options", sections },
      },
    }),
  });
}

// Send a message with a single button (useful to send payment link as button)
export async function sendButtonLink(
  to: string,
  textBody: string,
  buttonText: string,
  urlLink: string
) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: textBody },
        action: {
          buttons: [
            {
              type: "url",
              url: urlLink,
              title: buttonText,
            },
          ],
        },
      },
    }),
  });
}

function extFromMimeType(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("flac")) return "flac";
  return "bin";
}

export async function getWhatsAppMediaInfo(mediaId: string) {
  const url = `https://graph.facebook.com/v17.0/${mediaId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch WhatsApp media info: ${res.status}`);
  }
  const data = (await res.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!data.url) {
    throw new Error("WhatsApp media URL missing in response.");
  }
  return {
    downloadUrl: data.url,
    mimeType: data.mime_type || "application/octet-stream",
  };
}

export async function downloadWhatsAppMedia(mediaId: string) {
  const info = await getWhatsAppMediaInfo(mediaId);
  const res = await fetch(info.downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download WhatsApp media: ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  return {
    bytes: Buffer.from(arr),
    mimeType: info.mimeType,
  };
}

export async function uploadWhatsAppMediaToBlob(
  mediaId: string,
  prefix = "whatsapp-products"
) {
  const { bytes, mimeType } = await downloadWhatsAppMedia(mediaId);
  const ext = extFromMimeType(mimeType);
  const blob = await put(
    `${prefix}/${Date.now()}-${mediaId}.${ext}`,
    bytes,
    {
      access: "public",
      contentType: mimeType,
    }
  );
  return blob.url;
}

export async function uploadBufferToBlob(args: {
  pathname: string;
  bytes: Buffer;
  contentType: string;
}) {
  const blob = await put(args.pathname, args.bytes, {
    access: "public",
    contentType: args.contentType,
  });
  return blob.url;
}
