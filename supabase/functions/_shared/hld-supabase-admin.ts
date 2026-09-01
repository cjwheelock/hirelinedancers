const NEW_SECRET_KEY_PREFIX = "sb_secret_";

function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * New Supabase secret keys belong in `apikey`, not in a Bearer header.
 * Strip only the exact duplicate secret-key Bearer value so user JWTs and
 * legacy JWT-based service-role keys keep their existing authorization path.
 */
export function supabaseApiKeyOnlyFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  const wrappedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const apiKey = headers.get("apikey");
    const authorization = headers.get("authorization");

    if (
      apiKey?.startsWith(NEW_SECRET_KEY_PREFIX) &&
      bearerToken(authorization) === apiKey
    ) {
      headers.delete("authorization");
      return baseFetch(input, { ...init, headers });
    }

    return baseFetch(input, init);
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
