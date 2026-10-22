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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const match = supabaseUrl.match(/https:\/\/([a-z0-9_-]+)\.supabase\.co/);
const projectRef = match ? match[1] : "unknown";

console.log("================================================================================");
console.log("  LIFE DROP: STAGING MIGRATION 16 & SCHEMA VERIFICATION");
console.log("================================================================================");
console.log(`Target Supabase Project Ref: ${projectRef}`);
console.log(`Target Supabase URL: ${supabaseUrl}`);

async function rest(endpoint, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${endpoint}`, {
        ...options,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...options.headers,
        },
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
}

async function check() {
  // 1. Check points_config
  console.log("\n[1/4] Checking points_config table...");
  const configRes = await rest("points_config?select=*");
  if (!configRes.ok) {
    const text = await configRes.text();
    console.log(`  ❌ points_config query returned HTTP ${configRes.status}: ${text}`);
  } else {
    const configData = await configRes.json();
    console.log(`  ✓ points_config exists! (${configData.length} rows)`);
    for (const row of configData) {
      console.log(`    - ${row.key}: ${row.value} (${row.description})`);
    }
  }

  // 2. Check donor_points_transactions
  console.log("\n[2/4] Checking donor_points_transactions table...");
  const txRes = await rest("donor_points_transactions?select=count", {
    headers: { Prefer: "count=exact" },
  });
  if (!txRes.ok) {
    const text = await txRes.text();
    console.log(`  ❌ donor_points_transactions query returned HTTP ${txRes.status}: ${text}`);
  } else {
    const count = txRes.headers.get("content-range") || "0";
    console.log(`  ✓ donor_points_transactions exists! (Range / Count: ${count})`);
  }

  // 3. Check _schema_migrations
  console.log("\n[3/4] Checking _schema_migrations recorded versions...");
  const migRes = await rest("_schema_migrations?select=version&order=version.asc");
  if (!migRes.ok) {
    const text = await migRes.text();
    console.log(`  ℹ️ _schema_migrations query returned HTTP ${migRes.status}: ${text}`);
  } else {
    const migData = await migRes.json();
    console.log("  Recorded versions in _schema_migrations:");
    for (const m of migData) {
      console.log(`    ✓ ${m.version}`);
    }
  }

  // 4. Test Management API status safely
  console.log("\n[4/4] Checking Supabase Management API token status (safe check, secrets redacted)...");
  if (!accessToken) {
    console.log("  ℹ️ No SUPABASE_ACCESS_TOKEN provided in environment.");
  } else {
    const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "SELECT 1 as ping;" }),
    });
    console.log(`  Management API Response Status: ${mgmtRes.status} ${mgmtRes.statusText}`);
    if (!mgmtRes.ok) {
      const errText = await mgmtRes.text();
      console.log(`  Management API Message: ${errText.slice(0, 100)}`);
    } else {
      const json = await mgmtRes.json();
      console.log(`  Management API Success:`, json);
    }
  }
}

check().catch((err) => {
  console.error("Check failed:", err.message, err.cause || "");
  process.exit(1);
});
