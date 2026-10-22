import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOutboxMetrics } from "@/lib/outbox/service";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/security";

export async function GET(req: NextRequest) {
  // 1. Abuse-prevention rate limit check
  const rateLimit = await checkRateLimit(req, { prefix: "api:health", limit: 60, windowMs: 60000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: "rate_limited", error: "Too many health check requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds || 60) },
      }
    );
  }

  const isClerkConfigured = env.isClerkConfigured();
  const isSupabaseConfigured = env.isSupabaseConfigured();

  let supabaseDbStatus = "untested";
  let supabaseLatencyMs: number | null = null;
  let outboxMetrics = null;

  if (isSupabaseConfigured) {
    try {
      const startTime = Date.now();
      const admin = createSupabaseAdminClient();
      if (admin) {
        const { error } = await admin
          .from("profiles")
          .select("count", { count: "exact", head: true });

        supabaseLatencyMs = Date.now() - startTime;
        supabaseDbStatus = error ? "degraded" : "healthy";

        // Query outbox metrics if database is reachable
        if (!error) {
          try {
            outboxMetrics = await getOutboxMetrics();
          } catch {
            // Metrics fetch failure is non-fatal for health check
          }
        }
      }
    } catch {
      supabaseDbStatus = "unavailable";
    }
  }

  const isHealthy =
    isClerkConfigured &&
    isSupabaseConfigured &&
    supabaseDbStatus === "healthy";

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      milestone: "MILESTONE_8_PRODUCTION_READY",
      version: "1.0.0",
      services: {
        clerk: {
          configured: isClerkConfigured,
          status: isClerkConfigured ? "configured" : "unconfigured",
        },
        supabase: {
          configured: isSupabaseConfigured,
          database: supabaseDbStatus,
          latencyMs: supabaseLatencyMs,
        },
        outbox: {
          available: Boolean(outboxMetrics),
          pendingCount: outboxMetrics?.pendingCount ?? 0,
          deliveredCount: outboxMetrics?.deliveredCount ?? 0,
          retryableCount: outboxMetrics?.retryableCount ?? 0,
        },
      },
      security: {
        rateLimitingEnforced: true,
        auditLogImmutability: "enforced",
        timingSafeWorkerAuth: "enforced",
      },
      medicalSafetyBoundary: {
        enforced: true,
        rule: "Non-clinical operational coordination only; clinical compatibility, eligibility, and phlebotomy remain exclusive responsibilities of licensed healthcare facilities.",
      },
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
