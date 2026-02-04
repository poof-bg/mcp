import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE_URL = 'https://api.poof.bg/v1';

// Helper to detect if string is a URL
function isUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

// Helper to detect if string is base64
function isBase64(str: string): boolean {
  if (str.startsWith('data:')) {
    return true;
  }
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return str.length > 100 && base64Regex.test(str.replace(/\s/g, ''));
}

// Helper to get image buffer from various inputs
async function getImageBuffer(
  image: string
): Promise<{ buffer: Buffer; filename: string }> {
  if (isUrl(image)) {
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const urlPath = new URL(image).pathname;
    const filename = path.basename(urlPath) || 'image.png';
    return { buffer, filename };
  } else if (isBase64(image)) {
    let base64Data = image;
    let extension = 'png';

    if (image.startsWith('data:')) {
      const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        extension = match[1];
        base64Data = match[2];
      }
    }

    const buffer = Buffer.from(base64Data, 'base64');
    return { buffer, filename: `image.${extension}` };
  } else {
    const resolvedPath = path.resolve(image);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    const buffer = fs.readFileSync(resolvedPath);
    const filename = path.basename(resolvedPath);
    return { buffer, filename };
  }
}

// Tool registry
type ToolHandler = (args: any, apiKey: string) => Promise<any>;

const toolRegistry: Record<
  string,
  {
    schema: {
      name: string;
      description: string;
      inputSchema: any;
    };
    handler: ToolHandler;
  }
> = {
  remove_background: {
    schema: {
      name: 'remove_background',
      description:
        'Remove the background from an image. Returns the processed image as base64 or saves to a file.',
      inputSchema: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description:
              'Image input: base64-encoded image data, a URL to an image, or a local file path',
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
          output_path: {
            type: 'string',
            description:
              'Optional: Save the result to this file path instead of returning base64',
          },
        },
        required: ['image'],
      },
    },
    handler: async (args, apiKey) => {
      const { buffer, filename } = await getImageBuffer(args.image);

      const formData = new FormData();
      const blob = new Blob([buffer as unknown as BlobPart], {
        type: 'application/octet-stream',
      });
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

      const response = await fetch(`${API_BASE_URL}/remove`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          (errorBody as { message?: string }).message ||
          `API error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const width = parseInt(response.headers.get('X-Image-Width') || '0', 10);
      const height = parseInt(
        response.headers.get('X-Image-Height') || '0',
        10
      );
      const processingTime = parseInt(
        response.headers.get('X-Processing-Time-Ms') || '0',
        10
      );

      const imageArrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(imageArrayBuffer);

      if (args.output_path) {
        const outputPath = path.resolve(args.output_path);
        fs.writeFileSync(outputPath, imageBuffer);
        return {
          success: true,
          output_path: outputPath,
          width,
          height,
          processing_time_ms: processingTime,
        };
      } else {
        const format = args.format || 'png';
        const mimeType =
          format === 'jpg'
            ? 'image/jpeg'
            : format === 'webp'
              ? 'image/webp'
              : 'image/png';
        const base64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        return {
          success: true,
          data: base64,
          width,
          height,
          processing_time_ms: processingTime,
        };
      }
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
    handler: async (_args, apiKey) => {
      const response = await fetch(`${API_BASE_URL}/me`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          (errorBody as { message?: string }).message ||
          `API error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as {
        organizationId: string;
        plan: string;
        maxCredits: number;
        usedCredits: number;
        autoRechargeThreshold: number | null;
      };

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
  const tool = toolRegistry[name];
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
    { name: 'poof', version: '1.0.0' },
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

    // Handle remove_background with image data specially
    if (req.params.name === 'remove_background' && result.success && result.data && !result.output_path) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              width: result.width,
              height: result.height,
              processing_time_ms: result.processing_time_ms,
              message: 'Background removed successfully. Image data returned as base64.',
            }),
          },
          {
            type: 'image',
            data: result.data.split(',')[1],
            mimeType: result.data.split(';')[0].split(':')[1],
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  return { server };
}
