# MCP transport brick 1

This directory holds the pure MCP plumbing for brick 1:

- tool registration
- response-budget helpers
- contact PII allowlisting
- the `get_connector_info` smoke tool

## Local run

Start the web app with a development bearer token:

```bash
MCP_DEV_TOKEN=replace-me pnpm dev:web
```

The Streamable HTTP MCP endpoint is:

```text
http://localhost:3000/api/mcp
```

## Claude Code

Claude Code supports remote HTTP MCP servers plus custom headers. A local setup looks like:

```bash
claude mcp add --transport http as-comms-local http://localhost:3000/api/mcp \
  --header "Authorization: Bearer ${MCP_DEV_TOKEN}"
```

Equivalent `.mcp.json` shape:

```json
{
  "mcpServers": {
    "as-comms-local": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_DEV_TOKEN}"
      }
    }
  }
}
```

## Auth note

`MCP_DEV_TOKEN` is a brick-1-only stopgap for local transport testing. Brick 2 replaces it with OAuth. Do not ship this bearer-token guard to the team as the final auth model.
