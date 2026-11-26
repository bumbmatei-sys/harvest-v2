// Minimal types for the one workerd API the CF-03 staging harness uses; the project has no Workers type package.
declare module "cloudflare:workers" {
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: unknown;
    constructor(ctx: unknown, env: Env);
  }
}
