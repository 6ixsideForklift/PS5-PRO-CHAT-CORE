import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const config = JSON.parse(await readFile(new URL('../.ps5-windows-mcp.json', import.meta.url), 'utf8'));
if (!config.token || !config.adminUserId) throw new Error('Missing private MCP configuration');
const port = 8766;
const app = createMcpExpressApp({ allowedHosts: ['127.0.0.1', 'localhost', 'host.docker.internal'] });

function sameSecret(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createServer(adminRequest) {
  const server = new McpServer({ name: 'ps5-windows-host', version: '1.0.0' });
  const authorize = () => {
    if (!adminRequest) throw new Error('This tool is available only to the private admin agent');
  };
  server.registerTool('list_directory', {
    description: 'List files and folders at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1) },
  }, async ({ path }) => {
    authorize();
    const entries = await readdir(path, { withFileTypes: true });
    return { content: [{ type: 'text', text: entries.slice(0, 500).map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n') || '(empty)' }] };
  });
  server.registerTool('read_text_file', {
    description: 'Read a UTF-8 text file at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1) },
  }, async ({ path }) => {
    authorize();
    const contents = await readFile(path, 'utf8');
    return { content: [{ type: 'text', text: contents.slice(0, 100_000) }] };
  });
  server.registerTool('write_text_file', {
    description: 'Create or replace a UTF-8 text file at an absolute Windows path on the host laptop.',
    inputSchema: { path: z.string().min(1), content: z.string() },
  }, async ({ path, content }) => {
    authorize();
    await writeFile(path, content, 'utf8');
    return { content: [{ type: 'text', text: `Wrote ${path}` }] };
  });
  server.registerTool('run_powershell', {
    description: 'Run a PowerShell command on the host Windows laptop as the signed-in Windows user. Commands run automatically.',
    inputSchema: { command: z.string().min(1).max(8000) },
  }, async ({ command }) => {
    authorize();
    const result = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, shell: false, timeout: 60_000,
      });
      let output = '';
      child.stdout.on('data', (data) => { output = (output + data.toString()).slice(0, 100_000); });
      child.stderr.on('data', (data) => { output = (output + data.toString()).slice(0, 100_000); });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve(`Exit code: ${code ?? signal}\n${output}`));
    });
    return { content: [{ type: 'text', text: result }] };
  });
  return server;
}

app.post('/mcp', async (req, res) => {
  if (!sameSecret(req.get('X-API-Key'), config.token)) return res.sendStatus(401);
  const adminRequest = req.get('X-LibreChat-User-Id') === config.adminUserId;
  if (req.body?.method === 'tools/call' && !adminRequest) return res.sendStatus(403);
  const server = createServer(adminRequest);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.sendStatus(500);
  }
});
app.get('/mcp', (_req, res) => res.sendStatus(405));
app.delete('/mcp', (_req, res) => res.sendStatus(405));
app.listen(port, '127.0.0.1', () => console.log(`Private Windows MCP listening on 127.0.0.1:${port}`));
