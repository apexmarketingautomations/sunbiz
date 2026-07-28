"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Business = {
  id: number; filing_number: string; name: string; industry: string; city: string; county: string;
  score: number; opportunity: string; confidence: number; stage: string; website: string; owner: string;
  phone: string; signals_json: string; pipeline_status: string; origin: string; brief: string | null; created_at: number; updated_at: number;
  score_breakdown: {
    total:number; model:string;
    components:{ key:string; label:string; points:number; evidence:string }[];
    enrichment:{ website:string; phone:string; note:string };
  };
};
type Run = { id:number; status:string; source:string; records_found:number; records_qualified:number; started_at:number; completed_at:number|null };
type Source = { id:number; name:string; status:string; success_rate:number; last_checked_at:number };
type Automation = { id:number; name:string; description:string; enabled:number; runs:number; last_run_at:number|null };
type Activity = { id:number; type:string; message:string; created_at:number };
type Summary = { total:number; qualified:number; claimed:number; counties:number };
type Data = { businesses:Business[]; runs:Run[]; sources:Source[]; automations:Automation[]; activity:Activity[]; summary:Summary; operator:boolean };
type ActionPayload = { action:string; businessId?:number; automationId?:number; source?:string };

const nav = ["Command", "Businesses", "Opportunities", "Enrichment", "Territories", "Automations"];

export default function Home() {
  const [activeNav, setActiveNav] = useState("Command");
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("All counties");
  const [minScore, setMinScore] = useState(80);
  const [selected, setSelected] = useState<Business | null>(null);
  const [data, setData] = useState<Data>({ businesses:[], runs:[], sources:[], automations:[], activity:[], summary:{total:0,qualified:0,claimed:0,counties:0}, operator:false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("Connecting to the intelligence database…");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [sessionTime, setSessionTime] = useState("");

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/intelligence", { cache:"no-store" });
      const payload = await response.json() as Data & { error?:string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load intelligence");
      setData(payload);
      setSelected((current) => current ? payload.businesses.find((item) => item.id === current.id) ?? null : null);
      setNotice("Persistent intelligence database connected");
    } catch (error) {
      setNotice(error instanceof Error ? `System error: ${error.message}` : "System error");
    } finally {
      setLoading(false);
      setSessionTime(new Date().toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}));
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadData]);

  async function performAction(payload:ActionPayload, key:string) {
    setBusy(key);
    try {
      const response = await fetch("/api/intelligence", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const result = await response.json() as { ok?:boolean; message?:string; error?:string; brief?:string };
      if (!response.ok) throw new Error(result.error ?? "Action failed");
      setNotice(result.message ?? "Action completed");
      await loadData();
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? `Action failed: ${error.message}` : "Action failed");
      return null;
    } finally { setBusy(null); }
  }

  const businessMatches = useMemo(() => data.businesses.filter((business) => {
    const haystack = `${business.name} ${business.filing_number} ${business.industry} ${business.city} ${business.opportunity}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (county === "All counties" || business.county === county);
  }), [data.businesses, query, county]);
  const filtered = useMemo(() => businessMatches.filter((business) => business.score >= minScore), [businessMatches, minScore]);

  const counties = useMemo(() => [...new Set(data.businesses.map((item) => item.county))].sort(), [data.businesses]);
  const territoryRows = useMemo(() => counties.map((name) => {
    const rows = data.businesses.filter((item) => item.county === name);
    return { name, businesses:rows.length, average:Math.round(rows.reduce((sum,item)=>sum+item.score,0)/rows.length), qualified:rows.filter((item)=>item.score>=80).length };
  }).sort((a,b)=>b.average-a.average), [counties, data.businesses]);
  const latestRun = data.runs[0];
  const claimedCount = data.summary.claimed;
  const configuredSources = data.sources.filter((item) => item.status !== "not_configured");
  const healthySources = configuredSources.filter((item) => item.status === "healthy").length;
  const unconfiguredSources = data.sources.length - configuredSources.length;
  const sourceIssues = configuredSources.length - healthySources;
  const health = configuredSources.length ? Math.round(configuredSources.reduce((sum,item)=>sum+item.success_rate,0)/configuredSources.length) : 0;

  function openWorkspace(name:string) { setActiveNav(name); setNotificationsOpen(false); setOperatorOpen(false); }
  function exportCsv(rowsToExport: Business[], filename: string) {
    const header = ["Filing","Business","Industry","City","County","Score","Score model","Score breakdown","Opportunity","Stage","Owner","Phone","Website","Model confidence","Signals","Pipeline status","Origin","Sales brief","Created","Updated"];
    const rows = rowsToExport.map((item) => [
      item.filing_number,item.name,item.industry,item.city,item.county,item.score,item.score_breakdown.model,
      item.score_breakdown.components.map((part)=>`${part.label}: ${part.points} (${part.evidence})`).join(" | "),
      item.opportunity,item.stage,item.owner,item.phone,item.website,item.confidence,parseSignals(item).join(" | "),
      item.pipeline_status,item.origin,item.brief ?? "",new Date(item.created_at).toISOString(),new Date(item.updated_at).toISOString(),
    ]);
    const csv = [header,...rows].map((row)=>row.map((value)=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type:"text/csv" }));
    const link = document.createElement("a"); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url);
    setNotice(`Exported ${rows.length} records`);
  }

  return <main className="app-shell">
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand"><span className="brand-mark" aria-hidden="true">A</span><span><strong>APEX</strong><small>Sunbiz Intelligence</small></span></div>
      <nav><p className="nav-label">Workspace</p>{nav.map((item,index)=><button key={item} data-testid={`nav-${item.toLowerCase()}`} className={`nav-item ${activeNav===item?"active":""}`} onClick={()=>openWorkspace(item)}><span className="nav-icon" aria-hidden="true">{["⌁","▤","◇","↻","◎","⚡"][index]}</span>{item}{item==="Opportunities"&&<span className="nav-count">{data.summary.qualified}</span>}</button>)}</nav>
      <div className="system-card"><div className="system-title"><span className={`pulse ${loading?"pulse-loading":""}`}/> Persistent systems</div><div className="system-row"><span>{configuredSources.length || "—"} connected · {unconfiguredSources} pending</span><strong>{loading?"Connecting":`${health}%`}</strong></div><div className="health-track"><span style={{width:`${health}%`}}/></div><small>{healthySources} healthy · {sourceIssues} issue{sourceIssues===1?"":"s"} · {unconfiguredSources} not configured</small></div>
      <div className="operator"><span className="avatar">AM</span><span><strong>Apex Operator</strong><small>Revenue command</small></span><button aria-label="Operator menu" aria-expanded={operatorOpen} onClick={()=>setOperatorOpen((value)=>!value)}>•••</button></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">Revenue intelligence / {activeNav}</p><h1>{activeNav==="Command"?"Opportunity Command Center":activeNav}</h1></div>
        <div className="top-actions">
          <label className="global-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search loaded records…" aria-label="Search loaded records"/><kbd>⌘ K</kbd></label>
          <button className="icon-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen((value)=>!value);setOperatorOpen(false)}}>●{data.activity.length>0&&<span className="notification-dot"/>}</button>
          <button data-testid="verify-source" className="primary-button" disabled={busy!==null} onClick={()=>void performAction({action:"verify_source"},"source-verification")}><span aria-hidden="true">↻</span> {busy==="source-verification"?"Checking…":"Verify source"}</button>
        </div>
        {notificationsOpen&&<div className="popover notifications-popover"><div className="popover-title"><strong>System activity</strong><button onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications">×</button></div>{data.activity.length===0?<p>No activity yet.</p>:data.activity.slice(0,6).map((item)=><div className="activity-item" key={item.id}><i/><span><strong>{item.message}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span></div>)}</div>}
        {operatorOpen&&<div className="popover operator-popover"><strong>Apex Operator</strong><span>Private self-use command mode</span><span>Database: {loading?"Checking…":"Connected"}</span><button onClick={()=>{setOperatorOpen(false);void loadData()}}>Refresh system state</button></div>}
      </header>
      <div className={`notice ${notice.startsWith("System error")||notice.startsWith("Action failed")?"notice-error":""}`}><span className="pulse"/>{notice}<span>{sessionTime}</span></div>

      {loading ? <LoadingState/> : <>
        {activeNav==="Command"&&<CommandView data={data} latestRun={latestRun} claimedCount={claimedCount} health={health} openWorkspace={openWorkspace} retry={(source)=>void performAction({action:"retry_source",source},`source-${source}`)} busy={busy} openLead={setSelected}/>}
        {activeNav==="Businesses"&&<BusinessesView rows={businessMatches} total={data.summary.total} counties={counties} county={county} setCounty={setCounty} exportCsv={()=>exportCsv(businessMatches,"apex-business-intelligence.csv")} openLead={setSelected}/>}
        {activeNav==="Opportunities"&&<OpportunitiesView rows={filtered} total={data.summary.total} counties={counties} county={county} setCounty={setCounty} minScore={minScore} setMinScore={setMinScore} reset={()=>{setQuery("");setCounty("All counties");setMinScore(80)}} exportCsv={()=>exportCsv(filtered,"apex-opportunities.csv")} openLead={setSelected}/>}
        {activeNav==="Enrichment"&&<EnrichmentView sources={data.sources} runs={data.runs} busy={busy} retry={(source)=>void performAction({action:"retry_source",source},`source-${source}`)}/>}
        {activeNav==="Territories"&&<TerritoriesView territories={territoryRows} businesses={data.businesses}/>}
        {activeNav==="Automations"&&<AutomationsView automations={data.automations} busy={busy} toggle={(id)=>void performAction({action:"toggle_automation",automationId:id},`automation-${id}`)}/>}
      </>}
    </section>

    {selected&&<LeadDrawer business={selected} busy={busy} close={()=>setSelected(null)} claim={()=>void performAction({action:"claim",businessId:selected.id},`claim-${selected.id}`)} generate={()=>void performAction({action:"brief",businessId:selected.id},`brief-${selected.id}`)}/>}
  </main>;
}

function LoadingState(){return <section className="loading-state" aria-live="polite"><span className="loading-spinner"/><strong>Loading persistent intelligence</strong><small>Connecting records, workflow state, and source health…</small></section>}

function MetricCards({summary,latestRun,claimedCount,health}:{summary:Summary;latestRun?:Run;claimedCount:number;health:number}){
  return <section className="kpi-grid" aria-label="Performance summary">
    <article className="kpi-card"><div><span>Records tracked</span><small>Persistent database</small></div><strong>{summary.total.toLocaleString()}</strong><p><em>{latestRun?"Official snapshot + durable state":"No source history yet"}</em></p><div className="spark bars"><i/><i/><i/><i/><i/><i/><i/></div></article>
    <article className="kpi-card"><div><span>Qualified opportunities</span><small>Score 80+</small></div><strong>{summary.qualified.toLocaleString()}</strong><p><em>{summary.total?Math.round(summary.qualified/summary.total*100):0}%</em> qualification rate</p><div className="spark line"><i/><i/><i/><i/><i/><i/></div></article>
    <article className="kpi-card"><div><span>Claimed pipeline</span><small>Durable state</small></div><strong>{claimedCount}</strong><p><em>{claimedCount?"Ready for follow-up":"No claimed leads"}</em></p><div className="spark bars alt"><i/><i/><i/><i/><i/><i/><i/></div></article>
    <article className="kpi-card"><div><span>Connected-source health</span><small>Configured checks only</small></div><strong>{health}%</strong><p><em>{health>=90?"Operational":"Attention needed"}</em></p><div className="health-donut" style={{background:`conic-gradient(var(--green) 0 ${health}%,#1c3346 ${health}%)`}}><span>{health}</span></div></article>
  </section>;
}

function CommandView({data,latestRun,claimedCount,health,openWorkspace,retry,busy,openLead}:{data:Data;latestRun?:Run;claimedCount:number;health:number;openWorkspace:(name:string)=>void;retry:(source:string)=>void;busy:string|null;openLead:(business:Business)=>void}){
  const retryable=data.sources.find((item)=>item.name==="Sunbiz daily filings"&&["degraded","blocked"].includes(item.status));
  const unconfigured=data.sources.filter((item)=>item.status==="not_configured").length;
  return <>
    <MetricCards summary={data.summary} latestRun={latestRun} claimedCount={claimedCount} health={health}/>
    <section className="intelligence-grid">
      <TerritoryMap businesses={data.businesses}/>
      <article className="panel queue-panel">
        <div className="panel-heading"><div><p className="eyebrow">Connected operations</p><h2>Source operations</h2></div><button className="text-button" onClick={()=>openWorkspace("Enrichment")}>View all →</button></div>
        <div className="queue-chart"><div className="queue-ring"><span><strong>{data.sources.length-unconfigured}</strong><small>connected</small></span></div><div className="queue-legend">{data.sources.map((source)=><span key={source.id}><i className={source.status==="healthy"?"green":source.status==="not_configured"?"neutral":"amber"}/><b>{source.name}</b><em>{source.status==="not_configured"?"Pending":`${source.success_rate}%`}</em></span>)}</div></div>
        <div className="throughput"><span><small>History records</small><strong>{data.runs.length}</strong></span><span><small>Businesses</small><strong>{data.summary.total.toLocaleString()}</strong></span><span><small>Activities</small><strong>{data.activity.length}</strong></span></div>
        {retryable?<div className="queue-footer"><span className="status-warning">{retryable.status}</span><p>{retryable.name} · source check requires attention</p><button disabled={busy===`source-${retryable.name}`} onClick={()=>retry(retryable.name)}>{busy===`source-${retryable.name}`?"Checking…":"Run health check"}</button></div>:<div className="queue-footer"><span className="stage new">Healthy</span><p>Connected source is operational · {unconfigured} provider{unconfigured===1?"":"s"} not configured</p><button onClick={()=>openWorkspace("Enrichment")}>Review providers</button></div>}
      </article>
    </section>
    <OpportunityTable title="Highest-value loaded opportunities" rows={data.businesses.slice(0,5)} openLead={openLead} footer={<button onClick={()=>openWorkspace("Opportunities")}>Open opportunity pipeline →</button>}/>
  </>;
}

function BusinessesView({rows,total,counties,county,setCounty,exportCsv,openLead}:{rows:Business[];total:number;counties:string[];county:string;setCounty:(value:string)=>void;exportCsv:()=>void;openLead:(business:Business)=>void}){
  const withWebsites=rows.filter((item)=>item.website!=="Not enriched"&&!item.website.toLowerCase().startsWith("no ")).length;
  return <section className="view-page"><div className="view-intro"><div><p className="eyebrow">Living profiles</p><h2>Business intelligence registry</h2><p>All loaded records with identity, contact evidence, opportunity signals, and transparent score components.</p></div><button className="primary-button" onClick={exportCsv}>Export full intelligence CSV</button></div><div className="summary-strip"><span><small>Registry total</small><strong>{total.toLocaleString()}</strong></span><span><small>Visible matches</small><strong>{rows.length}</strong></span><span><small>Enriched websites</small><strong>{withWebsites}</strong></span><label><small>County</small><select value={county} onChange={(event)=>setCounty(event.target.value)}><option>All counties</option>{counties.map((item)=><option key={item}>{item}</option>)}</select></label></div><OpportunityTable title="Highest-priority loaded businesses" rows={rows} openLead={openLead}/></section>;
}

function OpportunitiesView({rows,total,counties,county,setCounty,minScore,setMinScore,reset,exportCsv,openLead}:{rows:Business[];total:number;counties:string[];county:string;setCounty:(value:string)=>void;minScore:number;setMinScore:(value:number)=>void;reset:()=>void;exportCsv:()=>void;openLead:(business:Business)=>void}){
  return <section className="view-page"><div className="view-intro"><div><p className="eyebrow">Revenue priority</p><h2>Opportunity pipeline</h2><p>Filter, inspect, claim, and export the highest-priority loaded businesses.</p></div><button className="primary-button" onClick={exportCsv}>Export loaded matches</button></div><div className="filter-panel"><label>County<select value={county} onChange={(event)=>setCounty(event.target.value)}><option>All counties</option>{counties.map((item)=><option key={item}>{item}</option>)}</select></label><label>Minimum score <strong>{minScore}</strong><input aria-label="Minimum score" type="range" min="50" max="95" value={minScore} onChange={(event)=>setMinScore(Number(event.target.value))}/></label><button className="secondary-button" onClick={reset}>Reset filters</button><span>{rows.length} loaded matches · {total.toLocaleString()} database records</span></div><OpportunityTable title="Qualified loaded pipeline" rows={rows} openLead={openLead}/></section>;
}

function EnrichmentView({sources,runs,busy,retry}:{sources:Source[];runs:Run[];busy:string|null;retry:(source:string)=>void}){
  return <section className="view-page">
    <div className="view-intro"><div><p className="eyebrow">Data operations</p><h2>Source control plane</h2><p>Monitor the connected Sunbiz source and see exactly which enrichment providers still need configuration.</p></div></div>
    <div className="source-grid">{sources.map((source)=>{
      const configured=source.status!=="not_configured";
      const canCheck=source.name==="Sunbiz daily filings";
      return <article className="panel source-card" key={source.id}>
        <div><span className={`status-dot ${source.status}`}/><strong>{source.name}</strong><small>{source.status.replaceAll("_"," ")}</small></div>
        <div className="source-score"><strong>{configured?`${source.success_rate}%`:"—"}</strong><span><i style={{width:configured?`${source.success_rate}%`:"0%"}}/></span></div>
        <p>{configured?`Last checked ${new Date(source.last_checked_at).toLocaleString()}`:"Live provider adapter and credentials are not configured."}</p>
        {canCheck?<button className="secondary-button" disabled={busy===`source-${source.name}`} onClick={()=>retry(source.name)}>{busy===`source-${source.name}`?"Checking…":"Run health check"}</button>:<button className="secondary-button" disabled>Provider not configured</button>}
      </article>;
    })}</div>
    <article className="panel run-history"><div className="panel-heading"><div><p className="eyebrow">Audit log</p><h2>Source and import history</h2></div></div>{runs.length===0?<div className="empty-state"><strong>No source history recorded.</strong><span>Use Verify source to record the first availability check.</span></div>:<div className="run-list">{runs.map((run)=>{
      const availability=run.source.toLowerCase().includes("availability");
      return <div key={run.id}><span className={`stage ${run.status==="completed"||run.status==="verified"?"new":"reinstated"}`}>{run.status}</span><strong>{run.source}</strong><span>{availability?"Availability check only":`${run.records_found.toLocaleString()} imported · ${run.records_qualified.toLocaleString()} score 80+`}</span><time>{new Date(run.started_at).toLocaleString()}</time></div>;
    })}</div>}</article>
  </section>;
}

function TerritoriesView({territories,businesses}:{territories:{name:string;businesses:number;average:number;qualified:number}[];businesses:Business[]}){
  return <section className="view-page"><div className="view-intro"><div><p className="eyebrow">Geographic intelligence</p><h2>Loaded territory signals</h2><p>Compare county density and qualification strength across the top loaded opportunity records.</p></div></div><section className="territory-layout"><TerritoryMap businesses={businesses}/><article className="panel territory-list"><div className="panel-heading"><div><p className="eyebrow">Ranked loaded markets</p><h2>County signal strength</h2></div></div>{territories.map((row,index)=><div className="territory-row" key={row.name}><span>{index+1}</span><strong>{row.name}</strong><small>{row.businesses} loaded · {row.qualified} qualified</small><em>{row.average}</em></div>)}</article></section></section>;
}

function AutomationsView({automations,busy,toggle}:{automations:Automation[];busy:string|null;toggle:(id:number)=>void}){
  const enabled=automations.filter((item)=>item.enabled).length;
  return <section className="view-page"><div className="view-intro"><div><p className="eyebrow">Rule configuration</p><h2>Automation rules</h2><p>Save rule settings now; scheduled execution remains off until an automation worker is connected.</p></div><span className="connection-badge"><i/>{enabled} enabled · unscheduled</span></div><div className="automation-grid">{automations.map((item)=><article className="panel automation-card" key={item.id}><div className="automation-head"><span className="automation-icon">⚡</span><label className="switch"><input aria-label={`${item.enabled?"Disable":"Enable"} ${item.name}`} type="checkbox" checked={Boolean(item.enabled)} disabled={busy===`automation-${item.id}`} onChange={()=>toggle(item.id)}/><span/></label></div><h3>{item.name}</h3><p>{item.description}</p><footer><span>{item.runs} executed runs</span><strong>{item.enabled?"Enabled · unscheduled":"Disabled"}</strong></footer></article>)}</div></section>;
}

function TerritoryMap({businesses}:{businesses:Business[]}){
  const count=(city:string)=>businesses.filter((item)=>item.city===city).length;
  return <article className="panel territory-panel"><div className="panel-heading"><div><p className="eyebrow">Geographic intelligence</p><h2>Florida loaded opportunity signals</h2></div><div className="legend"><span><i className="hot"/> High</span><span><i className="warm"/> Growing</span><span><i/> Loaded</span></div></div><div className="map-area" role="img" aria-label="Florida opportunity map based on loaded records"><div className="grid-lines"/><div className="florida-shape"/><MapPoint className="tampa" city="Tampa" count={count("Tampa")}/><MapPoint className="orlando" city="Orlando" count={count("Orlando")}/><MapPoint className="jacksonville" city="Jacksonville" count={count("Jacksonville")}/><MapPoint className="miami" city="Miami" count={count("Miami")}/><MapPoint className="sarasota" city="Sarasota" count={count("Sarasota")}/><div className="map-summary"><strong>{businesses.length}</strong><span>loaded profiles</span><small>Across {new Set(businesses.map((item)=>item.county)).size} counties in this result set</small></div></div></article>;
}
function MapPoint({className,city,count}:{className:string;city:string;count:number}){return <div className={`map-point ${className}`}><i/><span><strong>{city}</strong><small>{count} tracked</small></span></div>}

function OpportunityTable({title,rows,openLead,footer}:{title:string;rows:Business[];openLead:(business:Business)=>void;footer?:React.ReactNode}){
  return <section className="panel opportunities-panel"><div className="panel-heading"><div><p className="eyebrow">Intelligence records</p><h2>{title}</h2></div></div><div className="table-wrap"><table><thead><tr><th>Business</th><th>Stage</th><th>Location</th><th>Best opportunity</th><th>Pipeline</th><th>Priority</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((business)=><tr key={business.id} onClick={()=>openLead(business)}><td><div className="company-cell"><span>{business.name.slice(0,2).toUpperCase()}</span><div><strong>{business.name}</strong><small>{business.industry} · {business.filing_number}</small></div></div></td><td><span className={`stage ${business.stage.toLowerCase().replaceAll(" ","-")}`}>{business.stage}</span></td><td><strong>{business.city}</strong><small>{business.county} County</small></td><td><strong>{business.opportunity}</strong><small>{parseSignals(business)[0]}</small></td><td><span className={`stage ${business.pipeline_status==="claimed"?"new":""}`}>{business.pipeline_status}</span></td><td><div className={`score score-${business.score>=90?"high":"medium"}`}>{business.score}</div></td><td><button className="row-action" onClick={(event)=>{event.stopPropagation();openLead(business)}} aria-label={`Open ${business.name}`}>→</button></td></tr>)}</tbody></table>{rows.length===0&&<div className="empty-state"><strong>No records match the current filters.</strong><span>Reset filters or search for another business.</span></div>}</div>{footer&&<footer className="table-footer"><span>Showing {rows.length} records</span>{footer}</footer>}</section>;
}

function LeadDrawer({business,busy,close,claim,generate}:{business:Business;busy:string|null;close:()=>void;claim:()=>void;generate:()=>void}){
  return <div className="drawer-backdrop" onMouseDown={close}>
    <aside className="lead-drawer" aria-label={`${business.name} intelligence profile`} onMouseDown={(event)=>event.stopPropagation()}>
      <div className="drawer-top"><span className={`stage ${business.pipeline_status==="claimed"?"new":""}`}>{business.pipeline_status==="claimed"?"In pipeline":"Revenue-ready"}</span><button onClick={close} aria-label="Close profile">×</button></div>
      <p className="eyebrow">Complete business profile</p>
      <h2>{business.name}</h2>
      <p className="drawer-subtitle">{business.industry} · {business.city}, Florida</p>
      <div className="drawer-score"><div className="score score-high">{business.score}</div><span><strong>Priority score</strong><small>{business.confidence}% model confidence · contact fields shown separately · no hidden factors</small></span></div>
      <div className="profile-grid">
        <span><small>Business stage</small><strong>{business.stage}</strong></span>
        <span><small>Pipeline status</small><strong>{business.pipeline_status}</strong></span>
        <span><small>Decision maker</small><strong>{business.owner}</strong></span>
        <span><small>Phone</small><strong>{business.phone}</strong></span>
        <span><small>Source</small><strong>{business.origin==="official-sunbiz"?"Official Sunbiz":"Sample"}</strong></span>
        <span><small>Last updated</small><strong>{new Date(business.updated_at).toLocaleDateString()}</strong></span>
      </div>
      <section className="drawer-section">
        <h3>Score ledger</h3>
        <div className="score-ledger">{business.score_breakdown.components.map((part)=><div key={part.key}><span><strong>{part.label}</strong><small>{part.evidence}</small></span><em>{part.points >= 0 ? "+" : ""}{part.points}</em></div>)}<footer><span>Priority score</span><strong>{business.score_breakdown.total}</strong></footer></div>
        <p className="score-note">{business.score_breakdown.enrichment.note}</p>
      </section>
      <section className="drawer-section"><h3>Detected opportunity</h3><div className="opportunity-callout"><span>Best next offer</span><strong>{business.opportunity}</strong><small>Based on the filing, stage, industry classification, and loaded evidence.</small></div></section>
      <section className="drawer-section"><h3>Evidence used</h3><ul>{parseSignals(business).map((signal)=><li key={signal}><span>✓</span>{signal}</li>)}</ul></section>
      {business.brief&&<section className="drawer-section"><h3>Generated sales brief</h3><div className="brief-box">{business.brief}</div></section>}
      <section className="drawer-section"><h3>Contact and source data</h3><div className="presence-row"><span>Website</span><strong>{business.website}</strong></div><div className="presence-row"><span>Phone</span><strong>{business.phone}</strong></div><div className="presence-row"><span>Owner / registered party</span><strong>{business.owner}</strong></div><div className="presence-row"><span>Filing</span><strong>{business.filing_number}</strong></div><div className="presence-row"><span>Origin</span><strong>{business.origin}</strong></div></section>
      <div className="drawer-actions"><button className="secondary-button" disabled={busy===`brief-${business.id}`} onClick={generate}>{busy===`brief-${business.id}`?"Generating…":business.brief?"Regenerate brief":"Generate brief"}</button><button className="primary-button" disabled={business.pipeline_status==="claimed"||busy===`claim-${business.id}`} onClick={claim}>{business.pipeline_status==="claimed"?"✓ Added to pipeline":busy===`claim-${business.id}`?"Adding…":"Claim opportunity"}</button></div>
    </aside>
  </div>;
}

function parseSignals(business:Business){try{return JSON.parse(business.signals_json) as string[]}catch{return []}}
