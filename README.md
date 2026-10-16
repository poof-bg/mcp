# @poof-bg/mcp

MCP (Model Context Protocol) server for the [Poof](https://poof.bg) [background removal API](https://poof.bg/background-removal-api). Use AI assistants like Claude to remove backgrounds from images and [videos](https://poof.bg/video-background-removal-api).

Migrating from remove.bg? It shuts down on 1 December 2026 — see the [remove.bg alternative and migration guide](https://poof.bg/alternative/remove-bg).

## Features

- **remove_background** - Remove background from images (accepts base64 or URL)
- **remove_video_background** - Remove background from a video by URL: transparent WebM/MOV, green-screen MP4 or alpha matte, audio kept
- **get_job** - Check the status of a video job and get its download link
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

### Claude Code

#### OAuth (recommended)

```bash
claude mcp add --transport http poof https://api.poof.bg/mcp
```

#### API Key

```bash
claude mcp add --transport http poof https://api.poof.bg/mcp \
  --header "x-api-token: YOUR_POOF_API_KEY"
```

### Claude Desktop

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

#### Option 1: Remote with OAuth (recommended)

```json
{
  "mcpServers": {
    "poof": {
      "url": "https://api.poof.bg/mcp"
    }
  }
}
```

#### Option 2: Local (stdio transport)

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

#### Option 3: Remote with API key

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

#### OAuth (recommended)

```json
{
  "mcpServers": {
    "poof": {
      "url": "https://api.poof.bg/mcp"
    }
  }
}
```

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

#### Remote with API key

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

#### OAuth (recommended)

```json
{
  "mcpServers": {
    "poof": {
      "serverUrl": "https://api.poof.bg/mcp"
    }
  }
}
```

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

#### Remote with API key

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

#### OAuth (recommended)

```json
{
  "mcp": {
    "servers": {
      "poof": {
        "url": "https://api.poof.bg/mcp"
      }
    }
  }
}
```

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

#### Remote with API key

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

#### OAuth (recommended)

```json
{
  "poof": {
    "url": "https://api.poof.bg/mcp"
  }
}
```

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

#### Remote with API key

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
| `size` | string | No | Output size preset: `full`, `preview`, `medium`, `hd` (default: `full`). Ignored when `width`/`height` is set |
| `crop` | boolean | No | Crop to subject bounds (default: `false`) |
| `width` | integer | No | Output width in pixels (1-6000). Alone, the height follows the aspect ratio |
| `height` | integer | No | Output height in pixels (1-6000). Alone, the width follows the aspect ratio |
| `fit` | string | No | How to fit into `width` x `height` without stretching: `contain` (default, pad), `cover` (fill, crop the overflow around the subject), `scale-down` (pad, never enlarge) |

**Example prompts:**

```
Remove the background from this image: https://example.com/photo.jpg

Remove the background and add a white background instead

Remove the background and give me a 500x500 image with the product centred
```

### remove_video_background

Remove the background from a video. Pass a public URL; the result is a direct download link that stays valid for 24 hours. Video costs 5 credits per second.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video_url` | string | Yes | Public `https` URL of the video (mp4, mov, webm or mkv; up to 500 MB and 5 minutes) |
| `format` | string | No | Output container: `webm` (VP9, transparent), `mov` (ProRes 4444, transparent), `mp4` (H.264, composited onto `bg_color`) (default: `webm`) |
| `channels` | string | No | `rgba` for transparency, `rgb` for an opaque background, `alpha` for a grayscale matte video (default: `rgba`) |
| `bg_color` | string | No | Background color when the output has no transparency (`rgb` or `mp4`), e.g. `#00ff00` (default: white) |
| `size` | string | No | Output size preset: `full`, `preview` (640), `medium` (1280), `hd` (1920) (default: `full`, capped at 1080p) |
| `wait` | boolean | No | Poll until the job finishes, up to 50 seconds, before returning (default: `true`). Set `false` to get the job id back immediately |

**Example prompts:**

```
Remove the background from this video: https://example.com/clip.mp4

Turn https://example.com/clip.mov into a transparent WebM

Give me a green-screen MP4 of this video and keep the audio
```

**Response:**

```json
{
  "success": true,
  "job": {
    "id": "job_8f3a1c2e9b7d4a10",
    "status": "completed",
    "progress": 1,
    "duration_seconds": 12.4,
    "fps": 29.97,
    "width": 1920,
    "height": 1080,
    "frames": 372,
    "credits": 65,
    "format": "webm",
    "channels": "rgba",
    "result_url": "https://cdn.poof.bg/1d/jobs/job_8f3a1c2e9b7d4a10/result.webm",
    "expires_at": "2026-10-17T10:12:00Z"
  }
}
```

If the job is still running after 50 seconds, `status` is `queued` or `processing`, `result_url` is `null` and a `hint` tells the assistant to call `get_job`.

### get_job

Check a video job started with `remove_video_background`. Polling is free.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `job_id` | string | Yes | The job id (`job_...`) |

**Example prompts:**

```
Is my video done yet?

Check job job_8f3a1c2e9b7d4a10 and give me the download link
```

**Response:** the same `job` object as above; `result_url` is set once `status` is `completed`, and `error` explains a `failed` job (failed jobs are refunded).

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

Set the required environment secrets:

```bash
wrangler secret put POOF_API_KEY
wrangler secret put MCP_JWT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY
```

Also set the dashboard URL variable:

```bash
wrangler secret put DASHBOARD_URL
```

You'll also need to create a KV namespace for OAuth state storage and update the IDs in `wrangler.toml`:

```bash
wrangler kv namespace create OAUTH_KV
wrangler kv namespace create OAUTH_KV --preview
```

## License

MIT

## Links

- [Poof Website](https://poof.bg)
- [API Documentation](https://docs.poof.bg)
- [Dashboard](https://dash.poof.bg)
- [MCP Protocol](https://modelcontextprotocol.io)
