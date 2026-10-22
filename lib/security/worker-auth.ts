import crypto from "node:crypto";
import { NextRequest } from "next/server";

export interface WorkerAuthResult {
  authorized: boolean;
  error?: string;
}

/**
 * Validates worker invocation tokens using timing-safe constant-time comparison.
 * Strictly fails closed if no secret is configured in the environment.
 */
export function verifyWorkerAuthorization(req: NextRequest): WorkerAuthResult {
  const configuredSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET;

  // Fail-closed: Never allow access if server secret is not configured
  if (!configuredSecret || configuredSecret.trim().length === 0) {
    return {
      authorized: false,
      error: "SERVER_MISCONFIGURATION: Worker secret is not configured on the server.",
    };
  }

  const authHeader = req.headers.get("authorization");
  const workerSecretHeader = req.headers.get("x-worker-secret");

  let providedToken: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.slice(7).trim();
  } else if (workerSecretHeader) {
    providedToken = workerSecretHeader.trim();
  }

  if (!providedToken) {
    return {
      authorized: false,
      error: "UNAUTHORIZED: Missing authorization bearer token or x-worker-secret header.",
    };
  }

  // Constant-time buffer comparison to prevent timing attacks
  const expectedBuf = Buffer.from(configuredSecret, "utf-8");
  const providedBuf = Buffer.from(providedToken, "utf-8");

  if (expectedBuf.length !== providedBuf.length) {
    return {
      authorized: false,
      error: "UNAUTHORIZED: Invalid worker credentials.",
    };
  }

  const isValid = crypto.timingSafeEqual(expectedBuf, providedBuf);
  if (!isValid) {
    return {
      authorized: false,
      error: "UNAUTHORIZED: Invalid worker credentials.",
    };
  }

  return { authorized: true };
}
