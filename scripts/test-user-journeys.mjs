import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const compiled = new Map();
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000004";
const profile = { id: "profile", account_id: "account", slug: "instructor-one", display_name: "Instructor One", bio: "Saved profile text", city: "Austin", region: "TX", styles: [], event_types: ["weddings"], age_groups: [], languages: [], preferred_response_hours: 24, liability_insurance_status: "not_provided", status: "draft" };
const rows = [a, b].map((id, index) => ({ thread_id: id, inquiry_id: id, counterparty_name: `Conversation ${index + 1}`, counterparty_profile_slug: "cole-la-brie-san-francisco-bay-area-ca", event_type: "weddings", event_date: "2026-12-01", thread_status: "active", unread_count: 0 }));
const detail = id => ({ thread: { id, thread_status: "active" }, inquiry: { id, event_type: "weddings", booking_outcome: "unknown", completion_status: "unknown" }, messages: [{ id: `message-${id}`, body: `Details ${id}`, sender_role: "organizer", created_at: "2026-10-01T12:00:00Z" }], participants: [] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const event = value => ({ preventDefault() {}, target: { value } });
function all(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  return [node, ...all(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

// Executes the actual components, hook state, callbacks, and child mount/unmount
// behavior. Only browser, timers, and API boundaries are isolated.
function harness(component = "inbox", props = {}) {
  const instances = new Map(), modules = new Map(), timers = new Map(), plans = new Map();
  const calls = [], counts = [];
  let active, tree, dirty = true, nextTimer = 0;
  const location = new URL("/account/?tab=profile", "https://hirelinedancers.test");
  const window = { location, history: { replaceState: (_s, _t, url) => { location.href = new URL(url, location).href; } }, setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  function query(table) {
    let single = false;
    const data = table === "instructor_profiles" ? [profile] : table === "instructor_private_settings" ? [{ inquiry_email: "account@example.test", subscription_status: "active" }] : table === "instructor_directory_profiles" ? [profile] : [];
    const result = { then: (yes, no) => Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(yes, no) };
    for (const method of ["select", "eq", "neq", "in", "order", "limit", "update", "upsert"]) result[method] = () => result;
    result.maybeSingle = () => { single = true; return result; };
    return result;
  }
  const channel = { on: () => channel, subscribe: () => channel };
  const client = { from: query, channel: () => channel, removeChannel: async () => {}, rpc: async (name, args) => {
    calls.push({ name, args });
    const plan = plans.get(name)?.shift();
    if (plan) return plan(args);
    return { data: name === "list_inquiry_threads" ? rows : name === "get_inquiry_thread" ? detail(args.p_thread_id) : name === "current_instructor_lifetime_access" ? false : null, error: null };
  } };
  const react = {
    useState(initial) {
      const instance = active, index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === "function" ? initial() : initial;
      return [instance.slots[index], value => {
        if (!instance.alive) return;
        const next = typeof value === "function" ? value(instance.slots[index]) : value;
        if (!Object.is(next, instance.slots[index])) { instance.slots[index] = next; dirty = true; }
      }];
    },
    useRef(value) { return react.useState(() => ({ current: value }))[0]; },
    useMemo(fn, deps) {
      const instance = active, index = instance.cursor++, previous = instance.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) instance.slots[index] = { value: fn(), deps };
      return instance.slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const instance = active, index = instance.cursor++, previous = instance.effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        instance.effects[index] = { deps, cleanup: previous?.cleanup, pending: fn };
      }
    }
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    if (!compiled.has(relative)) {
      let source = readFileSync(new URL(relative, root), "utf8");
      if (relative.endsWith("AccountWorkspace.tsx")) source += "\nexport { InstructorDashboard };";
      compiled.set(relative, ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
    }
    const commonJsModule = { exports: {} }; modules.set(relative, commonJsModule);
    new Function("exports", "module", "require", "window", "process", compiled.get(relative))(commonJsModule.exports, commonJsModule, specifier => {
      if (specifier === "react") return react;
      if (specifier === "react/jsx-runtime") return require(specifier);
      if (specifier === "next/link") return { __esModule: true, default: ({ children, ...rest }) => require("react/jsx-runtime").jsx("a", { ...rest, children }) };
      if (specifier === "@supabase/supabase-js") return { createClient: () => client };
      if (specifier === "@/lib/marketplace") return load("src/lib/marketplace.ts");
      if (specifier === "@/lib/commercialTerms") return load("src/lib/commercialTerms.ts");
      if (specifier === "@/data/site") return load("src/data/site.ts");
      if (specifier === "@/lib/videoLinks") return load("src/lib/videoLinks.ts");
      if (specifier === "./ProfileEditor" || specifier === "./ProfileMediaManager") return load(`src/components/${specifier.slice(2)}.tsx`);
      if (specifier.includes("commercial-terms.json")) return JSON.parse(readFileSync(new URL("config/commercial-terms.json", root), "utf8"));
      if (specifier.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      return new Proxy({}, { get: (_target, key) => key === "__esModule" ? true : () => null });
    }, window, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test" } });
    return commonJsModule.exports;
  }
  const Component = component === "inbox" ? load("src/components/InquiryInbox.tsx").InquiryInbox : component === "dashboard" ? load("src/components/AccountWorkspace.tsx").InstructorDashboard : load("src/components/SearchPanel.tsx").PublicInstructorResults;
  const rootProps = component === "inbox" ? { perspective: "organizer", accountId: "account", ...props } : component === "dashboard" ? { account: { id: "account" }, ...props } : { onCountChange: count => counts.push(count), ...props };
  async function render() {
    for (let iteration = 0; iteration < 40; iteration++) {
      dirty = false;
      const visited = new Set();
      function expand(node, path) {
        if (!node || typeof node !== "object") return node;
        if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
        if (typeof node.type === "function") {
          const id = `${path}/${node.type.name}/${node.key ?? ""}`;
          let instance = instances.get(id);
          if (!instance) { instance = { slots: [], effects: [], alive: true }; instances.set(id, instance); }
          visited.add(id); active = instance; instance.cursor = 0;
          return expand(node.type(node.props), `${id}/child`);
        }
        return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/children`) } };
      }
      tree = expand({ type: Component, props: rootProps }, "root");
      for (const [id, instance] of instances) {
        if (!visited.has(id)) { instance.alive = false; for (const effect of instance.effects) effect?.cleanup?.(); instances.delete(id); }
        else for (const effect of instance.effects) if (effect?.pending) { effect.cleanup?.(); effect.cleanup = effect.pending(); effect.pending = null; }
      }
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return;
    }
    throw new Error("Component did not settle");
  }
  const nodes = () => all(tree);
  const button = name => nodes().find(node => node.type === "button" && text(node) === name);
  const field = name => { const label = nodes().find(node => node.type === "label" && all(node).some(child => child.type === "span" && text(child).trim() === name)); return all(label).find(node => ["input", "textarea", "select"].includes(node.type)); };
  return { render, nodes, button, field, counts, calls, text: () => text(tree), queue: (name, fn) => { if (!plans.has(name)) plans.set(name, []); plans.get(name).push(fn); }, choose: id => nodes().find(node => node.type === "button" && node.props.className?.includes("threadListItem") && text(node).includes(id === a ? "Conversation 1" : "Conversation 2")).props.onClick(), reply: () => nodes().find(node => node.type === "textarea" && node.props.placeholder === "Write a reply"), submit: () => nodes().find(node => node.type === "form" && node.props.className === "messageComposer").props.onSubmit(event()), flushTimers: async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await render(); } };
}

for (const perspective of ["organizer", "instructor"]) {
  test(`${perspective}: drafts stay with their conversation`, async () => {
    const app = harness("inbox", { perspective }); await app.render();
    app.reply().props.onChange(event("Draft for first conversation")); await app.render();
    app.choose(b); await app.render(); assert.equal(app.reply().props.value, "");
    app.reply().props.onChange(event("Draft for second conversation")); await app.render();
    app.choose(a); await app.render(); assert.equal(app.reply().props.value, "Draft for first conversation");
    await app.submit(); await app.render();
    assert.equal(app.calls.find(call => call.name === "send_inquiry_message").args.p_thread_id, a);
    app.choose(b); await app.render(); assert.equal(app.reply().props.value, "Draft for second conversation");
  });
}
test("clicking the selected conversation keeps its contents", async () => {
  const app = harness(); await app.render(); const before = app.text(); const requests = app.calls.length;
  app.choose(a); await app.render(); assert.equal(app.text(), before); assert.equal(app.calls.length, requests);
});
test("pending selection keeps the old details, recipient, and draft together", async () => {
  const app = harness(); await app.render(); app.reply().props.onChange(event("First draft")); await app.render();
  const pending = deferred(); app.queue("get_inquiry_thread", () => pending.promise);
  app.choose(b); await app.render(); assert.ok(app.text().includes(`Details ${a}`)); assert.equal(app.reply().props.value, "First draft");
  pending.resolve({ data: detail(b), error: null }); await app.render();
  assert.ok(app.text().includes(`Details ${b}`)); assert.equal(app.reply().props.value, "");
});
test("an old detail response cannot replace the newer selection", async () => {
  const app = harness(); await app.render(); const old = deferred(); app.queue("get_inquiry_thread", () => old.promise);
  app.choose(b); await app.render(); app.choose(a); await app.render();
  old.resolve({ data: detail(b), error: null }); await app.render(); assert.ok(app.text().includes(`Details ${a}`));
});
test("completing a send after switching preserves the new recipient and draft", async () => {
  const app = harness(); await app.render(); app.reply().props.onChange(event("First draft")); await app.render();
  const pending = deferred(); app.queue("send_inquiry_message", () => pending.promise); const sent = app.submit();
  await app.render(); app.choose(b); await app.render(); app.reply().props.onChange(event("Second draft")); await app.render();
  pending.resolve({ error: null }); await sent; await app.render();
  assert.ok(app.text().includes(`Details ${b}`)); assert.equal(app.reply().props.value, "Second draft");
});
test("failed send preserves the draft and reuses its retry key", async () => {
  const app = harness(); await app.render(); app.reply().props.onChange(event("Retry draft")); await app.render();
  app.queue("send_inquiry_message", async () => ({ error: { message: "Unavailable" } }));
  await app.submit(); await app.render(); assert.equal(app.reply().props.value, "Retry draft");
  await app.submit(); await app.render(); const sends = app.calls.filter(call => call.name === "send_inquiry_message");
  assert.equal(sends[0].args.p_client_request_id, sends[1].args.p_client_request_id);
});
test("an older search response cannot overwrite a newer search", async () => {
  const app = harness(); await app.render(); const old = deferred(); app.queue("list_inquiry_threads", () => old.promise);
  app.field("Search conversations").props.onChange(event("old")); await app.render(); await app.flushTimers();
  app.queue("list_inquiry_threads", async () => ({ data: [rows[1]], error: null }));
  app.field("Search conversations").props.onChange(event("new")); await app.render(); await app.flushTimers();
  old.resolve({ data: [rows[0]], error: null }); await app.render();
  const list = app.nodes().find(node => node.type === "aside" && node.props["aria-label"] === "Conversations");
  assert.ok(text(list).includes("Conversation 2")); assert.ok(!text(list).includes("Conversation 1"));
});
test("older pagination cannot append into a new filter", async () => {
  const app = harness(); const page = Array.from({ length: 50 }, (_, i) => ({ ...rows[0], thread_id: `page-${i}`, next_cursor_at: "2026-10-01T00:00:00Z", next_cursor_id: `page-${i}` }));
  app.queue("list_inquiry_threads", async () => ({ data: page, error: null })); await app.render();
  const old = deferred(); app.queue("list_inquiry_threads", () => old.promise); const pending = app.button("Load more conversations").props.onClick(); await app.render();
  app.queue("list_inquiry_threads", async () => ({ data: [rows[1]], error: null })); app.field("Show").props.onChange(event("unread")); await app.render();
  old.resolve({ data: [{ ...rows[0], thread_id: "stale-page", counterparty_name: "Stale result" }], error: null }); await pending; await app.render();
  assert.ok(!app.text().includes("Stale result"));
});
test("message profile links use the public database profile route", async () => {
  const app = harness(); await app.render();
  assert.equal(app.nodes().find(node => node.type === "a" && text(node) === "View instructor profile").props.href, "/profile/?instructor=cole-la-brie-san-francisco-bay-area-ca");
});
test("instructor profile edits survive repeated tab switches", async () => {
  const app = harness("dashboard"); await app.render();
  app.field("About you").props.onChange(event("Unsaved profile edits")); await app.render();
  for (const name of ["Messages", "Membership", "Profile", "Messages", "Profile"]) { app.button(name).props.onClick(); await app.render(); }
  assert.equal(app.field("About you").props.value, "Unsaved profile edits");
});
test("directory count excludes featured suggestions when no published profile matches", async () => {
  const app = harness("directory", { citySlug: "new-york-ny", eventSlug: "weddings" }); await app.render(); assert.equal(app.counts.at(-1), 0);
});
test("directory counts matching published profiles without the featured suggestion", async () => {
  const app = harness("directory", { citySlug: "austin-tx" }); await app.render(); assert.equal(app.counts.at(-1), 1);
});
