#!/usr/bin/env node

/**
 * LIFE DROP: STANDALONE WORKER RUNNER SCRIPT
 *
 * Can be triggered via system crontab, GitHub Actions, AWS EventBridge,
 * or docker-compose scheduler to invoke the authenticated worker endpoints.
 *
 * Usage:
 *   node scripts/run-workers.mjs [--url http://localhost:3000] [--outbox-only] [--reconcile-only]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env.staging"));
loadEnvFile(path.join(ROOT_DIR, ".env.local"));

const baseUrl = process.argv.find((arg) => arg.startsWith("--url="))?.split("=")[1] ||
  process.env.APP_URL ||
  "http://localhost:3000";

const cronSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET;
const outboxOnly = process.argv.includes("--outbox-only");
const reconcileOnly = process.argv.includes("--reconcile-only");

console.log("================================================================================");
console.log("  LIFE DROP: PLATFORM WORKER SCHEDULER EXECUTION");
console.log("================================================================================");
console.log(`Target URL: ${baseUrl}`);
console.log(`Secret Configured: ${cronSecret ? "YES (redacted)" : "NO"}`);

if (!cronSecret) {
  console.error("❌ CRON_SECRET or WORKER_SECRET must be configured in environment.");
  process.exit(1);
}

async function triggerOutbox() {
  console.log("\n[1/2] Invoking Outbox Delivery Worker (/api/workers/outbox)...");
  try {
    const res = await fetch(`${baseUrl}/api/workers/outbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ batchSize: 20 }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`  ❌ Failed (HTTP ${res.status}):`, data.error || data);
      return false;
    }
    console.log(`  ✓ Success: Claimed ${data.result?.claimedCount ?? 0}, Delivered ${data.result?.deliveredCount ?? 0}, Failures ${data.result?.failedCount ?? 0}`);
    return true;
  } catch (err) {
    console.error("  ❌ Connection error invoking outbox worker:", err.message);
    return false;
  }
}

async function triggerReconciliation() {
  console.log("\n[2/2] Invoking Platform Reconciliation Worker (/api/workers/reconciliation)...");
  try {
    const res = await fetch(`${baseUrl}/api/workers/reconciliation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        reconcileCommitments: true,
        reconcileRequests: true,
        reconcileLeases: true,
        reconcileCounters: true,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`  ❌ Failed (HTTP ${res.status}):`, data.error || data);
      return false;
    }
    console.log(`  ✓ Success: Expired commitments ${data.result?.expiredCommitments ?? 0}, Expired requests ${data.result?.expiredRequests ?? 0}, Reconciled counters ${data.result?.reconciledCounters ?? 0}`);
    return true;
  } catch (err) {
    console.error("  ❌ Connection error invoking reconciliation worker:", err.message);
    return false;
  }
}

async function main() {
  let ok = true;
  if (!reconcileOnly) {
    const outboxOk = await triggerOutbox();
    if (!outboxOk) ok = false;
  }
  if (!outboxOnly) {
    const reconOk = await triggerReconciliation();
    if (!reconOk) ok = false;
  }

  console.log("\n================================================================================");
  console.log(`  RESULT: ${ok ? "ALL WORKERS COMPLETED SUCCESSFULLY" : "WORKER EXECUTION REPORTED ERRORS"}`);
  console.log("================================================================================");

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
