require("dotenv").config();

const db = require("../config/db");

function startOfDayLocal(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateInput(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function computeTrialEnd(startDate, freeTrialDays) {
  const end = new Date(startDate);
  if (freeTrialDays === "5_minutes") {
    end.setMinutes(end.getMinutes() + 5);
    return end;
  }

  const days = parseInt(freeTrialDays, 10);
  if (!Number.isNaN(days) && days > 0) {
    end.setDate(end.getDate() + days);
  }
  return end;
}

function isoMinute(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString().slice(0, 16);
}

function parseCliStartDate() {
  const arg = process.argv.find((a) => a.startsWith("--start="));
  if (!arg) return null;
  return arg.split("=")[1] || null;
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(
    `SELECT column_name, is_nullable, column_default, is_identity
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return rows;
}

function getRequiredNoDefaultColumns(columns, exclude = new Set()) {
  return columns
    .filter((c) => c.is_nullable === "NO")
    .filter((c) => c.column_default === null)
    .filter((c) => c.is_identity !== "YES")
    .map((c) => c.column_name)
    .filter((name) => !exclude.has(name));
}

function uniqNickname() {
  return `t${Math.random().toString(36).slice(2, 11)}`.slice(0, 12);
}

function uniqEmail() {
  return `trialtest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const settingsRes = await client.query(
      "SELECT key, value FROM app_settings WHERE key IN ('free_trial_enabled', 'free_trial_days')"
    );
    const settings = Object.fromEntries(settingsRes.rows.map((r) => [r.key, r.value]));

    const freeTrialEnabled = settings.free_trial_enabled === "true";
    const freeTrialDays = settings.free_trial_days || null;

    if (!freeTrialEnabled || !freeTrialDays) {
      throw new Error(
        `Free trial is not enabled/configured. free_trial_enabled=${settings.free_trial_enabled || "null"}, free_trial_days=${freeTrialDays}`
      );
    }

    const today = startOfDayLocal(new Date());
    const maxDate = startOfDayLocal(new Date());
    maxDate.setMonth(maxDate.getMonth() + 3);

    const cliStart = parseCliStartDate();
    const chosenStart = cliStart ? parseDateInput(cliStart) : null;
    const trialStart = chosenStart || today;

    if (!trialStart) {
      throw new Error("Invalid --start=YYYY-MM-DD input.");
    }
    if (trialStart < today || trialStart > maxDate) {
      throw new Error(
        `Selected start date ${formatDateInput(trialStart)} is outside allowed range ${formatDateInput(today)} to ${formatDateInput(maxDate)}.`
      );
    }

    const trialEnd = computeTrialEnd(trialStart, freeTrialDays);

    const orgTemplateRes = await client.query("SELECT * FROM organizations ORDER BY organization_id DESC LIMIT 1");
    if (!orgTemplateRes.rows.length) {
      throw new Error("No organization row found to use as template for insert test.");
    }
    const orgTemplate = orgTemplateRes.rows[0];

    const orgCols = await getTableColumns(client, "organizations");
    const hasOrgTrialStart = orgCols.some((c) => c.column_name === "trial_start_at");
    const hasOrgTrialEnd = orgCols.some((c) => c.column_name === "trial_active_until");
    if (!hasOrgTrialStart || !hasOrgTrialEnd) {
      throw new Error(
        "Required columns are missing on organizations table. Ensure migration adding trial_start_at/trial_active_until has run."
      );
    }
    const orgRequired = getRequiredNoDefaultColumns(orgCols, new Set(["organization_id"]));

    const orgOverrides = {
      email: uniqEmail(),
      nickname: uniqNickname(),
      organization_name: `Trial Test Org ${Date.now()}`,
      trial_start_at: trialStart,
      trial_active_until: trialEnd,
    };

    const orgInsertCols = Array.from(new Set([...orgRequired, ...Object.keys(orgOverrides)]))
      .filter((c) => c !== "organization_id")
      .filter((c) => orgCols.some((x) => x.column_name === c));

    const orgValues = orgInsertCols.map((c) => (Object.prototype.hasOwnProperty.call(orgOverrides, c) ? orgOverrides[c] : orgTemplate[c]));
    const orgPlaceholders = orgInsertCols.map((_, i) => `$${i + 1}`).join(", ");

    const orgInsertSql = `INSERT INTO organizations (${orgInsertCols.map((c) => `"${c}"`).join(", ")}) VALUES (${orgPlaceholders}) RETURNING *`;
    const orgInsertRes = await client.query(orgInsertSql, orgValues);
    const insertedOrg = orgInsertRes.rows[0];

    const paymentTemplateRes = await client.query("SELECT * FROM payments ORDER BY id DESC LIMIT 1");
    if (!paymentTemplateRes.rows.length) {
      throw new Error("No payment row found to use as template for insert test.");
    }
    const payTemplate = paymentTemplateRes.rows[0];

    const payCols = await getTableColumns(client, "payments");
    const hasPayTrialStart = payCols.some((c) => c.column_name === "trial_starts_at");
    const hasPayTrialEnd = payCols.some((c) => c.column_name === "trial_ends_at");
    const hasPayNextEnd = payCols.some((c) => c.column_name === "next_payment_end_date");
    if (!hasPayTrialStart || !hasPayTrialEnd || !hasPayNextEnd) {
      throw new Error(
        "Required columns are missing on payments table. Ensure migration adding trial_starts_at/trial_ends_at/next_payment_end_date has run."
      );
    }
    const payRequired = getRequiredNoDefaultColumns(payCols, new Set(["id"]));

    const paymentReference = `trial_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payOverrides = {
      organization_id: insertedOrg.organization_id,
      is_trial: true,
      trial_starts_at: trialStart,
      trial_ends_at: trialEnd,
      next_payment_end_date: trialEnd,
      paystack_reference: paymentReference,
    };

    const payInsertCols = Array.from(new Set([...payRequired, ...Object.keys(payOverrides)]))
      .filter((c) => c !== "id")
      .filter((c) => payCols.some((x) => x.column_name === c));

    const payValues = payInsertCols.map((c) => (Object.prototype.hasOwnProperty.call(payOverrides, c) ? payOverrides[c] : payTemplate[c]));
    const payPlaceholders = payInsertCols.map((_, i) => `$${i + 1}`).join(", ");

    const payInsertSql = `INSERT INTO payments (${payInsertCols.map((c) => `"${c}"`).join(", ")}) VALUES (${payPlaceholders}) RETURNING *`;
    const payInsertRes = await client.query(payInsertSql, payValues);
    const insertedPayment = payInsertRes.rows[0];

    const checks = [
      {
        name: "organizations.trial_start_at saved",
        pass: isoMinute(insertedOrg.trial_start_at) === isoMinute(trialStart),
        expected: isoMinute(trialStart),
        actual: isoMinute(insertedOrg.trial_start_at),
      },
      {
        name: "organizations.trial_active_until saved",
        pass: isoMinute(insertedOrg.trial_active_until) === isoMinute(trialEnd),
        expected: isoMinute(trialEnd),
        actual: isoMinute(insertedOrg.trial_active_until),
      },
      {
        name: "payments.trial_starts_at saved",
        pass: isoMinute(insertedPayment.trial_starts_at) === isoMinute(trialStart),
        expected: isoMinute(trialStart),
        actual: isoMinute(insertedPayment.trial_starts_at),
      },
      {
        name: "payments.trial_ends_at saved",
        pass: isoMinute(insertedPayment.trial_ends_at) === isoMinute(trialEnd),
        expected: isoMinute(trialEnd),
        actual: isoMinute(insertedPayment.trial_ends_at),
      },
      {
        name: "payments.next_payment_end_date starts at trial end",
        pass: isoMinute(insertedPayment.next_payment_end_date) === isoMinute(trialEnd),
        expected: isoMinute(trialEnd),
        actual: isoMinute(insertedPayment.next_payment_end_date),
      },
    ];

    const failed = checks.filter((c) => !c.pass);

    console.log("\n=== Trial Start Date DB Integration Test ===");
    console.log(`free_trial_days: ${freeTrialDays}`);
    console.log(`selected_start: ${formatDateInput(trialStart)}`);
    console.log(`computed_end:  ${new Date(trialEnd).toISOString()}`);
    console.log(`inserted_org_id: ${insertedOrg.organization_id}`);
    console.log(`inserted_payment_id: ${insertedPayment.id}`);
    console.log("");

    for (const c of checks) {
      console.log(`${c.pass ? "PASS" : "FAIL"} - ${c.name}`);
      if (!c.pass) {
        console.log(`  expected: ${c.expected}`);
        console.log(`  actual:   ${c.actual}`);
      }
    }

    if (failed.length > 0) {
      throw new Error(`Trial test failed with ${failed.length} assertion(s).`);
    }

    console.log("\nResult: PASS. Trial start/end persistence and countdown anchor are correct.");
    await client.query("ROLLBACK");
    console.log("Transaction rolled back (no permanent DB data written).");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // ignore rollback errors in failure path
    }
    console.error("\nResult: FAIL");
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}

run();
