import { writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { requiredEnv } from "../src/lib/env";

// Explicit operator command; never imported by the app or run by CI.
const apiKey = requiredEnv("NEON_API_KEY");
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://console.neon.tech/api/v2/${path}`, {
    method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const reason = String(error.message ?? error.code ?? "No error detail").replaceAll(apiKey, "[redacted]");
    throw new Error(`Neon API ${method} failed (HTTP ${response.status}): ${reason}`);
  }
  return response.json();
}
async function wait(projectId: string) {
  for (let i = 0; i < 120; i++) {
    const { operations } = await api(`projects/${projectId}/operations`);
    if (operations.some((op: { status: string }) => ["failed", "error"].includes(op.status))) throw new Error("A Neon operation failed; inspect the console privately.");
    if (!operations.some((op: { status: string }) => ["running", "scheduling"].includes(op.status))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Neon operations did not complete; rerun after checking the console.");
}
async function main() {
  type Project = { id: string; name: string; region_id: string };
  const matches: Project[] = [];
  let cursor = "";
  do {
    const result = await api(`projects?limit=400${cursor ? `&cursor=${cursor}` : ""}`);
    matches.push(...result.projects.filter((p: Project) => p.name === "harvest-v2"));
    cursor = result.projects.length === 400 ? result.pagination?.cursor ?? "" : "";
  } while (cursor);
  if (matches.length > 1) throw new Error("Multiple harvest-v2 projects exist; select the intended project privately.");
  let project = matches[0];
  if (!project) {
    const { organizations } = await api("users/me/organizations");
    if (organizations.length !== 1) throw new Error("A single Neon organization must be selected before creating harvest-v2.");
    ({ project } = await api("projects", "POST", { project: { name: "harvest-v2", org_id: organizations[0].id,
      region_id: "aws-eu-central-1", pg_version: 17,
      branch: { name: "prod", database_name: "harvest", role_name: "harvest_owner" },
      default_endpoint_settings: { autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 },
    } }));
    console.info("Created Neon project harvest-v2");
  }
  if (project.name !== "harvest-v2") throw new Error("Unexpected Neon project; stopped.");
  await wait(project.id);
  const { branches } = await api(`projects/${project.id}/branches`);
  const prod = branches.find((b: { name: string }) => b.name === "prod");
  if (!prod) throw new Error("Existing harvest-v2 has no prod branch; inspect before choosing its root.");
  for (const name of ["staging", "dev"]) {
    if (!branches.some((b: { name: string }) => b.name === name)) {
      const { branch } = await api(`projects/${project.id}/branches`, "POST", { branch: { name, parent_id: prod.id }, endpoints: [{ type: "read_write" }] });
      branches.push(branch); console.info(`Created harvest-v2 branch ${name}`);
      await wait(project.id);
    }
  }
  const dev = branches.find((b: { name: string }) => b.name === "dev");
  const { endpoints } = await api(`projects/${project.id}/endpoints`);
  const endpoint = endpoints.find((e: { branch_id: string }) => e.branch_id === dev.id);
  if (!endpoint) throw new Error("Dev compute endpoint is missing.");
  const params = new URLSearchParams({ branch_id: dev.id, endpoint_id: endpoint.id, database_name: "harvest", role_name: "harvest_owner", pooled: "false" });
  const { uri } = await api(`projects/${project.id}/connection_uri?${params}`);
  const secureUri = new URL(uri); secureUri.searchParams.set("sslmode", "verify-full");
  // Do not replace any pre-existing local env file silently.
  const existing = await readFile(".env.local", "utf8").catch(() => "");
  let contents = existing;
  for (const [name, value] of Object.entries({ DATABASE_URL_UNPOOLED: secureUri.toString(), BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), BETTER_AUTH_URL: "http://localhost:3000" })) {
    const pattern = new RegExp(`^${name}=(.*)$`, "m");
    const match = contents.match(pattern);
    if (match?.[1]?.trim()) continue;
    const line = `${name}=${value}`;
    contents = match ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
  }
  if (contents !== existing) await writeFile(".env.local", contents.trimStart(), { mode: 0o600 });
  const metadata = { projectId: project.id, projectName: "harvest-v2", region: project.region_id,
    branches: Object.fromEntries(branches.filter((b: { name: string }) => ["dev", "staging", "prod"].includes(b.name)).map((b: { name: string; id: string }) => [b.name, b.id])),
    devEndpointHost: new URL(uri).hostname };
  await writeFile("docs/setup/neon-project.json", `${JSON.stringify(metadata, null, 2)}\n`);
  console.info(JSON.stringify({ projectId: project.id, branches: ["dev", "staging", "prod"], credentials: "dev only, stored in ignored .env.local" }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") : "Neon provisioning failed"); process.exitCode = 1; });
