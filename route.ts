import { NextRequest, NextResponse } from "next/server";
import {
  buildRoleAwareWhatsAppUsageTemplate,
  processMerchantWhatsAppMessage,
} from "@/app/lib/whatsapp-orchestrator";
import {
  downloadWhatsAppMedia,
  sendImage,
  sendText,
} from "@/app/lib/whatsapp";
import {
  identifyTextLanguageWithSarvam,
  translateTextWithSarvam,
  transcribeAudioWithSarvam,
} from "@/app/lib/sarvam";

export const runtime = "nodejs";

function isLikelyLlmFailure(message: string) {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("429") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("gemini") ||
    m.includes("openai") ||
    m.includes("generatecontent") ||
    m.includes("model") ||
    m.includes("llm")
  );
}

type WhatsAppInbound = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        messages?: Array<{
          from?: string;
          id?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; caption?: string };
          audio?: { id?: string; voice?: boolean };
          interactive?: {
            button_reply?: { title?: string; id?: string };
            list_reply?: { title?: string; id?: string };
          };
        }>;
      };
    }>;
  }>;
};

function extractImageCardsFromReply(reply: string) {
  const lines = String(reply || "")
    .split("\n")
    .map((line) => line.trim());
  const cards: Array<{ imageUrl: string; caption: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const imageMatch = /^Image:\s*(https?:\/\/\S+)/i.exec(lines[i]);
    if (!imageMatch) continue;
    const imageUrl = imageMatch[1];
    const title = i > 0 ? lines[i - 1].replace(/^\d+\)\s*/, "").trim() : "";
    const descLine = lines.find((line, idx) => idx > i - 3 && idx < i && /^Description:/i.test(line));
    const linkLine = lines.find((line, idx) => idx > i - 4 && idx < i + 4 && /^Product link:/i.test(line));
    const caption = [title, descLine, linkLine].filter(Boolean).join("\n").slice(0, 900);
    cards.push({ imageUrl, caption });
    if (cards.length >= 3) break;
  }

  return cards;
}

function stripInlineImageLines(reply: string) {
  return String(reply || "")
    .split("\n")
    .filter((line) => !/^Image:\s*https?:\/\/\S+/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge || "", { status: 200 });
  }

  return NextResponse.json({ error: "Invalid webhook verification" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const debug =
      req.nextUrl.searchParams.get("debug") === "1" ||
      process.env.WHATSAPP_WEBHOOK_DEBUG === "1";
    const body = (await req.json()) as WhatsAppInbound;

    const messages =
      body.entry?.flatMap(
        (entry) =>
          entry.changes?.flatMap((c) => c.value?.messages || []) || []
      ) || [];

    let processed = 0;
    let skipped = 0;
    const diagnostics: Array<Record<string, string>> = [];

    for (const message of messages) {
      const parentChange = body.entry
        ?.flatMap((entry) => entry.changes || [])
        .find((c) => (c.value?.messages || []).some((m) => m.id === message.id));
      const recipientDisplayPhone = String(
        parentChange?.value?.metadata?.display_phone_number || ""
      ).trim();
      const recipientPhoneNumberId = String(
        parentChange?.value?.metadata?.phone_number_id || ""
      ).trim();

      const from = String(message.from || "").trim();
      if (!from) {
        skipped += 1;
        diagnostics.push({
          messageId: String(message.id || ""),
          reason: "missing_from",
        });
        continue;
      }

      const text = String(
        message.text?.body ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          ""
      ).trim();
      const mediaId =
        message.type === "image"
          ? String(message.image?.id || "").trim()
          : message.type === "audio"
          ? String(message.audio?.id || "").trim()
          : "";
      const mediaCaption =
        message.type === "image"
          ? String(message.image?.caption || "").trim()
          : "";
      const isAudioMessage = message.type === "audio";

      if (!text && !mediaId && !mediaCaption) {
        skipped += 1;
        diagnostics.push({
          messageId: String(message.id || ""),
          from,
          reason: "empty_payload",
          type: String(message.type || ""),
        });
        continue;
      }

      try {
        let inputText = text;
        let voiceTranscript: string | undefined;
        let queryLanguageCode: string | undefined;

        if (isAudioMessage && mediaId) {
          const { bytes, mimeType } = await downloadWhatsAppMedia(mediaId);
          const transcription = await transcribeAudioWithSarvam({
            audio: bytes,
            mimeType,
          });
          inputText = transcription.transcript;
          voiceTranscript = transcription.transcript;
          queryLanguageCode = transcription.languageCode;
        } else if (inputText) {
          try {
            const detectedLanguage = await identifyTextLanguageWithSarvam(inputText);
            queryLanguageCode = detectedLanguage.languageCode;
          } catch (languageError) {
            console.error("[/api/whatsapp] text language detection failed", {
              messageId: String(message.id || ""),
              from,
              reason:
                languageError instanceof Error
                  ? languageError.message
                  : "unknown_error",
            });
          }
        }

        const reply = await processMerchantWhatsAppMessage({
          fromPhone: from,
          recipientPhone: recipientDisplayPhone || undefined,
          recipientPhoneNumberId: recipientPhoneNumberId || undefined,
          text: inputText,
          messageId: message.id,
          mediaId: isAudioMessage ? undefined : mediaId || undefined,
          mediaCaption: mediaCaption || undefined,
        });

        const strippedReply = stripInlineImageLines(reply);
        let outboundTextReply = strippedReply;

        if (
          strippedReply &&
          queryLanguageCode &&
          queryLanguageCode !== "en-IN"
        ) {
          try {
            const translation = await translateTextWithSarvam({
              input: strippedReply,
              sourceLanguageCode: "en-IN",
              targetLanguageCode: queryLanguageCode,
            });
            outboundTextReply = translation.translatedText;
          } catch (translationError) {
            console.error("[/api/whatsapp] text translation failed", {
              messageId: String(message.id || ""),
              from,
              targetLanguageCode: queryLanguageCode,
              reason:
                translationError instanceof Error
                  ? translationError.message
                  : "unknown_error",
            });
          }
        }

        const cards = extractImageCardsFromReply(reply);
        for (const card of cards) {
          try {
            await sendImage(from, card.imageUrl, card.caption);
          } catch {
            // Non-blocking; continue with text reply.
          }
        }
        await sendText(from, outboundTextReply);
        processed += 1;
        diagnostics.push({
          messageId: String(message.id || ""),
          from,
          status: "processed",
          type: String(message.type || ""),
          ...(voiceTranscript ? { transcript: voiceTranscript } : {}),
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : "unknown_error";
        const likelyLlmFailure = isLikelyLlmFailure(reason);

        if (likelyLlmFailure) {
          try {
            const usageTemplate = await buildRoleAwareWhatsAppUsageTemplate(from);
            await sendText(from, usageTemplate);
            processed += 1;
            diagnostics.push({
              messageId: String(message.id || ""),
              from,
              status: "fallback_usage_sent",
              reason,
            });
            continue;
          } catch (fallbackErr: unknown) {
            diagnostics.push({
              messageId: String(message.id || ""),
              from,
              status: "fallback_send_failed",
              reason:
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : "fallback_send_failed",
            });
          }
        }

        diagnostics.push({
          messageId: String(message.id || ""),
          from,
          status: "error",
          reason,
        });
        // Do not fail the entire webhook for a single message failure.
        // Meta retries aggressively on non-2xx responses.
        console.error("[/api/whatsapp] message processing error", {
          messageId: String(message.id || ""),
          from,
          reason,
        });
        continue;
      }
    }

    if (debug) {
      return NextResponse.json(
        { ok: true, received: messages.length, processed, skipped, diagnostics },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "WhatsApp webhook failed";
    console.error("[/api/whatsapp] fatal webhook error", { message });
    // Return 200 so Meta does not keep retrying for transient/server-side failures.
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
