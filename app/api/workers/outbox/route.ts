import { NextRequest, NextResponse } from "next/server";
import { processOutboxBatch } from "@/lib/outbox/worker";
import { getOutboxMetrics } from "@/lib/outbox/service";
import { verifyWorkerAuthorization, checkRateLimit } from "@/lib/security";

export async function POST(req: NextRequest) {
  // 1. Abuse-prevention rate limit check (max 120 calls per minute)
  const rateLimit = await checkRateLimit(req, { prefix: "worker:outbox", limit: 120, windowMs: 60000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED: Too many worker requests. Please retry later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds || 60) },
      }
    );
  }

  // 2. Timing-safe worker token verification
  const authResult = verifyWorkerAuthorization(req);
  if (!authResult.authorized) {
    return NextResponse.json(
      { success: false, error: authResult.error || "UNAUTHORIZED: Valid worker authorization token required." },
      { status: 401 }
    );
  }

  try {
    let body: { batchSize?: number; leaseSeconds?: number } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable, use defaults
    }

    const batchSize = typeof body.batchSize === "number" ? body.batchSize : 20;
    const leaseSeconds = typeof body.leaseSeconds === "number" ? body.leaseSeconds : 60;

    const result = await processOutboxBatch({ batchSize, leaseSeconds });
    const metrics = await getOutboxMetrics();

    return NextResponse.json({
      success: true,
      worker: "outbox-delivery",
      result,
      metrics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error executing outbox worker",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const rateLimit = await checkRateLimit(req, { prefix: "worker:outbox:get", limit: 120, windowMs: 60000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED: Too many worker requests. Please retry later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds || 60) } }
    );
  }

  const authResult = verifyWorkerAuthorization(req);
  if (!authResult.authorized) {
    return NextResponse.json(
      { success: false, error: authResult.error || "UNAUTHORIZED: Valid worker authorization token required." },
      { status: 401 }
    );
  }

  try {
    const isMetricsOnly = req.nextUrl.searchParams.get("metrics") === "true";
    if (isMetricsOnly) {
      const metrics = await getOutboxMetrics();
      return NextResponse.json({
        success: true,
        worker: "outbox-delivery-metrics",
        metrics,
      });
    }

    // Process batch (used by Vercel Cron triggers)
    const batchSize = Number(req.nextUrl.searchParams.get("batchSize")) || 20;
    const leaseSeconds = Number(req.nextUrl.searchParams.get("leaseSeconds")) || 60;

    const result = await processOutboxBatch({ batchSize, leaseSeconds });
    const metrics = await getOutboxMetrics();

    return NextResponse.json({
      success: true,
      worker: "outbox-delivery",
      result,
      metrics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error executing outbox worker",
      },
      { status: 500 }
    );
  }
}
