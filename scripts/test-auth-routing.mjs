import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const compiled = new Map();
const threadPath = "/account/?tab=inquiries&thread=00000000-0000-4000-8000-000000000001";

// Run the actual component callbacks with isolated browser, auth, and hook state.
// No production account, email, OAuth provider, or database is contacted.
function harness(path, { role = null, signedIn = true, signOutError = null, oauthError = null } = {}) {
  const states = [], effects = [], pending = [], navigation = [], authCalls = [];
  let cursor = 0, changed = true, tree;
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "account@example.test", user_metadata: { full_name: "Account" } };
  const sessionState = { session: signedIn ? { user } : null, account: signedIn ? { role, full_name: "Account" } : null, configured: true, loading: false, isAdmin: role === "admin", refresh: async () => {} };
  const location = new URL(path, "https://hirelinedancers.test");
  location.replace = (destination) => navigation.push(destination);
  const window = { location, history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } } };
  const client = { auth: {
    getSession: async () => ({ data: { session: sessionState.session }, error: null }),
    signOut: async (options) => {
      authCalls.push({ action: "signOut", options });
      if (!signOutError) sessionState.session = null;
      return { error: signOutError };
    },
    signInWithOAuth: async (options) => {
      authCalls.push({ action: "oauth", options });
      if (oauthError instanceof Error) throw oauthError;
      return { error: oauthError };
    }
  } };
  const react = {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => {
        const next = typeof value === "function" ? value(states[index]) : value;
        if (!Object.is(next, states[index])) { states[index] = next; changed = true; }
      }];
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      if (!effects[index] || deps.some((value, i) => !Object.is(value, effects[index][i]))) {
        effects[index] = deps;
        pending.push(callback);
      }
    },
    useMemo: (callback) => callback(),
    useRef: (value) => ({ current: value })
  };
  const modules = new Map();
  function load(relativePath) {
    if (modules.has(relativePath)) return modules.get(relativePath).exports;
    if (!compiled.has(relativePath)) compiled.set(relativePath, ts.transpileModule(readFileSync(new URL(relativePath, root), "utf8"), {
      fileName: relativePath,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText);
    const commonJsModule = { exports: {} };
    modules.set(relativePath, commonJsModule);
    new Function("exports", "module", "require", "window", "process", compiled.get(relativePath))(
      commonJsModule.exports, commonJsModule,
      (specifier) => {
        if (specifier === "react") return react;
        if (specifier === "react/jsx-runtime") return require(specifier);
        if (specifier === "@supabase/supabase-js") return { createClient: () => client };
        if (specifier === "@/hooks/useMarketplaceSession") return { useMarketplaceSession: () => sessionState };
        if (specifier === "@/lib/marketplace") return load("src/lib/marketplace.ts");
        if (specifier === "@/lib/commercialTerms") return load("src/lib/commercialTerms.ts");
        if (specifier.includes("commercial-terms.json")) return JSON.parse(readFileSync(new URL("config/commercial-terms.json", root), "utf8"));
        if (specifier.endsWith(".css")) return {};
        return new Proxy({}, { get: (_target, name) => name === "__esModule" ? true : () => null });
      }, window, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test" } }
    );
    return commonJsModule.exports;
  }
  async function render(component = "account") {
    const Component = component === "account" ? load("src/components/AccountWorkspace.tsx").AccountWorkspace : load("src/components/LoginScreen.tsx").LoginScreen;
    for (let iteration = 0; iteration < 20; iteration++) {
      changed = false;
      cursor = 0;
      tree = Component({});
      for (const effect of pending.splice(0)) effect();
      await new Promise((resolve) => setImmediate(resolve));
      if (!changed) return tree;
    }
    throw new Error("Component did not settle");
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    return [node, ...nodes(node.props?.children)];
  }
  return { render, nodes: () => nodes(tree), navigation, authCalls, load, location, sessionState };
}

for (const path of [threadPath, "/account/?tab=profile", "/account/?inquiry=example", "/account/?followup=example"]) {
  test(`incomplete Google account stays on ${path} without a redirect loop`, async () => {
    const app = harness(path);
    await app.render();
    await app.render();
    assert.deepEqual(app.navigation, []);
    assert.ok(app.nodes().some((node) => node.type === "button" && node.props.children === "Use another account"));
  });
}

test("completed instructors stay on their inquiry link", async () => {
  const app = harness(threadPath, { role: "instructor" });
  await app.render();
  assert.deepEqual(app.navigation, []);
});

test("completed explicit instructor entry returns to the saved inquiry exactly once", async () => {
  const app = harness(`/account/?intent=instructor&returnTo=${encodeURIComponent(threadPath)}`, { role: "instructor" });
  await app.render();
  assert.deepEqual(app.navigation, [threadPath]);
});

test("unfinished explicit instructor entry does not skip onboarding", async () => {
  const app = harness(`/account/?intent=instructor&returnTo=${encodeURIComponent(threadPath)}`);
  await app.render();
  assert.deepEqual(app.navigation, []);
  assert.equal(app.location.searchParams.get("intent"), "instructor");
  assert.equal(app.location.searchParams.get("returnTo"), threadPath);

  const refreshed = harness(`${app.location.pathname}${app.location.search}`);
  await refreshed.render();
  assert.ok(refreshed.nodes().some((node) => node.props?.fixedRole === "instructor"));
});

test("account return guard rejects absent intent, wrong roles, and self redirects", () => {
  const { accountEntryRedirect } = harness("/account/").load("src/lib/marketplace.ts");
  for (const [role, intent, admin, target, current] of [
    [null, null, false, threadPath, threadPath],
    [null, "instructor", false, threadPath, "/account/"],
    ["organizer", "instructor", false, threadPath, "/account/"],
    ["instructor", "instructor", false, threadPath, threadPath],
    ["instructor", "instructor", false, "/account/../account/", "/account/"],
    ["instructor", undefined, false, threadPath, "/account/"],
    ["instructor", "instructor", false, null, "/account/"]
  ]) assert.equal(accountEntryRedirect(role, intent, admin, target, current), null);
  assert.equal(accountEntryRedirect("admin", "organizer", true, "/contact/", "/account/"), "/contact/");
});

test("switching accounts signs out locally and preserves the full inquiry destination", async () => {
  const app = harness(threadPath);
  await app.render();
  app.nodes().find((node) => node.type === "button" && node.props.children === "Use another account").props.onClick();
  await app.render();
  assert.deepEqual(app.authCalls, [{ action: "signOut", options: { scope: "local" } }]);
  assert.equal(app.navigation.length, 1);
  const target = new URL(app.navigation[0], "https://hirelinedancers.test");
  assert.equal(target.pathname, "/sign-in/");
  assert.equal(target.searchParams.get("next"), threadPath);
});

test("switching accounts preserves instructor signup intent", async () => {
  const app = harness(`/account/?intent=instructor&returnTo=${encodeURIComponent(threadPath)}`);
  await app.render();
  app.nodes().find((node) => node.type === "button" && node.props.children === "Use another account").props.onClick();
  await app.render();
  const target = new URL(app.navigation[0], "https://hirelinedancers.test");
  assert.equal(target.searchParams.get("role"), "instructor");
  assert.equal(target.searchParams.get("next"), threadPath);
});

test("failed account switch remains recoverable without navigating", async () => {
  const app = harness(threadPath, { signOutError: { message: "Unable to sign out" } });
  await app.render();
  app.nodes().find((node) => node.type === "button" && node.props.children === "Use another account").props.onClick();
  await app.render();
  assert.deepEqual(app.navigation, []);
  assert.ok(app.nodes().some((node) => node.props?.role === "alert" && node.props.children === "Unable to sign out"));
  assert.equal(app.nodes().find((node) => node.type === "button" && node.props.children === "Use another account").props.disabled, false);
});

test("Google always requests the account chooser and preserves the callback destination", async () => {
  const app = harness(`/sign-in/?next=${encodeURIComponent(threadPath)}`, { signedIn: false });
  await app.render("login");
  app.nodes().find((node) => node.type === "button" && node.props.children === "Continue with Google").props.onClick();
  await app.render("login");
  const { options } = app.authCalls.find((call) => call.action === "oauth");
  assert.equal(options.provider, "google");
  assert.deepEqual(options.options.queryParams, { prompt: "select_account" });
  assert.equal(new URL(options.options.redirectTo).searchParams.get("next"), threadPath);
});

for (const error of [{ message: "Google unavailable" }, new Error("Network unavailable")]) {
  test(`Google sign-in recovers from ${error.message}`, async () => {
    const app = harness("/sign-in/", { signedIn: false, oauthError: error });
    await app.render("login");
    app.nodes().find((node) => node.type === "button" && node.props.children === "Continue with Google").props.onClick();
    await app.render("login");
    assert.ok(app.nodes().some((node) => node.props?.role === "alert" && node.props.children === error.message));
    assert.equal(app.nodes().find((node) => node.type === "button" && node.props.children === "Continue with Google").props.disabled, false);
  });
}
