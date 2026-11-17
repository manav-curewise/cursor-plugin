# CureWise — Cursor Plugin

A **Cursor-only** plugin repo for the CureWise MCP server. It uses the
single-plugin layout Cursor's marketplace import expects (`.cursor-plugin/plugin.json`
at the repo root), so there is no multi-plugin `marketplace.json` and no
ambiguous `source` field to get wrong.

This repo intentionally does **not** try to also serve Claude Code / Codex —
those have their own repos (`curewise-claude-plugin`, `codex-plugin`) with
their own manifest conventions. Mixing all three in one root is what caused
the previous marketplace import to fail.

## Why this repo exists

The old `curewise-plugin` repo put `.cursor-plugin/marketplace.json` at the
root with a single entry `"source": "./"`. Cursor's importer expects either:

- a **single-plugin repo**: `.cursor-plugin/plugin.json` at the repo root
  (what this repo does), or
- a **multi-plugin repo**: `.cursor-plugin/marketplace.json` at the root,
  with each plugin in its own subfolder and `"source"` as a bare folder name
  (e.g. `"curewise"`, not `"./curewise"`).

Since there is only one plugin, the single-plugin layout is simpler and
avoids the `source: "./"` / `source: "."` failure mode entirely.

## Structure

```text
cursor-plugin/
├── .cursor-plugin/
│   └── plugin.json       # Required Cursor Plugin manifest
├── mcp.json               # CureWise MCP server (OAuth, no API key needed)
├── skills/
│   ├── curewise/SKILL.md
│   ├── clinical-trials/SKILL.md
│   ├── health-records/SKILL.md
│   ├── cross-check/SKILL.md
│   └── documents/SKILL.md
├── assets/
│   └── logo.png
├── scripts/
│   └── validate.mjs       # Structural check, no deps/network required
└── LICENSE
```

## Authentication: OAuth, not API keys

`mcp.json` points at the hosted MCP endpoint with no `headers` and no
`variables` in `plugin.json`:

```json
{
  "mcpServers": {
    "curewise": {
      "url": "https://app.curewise.com/api/mcp"
    }
  }
}
```

This works because `app.curewise.com` already implements the full OAuth 2.1
flow Cursor expects for remote MCP servers, with **no plugin-side
configuration required**:

1. Cursor calls `POST https://app.curewise.com/api/mcp` with no `Authorization`
   header and gets `401` with:
   `WWW-Authenticate: Bearer resource_metadata="https://app.curewise.com/.well-known/oauth-protected-resource"`
2. Cursor fetches that protected-resource document (RFC 9728), which points
   at `https://app.curewise.com` as the authorization server.
3. Cursor fetches `https://app.curewise.com/.well-known/oauth-authorization-server`
   (RFC 8414) to learn the `authorization_endpoint`, `token_endpoint`, and
   `registration_endpoint`.
4. Cursor dynamically registers itself as an OAuth client
   (`POST /api/oauth/register`, RFC 7591) using its own redirect URIs
   (`https://www.cursor.com/agents/mcp/oauth/callback` for web/Agents,
   `http://localhost:8787/callback` for desktop).
5. Cursor opens `/oauth/authorize` in the browser. The user logs in to
   CureWise (if needed) and approves the connection.
6. Cursor exchanges the authorization code for an access token via
   `POST /api/oauth/token` (PKCE, S256).
7. Cursor sends that token as `Authorization: Bearer <token>` on every MCP
   call from then on, refreshing/re-authenticating as needed.

No `CLIENT_ID`/`CLIENT_SECRET` (`auth` block) is needed in `mcp.json` because
the server supports **dynamic client registration** — static credentials are
only required for providers that don't support DCR.

If you ever need to point this at a different environment (staging, a
tunnel, etc.), just change the `url` in `mcp.json`; the issuer/endpoints are
derived from the request host on the server side, so OAuth discovery follows
automatically.

Manual API keys (`https://app.curewise.com/me/api-keys`) still work as a
fallback for clients that don't support OAuth, but Cursor users should never
need one.

## Installing locally for testing

1. In Cursor: **Settings → Plugins → Add Marketplace** (or team marketplace
   equivalent) and point it at this repo.
2. Install the `curewise` plugin.
3. Cursor should immediately prompt an OAuth sign-in/consent flow in the
   browser — confirm you land on `app.curewise.com`'s consent screen, approve
   it, and get redirected back.
4. Ask the agent something that needs a CureWise tool (e.g. "list my saved
   clinical trials") to confirm the MCP connection is live.

## Validating the repo shape

```bash
node scripts/validate.mjs
```

This checks `.cursor-plugin/plugin.json`, skill frontmatter, `mcp.json`
server entries, and the logo path — no dependencies, no network calls.

## Publishing

- Cursor marketplace: [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish)
- Submission checklist: see [Cursor's plugin reference](https://cursor.com/docs/reference/plugins#submitting-a-plugin)

## Security and privacy

- Privacy policy: `https://curewise.com/privacy`
- Terms of service: `https://curewise.com/terms`
- Support: `support@curewise.com`

This repository never stores real credentials. OAuth tokens are minted
per-user at install/consent time and are never committed to this repo.
