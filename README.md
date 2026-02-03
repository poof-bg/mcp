# @poof/mcp-server

MCP (Model Context Protocol) server for the [Poof](https://poof.bg) background removal API. Use AI assistants like Claude to remove backgrounds from images.

## Features

- **remove_background** - Remove background from images (accepts base64, URL, or file path)
- **get_account** - Check your account info and credit balance

## Installation

```bash
npm install -g @poof/mcp-server
```

Or install locally:

```bash
git clone https://github.com/poof-bg/poof-sdks.git
cd poof-sdks/mcp-server
npm install
npm run build
```

## Configuration

### Environment Variable

Set your Poof API key:

```bash
export POOF_API_KEY=your_api_key_here
```

Get your API key at [dash.poof.bg](https://dash.poof.bg)

### Claude Desktop

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "poof": {
      "command": "npx",
      "args": ["-y", "@poof/mcp-server"],
      "env": {
        "POOF_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "poof": {
      "command": "node",
      "args": ["/path/to/poof-sdks/mcp-server/dist/index.js"],
      "env": {
        "POOF_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tools

### remove_background

Remove the background from an image.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | string | Yes | Base64-encoded image, URL, or file path |
| `format` | string | No | Output format: `png`, `jpg`, `webp` (default: `png`) |
| `channels` | string | No | Color channels: `rgba` for transparency, `rgb` for opaque (default: `rgba`) |
| `bg_color` | string | No | Background color when using `rgb` channels (e.g., `#ffffff`) |
| `size` | string | No | Output size: `full`, `preview`, `small`, `medium`, `large` (default: `full`) |
| `crop` | boolean | No | Crop to subject bounds (default: `false`) |
| `output_path` | string | No | Save result to file instead of returning base64 |

**Example prompts:**

```
Remove the background from this image: https://example.com/photo.jpg

Remove the background from /Users/me/photos/headshot.png and save it to /Users/me/photos/headshot-nobg.png

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

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run
npm start
```

## License

MIT

## Links

- [Poof Website](https://poof.bg)
- [API Documentation](https://docs.poof.bg)
- [Dashboard](https://dash.poof.bg)
- [MCP Protocol](https://modelcontextprotocol.io)
