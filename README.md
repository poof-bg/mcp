# @poof-bg/mcp

MCP (Model Context Protocol) server for the [Poof](https://poof.bg) background removal API. Use AI assistants like Claude to remove backgrounds from images.

## Features

- **remove_background** - Remove background from images (accepts base64 or URL)
- **get_account** - Check your account info and credit balance
- Supports both **stdio** (local) and **HTTP** (remote/Cloudflare Worker) transports

## Installation

### Local (stdio transport)

```bash
npm install -g @poof-bg/mcp
```

Or install locally:

```bash
git clone https://github.com/poof-bg/mcp.git
cd mcp
npm install
npm run build
```

### Remote (HTTP transport via Cloudflare Worker)

The Poof MCP server can be deployed as a Cloudflare Worker, allowing remote access via HTTP.

## Configuration

### Environment Variable

Set your Poof API key:

```bash
export POOF_API_KEY=your_api_key_here
```

Get your API key at [dash.poof.bg](https://dash.poof.bg)

### Claude Code (HTTP Transport)

```bash
claude mcp add --transport http poof https://api.poof.bg/mcp \
  --header "x-api-token: YOUR_POOF_API_KEY"
```

### Claude Desktop

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

#### Option 1: Local (stdio transport)

```json
{
  "mcpServers": {
    "poof": {
      "command": "npx",
      "args": ["-y", "@poof-bg/mcp"],
      "env": {
        "POOF_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Option 2: Remote (HTTP transport)

```json
{
  "mcpServers": {
    "poof": {
      "url": "https://api.poof.bg/mcp",
      "headers": {
        "x-api-token": "YOUR_POOF_API_KEY"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root (or global config):

#### Local (stdio)

```json
{
  "mcpServers": {
    "poof": {
      "command": "npx",
      "args": ["-y", "@poof-bg/mcp"],
      "env": {
        "POOF_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Remote (HTTP)

```json
{
  "mcpServers": {
    "poof": {
      "url": "https://api.poof.bg/mcp",
      "headers": {
        "x-api-token": "YOUR_POOF_API_KEY"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

#### Local (stdio)

```json
{
  "mcpServers": {
    "poof": {
      "command": "npx",
      "args": ["-y", "@poof-bg/mcp"],
      "env": {
        "POOF_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Remote (HTTP)

```json
{
  "mcpServers": {
    "poof": {
      "serverUrl": "https://api.poof.bg/mcp",
      "headers": {
        "x-api-token": "YOUR_POOF_API_KEY"
      }
    }
  }
}
```

### VS Code + Copilot

Add to your VS Code `settings.json`:

#### Local (stdio)

```json
{
  "mcp": {
    "servers": {
      "poof": {
        "command": "npx",
        "args": ["-y", "@poof-bg/mcp"],
        "env": {
          "POOF_API_KEY": "your_api_key_here"
        }
      }
    }
  }
}
```

#### Remote (HTTP)

```json
{
  "mcp": {
    "servers": {
      "poof": {
        "url": "https://api.poof.bg/mcp",
        "headers": {
          "x-api-token": "YOUR_POOF_API_KEY"
        }
      }
    }
  }
}
```

### Cline (VS Code Extension)

Open Cline settings and add to the MCP Servers configuration:

#### Local (stdio)

```json
{
  "poof": {
    "command": "npx",
    "args": ["-y", "@poof-bg/mcp"],
    "env": {
      "POOF_API_KEY": "your_api_key_here"
    }
  }
}
```

#### Remote (HTTP)

```json
{
  "poof": {
    "url": "https://api.poof.bg/mcp",
    "headers": {
      "x-api-token": "YOUR_POOF_API_KEY"
    }
  }
}
```

---

## Tools

### remove_background

Remove the background from an image.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | string | Yes | Base64-encoded image or URL to an image |
| `format` | string | No | Output format: `png`, `jpg`, `webp` (default: `png`) |
| `channels` | string | No | Color channels: `rgba` for transparency, `rgb` for opaque (default: `rgba`) |
| `bg_color` | string | No | Background color when using `rgb` channels (e.g., `#ffffff`) |
| `size` | string | No | Output size: `full`, `preview`, `small`, `medium`, `large` (default: `full`) |
| `crop` | boolean | No | Crop to subject bounds (default: `false`) |

**Example prompts:**

```
Remove the background from this image: https://example.com/photo.jpg

Remove the background and add a white background instead
```

### get_account

Get your account information and credit balance.

**Example prompts:**

```
Check my Poof account balance

How many credits do I have left?
```

**Response:**

```json
{
  "success": true,
  "data": {
    "organizationId": "org_abc123",
    "plan": "Pro",
    "maxCredits": 5000,
    "usedCredits": 1234,
    "remainingCredits": 3766,
    "autoRechargeThreshold": 100
  }
}
```

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in dev mode (Cloudflare Worker)
npm run dev

# Run locally (stdio mode)
POOF_API_KEY=your_key npm start

# Lint
npm run lint

# Format
npm run format
```

## Deployment (Cloudflare Worker)

To deploy the MCP server as a Cloudflare Worker:

```bash
# Install Wrangler if you haven't already
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
wrangler deploy
```

Make sure to set your `POOF_API_KEY` in the Cloudflare Worker environment variables:

```bash
wrangler secret put POOF_API_KEY
```

## License

MIT

## Links

- [Poof Website](https://poof.bg)
- [API Documentation](https://docs.poof.bg)
- [Dashboard](https://dash.poof.bg)
- [MCP Protocol](https://modelcontextprotocol.io)
