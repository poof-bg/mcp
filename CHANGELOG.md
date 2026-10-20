# Changelog

## [Unreleased]

## [1.5.1] - 2026-10-20

### Fixed

- The `remove_video_background` description states the full video rate:
  5 credits per second, 10 per second above 30 fps
- A 402 for a video that costs more than the credits left (`details.credits_required`)
  no longer tells the model the credits are used up: it says images and shorter
  clips may still work
- The video input formats list m4v; the README feature list includes GIF output

## [1.5.0] - 2026-10-20

### Added

- `remove_video_background` accepts `format: "gif"` (looping GIF with 1-bit
  transparency, no audio, capped at 720p and 50 fps; use `size: "preview"` for
  sticker-sized output) and animated GIF URLs as input
- The `full` size preset documents 4K output (4096 px on the longest side)

### Changed

- The worker is deployed to Cloudflare automatically on every push to `main`

## [1.4.0] - 2026-10-19

### Added

- `remove_video_background` and `get_job` tools: submit a video by URL, poll
  the job and return the `result_url`
- `remove_background` uploads as `file` (the API's primary field name)

### Changed

- `remove_video_background`: the `full` size preset (default) now keeps the
  source resolution up to 4K (4096 px on the longest side) instead of 1080p

## [1.3.0] - 2026-10-19

### Added

- Every tool has a `title` and MCP tool annotations (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`), as required by the
  Claude connector directory and the ChatGPT app directory
- Requests to the Poof API send a `User-Agent` of the form
  `poof-mcp/<version> (<client>; <transport>)`, so API usage can be attributed
  to the AI client that made it. On the hosted server the client comes from the
  request headers (Claude, ChatGPT, Codex, Claude Code, Cursor), then the OAuth
  client's registered name, then the User-Agent's product name; over stdio it is
  the name the MCP client sends when it connects
- The OAuth authorize redirect to the dashboard includes a `client` parameter
  with the OAuth client's registered name, when known
- The hosted server answers `/.well-known/openai-apps-challenge` with the
  `OPENAI_APPS_CHALLENGE_TOKEN` var, for ChatGPT app domain verification
- Failed `/oauth/token` requests are logged as `[OAuth Token Error]` with the
  error, grant type, client name and age, and whether the grant still exists;
  `[OAuth Error]` lines name the provider's internal reason
- Tests (Jest) for the tools, the stdio transport and the OAuth flow, and a CI
  workflow that builds, lints and tests pull requests

### Changed

- `remove_background` returns the processed image as an MCP `image` content
  block plus a text block with `success`, `format`, `width`, `height` and
  `processing_time_ms`, instead of a JSON text block with a base64 data URL in
  `data`. Clients can show the image, and the model's context is no longer
  filled with base64 text
- Hosted server OAuth: a connection no longer expires a fixed time after login.
  Every token refresh extends it to 30 days ahead, so it lasts as long as the
  client uses it and expires after 30 days without use. This also applies to
  connections made before the deploy, from their next refresh
- `@cloudflare/workers-oauth-provider` upgraded from 0.1.0 to 1.2.3. Existing
  connections and registered clients keep working without logging in again.
  Authorization requests from public clients must use S256 PKCE, and an
  authorization error found after the redirect URI is validated (such as
  missing PKCE) is sent back to the client's redirect URI instead of a 400
- Discovery documents are sent with `Cache-Control: public, max-age=3600`
- Fuller tool and input descriptions, including supported formats and credit
  cost
- The MCP server reports the package version instead of a hard-coded one
- The npm package ships only the compiled `dist/` output (plus README)

### Fixed

- Failed tool calls (invalid image, credits used up, rate limit, upstream
  errors, network failures, an image URL that cannot be downloaded) are returned
  as tool results with `isError: true` and a readable message (HTTP status,
  error code, details, documentation link, request ID) instead of JSON-RPC
  protocol errors that clients counted as failed requests and the model could
  not read. The message says whether retrying can help
- Rate limits (429) and temporary processing errors (502/503/504) are retried
  up to twice with backoff before being reported. Used-up credits (402) are not
  retried, and the error tells the model not to process more images
- Missing required arguments are reported as a tool error instead of calling the
  API with `undefined`
- The stdio server starts when invoked through the npm bin symlink
  (`npx -y @poof-bg/mcp`, global installs); previously the entry-point check
  only matched a direct `node dist/index.js` invocation
- Clear "POOF_API_KEY is required" error instead of a raw validation stack
- The stdio server writes logs to stderr only, so stdout stays JSON-RPC. An
  ESLint `no-console` rule and a test that drives the stdio server keep it so
- Hosted server OAuth: path-aware discovery URLs
  (`/.well-known/oauth-protected-resource/mcp`,
  `/.well-known/oauth-authorization-server/mcp`) are served by the worker, and
  `/.well-known/openid-configuration` returns 404. The `/mcp` protected resource
  document names `https://api.poof.bg/mcp` as its resource (RFC 9728 §3.3)
- A token request without a `resource` parameter no longer fails with a 500
  (the request body was read twice)
- An authorization request with an unknown `client_id` or unregistered
  `redirect_uri` returns a 400 OAuth error instead of a 500
- A pending authorization lasts 1 hour instead of 10 minutes, so a new user can
  sign up and verify their email before connecting
- `/mcp` 401 responses carry `error="invalid_token"` and `resource_metadata` in
  `WWW-Authenticate`
