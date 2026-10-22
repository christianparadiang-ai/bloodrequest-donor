import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security";

export interface SvixVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates Svix webhook signatures using timing-safe constant-time comparison.
 * Zero external dependency implementation using native Node.js crypto.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string
): SvixVerificationResult {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, error: "MISSING_HEADERS: Missing required svix headers." };
  }

  // Prevent replay attacks (tolerance: 5 minutes / 300 seconds)
  const timestampSec = parseInt(svixTimestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(timestampSec) || Math.abs(nowSec - timestampSec) > 300) {
    return { valid: false, error: "REPLAY_PROTECTION: Webhook timestamp expired or invalid." };
  }

  // Parse secret: Svix secrets are base64 encoded and usually start with "whsec_"
  let keyString = secret;
  if (keyString.startsWith("whsec_")) {
    keyString = keyString.slice(6);
  }

  let secretBuf: Buffer;
  try {
    secretBuf = Buffer.from(keyString, "base64");
  } catch {
    return { valid: false, error: "INVALID_SECRET: Could not decode webhook secret key." };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const computedHmac = crypto
    .createHmac("sha256", secretBuf)
    .update(signedContent, "utf-8")
    .digest("base64");

  // svix-signature may contain multiple space-separated signatures (e.g. "v1,signature1 v1,signature2")
  const signatures = svixSignature.split(" ");
  let matched = false;

  const computedBuf = Buffer.from(computedHmac, "utf-8");

  for (const sig of signatures) {
    const parts = sig.split(",");
    if (parts.length < 2) continue;
    const sigValue = parts[1];
    const sigBuf = Buffer.from(sigValue, "utf-8");

    if (sigBuf.length === computedBuf.length && crypto.timingSafeEqual(sigBuf, computedBuf)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return { valid: false, error: "INVALID_SIGNATURE: Cryptographic signature mismatch." };
  }

  return { valid: true };
}

export async function POST(req: NextRequest) {
  // 1. Rate limiting abuse guard
  const rateLimit = await checkRateLimit(req, {
    prefix: "webhook:clerk",
    limit: 120,
    windowMs: 60000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED: Webhook traffic exceeds threshold." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds || 60) } }
    );
  }

  // 2. Secret check
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured on the server.");
    return NextResponse.json(
      { error: "SERVER_MISCONFIGURATION: Webhook secret not set." },
      { status: 500 }
    );
  }

  // 3. Raw body extraction
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST: Unable to read request body." },
      { status: 400 }
    );
  }

  // 4. Cryptographic signature verification
  const verification = verifySvixSignature(rawBody, req.headers, webhookSecret);
  if (!verification.valid) {
    return NextResponse.json(
      { error: `UNAUTHORIZED: ${verification.error}` },
      { status: 401 }
    );
  }

  // 5. Parse JSON payload
  let payload: {
    type: string;
    data: {
      id?: string;
      email_addresses?: Array<{ email_address: string; id: string }>;
      first_name?: string;
      last_name?: string;
      public_metadata?: Record<string, unknown>;
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST: Malformed JSON payload." },
      { status: 400 }
    );
  }

  const { type, data } = payload;
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json(
      { error: "SERVER_ERROR: Database client unavailable." },
      { status: 500 }
    );
  }

  // 6. Check for duplicate/replayed webhook via public.processed_webhooks
  const svixId = req.headers.get("svix-id");
  if (svixId) {
    const { data: alreadyProcessed } = await admin
      .from("processed_webhooks")
      .select("id")
      .eq("id", svixId)
      .maybeSingle();

    if (alreadyProcessed) {
      return NextResponse.json(
        { received: true, note: "Duplicate webhook event already processed." },
        { status: 200 }
      );
    }
  }

  try {
    if (type === "user.created" || type === "user.updated") {
      const clerkUserId = data.id;
      if (!clerkUserId) {
        return NextResponse.json({ received: true, note: "No user id in event." });
      }

      const primaryEmail = data.email_addresses?.[0]?.email_address || "";
      const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ") || "User";
      const metadataRole = (data.public_metadata?.role as string) || "USER";

      // Upsert profile in public.profiles
      const { error: upsertErr } = await admin.from("profiles").upsert(
        {
          clerk_user_id: clerkUserId,
          email: primaryEmail || "unknown@lifedrop.internal",
          full_name: fullName,
          role: metadataRole,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id" }
      );

      if (upsertErr) {
        console.error("Failed to upsert profile from webhook:", upsertErr.message);
      }
    } else if (type === "user.deleted") {
      const clerkUserId = data.id;
      if (clerkUserId) {
        // Soft-anonymize or log deletion
        await admin
          .from("profiles")
          .update({
            email: `deleted_${clerkUserId}@anonymized.internal`,
            full_name: "Deactivated User",
            updated_at: new Date().toISOString(),
          })
      }
    }

    // Record processed webhook to prevent future replay attacks
    if (svixId) {
      await admin.from("processed_webhooks").insert({
        id: svixId,
        event_type: type,
        processed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ received: true, event: type });
  } catch (handlerErr) {
    console.error("Clerk webhook handler error:", handlerErr);
    return NextResponse.json(
      { error: "INTERNAL_ERROR: Failed to process webhook event." },
      { status: 500 }
    );
  }
}
