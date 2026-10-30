# Waitlist signup: server boundary and provider adapters

The page posts signups to one on-demand route, `POST /api/waitlist`
(`src/pages/api/waitlist.ts`). That route is a thin wrapper around
`src/lib/waitlist/handler.ts`, which validates, rate-limits and hands the address
to a **provider adapter**. No real provider has been chosen yet, so out of the box
every signup answers `503 unavailable`. The page shows its recoverable failure
state instead of pretending to succeed.

Rules this code enforces:

- Success is reported only after a real successful response from the configured
  destination. There is no fallback to browser storage, files or a fake success.
- The email address is never written to logs, analytics, URLs or persistent
  storage by this code. Responses never echo it.
- A duplicate signup looks exactly like a new one from the outside.

## Public contract

**Request:** `POST /api/waitlist`, same origin only, body at most 2 KB.

| Body type | Fields |
|---|---|
| `application/json` | `{ "email": string, "source"?: "hero" \| "final" \| "no-js" }` |
| `application/x-www-form-urlencoded` or `multipart/form-data` | `email`, optional `source` |

- Script callers must send `Accept: application/json` to get JSON back. A form
  body *without* that header is treated as a no-JS form post and gets a redirect.
- `source` is optional. Unknown values become `"no-js"` for no-JS form posts and
  `"hero"` otherwise.

**Response:** JSON is always exactly `{ "status": "<status>" }` with
`content-type: application/json; charset=utf-8` and `cache-control: no-store`.

| Situation | HTTP | `status` | Extra headers | No-JS redirect (303) |
|---|---|---|---|---|
| Added (single opt-in) | 200 | `accepted` | | `/waitlist/joined/` |
| Added, confirmation email sent | 200 | `confirmation_required` | | `/waitlist/confirm/` |
| Already on the list, single opt-in | 200 | `accepted` | | `/waitlist/joined/` |
| Already on the list, double opt-in | 200 | `confirmation_required` | | `/waitlist/confirm/` |
| Invalid/missing email, provider rejected the address | 400 | `invalid` | | `/waitlist/try-again/` |
| Malformed JSON, unsupported content type | 400 | `invalid` | | `/waitlist/try-again/` |
| Body over 2 KB | 413 | `invalid` | | `/waitlist/try-again/` |
| Cross-origin request | 403 | `forbidden` | | `/waitlist/try-again/`* |
| Too many attempts (local limiter or provider) | 429 | `rate_limited` | `Retry-After: <seconds>` when known | `/waitlist/try-again/` |
| No provider configured, provider error, provider timeout (8 s) | 503 | `unavailable` | | `/waitlist/try-again/` |
| Method other than POST | 405 | `invalid` | `Allow: POST` | (not applicable) |

\* Astro's built-in origin check answers cross-site *form* posts with its own
plain-text 403 before this handler runs.

Redirect URLs never carry the email or a reason. The three `/waitlist/*` pages
must exist for the no-JS path. With the test destination selected, every
response also carries `x-waitlist-destination: test-destination`.

Suggested UI mapping: `accepted` → "You're on the list…", `confirmation_required`
→ "Check your inbox to confirm your place.", `invalid` → field error, and
`rate_limited` / `unavailable` / `forbidden` / network error → "We couldn't add
you yet. Please try again." (keep the typed email).

**Server-side validation** is permissive on purpose. The handler trims, allows at
most 254 characters, splits on the last `@`, requires a 1–64 character local part
and a domain that contains a dot, does not start or end with a dot, and has no
whitespace or control characters. Only the domain is lowercased.

## How the provider is selected

`selectProvider(env, { dev })` in `src/lib/waitlist/providers/index.ts`:

| `WAITLIST_PROVIDER` | Result |
|---|---|
| unset or empty | `unconfigured`: every signup → 503. Log reason: `WAITLIST_PROVIDER is not set` |
| `test` and (`astro dev` **or** `WAITLIST_ALLOW_TEST_PROVIDER=1`) | controlled test destination |
| `test` otherwise | `unconfigured`. Log reason: `test provider refused outside development` |
| a registered adapter name | that adapter |
| anything else | `unconfigured`. Log reason: `unknown WAITLIST_PROVIDER` |

The endpoint picks the provider and the rate limiter once per server process.

## Environment variables

All are server-side only. Never give them a `PUBLIC_` prefix.

| Variable | Default | Meaning |
|---|---|---|
| `WAITLIST_PROVIDER` | empty | Destination name, as in the table above |
| `WAITLIST_ALLOW_TEST_PROVIDER` | empty | `1` allows `test` in a built/preview server. Never set it in production |
| `WAITLIST_TEST_CONFIRMATION` | `none` | `double-opt-in` makes the test destination behave like a confirmation-email provider |
| `WAITLIST_RATE_LIMIT` | `20` | Attempts per client address per window |
| `WAITLIST_RATE_WINDOW_SECONDS` | `600` | Window length |
| `WAITLIST_TRUSTED_PROXY_HOPS` | `0` | Number of reverse proxies in front of the server that append to `X-Forwarded-For`. See "Client addresses" below |

Values are read at runtime from `process.env`, layered over Astro's
`import.meta.env` (which is how `.env` files apply during `astro dev`). The built
Node server does not read `.env` by itself. Set the variables in the host's
environment, or run `node --env-file=.env ./dist/server/entry.mjs`.
`.env.example` lists them all.

### Deployment notes

#### Client addresses (rate-limit key)

The limiter keys on one address per visitor. That address must be one the
visitor cannot write, or the limiter can be skipped by rotating it, and used to
lock a chosen person out by sending their address.

- **Server reachable directly, no proxy:** leave `WAITLIST_TRUSTED_PROXY_HOPS`
  unset and do not set `security.allowedDomains`. The key is the TCP peer address
  from `@astrojs/node`.
- **Behind reverse proxies** (nginx, a load balancer, a PaaS router, a CDN): set
  `WAITLIST_TRUSTED_PROXY_HOPS` to the number of proxies that append the
  connecting address to `X-Forwarded-For` (`1` for a single nginx or load
  balancer). The handler then uses the entry that many places from the **right**
  of the header. Only your proxies wrote it. Entries further left came from the
  visitor and are ignored. If you leave it at `0`, every visitor shares the
  proxy's address, so the whole site shares one bucket (20 attempts per 10 minutes).
  - Each proxy must append (nginx: `proxy_set_header X-Forwarded-For
    $proxy_add_x_forwarded_for;`) or overwrite the header with the address it
    saw. A proxy that passes the incoming header through untouched breaks this.
  - The Node port must be reachable only from the proxy: bind it to `127.0.0.1`
    or a private network, or firewall it. With several proxies, only the
    outermost one may be public. Anyone who can reach an inner hop can write the
    entry it trusts.
  - Check your platform's docs for how many entries it appends, then confirm with
    the forged-header check in the release checklist.
- **Do not rely on `security.allowedDomains` for client addresses.** Once it is
  set, Astro 7 reports the **left-most** `X-Forwarded-For` entry as the client
  address, and the visitor writes that entry. With `WAITLIST_TRUSTED_PROXY_HOPS`
  set, the handler ignores Astro's address whenever the header has enough entries,
  so the two settings are safe together. `allowedDomains` with hops left at `0`
  is **not** safe: the limiter can be bypassed.
- If an adapter supplies no client address at all, the local limiter is skipped
  rather than putting every visitor into one shared bucket. `X-Forwarded-For` is
  never used as a fallback unless `WAITLIST_TRUSTED_PROXY_HOPS` says it is trusted.

#### Origin check behind a proxy

Without `security.allowedDomains`, Astro builds `request.url` with a
`localhost:<port>` host. The origin guard trusts `Sec-Fetch-Site` first, the same
way Astro's own check does, so current browsers are unaffected. A browser that
sends only `Origin` and no `Sec-Fetch-Site` (Safari before 16.4, for example) is
compared against that `localhost` URL and gets `403 forbidden`, and the page
shows its retry state. Behind a proxy, setting `allowedDomains` fixes this, as
long as `WAITLIST_TRUSTED_PROXY_HOPS` is set too. With no proxy, leave
`allowedDomains` unset and accept that those few old browsers cannot sign up.

#### Other notes

- The rate limiter lives in memory and is per process. It does not share counts
  across instances or survive restarts. Rely on the provider's limits and the
  platform's edge rate limiting as well.
- Each request writes one log line:
  `{"event":"waitlist","outcome":"…","provider":"…","source":"…","status":"…"}`,
  plus an optional non-email `reason`. Provider error text is scrubbed of anything
  address-shaped before it is logged. Client IPs are never logged.

## Adding a real provider

1. Create `src/lib/waitlist/providers/<name>.ts` exporting a `ProviderFactory`.
2. Register it in `REAL_PROVIDERS` in `providers/index.ts`. The block is marked
   `REAL PROVIDER REGISTRY`.
3. Set `WAITLIST_PROVIDER=<name>` and the adapter's secrets in the server
   environment.

Skeleton for an HTTP API (names are placeholders, not a real service):

```ts
// src/lib/waitlist/providers/example.ts
import type { ProviderOutcome, WaitlistProvider } from "../types";
import type { ProviderFactory } from "./index";
import { createUnconfiguredProvider } from "./unconfigured";

const REQUEST_TIMEOUT_MS = 7000; // stay under the handler's 8 s ceiling

export const createExampleProvider: ProviderFactory = (env) => {
  const apiKey = env.EXAMPLE_API_KEY;
  const listId = env.EXAMPLE_LIST_ID;
  if (!apiKey || !listId) {
    return createUnconfiguredProvider("example: EXAMPLE_API_KEY or EXAMPLE_LIST_ID is not set");
  }

  const provider: WaitlistProvider = {
    id: "example",
    // Must match how the list is really configured at the provider.
    confirmation: env.EXAMPLE_DOUBLE_OPT_IN === "1" ? "double-opt-in" : "none",

    async subscribe({ email, source, signal }): Promise<ProviderOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const stop = () => controller.abort(); // the handler's own timeout
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const res = await fetch(
          `https://api.example.com/v1/lists/${encodeURIComponent(listId)}/subscribers`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ email, tags: [`source:${source}`] }), // email in the body, never the URL
            signal: controller.signal,
          },
        );
        if (res.status === 200 || res.status === 201) {
          return provider.confirmation === "double-opt-in"
            ? { kind: "confirmation_required" }
            : { kind: "accepted" };
        }
        if (res.status === 409) return { kind: "duplicate" };
        // Some APIs answer 400 for "already a member". Check the error code in the body
        // and return { kind: "duplicate" } for that case, or a repeat signup becomes
        // distinguishable from a new one (400 vs 200).
        if (res.status === 400 || res.status === 422) return { kind: "rejected" }; // the address itself was refused
        if (res.status === 429) {
          const retry = Number(res.headers.get("retry-after"));
          return { kind: "rate_limited", retryAfterSeconds: retry > 0 ? retry : undefined };
        }
        // 401/403/5xx are our or their problem, not the visitor's. Log the status only, never the body.
        return { kind: "unavailable", reason: `example: HTTP ${res.status}` };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      }
    },
  };
  return provider;
};
```

Mapping rules for any adapter:

- Return `accepted` or `confirmation_required` only when the provider confirms it
  stored the address. Check the API docs for which status codes mean that.
- Return `rejected` only when the provider says the address is invalid. Auth or
  configuration errors are `unavailable`.
- Return `duplicate` for every "already subscribed" answer, whatever HTTP status
  the provider uses for it.
- Network errors, aborts and thrown exceptions can simply propagate. The handler
  turns them into `503 unavailable`.
- Never put the email in a URL or query string, or in the `reason` text.
- Add unit tests with a mocked `fetch` covering every status mapping.

## Verifying UI states with the test destination

The controlled test destination (`providers/test-destination.ts`) is for testing
the page's states. It is not a waitlist. It keeps an in-memory set of addresses
for the life of the server process, never writes anything to disk, and labels its
responses with `x-waitlist-destination: test-destination`.

```sh
WAITLIST_PROVIDER=test WAITLIST_RATE_LIMIT=100 npm run dev   # allowed in dev
# Built server for preview testing only:
WAITLIST_PROVIDER=test WAITLIST_ALLOW_TEST_PROVIDER=1 node ./dist/server/entry.mjs
```

Pick the outcome with the start of the address's local part (case-insensitive):

| Local part starts with | Outcome | Page should show |
|---|---|---|
| `confirm` | `confirmation_required` (200) | check-your-inbox state |
| `duplicate` | duplicate → 200 `accepted` (or `confirmation_required` in double opt-in mode) | same as a new signup |
| `limit` | `rate_limited` (429, `Retry-After: 30`) | failure state with retry |
| `fail` | `unavailable` (503) | failure state with retry |
| `reject` | `rejected` → 400 `invalid` | field error |
| `slow` | waits 2.5 s, then `accepted` | "Joining…" busy state, then success |
| anything else | `accepted` the first time, duplicate on repeats | success |

Set `WAITLIST_TEST_CONFIRMATION=double-opt-in` to make new signups (and repeats)
answer `confirmation_required`. The default limit of 20 attempts per 10 minutes
per client is easy to hit while clicking through states, so raise
`WAITLIST_RATE_LIMIT` locally. Use `limit@…` to test the 429 state on purpose.
`npm test` runs the handler's unit tests.

## Release checklist

- [ ] Choose the provider. Write and register its adapter, and unit-test its status mapping.
- [ ] Store secrets server-side only, in the host's environment. No `PUBLIC_` prefix, never committed.
- [ ] Decide single or double opt-in. Make the adapter's `confirmation` match the
      list's real setting, and make the page copy match it too.
- [ ] Production has neither `WAITLIST_PROVIDER=test` nor `WAITLIST_ALLOW_TEST_PROVIDER`.
      Responses carry no `x-waitlist-destination` header.
- [ ] Verify persistence end to end with a real address you control: it appears in
      the provider's dashboard, and the confirmation email arrives if double opt-in.
- [ ] Verify duplicates: submit the same address again. You get the same public
      response and no second record.
- [ ] Verify failure: use a wrong API key temporarily. You get a 503, the page
      shows "We couldn't add you yet", and the log names the provider and HTTP
      status with no address.
- [ ] Behind a proxy, `WAITLIST_TRUSTED_PROXY_HOPS` matches the number of proxies
      that append to `X-Forwarded-For`, and the Node port is not reachable from
      outside. With no proxy, it is unset and `security.allowedDomains` is not set.
- [ ] The limiter cannot be dodged with a forged header. Send one attempt more
      than `WAITLIST_RATE_LIMIT` (21 with the default of 20), each with a
      different `X-Forwarded-For`. The address is deliberately invalid, so nothing
      reaches the provider, but each attempt still counts:

      ```sh
      for i in $(seq 1 21); do
        curl -s -o /dev/null -w "%{http_code}\n" https://<your-site>/api/waitlist \
          -H "content-type: application/json" -H "accept: application/json" \
          -H "x-forwarded-for: 10.9.8.$i" -d '{"email":"not-an-address"}'
      done
      ```

      Expect `400` up to the limit, then `429`. All `400`s mean the key is
      forgeable. Then send one attempt from a second network right away. It should
      get `400`, not `429`. A `429` means every visitor shares one bucket.
- [ ] Host logs, analytics and error tracking capture no email (form field, body or URL).
- [ ] `/waitlist/joined/`, `/waitlist/confirm/` and `/waitlist/try-again/` exist for the no-JS path.
- [ ] Approved privacy wording is linked under the form. It names the provider,
      what is stored (email, signup source, time), why (early-access emails), and
      how to unsubscribe or request deletion, with a verified contact address.
