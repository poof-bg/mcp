#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

const API_BASE_URL = "https://api.poof.bg/v1";

// Get API key from environment
function getApiKey(): string {
  const apiKey = process.env.POOF_API_KEY;
  if (!apiKey) {
    throw new Error(
      "POOF_API_KEY environment variable is required. Get your API key at https://dash.poof.bg"
    );
  }
  return apiKey;
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "remove_background",
    description:
      "Remove the background from an image. Returns the processed image as base64 or saves to a file.",
    inputSchema: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description:
            "Image input: base64-encoded image data, a URL to an image, or a local file path",
        },
        format: {
          type: "string",
          enum: ["png", "jpg", "webp"],
          default: "png",
          description: "Output image format",
        },
        channels: {
          type: "string",
          enum: ["rgba", "rgb"],
          default: "rgba",
          description:
            "Output color channels. Use 'rgba' for transparency, 'rgb' for opaque background",
        },
        bg_color: {
          type: "string",
          description:
            "Background color (hex, rgb, or color name). Only applies when channels is 'rgb'. Example: '#ffffff'",
        },
        size: {
          type: "string",
          enum: ["full", "preview", "small", "medium", "large"],
          default: "full",
          description: "Output image size preset",
        },
        crop: {
          type: "boolean",
          default: false,
          description: "Whether to crop the image to the subject bounds",
        },
        output_path: {
          type: "string",
          description:
            "Optional: Save the result to this file path instead of returning base64",
        },
      },
      required: ["image"],
    },
  },
  {
    name: "get_account",
    description:
      "Get account information including plan details and credit usage",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Helper to detect if string is a URL
function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

// Helper to detect if string is base64
function isBase64(str: string): boolean {
  // Check for data URL format
  if (str.startsWith("data:")) {
    return true;
  }
  // Check if it's a valid base64 string (basic check)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return str.length > 100 && base64Regex.test(str.replace(/\s/g, ""));
}

// Helper to get image buffer from various inputs
async function getImageBuffer(
  image: string
): Promise<{ buffer: Buffer; filename: string }> {
  if (isUrl(image)) {
    // Fetch from URL
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const urlPath = new URL(image).pathname;
    const filename = path.basename(urlPath) || "image.png";
    return { buffer, filename };
  } else if (isBase64(image)) {
    // Decode base64
    let base64Data = image;
    let extension = "png";

    if (image.startsWith("data:")) {
      const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        extension = match[1];
        base64Data = match[2];
      }
    }

    const buffer = Buffer.from(base64Data, "base64");
    return { buffer, filename: `image.${extension}` };
  } else {
    // Treat as file path
    const resolvedPath = path.resolve(image);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    const buffer = fs.readFileSync(resolvedPath);
    const filename = path.basename(resolvedPath);
    return { buffer, filename };
  }
}

// Remove background API call
async function removeBackground(args: {
  image: string;
  format?: string;
  channels?: string;
  bg_color?: string;
  size?: string;
  crop?: boolean;
  output_path?: string;
}): Promise<{
  success: boolean;
  data?: string;
  output_path?: string;
  width?: number;
  height?: number;
  processing_time_ms?: number;
  error?: string;
}> {
  const apiKey = getApiKey();

  // Get image buffer
  const { buffer, filename } = await getImageBuffer(args.image);

  // Build form data
  const formData = new FormData();
  const blob = new Blob([buffer as unknown as BlobPart], { type: "application/octet-stream" });
  formData.append("image_file", blob, filename);

  if (args.format) {
    formData.append("format", args.format);
  }
  if (args.channels) {
    formData.append("channels", args.channels);
  }
  if (args.bg_color) {
    formData.append("bg_color", args.bg_color);
  }
  if (args.size) {
    formData.append("size", args.size);
  }
  if (args.crop !== undefined) {
    formData.append("crop", String(args.crop));
  }

  // Make API request
  const response = await fetch(`${API_BASE_URL}/remove`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage =
      (errorBody as { message?: string }).message ||
      `API error: ${response.status} ${response.statusText}`;
    return { success: false, error: errorMessage };
  }

  // Get response metadata
  const width = parseInt(response.headers.get("X-Image-Width") || "0", 10);
  const height = parseInt(response.headers.get("X-Image-Height") || "0", 10);
  const processingTime = parseInt(
    response.headers.get("X-Processing-Time-Ms") || "0",
    10
  );

  // Get image data
  const imageArrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(imageArrayBuffer);

  // Either save to file or return as base64
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
    const format = args.format || "png";
    const mimeType =
      format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const base64 = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    return {
      success: true,
      data: base64,
      width,
      height,
      processing_time_ms: processingTime,
    };
  }
}

// Get account info API call
async function getAccount(): Promise<{
  success: boolean;
  data?: {
    organizationId: string;
    plan: string;
    maxCredits: number;
    usedCredits: number;
    remainingCredits: number;
    autoRechargeThreshold: number | null;
  };
  error?: string;
}> {
  const apiKey = getApiKey();

  const response = await fetch(`${API_BASE_URL}/me`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage =
      (errorBody as { message?: string }).message ||
      `API error: ${response.status} ${response.statusText}`;
    return { success: false, error: errorMessage };
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
}

// Main server setup
async function main() {
  const server = new Server(
    {
      name: "poof-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "remove_background": {
          const typedArgs = args as {
            image: string;
            format?: string;
            channels?: string;
            bg_color?: string;
            size?: string;
            crop?: boolean;
            output_path?: string;
          };

          if (!typedArgs.image) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: "The 'image' parameter is required",
                  }),
                },
              ],
            };
          }

          const result = await removeBackground(typedArgs);

          if (result.success && result.data && !result.output_path) {
            // Return image as embedded content
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    width: result.width,
                    height: result.height,
                    processing_time_ms: result.processing_time_ms,
                    message:
                      "Background removed successfully. Image data returned as base64.",
                  }),
                },
                {
                  type: "image",
                  data: result.data.split(",")[1], // Remove data URL prefix
                  mimeType: result.data.split(";")[0].split(":")[1],
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_account": {
          const result = await getAccount();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Unknown tool: ${name}`,
                }),
              },
            ],
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: errorMessage,
            }),
          },
        ],
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("Poof MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
