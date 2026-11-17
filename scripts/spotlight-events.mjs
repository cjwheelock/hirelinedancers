import { articleProblems } from "./spotlight-publication.mjs";

export async function verifyArticleOnce(row, { fetchImpl = fetch } = {}) {
  const read = path => fetchImpl(`https://hirelinedancers.com${path}?publication_check=${Date.now()}`, {
    cache: "no-store", signal: AbortSignal.timeout(30000)
  });
  const path = `/blog/${row.slug}/`;
  const problems = [];
  const blog = await read("/blog/");
  if (!blog.ok) problems.push(`blog listing HTTP ${blog.status}`);
  else if (!(await blog.text()).includes(`href="${path}"`)) problems.push("article missing from blog listing");
  const article = await read(path);
  if (!article.ok) problems.push(`article HTTP ${article.status}`);
  else problems.push(...articleProblems(row, await article.text()));
  return problems;
}

export class SpotlightEvents {
  constructor({ state, save, readArticle, dispatch, findDispatch, verify = verifyArticleOnce, notify = () => {}, now = Date.now }) {
    Object.assign(this, { state, save, readArticle, dispatch, findDispatch, verify, notify, now });
    this.state.jobs ||= {};
  }

  async accept(event) {
    if (!this.state.jobs[event.id]) {
      if (!['release', 'withdraw'].includes(event.action) || !event.id || !event.profile_id || !event.revision
        || (event.action === 'release' && !Number.isFinite(Date.parse(event.due_at)))) throw new Error("Invalid publication event.");
      this.state.jobs[event.id] = { event, dispatch: { status: "pending", attempts: 0 }, verification: {
        status: event.action === "release" ? "pending" : "not-required",
        at: event.action === "release" ? new Date(Date.parse(event.due_at) + 5 * 60000).toISOString() : null
      } };
      if (event.action === "withdraw") {
        for (const previous of Object.values(this.state.jobs)) {
          if (previous.event.profile_id === event.profile_id && previous.event.revision === event.revision
            && previous.verification.status === "pending") previous.verification.status = "superseded";
        }
      }
      await this.save(this.state);
    }
    await this.publish(event.id);
  }

  async publish(id) {
    const job = this.state.jobs[id];
    if (!['pending', 'attempting'].includes(job.dispatch.status)) return;
    if (job.dispatch.retryAt && this.now() < Date.parse(job.dispatch.retryAt)) return;
    try {
      // Reconcile a lost dispatch response before retrying. This does not inspect the public site.
      if (job.dispatch.attempts && await this.findDispatch(id)) {
        job.dispatch.status = "accepted";
        await this.save(this.state);
        return;
      }
      if (job.event.action === "release") {
        job.snapshot = await this.readArticle(job.event.profile_id);
        if (!job.snapshot || job.snapshot.revision !== job.event.revision) {
          job.dispatch.status = "superseded";
          job.verification.status = "superseded";
          await this.save(this.state);
          return;
        }
        for (const previous of Object.values(this.state.jobs)) {
          if (previous.event.profile_id === job.event.profile_id && previous.event.revision !== job.event.revision
            && previous.verification.status === "pending") previous.verification.status = "superseded";
        }
      }
      job.dispatch.attempts++;
      job.dispatch.status = "attempting";
      job.dispatch.attemptedAt = new Date(this.now()).toISOString();
      await this.save(this.state);
      await this.dispatch(id);
      job.dispatch.status = "accepted";
      delete job.dispatch.error;
      delete job.dispatch.retryAt;
    } catch (error) {
      // Bounded delivery retries only after a transport/API failure, never recurring page checks.
      job.dispatch.failures = (job.dispatch.failures || 0) + 1;
      job.dispatch.error = error.message;
      job.dispatch.status = job.dispatch.failures >= 3 ? "failed" : "pending";
      job.dispatch.retryAt = new Date(this.now() + 60000).toISOString();
      if (job.dispatch.status === "failed") await this.notify("Spotlight deployment could not be requested. Check the publication listener.");
    }
    await this.save(this.state);
  }

  async verifyDue(id) {
    const job = this.state.jobs[id];
    if (job.verification.status !== "pending" || this.now() < Date.parse(job.verification.at)) return;
    // Persist the claim before HTTP requests. A crash must not create a second public check.
    job.verification.status = "started";
    job.verification.startedAt = new Date(this.now()).toISOString();
    await this.save(this.state);
    try {
      const row = job.snapshot || await this.readArticle(job.event.profile_id);
      if (!row || row.revision !== job.event.revision) job.verification.status = "superseded";
      else {
        job.verification.problems = await this.verify(row);
        job.verification.status = job.verification.problems.length ? "failed" : "passed";
      }
    } catch (error) {
      job.verification.status = "failed";
      job.verification.problems = [error.message];
    }
    job.verification.completedAt = new Date(this.now()).toISOString();
    await this.save(this.state);
    if (job.verification.status === "failed") await this.notify("A spotlight was not public five minutes after its scheduled release. Check the publication listener and deployment.");
  }

  async recover() {
    for (const job of Object.values(this.state.jobs)) {
      if (job.verification.status === "started") {
        job.verification.status = "uncertain";
        await this.notify("A spotlight verification was interrupted. Its result needs manual review; the check will not repeat.");
      }
    }
    await this.save(this.state);
  }
}
