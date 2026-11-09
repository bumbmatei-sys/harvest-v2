import { appendFile, readFile, writeFile } from "node:fs/promises";
import { requiredEnv } from "../src/lib/env";
const projectId = requiredEnv("NEON_PROJECT_ID");
const headers = { Authorization: `Bearer ${requiredEnv("NEON_API_KEY")}`, "Content-Type": "application/json" };
// Preserve the existing GitHub Actions path while supporting CircleCI Free.
// Branch names are bound to this CI job so cleanup cannot touch dev/prod.
const runId = process.env.GITHUB_RUN_ID ??
  (process.env.CIRCLE_WORKFLOW_ID && process.env.CIRCLE_WORKFLOW_ID.replace(/-/g, ""));
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? process.env.CIRCLE_BUILD_NUM;
if (!runId || !runAttempt || !/^[a-zA-Z0-9]+$/.test(runId) || !/^[0-9]+$/.test(runAttempt)) {
  throw new Error("A recognized CI run ID and attempt/build number are required.");
}
const branchName = `ci/${runId}-${runAttempt}`;
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Neon CI request failed: HTTP ${response.status}`);
  return response.status === 204 ? {} : response.json();
}
async function main() {
  const { project } = await api("");
  if (project.name !== "harvest-v2") throw new Error("CI is restricted to the harvest-v2 project.");
  if (process.argv[2] === "delete") {
    const id = await readFile(".neon-ci-branch", "utf8");
    const { branch } = await api(`/branches/${id}`);
    if (branch.name !== branchName) throw new Error("Refusing to delete a branch outside this CI job.");
    await api(`/branches/${id}`, "DELETE"); return;
  }
  const { branches } = await api("/branches");
  const parent = branches.find((b: { name: string }) => b.name === "dev");
  if (!parent) throw new Error("harvest-v2 dev branch is missing");
  const name = branchName;
  const { branch, endpoints } = await api("/branches", "POST", { branch: { name, parent_id: parent.id }, endpoints: [{ type: "read_write" }] });
  await writeFile(".neon-ci-branch", branch.id);
  // Allow Neon to finish branch creation; no schema or app deploy occurs here.
  for (let i = 0; i < 90; i++) {
    const { operations } = await api("/operations");
    if (!operations.some((op: { branch_id: string; status: string }) => op.branch_id === branch.id && ["running", "scheduling"].includes(op.status))) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const params = new URLSearchParams({ branch_id: branch.id, endpoint_id: endpoints[0].id, database_name: "harvest", role_name: "harvest_owner", pooled: "false" });
  const { uri } = await api(`/connection_uri?${params}`);
  if (process.env.GITHUB_ENV) {
    // GitHub Actions treats each line as a literal environment assignment.
    await appendFile(process.env.GITHUB_ENV, `DATABASE_URL_UNPOOLED=${uri}\n`);
  } else if (process.env.BASH_ENV) {
    // CircleCI sources BASH_ENV for each subsequent run step. Quote a URL as
    // shell data, never print it or interpolate it into the workflow YAML.
    const quoted = "'" + uri.replace(/'/g, "'\\''") + "'";
    await appendFile(process.env.BASH_ENV, `export DATABASE_URL_UNPOOLED=${quoted}\n`);
  } else {
    throw new Error("No supported CI environment export file is available.");
  }
  console.info("Created isolated harvest-v2 CI branch; credential passed privately to migration step.");
}
main().catch(() => { console.error("Neon CI operation failed. Inspect the project privately; no credentials logged."); process.exitCode = 1; });
