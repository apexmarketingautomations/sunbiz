import { createServer } from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = join(root, ".local", "sunbiz-tailscale.db");
const port = Number(process.env.PORT || 3002);
const sqlite = "/usr/bin/sqlite3";

function runSql(sql) {
  return spawnSync(sqlite, [dbPath], { input: sql, encoding: "utf8" });
}

function ensureDb() {
  mkdirSync(dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) return;
  for (const migration of ["drizzle/0000_yielding_mephistopheles.sql", "drizzle/0001_redundant_roland_deschain.sql", "drizzle/0002_data_quality_corrections.sql"]) {
    const sql = readFileSync(join(root, migration), "utf8").replaceAll("--> statement-breakpoint", "");
    const result = runSql(sql);
    if (result.status !== 0) throw new Error(result.stderr || `Failed migration ${migration}`);
  }
}

function jsonQuery(sql) {
  const output = execFileSync(sqlite, ["-json", dbPath, sql], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  return output.trim() ? JSON.parse(output) : [];
}

function execSql(sql) {
  const result = runSql(sql);
  if (result.status !== 0) throw new Error(result.stderr || "SQL command failed");
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function scoreBreakdown(row) {
  const sourcePoints = row.origin === "official-sunbiz" ? 60 : 45;
  const stagePoints = { New: 20, Expanding: 16, Reinstated: 18, "Ownership change": 17 };
  const filingStagePoints = stagePoints[row.stage] ?? 15;
  const industryFitPoints = row.score - sourcePoints - filingStagePoints;
  const websiteEnriched = row.website !== "Not enriched" && !String(row.website).toLowerCase().startsWith("no ");
  const phoneEnriched = row.phone !== "Not enriched" && String(row.phone).trim().length > 0;
  return {
    total: row.score,
    model: "filing-source + business-stage + industry-opportunity-fit",
    components: [
      { key: "source", label: "Filing source", points: sourcePoints, evidence: row.origin === "official-sunbiz" ? "Official Florida Sunbiz filing" : "Non-official source" },
      { key: "stage", label: "Business stage", points: filingStagePoints, evidence: row.stage },
      { key: "fit", label: "Industry opportunity fit", points: industryFitPoints, evidence: `${row.industry} -> ${row.opportunity}` },
    ],
    enrichment: {
      website: websiteEnriched ? "available" : "not enriched",
      phone: phoneEnriched ? "available" : "not enriched",
      note: "Enrichment status is visible evidence and currently adds no hidden score points.",
    },
  };
}

function intelligence() {
  const businesses = jsonQuery("SELECT id,filing_number,name,industry,city,county,score,opportunity,confidence,stage,website,owner,phone,signals_json,pipeline_status,origin,brief,created_at,updated_at FROM businesses ORDER BY score DESC,id DESC LIMIT 5000")
    .map((business) => ({ ...business, score_breakdown: scoreBreakdown(business) }));
  const sources = jsonQuery("SELECT id,name,status,success_rate,last_checked_at FROM source_health ORDER BY name LIMIT 20");
  const automations = jsonQuery("SELECT id,name,description,enabled,runs,last_run_at FROM automations ORDER BY id LIMIT 50");
  const activity = jsonQuery("SELECT id,type,message,created_at,actor FROM activity ORDER BY created_at DESC LIMIT 30");
  const summary = jsonQuery("SELECT COUNT(*) AS total,SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END) AS qualified,SUM(CASE WHEN pipeline_status='claimed' THEN 1 ELSE 0 END) AS claimed,COUNT(DISTINCT county) AS counties FROM businesses")[0];
  return { businesses, sources, automations, activity, summary, operator: true, accessMode: "tailscale-self-use" };
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>APEX Sunbiz Intelligence</title>
<style>
:root{color-scheme:dark;--bg:#071014;--panel:#101c22;--line:#25404a;--text:#eef8f6;--muted:#9db6b3;--green:#25d89a;--amber:#ffbf69}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;background:rgba(7,16,20,.94);border-bottom:1px solid var(--line);padding:18px 22px;display:flex;gap:16px;align-items:center;justify-content:space-between}
h1,h2,h3,p{margin:0}h1{font-size:22px}.sub{color:var(--muted)}main{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:16px;padding:16px}
.controls,.cards,.drawer,.table{background:var(--panel);border:1px solid var(--line);border-radius:8px}.controls{padding:12px;display:grid;grid-template-columns:1fr 160px 170px auto;gap:10px;align-items:end}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:1px;overflow:hidden}.card{padding:14px;background:#0c171c}.card span,.field span{display:block;color:var(--muted);font-size:12px}.card strong{font-size:22px}.card small{color:var(--muted)}input,select,button{border-radius:6px;border:1px solid var(--line);background:#0b151a;color:var(--text);padding:10px}button{cursor:pointer;background:#143027}button.primary{background:var(--green);border-color:var(--green);color:#032117;font-weight:800}
.table{margin-top:12px;overflow:auto;max-height:calc(100vh - 230px)}table{width:100%;border-collapse:collapse}th,td{padding:11px 12px;border-bottom:1px solid #1b3139;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#0d1b21;color:var(--muted);font-size:12px}tr{cursor:pointer}tr:hover{background:#11242a}.score{display:inline-flex;min-width:44px;height:32px;align-items:center;justify-content:center;border-radius:999px;background:#17382e;color:#7dffc9;font-weight:800}.stage{color:var(--amber)}
.status-pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800}.status-pill.ok{background:#14382d;color:#7dffc9}.status-pill.missing{background:#38261d;color:#ffbf69}.drawer{padding:16px;position:sticky;top:88px;max-height:calc(100vh - 110px);overflow:auto}.drawer h2{font-size:18px;margin:4px 0 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.field{padding:10px;background:#0b151a;border:1px solid #1d343c;border-radius:6px;overflow-wrap:anywhere}.ledger{margin:12px 0;border:1px solid #203842;border-radius:8px;overflow:hidden}.ledger div,.ledger footer{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid #203842}.ledger footer{border-bottom:0;background:#0b151a;font-weight:800}ul{padding-left:18px;color:var(--muted)}.note{color:var(--muted);font-size:12px}.empty{padding:22px;color:var(--muted)}@media(max-width:1150px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:950px){main{grid-template-columns:1fr}.controls{grid-template-columns:1fr}.drawer{position:static}.cards{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<header><div><h1>APEX Sunbiz Intelligence</h1><p class="sub">Private Tailscale self-use mode. Full lead fields and score factors are visible.</p></div><button class="primary" id="export">Export full CSV</button></header>
<main>
<section>
<div class="controls">
<label><span class="sub">Search</span><input id="q" placeholder="Business, filing, city, industry..." /></label>
<label><span class="sub">County</span><select id="county"><option>All counties</option></select></label>
<label><span class="sub">Minimum score <b id="scoreLabel">0</b></span><input id="minScore" type="range" min="0" max="100" value="0" /></label>
<button id="reset">Reset</button>
</div>
<div class="cards" id="cards"></div>
<div class="table"><table><thead><tr><th>Business</th><th>Filing #</th><th>Stage</th><th>Location</th><th>Opportunity</th><th>Website</th><th>Phone / number</th><th>Score</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty" hidden>No records match.</div></div>
</section>
<aside class="drawer" id="drawer"><p class="sub">Select a lead to inspect full source data and scoring.</p></aside>
</main>
<script>
let data={businesses:[],summary:{total:0,qualified:0,claimed:0,counties:0}}, selected=null;
const el=(id)=>document.getElementById(id);
const signals=(b)=>{try{return JSON.parse(b.signals_json)}catch{return[]}};
const esc=(v)=>String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
const hasWebsite=(b)=>b.website&&b.website!=="Not enriched"&&!String(b.website).toLowerCase().startsWith("no ");
const hasPhone=(b)=>b.phone&&b.phone!=="Not enriched"&&String(b.phone).trim().length>0;
const status=(ok,yes,no)=>'<span class="status-pill '+(ok?'ok':'missing')+'">'+(ok?yes:no)+'</span>';
async function load(){data=await fetch("/api/intelligence").then((r)=>r.json());fillCounties();render();}
function fillCounties(){const c=[...new Set(data.businesses.map((b)=>b.county))].sort();el("county").innerHTML="<option>All counties</option>"+c.map((x)=>'<option>'+esc(x)+'</option>').join("");}
function filtered(){const q=el("q").value.toLowerCase(), county=el("county").value, min=Number(el("minScore").value);return data.businesses.filter((b)=>(b.name+" "+b.filing_number+" "+b.industry+" "+b.city+" "+b.opportunity+" "+b.owner+" "+b.phone+" "+b.website).toLowerCase().includes(q)&&b.score>=min&&(county==="All counties"||b.county===county));}
function render(){const rows=filtered(), websites=rows.filter(hasWebsite).length, phones=rows.filter(hasPhone).length;el("scoreLabel").textContent=el("minScore").value;el("cards").innerHTML=[
["Records tracked",data.summary.total,"All loaded"],["Score 80+",data.summary.qualified,"Qualified"],["Visible matches",rows.length,"Current filter"],["Websites found",websites,(rows.length-websites)+" missing"],["Phone numbers",phones,(rows.length-phones)+" missing"],["Claimed",data.summary.claimed,"Pipeline"]
].map(([k,v,n])=>'<div class="card"><span>'+k+'</span><strong>'+Number(v||0).toLocaleString()+'</strong><small>'+esc(n)+'</small></div>').join("");
el("rows").innerHTML=rows.map((b)=>'<tr data-id="'+b.id+'"><td><strong>'+esc(b.name)+'</strong><br><span class="sub">'+esc(b.industry)+'</span></td><td><strong>'+esc(b.filing_number)+'</strong></td><td class="stage">'+esc(b.stage)+'</td><td>'+esc(b.city)+'<br><span class="sub">'+esc(b.county)+' County</span></td><td>'+esc(b.opportunity)+'<br><span class="sub">'+esc(signals(b)[0]||"No signal")+'</span></td><td>'+status(hasWebsite(b),'Has website','No website')+'<br><span class="sub">'+esc(b.website)+'</span></td><td>'+status(hasPhone(b),'Has number','No number')+'<br><span class="sub">'+esc(b.phone)+'</span></td><td><span class="score">'+b.score+'</span></td></tr>').join("");
el("empty").hidden=rows.length>0;document.querySelectorAll("tr[data-id]").forEach((row)=>row.onclick=()=>select(Number(row.dataset.id)));if(!selected&&rows[0])select(rows[0].id,false);}
function select(id,scroll=true){selected=data.businesses.find((b)=>b.id===id);if(!selected)return;const b=selected;el("drawer").innerHTML='<p class="sub">Complete business profile</p><h2>'+esc(b.name)+'</h2><p class="sub">'+esc(b.industry)+' · '+esc(b.city)+', Florida</p><div class="grid">'+[
["Priority score",b.score],["Model confidence",b.confidence+"%"],["Business stage",b.stage],["Pipeline",b.pipeline_status],["Decision maker",b.owner],["Phone",b.phone],["Website",b.website],["Origin",b.origin],["Filing",b.filing_number],["Updated",new Date(b.updated_at).toLocaleDateString()]
].map(([k,v])=>'<div class="field"><span>'+k+'</span><strong>'+esc(v)+'</strong></div>').join("")+'</div><h3>Score ledger</h3><div class="ledger">'+b.score_breakdown.components.map((p)=>'<div><span><strong>'+esc(p.label)+'</strong><br><small class="sub">'+esc(p.evidence)+'</small></span><b>'+(p.points>=0?"+":"")+p.points+'</b></div>').join("")+'<footer><span>Priority score</span><strong>'+b.score_breakdown.total+'</strong></footer></div><p class="note">'+esc(b.score_breakdown.enrichment.note)+'</p><h3>Detected opportunity</h3><div class="field"><span>Best next offer</span><strong>'+esc(b.opportunity)+'</strong></div><h3>Evidence used</h3><ul>'+signals(b).map((s)=>'<li>'+esc(s)+'</li>').join("")+'</ul>'+(b.brief?'<h3>Generated sales brief</h3><div class="field">'+esc(b.brief)+'</div>':'')+'<p><button onclick="brief('+b.id+')">Generate brief</button> <button class="primary" onclick="claim('+b.id+')" '+(b.pipeline_status==="claimed"?"disabled":"")+'>Claim opportunity</button></p>';if(scroll)el("drawer").scrollTop=0;}
async function claim(id){await fetch("/api/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});await load();select(id,false)}
async function brief(id){await fetch("/api/brief",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});await load();select(id,false)}
function csv(){const rows=filtered(), header=["Filing","Business","Industry","City","County","Score","Score model","Score breakdown","Opportunity","Stage","Owner","Phone","Website","Model confidence","Signals","Pipeline status","Origin","Sales brief","Created","Updated"];const lines=[header,...rows.map((b)=>[b.filing_number,b.name,b.industry,b.city,b.county,b.score,b.score_breakdown.model,b.score_breakdown.components.map((p)=>p.label+": "+p.points+" ("+p.evidence+")").join(" | "),b.opportunity,b.stage,b.owner,b.phone,b.website,b.confidence,signals(b).join(" | "),b.pipeline_status,b.origin,b.brief||"",new Date(b.created_at).toISOString(),new Date(b.updated_at).toISOString()])].map((r)=>r.map((v)=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines],{type:"text/csv"}));a.download="apex-business-intelligence.csv";a.click();}
["q","county","minScore"].forEach((id)=>el(id).addEventListener("input",render));el("reset").onclick=()=>{el("q").value="";el("county").value="All counties";el("minScore").value=0;render()};el("export").onclick=csv;load();
</script>
</body>
</html>`;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
  });
}

ensureDb();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, page(), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/intelligence") return send(res, 200, JSON.stringify(intelligence()));
    if (req.method === "POST" && url.pathname === "/api/claim") {
      const { id } = await readJson(req);
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, JSON.stringify({ error: "Invalid id" }));
      execSql(`UPDATE businesses SET pipeline_status='claimed',updated_at=${Date.now()} WHERE id=${id};`);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (req.method === "POST" && url.pathname === "/api/brief") {
      const { id } = await readJson(req);
      if (!Number.isInteger(id) || id <= 0) return send(res, 400, JSON.stringify({ error: "Invalid id" }));
      const row = jsonQuery(`SELECT name,industry,opportunity,signals_json FROM businesses WHERE id=${id} LIMIT 1`)[0];
      if (!row) return send(res, 404, JSON.stringify({ error: "Business not found" }));
      let signals = [];
      try { signals = JSON.parse(row.signals_json).slice(0, 6); } catch {}
      const brief = `${row.name} is a ${String(row.industry).toLowerCase()} opportunity best matched to ${String(row.opportunity).toLowerCase()}. Priority drivers: ${signals.join("; ") || "new Florida filing"}. Recommended next step: verify the decision maker and open with a focused operational audit.`;
      execSql(`UPDATE businesses SET brief='${sqlString(brief)}',updated_at=${Date.now()} WHERE id=${id};`);
      return send(res, 200, JSON.stringify({ ok: true, brief }));
    }
    return send(res, 404, JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error(error);
    return send(res, 500, JSON.stringify({ error: error instanceof Error ? error.message : "Server error" }));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`APEX Sunbiz Tailscale server listening on http://127.0.0.1:${port}`);
});
