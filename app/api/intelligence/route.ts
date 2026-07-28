import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/runtime";

const ALLOWED_SOURCES = new Set(["Sunbiz daily filings", "Website discovery", "Google Business lookup", "Contact validation"]);

type ActionPayload =
  | { action: "verify_source" }
  | { action: "claim" | "brief"; businessId: number }
  | { action: "retry_source"; source: string }
  | { action: "toggle_automation"; automationId: number };

function isPositiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }

function parsePayload(value: unknown): ActionPayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.action === "verify_source") return { action: "verify_source" };
  if ((row.action === "claim" || row.action === "brief") && isPositiveInteger(row.businessId)) return { action: row.action, businessId: row.businessId };
  if (row.action === "toggle_automation" && isPositiveInteger(row.automationId)) return { action: row.action, automationId: row.automationId };
  if (row.action === "retry_source" && typeof row.source === "string" && row.source.length <= 80 && ALLOWED_SOURCES.has(row.source)) return { action: row.action, source: row.source };
  return null;
}

function apiError(message: string, status: number) { return Response.json({ error: message }, { status }); }

async function currentActor() {
  const user = await getChatGPTUser();
  return user?.email.toLowerCase() ?? "apex-operator";
}

type BusinessRow = {
  score: number;
  industry: string;
  opportunity: string;
  stage: string;
  origin: string;
  website: string;
  phone: string;
  [key: string]: unknown;
};

function scoreBreakdown(row: BusinessRow) {
  const sourcePoints = row.origin === "official-sunbiz" ? 60 : 45;
  const stagePoints: Record<string, number> = {
    New: 20,
    Expanding: 16,
    Reinstated: 18,
    "Ownership change": 17,
  };
  const filingStagePoints = stagePoints[row.stage] ?? 15;
  const industryFitPoints = row.score - sourcePoints - filingStagePoints;
  const websiteEnriched = row.website !== "Not enriched" && !row.website.toLowerCase().startsWith("no ");
  const phoneEnriched = row.phone !== "Not enriched" && row.phone.trim().length > 0;

  return {
    total: row.score,
    model: "filing-source + business-stage + industry-opportunity-fit",
    components: [
      { key: "source", label: "Filing source", points: sourcePoints, evidence: row.origin === "official-sunbiz" ? "Official Florida Sunbiz filing" : "Non-official source" },
      { key: "stage", label: "Business stage", points: filingStagePoints, evidence: row.stage },
      { key: "fit", label: "Industry opportunity fit", points: industryFitPoints, evidence: `${row.industry} → ${row.opportunity}` },
    ],
    enrichment: {
      website: websiteEnriched ? "available" : "not enriched",
      phone: phoneEnriched ? "available" : "not enriched",
      note: "Enrichment status is visible evidence and currently adds no hidden score points.",
    },
  };
}

export async function GET() {
  try {
    const db = getD1();
    const businessSql = "SELECT id,filing_number,name,industry,city,county,score,opportunity,confidence,stage,website,owner,phone,signals_json,pipeline_status,origin,brief,created_at,updated_at FROM businesses ORDER BY score DESC,id DESC LIMIT 5000";
    const [businesses, runs, sources, automations, activity, summary] = await Promise.all([
      db.prepare(businessSql).all(),
      db.prepare("SELECT id,status,source,records_found,records_qualified,started_at,completed_at FROM ingestion_runs ORDER BY started_at DESC LIMIT 20").all(),
      db.prepare("SELECT id,name,status,success_rate,last_checked_at FROM source_health ORDER BY name LIMIT 20").all(),
      db.prepare("SELECT id,name,description,enabled,runs,last_run_at FROM automations ORDER BY id LIMIT 50").all(),
      db.prepare("SELECT id,type,message,created_at FROM activity ORDER BY created_at DESC LIMIT 30").all(),
      db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END) AS qualified,SUM(CASE WHEN pipeline_status='claimed' THEN 1 ELSE 0 END) AS claimed,COUNT(DISTINCT county) AS counties FROM businesses").first(),
    ]);
    const scoredBusinesses = businesses.results.map((business) => ({
      ...business,
      score_breakdown: scoreBreakdown(business as BusinessRow),
    }));
    return Response.json({ businesses: scoredBusinesses, runs: runs.results, sources: sources.results, automations: automations.results, activity: activity.results, summary, operator: true, accessMode: "self-use" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError("The intelligence database is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!request.headers.get("content-type")?.includes("application/json")) return apiError("JSON content is required.", 415);
  let payload: ActionPayload | null = null;
  try { payload = parsePayload(await request.json()); } catch { return apiError("Invalid JSON payload.", 400); }
  if (!payload) return apiError("Invalid action payload.", 400);
  try {
    const db = getD1();
    const now = Date.now();
    const recent = await db.prepare("SELECT COUNT(*) AS count FROM activity WHERE actor=? AND created_at>?").bind(actor, now - 60_000).first<{count:number}>();
    if ((recent?.count ?? 0) >= 30) return apiError("Too many actions. Wait one minute and try again.", 429);
    if (payload.action === "verify_source") {
      let status: "verified" | "blocked" = "blocked";
      try {
        const response = await fetch("https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/", { method: "HEAD" });
        if (response.ok) status = "verified";
      } catch { status = "blocked"; }
      const result = await db.prepare("INSERT INTO ingestion_runs (status,source,records_found,records_qualified,started_at,completed_at) VALUES (?,?,?,?,?,?)").bind(status,"Sunbiz source availability",0,0,now,now).run();
      await db.prepare("INSERT INTO activity (type,message,actor,created_at) VALUES ('source',?,?,?)").bind(`Official Sunbiz source ${status}; daily SFTP adapter is ${status === "verified" ? "reachable but not yet scheduled" : "blocked"}`,actor,now).run();
      return status === "verified"
        ? Response.json({ ok: true, runId: result.meta.last_row_id, message: "Official Sunbiz source verified; import adapter still requires scheduling." })
        : apiError("The official Sunbiz source check is blocked from the app runtime.", 503);
    }
    if (payload.action === "claim") {
      const update = await db.prepare("UPDATE businesses SET pipeline_status='claimed',updated_at=? WHERE id=? AND pipeline_status='unclaimed'").bind(now,payload.businessId).run();
      if (!update.meta.changes) return apiError("This opportunity is already claimed or no longer exists.", 409);
      await db.prepare("INSERT INTO activity (type,message,actor,created_at) SELECT 'pipeline','Claimed ' || name || ' for revenue follow-up',?,? FROM businesses WHERE id=?").bind(actor,now,payload.businessId).run();
      return Response.json({ ok: true, message: "Opportunity added to the persistent pipeline." });
    }
    if (payload.action === "brief") {
      const row = await db.prepare("SELECT name,industry,opportunity,signals_json FROM businesses WHERE id=?").bind(payload.businessId).first<Record<string, unknown>>();
      if (!row) return apiError("Business not found.", 404);
      let signals: string[] = [];
      try { const parsed = JSON.parse(String(row.signals_json)); if (Array.isArray(parsed)) signals = parsed.map(String).slice(0,6); } catch { signals = []; }
      const brief = `${row.name} is a ${String(row.industry).toLowerCase()} opportunity best matched to ${String(row.opportunity).toLowerCase()}. Priority drivers: ${signals.join("; ") || "new Florida filing"}. Recommended next step: verify the decision maker and open with a focused operational audit.`;
      await db.batch([db.prepare("UPDATE businesses SET brief=?,updated_at=? WHERE id=?").bind(brief,now,payload.businessId),db.prepare("INSERT INTO activity (type,message,actor,created_at) VALUES ('brief',?,?,?)").bind(`Generated sales brief for ${row.name}`,actor,now)]);
      return Response.json({ ok: true, brief, message: "Sales brief generated and saved." });
    }
    if (payload.action === "retry_source") {
      const source = await db.prepare("SELECT id,status FROM source_health WHERE name=?").bind(payload.source).first<{id:number;status:string}>();
      if (!source) return apiError("Source not found.", 404);
      if (payload.source !== "Sunbiz daily filings") return apiError(`${payload.source} is not configured with a live provider yet.`, 409);
      let healthy = false;
      try { healthy = (await fetch("https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/", { method: "HEAD" })).ok; } catch { healthy = false; }
      await db.batch([db.prepare("UPDATE source_health SET status=?,success_rate=?,last_checked_at=? WHERE id=?").bind(healthy?"healthy":"blocked",healthy?100:0,now,source.id),db.prepare("INSERT INTO activity (type,message,actor,created_at) VALUES ('source',?,?,?)").bind(`Sunbiz source health check ${healthy?"passed":"failed"}`,actor,now)]);
      return healthy ? Response.json({ ok:true,message:"Official Sunbiz source is reachable." }) : apiError("Official Sunbiz source is not reachable from the app runtime.", 503);
    }
    if (payload.action === "toggle_automation") {
      const update = await db.prepare("UPDATE automations SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END,last_run_at=? WHERE id=?").bind(now,payload.automationId).run();
      if (!update.meta.changes) return apiError("Automation not found.", 404);
      await db.prepare("INSERT INTO activity (type,message,actor,created_at) SELECT 'automation','Updated automation: ' || name,?,? FROM automations WHERE id=?").bind(actor,now,payload.automationId).run();
      return Response.json({ ok:true,message:"Automation state saved." });
    }
    return apiError("Unsupported action.", 400);
  } catch {
    return apiError("The action could not be completed.", 500);
  }
}
