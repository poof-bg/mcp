import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildUserAgent, callTool, createMcpServer, jobPollConfig, listTools, retryConfig } from './mcp.js';
import { detectClient, resolveClient, sanitizeClientName } from './client.js';
import { VERSION } from './version.js';

const API_KEY = 'test-api-key';
const CTX = { apiKey: API_KEY, userAgent: buildUserAgent('test-client', 'hosted') };
const IMAGE_URL = 'https://example.com/photo.jpg';
const VIDEO_URL = 'https://example.com/clip.mp4';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// A fetch stub for the two calls remove_background makes: downloading the
// input image, then POST /remove
function imageFetch(removeResponse: () => any) {
  return async (input: string) => {
    if (input === IMAGE_URL) {
      return { ok: true, arrayBuffer: async () => PNG_BYTES.buffer };
    }
    return removeResponse();
  };
}

function processedImage() {
  return {
    ok: true,
    headers: new Headers({
      'X-Image-Width': '640',
      'X-Image-Height': '480',
      'X-Processing-Time-Ms': '321',
    }),
    arrayBuffer: async () => PNG_BYTES.buffer,
  };
}

function errorResponse(status: number, body: string) {
  return { ok: false, status, headers: new Headers(), text: async () => body };
}

function apiError(status: number, code: string, message: string, details?: unknown) {
  return errorResponse(
    status,
    JSON.stringify({
      code,
      message,
      ...(details ? { details } : {}),
      request_id: 'req_123',
      doc_url: `https://docs.poof.bg/errors/${code.replace(/_/g, '-')}`,
    })
  );
}

describe('mcp tool registry', () => {
  let fetchMock: jest.Mock<any>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = jest.fn(imageFetch(processedImage)) as any;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  test('lists the four tools', () => {
    expect(listTools().map((t) => t.name).sort()).toEqual([
      'get_account',
      'get_job',
      'remove_background',
      'remove_video_background',
    ]);
  });

  test('every tool has a title and read-only/destructive annotations', () => {
    for (const tool of listTools()) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations.title).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
    }
  });

  test('every tool is read-only and non-destructive', () => {
    for (const tool of listTools()) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  test('every tool input has a description', () => {
    for (const tool of listTools()) {
      for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
        expect([name, (property as any).description]).toEqual([name, expect.any(String)]);
      }
    }
  });

  test('src/version.ts matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });

  test('remove_background uploads the image and forwards options as form fields', async () => {
    await callTool(
      'remove_background',
      { image: IMAGE_URL, format: 'webp', width: 300, height: 200, fit: 'cover', crop: false },
      CTX
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.poof.bg/v1/remove');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(form.get('image_file')).toBeNull();
    expect(form.get('format')).toBe('webp');
    expect(form.get('width')).toBe('300');
    expect(form.get('height')).toBe('200');
    expect(form.get('fit')).toBe('cover');
    expect(form.get('crop')).toBe('false');
    expect(form.has('size')).toBe(false);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      `poof-mcp/${VERSION} (test-client; hosted)`
    );
  });

  test('get_account adds remainingCredits', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ plan: 'Pro', maxCredits: 1000, usedCredits: 250 }),
    }));

    const result = await callTool('get_account', {}, CTX);
    expect(result.data).toEqual({ plan: 'Pro', maxCredits: 1000, usedCredits: 250, remainingCredits: 750 });
  });

  test('remove_video_background sends the url and options, then polls until the job completes', async () => {
    jobPollConfig.intervalMs = 0;
    const calls: Array<{ url: string; method: string; body?: FormData }> = [];
    fetchMock.mockImplementation(async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body });
      if (init.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ id: 'job_1', status: 'queued', progress: 0 }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          calls.length < 3
            ? { id: 'job_1', status: 'processing', progress: 0.5 }
            : { id: 'job_1', status: 'completed', progress: 1, credits: 35, result_url: 'https://cdn.poof.bg/1d/jobs/job_1/result.webm' },
      };
    });

    const result = await callTool(
      'remove_video_background',
      { video_url: VIDEO_URL, format: 'mp4', channels: 'rgb', bg_color: '#00ff00', size: 'hd' },
      CTX
    );

    expect(calls[0].url).toBe('https://api.poof.bg/v1/remove');
    const body = calls[0].body as FormData;
    expect(body.get('url')).toBe(VIDEO_URL);
    expect(body.get('file')).toBeNull();
    expect(body.get('format')).toBe('mp4');
    expect(body.get('channels')).toBe('rgb');
    expect(body.get('bg_color')).toBe('#00ff00');
    expect(body.get('size')).toBe('hd');
    expect(calls.slice(1).every((c) => c.url === 'https://api.poof.bg/v1/jobs/job_1' && c.method === 'GET')).toBe(true);
    expect(result.success).toBe(true);
    expect(result.job.status).toBe('completed');
    expect(result.job.result_url).toBe('https://cdn.poof.bg/1d/jobs/job_1/result.webm');
    expect(result.hint).toBeUndefined();
  });

  test('remove_video_background forwards format=gif', async () => {
    jobPollConfig.intervalMs = 0;
    const calls: Array<{ url: string; method: string; body?: FormData }> = [];
    fetchMock.mockImplementation(async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body });
      if (init.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ id: 'job_2', status: 'queued', progress: 0, format: 'gif' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'job_2', status: 'completed', progress: 1, credits: 20, format: 'gif', result_url: 'https://cdn.poof.bg/1d/jobs/job_2/result.gif' }),
      };
    });

    const result = await callTool('remove_video_background', { video_url: VIDEO_URL, format: 'gif', size: 'medium' }, CTX);

    const body = calls[0].body as FormData;
    expect(body.get('format')).toBe('gif');
    expect(body.get('size')).toBe('medium');
    expect(result.success).toBe(true);
    expect(result.job.format).toBe('gif');
    expect(result.job.result_url).toBe('https://cdn.poof.bg/1d/jobs/job_2/result.gif');
  });

  test('remove_video_background with wait=false returns the queued job and a get_job hint', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ id: 'job_2', status: 'queued', progress: 0, result_url: null }),
    }));

    const result = await callTool('remove_video_background', { video_url: VIDEO_URL, wait: false }, CTX);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.job.status).toBe('queued');
    expect(result.hint).toContain('get_job');
    expect(result.hint).toContain('job_2');
  });

  test('remove_video_background hands a failed job back with success=false', async () => {
    jobPollConfig.intervalMs = 0;
    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 202,
        json: async () => ({ id: 'job_3', status: 'queued', progress: 0 }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'job_3', status: 'failed', error: { code: 'processing_failed', message: 'boom' } }),
      }));

    const result = await callTool('remove_video_background', { video_url: VIDEO_URL }, CTX);
    expect(result.success).toBe(false);
    expect(result.job.error.code).toBe('processing_failed');
    expect(result.hint).toBeUndefined();
  });

  test('remove_video_background rejects a non-https url without calling the API', async () => {
    await expect(callTool('remove_video_background', { video_url: 'http://example.com/a.mp4' }, CTX)).rejects.toThrow(
      'https://'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('remove_video_background rejects an image response (200 instead of 202)', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(callTool('remove_video_background', { video_url: VIDEO_URL }, CTX)).rejects.toThrow('202');
  });

  test('get_job fetches the job by id', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: any) => {
      expect(url).toBe('https://api.poof.bg/v1/jobs/job_9');
      expect(init.method).toBe('GET');
      expect(init.headers['x-api-key']).toBe(API_KEY);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'job_9', status: 'completed', result_url: 'https://cdn.poof.bg/1d/jobs/job_9/result.webm' }),
      };
    });

    const result = await callTool('get_job', { job_id: 'job_9' }, CTX);
    expect(result).toEqual({
      success: true,
      job: { id: 'job_9', status: 'completed', result_url: 'https://cdn.poof.bg/1d/jobs/job_9/result.webm' },
    });
  });

  test('unknown tool throws', async () => {
    await expect(callTool('nope', {}, CTX)).rejects.toThrow('Unknown tool: nope');
  });

  test('unknown tool throws for inherited object keys', async () => {
    await expect(callTool('toString', {}, CTX)).rejects.toThrow('Unknown tool: toString');
  });
});

describe('CallTool over the MCP protocol', () => {
  let fetchMock: jest.Mock<any>;
  const originalFetch = globalThis.fetch;
  let client: Client;

  beforeEach(async () => {
    retryConfig.baseDelayMs = 0;
    fetchMock = jest.fn() as any;
    (globalThis as any).fetch = fetchMock;

    const { server } = createMcpServer({ poofApiKey: API_KEY });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    (globalThis as any).fetch = originalFetch;
  });

  function removeBackground(args: Record<string, unknown> = {}) {
    return client.callTool({ name: 'remove_background', arguments: { image: IMAGE_URL, ...args } }) as Promise<any>;
  }

  test('returns the processed image as image content, with metadata as text', async () => {
    fetchMock.mockImplementation(imageFetch(processedImage));

    const result = await removeBackground({ format: 'webp' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: Buffer.from(PNG_BYTES).toString('base64'),
      mimeType: 'image/webp',
    });
    expect(JSON.parse(result.content[1].text)).toEqual({
      success: true,
      format: 'webp',
      width: 640,
      height: 480,
      processing_time_ms: 321,
    });
  });

  test('returns account data as text content', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ plan: 'Free', maxCredits: 50, usedCredits: 50 }),
    }));

    const result: any = await client.callTool({ name: 'get_account', arguments: {} });

    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text).data.remainingCredits).toBe(0);
  });

  test('an API error is a tool error result, not a JSON-RPC error', async () => {
    fetchMock.mockImplementation(
      imageFetch(() =>
        apiError(422, 'invalid_image', 'The file could not be decoded as PNG, JPEG or WebP.')
      )
    );

    const result = await removeBackground();

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Poof API error (HTTP 422 invalid_image)');
    expect(text).toContain('could not be decoded');
    expect(text).toContain('Only PNG, JPEG and WebP');
    expect(text).toContain('Documentation: https://docs.poof.bg/errors/invalid-image');
    expect(text).toContain('Request ID: req_123');
  });

  test('validation error details are included', async () => {
    fetchMock.mockImplementation(
      imageFetch(() =>
        apiError(400, 'validation_error', "Invalid value for 'format'.", { format: ['must be one of: png, jpg, webp'] })
      )
    );

    const result = await removeBackground();

    expect(result.content[0].text).toContain('{"format":["must be one of: png, jpg, webp"]}');
    expect(result.content[0].text).toContain('Fix the parameter');
  });

  test('a rate limit is retried and succeeds', async () => {
    let removeCalls = 0;
    fetchMock.mockImplementation(
      imageFetch(() =>
        ++removeCalls === 1
          ? apiError(429, 'rate_limit_exceeded', 'Rate limit exceeded for your plan.')
          : processedImage()
      )
    );

    const result = await removeBackground();

    expect(removeCalls).toBe(2);
    expect(result.isError).toBeFalsy();
  });

  test('a rate limit that persists after retries tells the model to stop calling in parallel', async () => {
    fetchMock.mockImplementation(async () =>
      apiError(429, 'rate_limit_exceeded', 'Rate limit exceeded for your plan.')
    );

    const result: any = await client.callTool({ name: 'get_account', arguments: {} });

    expect(fetchMock).toHaveBeenCalledTimes(retryConfig.maxRetries + 1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('one at a time');
  });

  test('an upstream error is retried', async () => {
    let removeCalls = 0;
    fetchMock.mockImplementation(
      imageFetch(() =>
        ++removeCalls === 1 ? apiError(503, 'upstream_error', 'Temporarily unavailable.') : processedImage()
      )
    );

    const result = await removeBackground();

    expect(removeCalls).toBe(2);
    expect(result.isError).toBeFalsy();
  });

  test('used-up credits are not retried and tell the model to stop', async () => {
    let removeCalls = 0;
    fetchMock.mockImplementation(
      imageFetch(() => {
        removeCalls++;
        return apiError(402, 'payment_required', "Your plan's monthly credits are used up.");
      })
    );

    const result = await removeBackground();

    expect(removeCalls).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Do not retry');
    expect(result.content[0].text).toContain('https://dash.poof.bg');
  });

  test('a non-JSON error body is passed through', async () => {
    fetchMock.mockImplementationOnce(async () => errorResponse(500, 'Internal Server Error'));

    const result: any = await client.callTool({ name: 'get_account', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Poof API error (HTTP 500): Internal Server Error');
  });

  test('an image URL that cannot be downloaded is a tool error result', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));

    const result = await removeBackground();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Could not download the image from the URL (HTTP 404 Not Found)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a network failure is a tool error result', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });

    const result: any = await client.callTool({ name: 'get_account', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Poof request failed: fetch failed');
  });

  test('missing required arguments are a tool error and skip the API call', async () => {
    const result: any = await client.callTool({ name: 'remove_background' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Poof request failed: Missing required argument "image" for remove_background'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a missing video job is a tool error result with a hint', async () => {
    fetchMock.mockImplementation(async () => apiError(404, 'job_not_found', 'No job with id job_x.'));

    const result: any = await client.callTool({ name: 'get_job', arguments: { job_id: 'job_x' } });

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Poof API error (HTTP 404 job_not_found)');
    expect(text).toContain('Do not retry; start a new remove_video_background job');
  });

  test('a finished video job comes back as text content with its result_url', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'job_7', status: 'completed', result_url: 'https://cdn.poof.bg/1d/jobs/job_7/result.webm' }),
    }));

    const result: any = await client.callTool({ name: 'get_job', arguments: { job_id: 'job_7' } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      success: true,
      job: { id: 'job_7', status: 'completed', result_url: 'https://cdn.poof.bg/1d/jobs/job_7/result.webm' },
    });
  });

  test('an unknown tool is still a protocol error', async () => {
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/Unknown tool: nope/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('User-Agent sent to the Poof API', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<any>;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  async function userAgentFor(config: Parameters<typeof createMcpServer>[0]) {
    const { server } = createMcpServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'My Client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({ name: 'get_account', arguments: {} });
    await client.close();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return (init.headers as Record<string, string>)['User-Agent'];
  }

  test('hosted: uses the detected client', async () => {
    expect(
      await userAgentFor({ poofApiKey: API_KEY, client: 'Claude-ClaudeAI', transport: 'hosted' })
    ).toBe(`poof-mcp/${VERSION} (Claude-ClaudeAI; hosted)`);
  });

  test('stdio: falls back to the MCP clientInfo name', async () => {
    expect(await userAgentFor({ poofApiKey: API_KEY, transport: 'stdio' })).toBe(
      `poof-mcp/${VERSION} (My-Client; stdio)`
    );
  });

  test('defaults to the stdio transport', async () => {
    expect(await userAgentFor({ poofApiKey: API_KEY, client: 'Cursor' })).toBe(
      `poof-mcp/${VERSION} (Cursor; stdio)`
    );
  });
});

describe('detectClient', () => {
  test.each([
    [{ 'x-anthropic-client': 'ClaudeAI', 'user-agent': 'Claude-User' }, 'Claude-ClaudeAI'],
    [{ 'x-anthropic-client': 'ClaudeCode' }, 'Claude-ClaudeCode'],
    [{ 'user-agent': 'Claude-User' }, 'Claude'],
    [{ 'x-openai-subject': 'abc', 'user-agent': 'python-httpx/0.27' }, 'ChatGPT'],
    [{ 'user-agent': 'openai-mcp/1.0.0' }, 'ChatGPT'],
    [{ 'user-agent': 'codex-mcp-client/0.46.0' }, 'Codex'],
    [{ 'user-agent': 'claude-code/2.0.14 (sdk-cli)' }, 'ClaudeCode-local'],
    [{ 'user-agent': 'Cursor/1.7.0 (darwin arm64)' }, 'Cursor'],
    [{ 'user-agent': 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)' }, 'node-fetch'],
    [{ 'user-agent': '   ' }, 'unknown'],
    [{}, 'unknown'],
  ])('%j -> %s', (headers, expected) => {
    expect(detectClient(new Headers(headers as Record<string, string>))).toBe(expected);
  });
});

describe('resolveClient', () => {
  test.each([
    // A client recognised from the headers beats the OAuth client name.
    [{ 'x-anthropic-client': 'ClaudeAI' }, 'Claude', 'Claude-ClaudeAI'],
    [{ 'user-agent': 'codex-mcp-client/0.46.0' }, 'Codex CLI', 'Codex'],
    // Otherwise the OAuth client name beats the generic User-Agent fallback.
    [{ 'user-agent': 'node-fetch/1.0' }, 'Some App', 'Some-App'],
    // Old grants without a client name use header detection alone.
    [{ 'user-agent': 'node-fetch/1.0' }, undefined, 'node-fetch'],
    [{}, undefined, 'unknown'],
  ])('%j with OAuth client %j -> %s', (headers, clientName, expected) => {
    expect(resolveClient(new Headers(headers as Record<string, string>), clientName)).toBe(expected);
  });
});

describe('sanitizeClientName', () => {
  test.each([
    ['Claude', 'Claude'],
    ['Claude Code (poof)', 'Claude-Code-poof'],
    ['my;client)', 'my-client'],
    ['a'.repeat(60), 'a'.repeat(40)],
    ['', undefined],
    ['()', undefined],
    [undefined, undefined],
    [null, undefined],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeClientName(input)).toBe(expected);
  });
});
