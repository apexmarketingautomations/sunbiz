import { env } from "cloudflare:workers";

type RuntimeEnv = {
  DB?: D1Database;
  APEX_OPERATOR_EMAILS?: string;
};

export function getD1() {
  const db = (env as unknown as RuntimeEnv).DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  return db;
}

export function operatorEmails() {
  return ((env as unknown as RuntimeEnv).APEX_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
