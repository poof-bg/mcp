import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const API_BASE_URL = 'https://api.poof.bg/v1';

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
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
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
  apiKey: string,
  method: 'GET' | 'POST' = 'GET',
  formData?: FormData
): Promise<Response> {
  console.error(`[MCP] Calling Poof API: ${method} ${path}`);

  const url = method === 'GET' ? buildUrl(path, args) : `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
  };

  let body: BodyInit | undefined;

  if (formData) {
    body = formData;
    // Don't set Content-Type for FormData, fetch will set it with boundary
  } else if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(args);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Poof API Error (${res.status}): ${errorText}`);
    throw new Error(errorText);
  }

  return res;
}

const toolRegistry = {
  remove_background: {
    schema: {
      name: 'remove_background',
      description:
        'Remove the background from an image. Returns the processed image as base64. Accepts URL or base64-encoded image.',
      inputSchema: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description:
              'Image input: base64-encoded image data or a URL to an image',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpg', 'webp'],
            default: 'png',
            description: 'Output image format',
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
            enum: ['full', 'preview', 'small', 'medium', 'large'],
            default: 'full',
            description: 'Output image size preset',
          },
          crop: {
            type: 'boolean',
            default: false,
            description: 'Whether to crop the image to the subject bounds',
          },
        },
        required: ['image'],
      },
    },
    handler: async (args: any, apiKey: string) => {
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

      const response = await callPoofApi('/remove', {}, apiKey, 'POST', formData);

      // Get response metadata
      const width = parseInt(response.headers.get('X-Image-Width') || '0', 10);
      const height = parseInt(response.headers.get('X-Image-Height') || '0', 10);
      const processingTime = parseInt(
        response.headers.get('X-Processing-Time-Ms') || '0',
        10
      );

      // Get image data
      const imageArrayBuffer = await response.arrayBuffer();

      // Convert to base64
      const format = args.format || 'png';
      const mimeType =
        format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      
      // Convert ArrayBuffer to base64
      const bytes = new Uint8Array(imageArrayBuffer);
      let binaryString = '';
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binaryString);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return {
        success: true,
        data: dataUrl,
        width,
        height,
        processing_time_ms: processingTime,
      };
    },
  },

  get_account: {
    schema: {
      name: 'get_account',
      description:
        'Get account information including plan details and credit usage',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args: any, apiKey: string) => {
      const response = await callPoofApi('/me', {}, apiKey, 'GET');
      const data = await response.json();

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

export async function callTool(name: string, args: any, apiKey: string) {
  const tool = (toolRegistry as any)[name];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(args, apiKey);
}

export const configSchema = z.object({
  poofApiKey: z.string(),
  debug: z.boolean().optional(),
});

export function createMcpServer(config: { poofApiKey: string; debug?: boolean }) {
  const server = new Server(
    { name: 'poof', version: '1.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await callTool(
      req.params.name,
      req.params.arguments,
      config.poofApiKey
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
    };
  });

  return { server };
}
