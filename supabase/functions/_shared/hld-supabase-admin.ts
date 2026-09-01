const NEW_SECRET_KEY_PREFIX = "sb_secret_";
const POSTGREST_FUTURE_JWT_CODE = "PGRST303";
const POSTGREST_FUTURE_JWT_MESSAGE = "JWT issued at future";
const POSTGREST_RETRY_DELAYS_MS = [1_500, 4_000] as const;

type Delay = (delayMs: number) => Promise<void>;

function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function isPostgrestFutureJwtResponse(
  response: Response,
): Promise<boolean> {
  if (response.status !== 401) return false;

  try {
    const payload = await response.clone().json() as {
      code?: unknown;
      message?: unknown;
    };
    return payload.code === POSTGREST_FUTURE_JWT_CODE &&
      payload.message === POSTGREST_FUTURE_JWT_MESSAGE;
  } catch {
    return false;
  }
}

/**
 * New Supabase secret keys belong in `apikey`, not in a Bearer header.
 * Strip only the exact duplicate secret-key Bearer value so user JWTs and
 * legacy JWT-based service-role keys keep their existing authorization path.
 * Retry only PostgREST's transient future-JWT validation failure, which occurs
 * before a request can execute, and keep every other authorization error final.
 */
export function supabaseApiKeyOnlyFetch(
  baseFetch: typeof fetch = globalThis.fetch,
  delay: Delay = wait,
  retryDelaysMs: readonly number[] = POSTGREST_RETRY_DELAYS_MS,
): typeof fetch {
  const wrappedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    const apiKey = headers.get("apikey");
    const authorization = headers.get("authorization");

    if (
      apiKey?.startsWith(NEW_SECRET_KEY_PREFIX) &&
      bearerToken(authorization) === apiKey
    ) {
      headers.delete("authorization");
    }

    const requestTemplate = new Request(request, { headers });
    let response = await baseFetch(requestTemplate.clone());

    for (const retryDelayMs of retryDelaysMs) {
      if (!(await isPostgrestFutureJwtResponse(response))) return response;
      await delay(retryDelayMs);
      response = await baseFetch(requestTemplate.clone());
    }

    return response;
  };

  return wrappedFetch;
}

export function supabaseServerOptions(
  baseFetch: typeof fetch = globalThis.fetch,
) {
  return {
    global: {
      fetch: supabaseApiKeyOnlyFetch(baseFetch),
    },
  };
}
