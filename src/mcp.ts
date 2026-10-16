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


const JOB_POLL_INTERVAL_MS = 3000;
const JOB_WAIT_MAX_MS = 50000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJob(jobId: string, apiKey: string): Promise<Record<string, any>> {
  const response = await callPoofApi(`/jobs/${encodeURIComponent(jobId)}`, {}, apiKey, 'GET');
  return (await response.json()) as Record<string, any>;
}

function jobResult(job: Record<string, any>) {
  const done = job.status === 'completed' || job.status === 'failed';
  return {
    success: job.status !== 'failed',
    job,
    ...(done
      ? {}
      : {
          hint: `The video is still ${job.status}. Call get_job with job_id "${job.id}" to check again; result_url is set once the status is completed.`,
        }),
  };
}

const toolRegistry = {
  remove_background: {
    schema: {
      name: 'remove_background',
      description:
        'Remove the background from an image. Returns the processed image as base64. Accepts URL or base64-encoded image. Can also resize the result to an exact width x height without stretching (width, height, fit).',
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
    handler: async (args: any, apiKey: string) => {
      const { buffer, filename } = await getImageBuffer(args.image);

      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      formData.append('file', blob, filename);

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

  remove_video_background: {
    schema: {
      name: 'remove_video_background',
      description:
        'Remove the background from a video given by public URL. Returns a job; when wait is true (default) the tool polls for up to 50 seconds and returns the finished job with result_url (a direct download link valid for 24 hours). For longer videos call get_job with the returned job id until status is completed. Costs 5 credits per second of video.',
      inputSchema: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description:
              'Public https URL of the video (mp4, mov, webm or mkv; up to 500 MB and 5 minutes)',
          },
          format: {
            type: 'string',
            enum: ['webm', 'mov', 'mp4'],
            default: 'webm',
            description:
              "Output container. 'webm' (VP9) and 'mov' (ProRes 4444) keep transparency; 'mp4' (H.264) has no alpha and is composited onto bg_color",
          },
          channels: {
            type: 'string',
            enum: ['rgba', 'rgb', 'alpha'],
            default: 'rgba',
            description:
              "'rgba' for a transparent video, 'rgb' for an opaque video on bg_color, 'alpha' for a grayscale matte video (no audio)",
          },
          bg_color: {
            type: 'string',
            description:
              "Background color (hex, rgb, or color name) used when the output has no transparency (channels 'rgb' or format 'mp4'). Defaults to white. Example: '#00ff00' for green screen",
          },
          size: {
            type: 'string',
            enum: ['full', 'preview', 'medium', 'hd'],
            default: 'full',
            description:
              'Output size preset. The longest side is capped at 640 (preview), 1280 (medium) or 1920 (hd/full) pixels',
          },
          wait: {
            type: 'boolean',
            default: true,
            description:
              'Poll until the job finishes (up to 50 seconds) before returning. Set to false to get the job id back immediately',
          },
        },
        required: ['video_url'],
      },
    },
    handler: async (args: any, apiKey: string) => {
      if (typeof args.video_url !== 'string' || !args.video_url.startsWith('https://')) {
        throw new Error('video_url must be a public https:// URL');
      }

      const formData = new FormData();
      formData.append('url', args.video_url);
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

      const response = await callPoofApi('/remove', {}, apiKey, 'POST', formData);
      if (response.status !== 202) {
        throw new Error(
          `Expected a video job (202) but the API returned ${response.status}. Is video_url a video?`
        );
      }
      let job = (await response.json()) as Record<string, any>;

      if (args.wait !== false) {
        const deadline = Date.now() + JOB_WAIT_MAX_MS;
        while (job.status !== 'completed' && job.status !== 'failed' && Date.now() < deadline) {
          await sleep(Math.min(JOB_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
          job = await fetchJob(job.id, apiKey);
        }
      }

      return jobResult(job);
    },
  },

  get_job: {
    schema: {
      name: 'get_job',
      description:
        'Get the status of a video background removal job started with remove_video_background. Polling is free. When status is completed the job carries result_url, a direct download link valid for 24 hours.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: {
            type: 'string',
            description: 'Job id returned by remove_video_background (starts with job_)',
          },
        },
        required: ['job_id'],
      },
    },
    handler: async (args: any, apiKey: string) => {
      if (typeof args.job_id !== 'string' || !args.job_id) {
        throw new Error('job_id is required');
      }
      return jobResult(await fetchJob(args.job_id, apiKey));
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
    { name: 'poof', version: '1.3.0' },
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
