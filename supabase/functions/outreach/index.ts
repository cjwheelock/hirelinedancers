// Single deployed entry for booker outreach.
// POST /outreach        -> scheduled worker (secret key, called by pg_cron)
// POST /outreach/admin  -> administrator actions (signed-in admin)
import worker from "../outreach-worker/index.ts";
import admin from "../outreach-admin/index.ts";

export default {
  fetch(req: Request, ...rest: unknown[]) {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    // deno-lint-ignore no-explicit-any
    const handler = (path.endsWith("/admin") ? admin : worker) as any;
    return handler.fetch(req, ...rest);
  },
};
