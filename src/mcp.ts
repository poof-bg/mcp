import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { sanitizeClientName } from './client.js';
import { VERSION } from './version.js';

const API_BASE_URL = 'https://api.poof.bg/v1';

// A non-2xx response from the Poof API. Carries the HTTP status and the API's
// `{ code, message, details, request_id, doc_url }` body (when it parses) so the
// failure can be reported to the model as a readable tool result.
export class PoofApiError extends Error {
  status: number;
  body: any;

  constructor(status: number, body: any, rawText: string) {
    super(rawText);
    this.name = 'PoofApiError';
    this.status = status;
    this.body = body;
  }
}

export type Transport = 'hosted' | 'stdio';

// Per-request credentials and identity for calls to the Poof API.
export type RequestContext = {
  apiKey: string;
  userAgent: string;
};

// The User-Agent tells the API's request logs which AI client and transport the
// traffic came from, e.g. "poof-mcp/1.3.0 (Claude-ClaudeAI; hosted)".
export function buildUserAgent(client: string, transport: Transport) {
  return `poof-mcp/${VERSION} (${client}; ${transport})`;
}

// Helper to detect if string is a URL
function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

// Helper to detect if string is base64
function isBase64(str: string): boolean {
  // Check for data URL format
  if (str.startsWith('data:')) {
    return true;
  }
  // Check if it's a valid base64 string (basic check)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return str.length > 100 && base64Regex.test(str.replace(/\s/g, ''));
}

// Helper to get image buffer from various inputs
async function getImageBuffer(
  image: string
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  if (isUrl(image)) {
    // Fetch from URL
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(
        `Could not download the image from the URL (HTTP ${response.status} ${response.statusText}). ` +
          'The URL must point directly to a publicly accessible PNG, JPEG or WebP image.'
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const urlPath = new URL(image).pathname;
    const filename = urlPath.split('/').pop() || 'image.png';
    return { buffer: arrayBuffer, filename };
  } else if (isBase64(image)) {
    // Decode base64
    let base64Data = image;
    let extension = 'png';

    if (image.startsWith('data:')) {
      const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        extension = match[1];
        base64Data = match[2];
      }
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return { buffer: bytes.buffer, filename: `image.${extension}` };
  } else {
    // For file paths, we can't read directly in Cloudflare Worker context
    // This will need to be handled by the caller
    throw new Error(
      'File paths are not supported in remote MCP mode. Please provide a URL or base64-encoded image.'
    );
  }
}

// Build URL with query params for GET requests
function buildUrl(path: string, args?: any): string {
  let url = `${API_BASE_URL}${path}`;
  if (args) {
    const params = new URLSearchParams();
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  return url;
}

// Call Poof API
async function callPoofApi(
  path: string,
  args: any,
  ctx: RequestContext,
  method: 'GET' | 'POST' = 'GET',
  formData?: FormData
): Promise<Response> {
  console.error(`[MCP] Calling Poof API: ${method} ${path}, UA: ${ctx.userAgent}`);

  const url = method === 'GET' ? buildUrl(path, args) : `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'x-api-key': ctx.apiKey,
    'User-Agent': ctx.userAgent,
  };

  let body: BodyInit | undefined;

  if (formData) {
    body = formData;
    // Don't set Content-Type for FormData, fetch will set it with boundary
  } else if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(args);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body,
    });

    if (res.ok) {
      return res;
    }

    const errorText = await res.text();
    console.error(`Poof API Error (${res.status}): ${errorText}`);
    let errorBody: any = null;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      // Non-JSON error body (e.g. an HTML error page) — keep the raw text.
    }
    const err = new PoofApiError(res.status, errorBody, errorText);

    // Rate limits and an unavailable processing service clear quickly, so retry
    // those here instead of handing the failure to the model. Failed requests
    // are not billed. Used-up credits are not retried.
    if (isRetryable(err) && attempt < retryConfig.maxRetries) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    throw err;
  }
}

export const retryConfig = { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 10000 };

// The API sends no Retry-After today; honour it if it ever does.
function retryDelayMs(res: { headers?: Headers }, attempt: number) {
  const retryAfter = Number(res.headers?.get?.('retry-after'));
  const delay = retryAfter > 0
    ? retryAfter * 1000
    : retryConfig.baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.5);
  return Math.min(delay, retryConfig.maxDelayMs);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(err: PoofApiError): string | undefined {
  return err.body?.code;
}

function isRateLimit(err: PoofApiError) {
  return err.status === 429;
}

// upstream_error: the processing service is unreachable (502), temporarily
// unavailable (503) or timed out (504). All three are safe to retry.
function isUpstreamError(err: PoofApiError) {
  return [502, 503, 504].includes(err.status);
}

function isRetryable(err: PoofApiError) {
  return isRateLimit(err) || isUpstreamError(err);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

const toolRegistry = {
  remove_background: {
    schema: {
      name: 'remove_background',
      title: 'Remove Image Background',
      description:
        'Remove the background from an image, leaving the subject on a transparent (or solid color) background. Accepts an image URL or base64-encoded image (PNG, JPEG or WebP, up to 20 MB) and returns the processed image. Can also crop to the subject and resize the result to an exact width x height without stretching (width, height, fit). Costs 1 credit.',
      annotations: {
        title: 'Remove Image Background',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description:
              'Image input: a publicly accessible URL to a PNG, JPEG or WebP image (including https://), or base64-encoded image data (optionally as a data: URL)',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpg', 'webp'],
            default: 'png',
            description: "Output image format. 'jpg' has no transparency",
          },
          channels: {
            type: 'string',
            enum: ['rgba', 'rgb'],
            default: 'rgba',
            description:
              "Output color channels. Use 'rgba' for transparency, 'rgb' for opaque background",
          },
          bg_color: {
            type: 'string',
            description:
              "Background color (hex, rgb, or color name). Only applies when channels is 'rgb'. Example: '#ffffff'",
          },
          size: {
            type: 'string',
            enum: ['full', 'preview', 'medium', 'hd'],
            default: 'full',
            description:
              'Output image size preset (megapixel cap). Ignored when width or height is set',
          },
          crop: {
            type: 'boolean',
            default: false,
            description: 'Whether to crop the image to the subject bounds',
          },
          width: {
            type: 'integer',
            minimum: 1,
            maximum: 6000,
            description:
              'Output width in pixels. On its own, the height follows the aspect ratio. With height, the image is fitted into an exact width x height canvas without stretching',
          },
          height: {
            type: 'integer',
            minimum: 1,
            maximum: 6000,
            description:
              'Output height in pixels. On its own, the width follows the aspect ratio. With width, the image is fitted into an exact width x height canvas without stretching',
          },
          fit: {
            type: 'string',
            enum: ['contain', 'cover', 'scale-down'],
            default: 'contain',
            description:
              "How to fit the image into width x height. 'contain' pads the remaining area (transparent or bg_color), 'cover' fills the canvas and crops the overflow around the subject, 'scale-down' is like contain but never enlarges a smaller image",
          },
        },
        required: ['image'],
      },
    },
    handler: async (args: any, ctx: RequestContext) => {
      const { buffer, filename } = await getImageBuffer(args.image);

      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      formData.append('image_file', blob, filename);

      if (args.format) {
        formData.append('format', args.format);
      }
      if (args.channels) {
        formData.append('channels', args.channels);
      }
      if (args.bg_color) {
        formData.append('bg_color', args.bg_color);
      }
      if (args.size) {
        formData.append('size', args.size);
      }
      if (args.crop !== undefined) {
        formData.append('crop', String(args.crop));
      }
      if (args.width !== undefined) {
        formData.append('width', String(args.width));
      }
      if (args.height !== undefined) {
        formData.append('height', String(args.height));
      }
      if (args.fit) {
        formData.append('fit', args.fit);
      }

      const response = await callPoofApi('/remove', {}, ctx, 'POST', formData);

      // Get response metadata
      const width = parseInt(response.headers.get('X-Image-Width') || '0', 10);
      const height = parseInt(response.headers.get('X-Image-Height') || '0', 10);
      const processingTime = parseInt(
        response.headers.get('X-Processing-Time-Ms') || '0',
        10
      );

      const format = args.format || 'png';
      const mimeType =
        format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

      return {
        image: { data: arrayBufferToBase64(await response.arrayBuffer()), mimeType },
        success: true,
        format,
        width,
        height,
        processing_time_ms: processingTime,
      };
    },
  },

  get_account: {
    schema: {
      name: 'get_account',
      title: 'Get Poof Account',
      description:
        "Get the Poof account's plan and credit usage: maxCredits, usedCredits and remainingCredits for the current billing cycle. Free; use it to check whether there are credits left before processing many images.",
      annotations: {
        title: 'Get Poof Account',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args: any, ctx: RequestContext) => {
      const response = await callPoofApi('/me', {}, ctx, 'GET');
      const data = await response.json() as Record<string, any>;

      return {
        success: true,
        data: {
          ...data,
          remainingCredits: data.maxCredits - data.usedCredits,
        },
      };
    },
  },
};

export function listTools() {
  return Object.values(toolRegistry).map((t) => t.schema);
}

export async function callTool(name: string, args: any, ctx: RequestContext) {
  const tool = (toolRegistry as any)[name];
  if (!Object.prototype.hasOwnProperty.call(toolRegistry, name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  for (const field of tool.schema.inputSchema.required) {
    if (args?.[field] === undefined || args?.[field] === null || args?.[field] === '') {
      throw new Error(`Missing required argument "${field}" for ${name}`);
    }
  }
  return tool.handler(args, ctx);
}

/**
 * Turn a tool's return value into MCP content. A processed image goes out as an
 * image content block, which clients show and models can look at, with the
 * rest of the result as JSON text. Base64 image data inside the JSON text would
 * only fill the model's context.
 */
export function toolResultContent(result: any) {
  if (result && typeof result === 'object' && result.image?.data) {
    const { image, ...rest } = result;
    return [
      { type: 'image' as const, data: image.data as string, mimeType: image.mimeType as string },
      { type: 'text' as const, text: JSON.stringify(rest) },
    ];
  }
  return [{ type: 'text' as const, text: JSON.stringify(result) }];
}

/**
 * Turn a failed tool call into a tool result with `isError: true`.
 *
 * MCP distinguishes protocol errors (malformed request, unknown tool) from tool
 * execution errors. Throwing from a CallTool handler on the low-level `Server`
 * produces a JSON-RPC error, which clients count as a failed request and the
 * model cannot read. API failures (invalid image, credits used up, rate limited)
 * are tool execution errors: return them as content so the model can react.
 */
export function toolErrorResult(err: unknown) {
  let text: string;

  if (err instanceof PoofApiError) {
    const body = err.body;
    const code = body?.code ? ` ${body.code}` : '';
    const details =
      body?.details && typeof body.details === 'object'
        ? JSON.stringify(body.details)
        : body?.details;
    const parts = [body?.message, details].filter(Boolean);
    const summary = parts.length ? parts.join(': ') : err.message || 'Request failed';
    text = `Poof API error (HTTP ${err.status}${code}): ${summary}`;
    const hint = errorHint(err);
    if (hint) {
      text += `\n${hint}`;
    }
    if (body?.doc_url) {
      text += `\nDocumentation: ${body.doc_url}`;
    }
    if (body?.request_id) {
      text += `\nRequest ID: ${body.request_id}`;
    }
  } else {
    const message = err instanceof Error ? err.message : String(err);
    text = `Poof request failed: ${message}`;
  }

  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}

// Tell the model whether retrying can help, so agents working through a list of
// images stop on terminal errors instead of repeating them.
function errorHint(err: PoofApiError): string | undefined {
  const code = errorCode(err);
  if (err.status === 402 || code === 'payment_required') {
    return (
      "The Poof account's monthly credits are used up. Do not retry, and do not process " +
      'other images: they will fail the same way. Tell the user to top up, enable Auto ' +
      'Recharge or upgrade at https://dash.poof.bg, or wait for the next billing cycle.'
    );
  }
  if (isRateLimit(err)) {
    return (
      "The plan's per-minute rate limit was exceeded (already retried). Process images one " +
      'at a time, not in parallel, and wait about 15 seconds before retrying.'
    );
  }
  if (isUpstreamError(err)) {
    return 'The processing service is temporarily unavailable (already retried). Wait a minute before retrying.';
  }
  if (err.status === 401) {
    return 'The Poof API key is invalid. Do not retry; the user needs to reconnect Poof or fix the key.';
  }
  if (err.status === 403) {
    return (
      "This feature is not available on the user's Poof plan. Do not retry; tell the user " +
      'it requires an upgrade at https://dash.poof.bg.'
    );
  }
  if (code === 'image_too_large' || err.status === 413) {
    return 'The image is larger than 20 MB. Do not retry the same image; use a smaller or compressed one.';
  }
  if (code === 'invalid_image' || err.status === 422) {
    return 'Only PNG, JPEG and WebP images are supported. Do not retry the same image.';
  }
  if (code === 'validation_error') {
    return 'A parameter value was rejected. Fix the parameter named in the error before retrying.';
  }
  if (code === 'processing_failed') {
    return 'Processing failed for this image. Do not retry it unchanged; try a different image or format.';
  }
  return undefined;
}

export const configSchema = z.object({
  poofApiKey: z.string(),
  debug: z.boolean().optional(),
});

export function createMcpServer(config: {
  poofApiKey: string;
  debug?: boolean;
  // AI client making the requests (see detectClient). When unset, the name the
  // client sent in its MCP initialize request is used.
  client?: string;
  transport?: Transport;
}) {
  const server = new Server(
    { name: 'poof', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (!Object.prototype.hasOwnProperty.call(toolRegistry, name)) {
      // Unknown tool is a protocol error per the MCP spec.
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }

    const client =
      config.client ?? sanitizeClientName(server.getClientVersion()?.name) ?? 'unknown';
    const ctx: RequestContext = {
      apiKey: config.poofApiKey,
      userAgent: buildUserAgent(client, config.transport ?? 'stdio'),
    };

    let result;
    try {
      result = await callTool(name, req.params.arguments ?? {}, ctx);
    } catch (err) {
      return toolErrorResult(err);
    }

    return { content: toolResultContent(result) };
  });

  return { server };
}
