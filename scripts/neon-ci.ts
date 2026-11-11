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
async function findBranchByExactName(name: string) {
  // The list API supports name search; use it to recover branches created by
  // a POST whose response was lost before .neon-ci-branch could be written.
  const { branches } = await api(`/branches?search=${encodeURIComponent(name)}&limit=100`);
  return (branches as Array<{ id: string; name: string; parent_id?: string; protected?: boolean; default?: boolean }>)
    .filter((branch) => branch.name === name);
}

async function main() {
  const { project } = await api("");
  if (project.name !== "harvest-v2") throw new Error("CI is restricted to the harvest-v2 project.");
  const parents = await findBranchByExactName("dev");
  if (parents.length !== 1) throw new Error("Expected exactly one harvest-v2 dev branch");
  const parent = parents[0];
  if (process.argv[2] === "delete") {
    const matches = await findBranchByExactName(branchName);
    if (matches.length === 0) {
      console.info("No disposable branch remains for this CI job.");
      return;
    }
    if (matches.length !== 1) throw new Error("Refusing ambiguous CI branch cleanup");
    const candidate = matches[0];
    if (candidate.parent_id !== parent.id || candidate.protected || candidate.default) {
      throw new Error("Refusing deletion of a non-disposable branch.");
    }
    // An existing marker must agree with the branch found by name.
    const marker = await readFile(".neon-ci-branch", "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (marker !== null && marker.trim() !== candidate.id) {
      throw new Error("Refusing deletion: stored CI branch ID differs.");
    }
    const { branch: verified } = await api(`/branches/${candidate.id}`);
    if (verified.name !== branchName || verified.parent_id !== parent.id || verified.protected || verified.default) {
      throw new Error("Refusing deletion of a branch outside this CI job.");
    }
    await api(`/branches/${candidate.id}`, "DELETE");
    console.info("Deleted this run's disposable Neon CI branch.");
    return;
  }
  if (process.argv[2] !== "create") throw new Error("Use create or delete.");
  if ((await findBranchByExactName(branchName)).length !== 0) {
    throw new Error("Refusing to create duplicate CI branch; use cleanup first.");
  }
  const { branch, endpoints } = await api("/branches", "POST", {
    branch: { name: branchName, parent_id: parent.id, protected: false },
    endpoints: [{ type: "read_write" }],
  });
  await writeFile(".neon-ci-branch", branch.id, { mode: 0o600 });
  // Allow Neon to finish branch creation; no schema or app deploy occurs here.
  for (let i = 0; i < 90; i++) {
    const { operations } = await api("/operations");
    if (!operations.some((op: { branch_id: string; status: string }) => op.branch_id === branch.id && ["running", "scheduling"].includes(op.status))) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const params = new URLSearchParams({ branch_id: branch.id, endpoint_id: endpoints[0].id, database_name: "harvest", role_name: "harvest_owner", pooled: "false" });
  const { uri } = await api(`/connection_uri?${params}`);
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `DATABASE_URL_UNPOOLED=${uri}\n`);
  } else if (process.env.BASH_ENV) {
    // CircleCI sources BASH_ENV for the next step; never print the URI.
    const quoted = "'" + uri.replace(/'/g, "'\\''") + "'";
    await appendFile(process.env.BASH_ENV, `export DATABASE_URL_UNPOOLED=${quoted}\n`);
  } else {
    throw new Error("No supported CI environment export file is available.");
  }
  console.info("Created isolated harvest-v2 CI branch; credential passed privately to migration step.");
}
main().catch(() => { console.error("Neon CI operation failed. Inspect the project privately; no credentials logged."); process.exitCode = 1; });
