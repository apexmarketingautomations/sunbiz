import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("ships six distinct intelligence workspaces with honest capability labels", async () => {
  const page = await source("app/page.tsx");

  assert.match(
    page,
    /const nav = \["Command", "Businesses", "Opportunities", "Enrichment", "Territories", "Automations"\]/,
  );
  for (const view of [
    "CommandView",
    "BusinessesView",
    "OpportunitiesView",
    "EnrichmentView",
    "TerritoriesView",
    "AutomationsView",
  ]) {
    assert.match(page, new RegExp(`function ${view}\\(`));
  }

  assert.match(page, /action:"verify_source"/);
  assert.match(page, /Connected-source health/);
  assert.match(page, /Provider not configured/);
  assert.match(page, /Enabled · unscheduled/);
  assert.match(page, /Score ledger/);
  assert.match(page, /Export full intelligence CSV/);
  assert.doesNotMatch(page, /Sign in to claim|Sign in to generate|Sign in to operate/);
  assert.doesNotMatch(page, /action:"run_ingestion"/);
});

test("ships full self-use intelligence without upsell or sign-in redaction", async () => {
  const route = await source("app/api/intelligence/route.ts");

  assert.match(route, /owner,phone,signals_json,pipeline_status,origin,brief/);
  assert.match(route, /score_breakdown: scoreBreakdown/);
  assert.match(route, /accessMode: "self-use"/);
  assert.match(route, /LIMIT 5000/);
  assert.match(route, /\(recent\?\.count \?\? 0\) >= 30/);
  assert.match(route, /payload\.source !== "Sunbiz daily filings"/);
  assert.doesNotMatch(route, /Sign in required|Operator sign-in is required/);
});

test("includes deployed data-quality repairs and the D1 binding", async () => {
  const [migration, journal, hosting] = await Promise.all([
    source("drizzle/0002_data_quality_corrections.sql"),
    source("drizzle/meta/_journal.json"),
    source(".openai/hosting.json"),
  ]);

  assert.match(migration, /LOWER\(name\) LIKE '%lawncare%'/);
  assert.match(migration, /county = 'Pinellas'/);
  assert.match(migration, /'st\. petersburg'/);
  assert.match(journal, /0002_data_quality_corrections/);
  assert.match(hosting, /"d1"\s*:\s*"DB"/);
});
