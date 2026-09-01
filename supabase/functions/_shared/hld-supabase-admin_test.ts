import { createAdminClient } from "npm:@supabase/server@^1/core";
import {
  supabaseApiKeyOnlyFetch,
  supabaseServerOptions,
} from "./hld-supabase-admin.ts";

function assertEquals(actual: string | null, expected: string | null): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

function captureFetch() {
  let capturedHeaders: Headers | null = null;
  const fetcher: typeof fetch = (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    return Promise.resolve(
      new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  return {
    fetcher,
    headers(): Headers {
      if (!capturedHeaders) throw new Error("Expected a captured request");
      return capturedHeaders;
    },
  };
}

async function adminRpcHeaders(secretKey: string): Promise<Headers> {
  const capture = captureFetch();
  const client = createAdminClient({
    env: {
      url: "https://example.supabase.co",
      publishableKeys: {},
      secretKeys: { default: secretKey },
      jwks: { keys: [] },
    },
    supabaseOptions: supabaseServerOptions(capture.fetcher),
  });

  const { error } = await client.rpc("test_admin_transport");
  if (error) throw error;
  return capture.headers();
}

Deno.test("new secret admin clients send the key only through apikey", async () => {
  const secretKey = "sb_secret_test_admin_transport_key";
  const headers = await adminRpcHeaders(secretKey);

  assertEquals(headers.get("apikey"), secretKey);
  assertEquals(headers.get("authorization"), null);
});

Deno.test("legacy JWT service-role keys retain Bearer authorization", async () => {
  const serviceRoleKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role.signature";
  const headers = await adminRpcHeaders(serviceRoleKey);

  assertEquals(headers.get("apikey"), serviceRoleKey);
  assertEquals(headers.get("authorization"), `Bearer ${serviceRoleKey}`);
});

Deno.test("user JWT Bearer authorization is preserved", async () => {
  const capture = captureFetch();
  const wrappedFetch = supabaseApiKeyOnlyFetch(capture.fetcher);
  const secretKey = "sb_secret_test_admin_transport_key";
  const userJwt = "header.user-payload.signature";

  await wrappedFetch("https://example.supabase.co/rest/v1/test", {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${userJwt}`,
    },
  });

  const headers = capture.headers();
  assertEquals(headers.get("apikey"), secretKey);
  assertEquals(headers.get("authorization"), `Bearer ${userJwt}`);
});
