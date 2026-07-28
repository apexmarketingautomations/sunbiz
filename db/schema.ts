import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable("businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filingNumber: text("filing_number").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  city: text("city").notNull(),
  county: text("county").notNull(),
  score: integer("score").notNull(),
  opportunity: text("opportunity").notNull(),
  confidence: integer("confidence").notNull(),
  stage: text("stage").notNull(),
  website: text("website").notNull(),
  owner: text("owner").notNull(),
  phone: text("phone").notNull(),
  signalsJson: text("signals_json").notNull(),
  pipelineStatus: text("pipeline_status", { enum: ["unclaimed", "claimed"] }).notNull().default("unclaimed"),
  origin: text("origin", { enum: ["official-sunbiz", "sample"] }).notNull().default("official-sunbiz"),
  brief: text("brief"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  check("businesses_score_check", sql`${table.score} BETWEEN 0 AND 100`),
  check("businesses_confidence_check", sql`${table.confidence} BETWEEN 0 AND 100`),
]);

export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status", { enum: ["verified", "blocked", "failed", "completed"] }).notNull(),
  source: text("source").notNull(),
  recordsFound: integer("records_found").notNull().default(0),
  recordsQualified: integer("records_qualified").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const sourceHealth = sqliteTable("source_health", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  status: text("status", { enum: ["healthy", "degraded", "not_configured", "blocked"] }).notNull(),
  successRate: integer("success_rate").notNull(),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [check("source_health_rate_check", sql`${table.successRate} BETWEEN 0 AND 100`)]);

export const automations = sqliteTable("automations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  runs: integer("runs").notNull().default(0),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
});

export const activity = sqliteTable("activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  actor: text("actor"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
