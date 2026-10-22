import { NextRequest, NextResponse } from "next/server";
import { reconcilePlatformState } from "@/lib/outbox/reconciliation";
import { getOutboxMetrics } from "@/lib/outbox/service";
import { verifyWorkerAuthorization, checkRateLimit } from "@/lib/security";

export async function POST(req: NextRequest) {
  // 1. Abuse-prevention rate limit check (max 60 calls per minute)
  const rateLimit = await checkRateLimit(req, { prefix: "worker:reconciliation", limit: 60, windowMs: 60000 });
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
    let body: {
      reconcileCommitments?: boolean;
      reconcileRequests?: boolean;
      reconcileLeases?: boolean;
      reconcileCounters?: boolean;
    } = {};

    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable
    }

    const result = await reconcilePlatformState(body);
    const metrics = await getOutboxMetrics();

    return NextResponse.json({
      success: true,
      worker: "platform-reconciliation",
      result,
      metrics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error executing reconciliation",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // 1. Abuse-prevention rate limit check (max 60 calls per minute)
  const rateLimit = await checkRateLimit(req, { prefix: "worker:reconciliation:get", limit: 60, windowMs: 60000 });
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
    const isMetricsOnly = req.nextUrl.searchParams.get("metrics") === "true";
    if (isMetricsOnly) {
      const metrics = await getOutboxMetrics();
      return NextResponse.json({
        success: true,
        worker: "platform-reconciliation-metrics",
        metrics,
      });
    }

    const result = await reconcilePlatformState({
      reconcileCommitments: true,
      reconcileRequests: true,
      reconcileLeases: true,
      reconcileCounters: true,
    });
    const metrics = await getOutboxMetrics();

    return NextResponse.json({
      success: true,
      worker: "platform-reconciliation",
      result,
      metrics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error executing reconciliation",
      },
      { status: 500 }
    );
  }
}

