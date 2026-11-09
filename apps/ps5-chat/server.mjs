import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, 'dist');
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const modelUrl = process.env.PS5_MODEL_URL;
const modelName = process.env.PS5_MODEL_NAME;
const modelKey = process.env.PS5_MODEL_API_KEY;
const port = Number(process.env.PORT || 3082);
const activeGenerations = new Set();

if (!supabaseUrl || !publishableKey || !modelUrl || !modelName) {
  throw new Error('Supabase and model settings are required in .env.local');
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

async function supabaseRequest(path, token, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error('Supabase request failed'), { status: response.status });
  return data;
}

async function generate(request, response) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return sendJson(response, 401, { error: 'Sign in required' });

  const { conversationId } = await readJson(request);
  if (typeof conversationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(conversationId)) {
    return sendJson(response, 400, { error: 'Invalid conversation' });
  }
  if (activeGenerations.has(conversationId)) {
    return sendJson(response, 409, { error: 'A reply is already being generated' });
  }

  activeGenerations.add(conversationId);
  try {
    const user = await supabaseRequest('/auth/v1/user', token);
    if (!user.id) return sendJson(response, 401, { error: 'Sign in required' });

    const conversations = await supabaseRequest(
      `/rest/v1/ps5_conversations?id=eq.${conversationId}&user_id=eq.${user.id}&select=id`,
      token,
    );
    if (conversations.length !== 1) return sendJson(response, 404, { error: 'Chat not found' });

    const messages = await supabaseRequest(
      `/rest/v1/ps5_messages?conversation_id=eq.${conversationId}&select=role,content&order=created_at.asc,id.asc&limit=50`,
      token,
    );
    if (messages.length === 0 || messages.at(-1).role !== 'user') {
      return sendJson(response, 409, { error: 'Send a message first' });
    }

    const modelResponse = await fetch(`${modelUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(modelKey ? { Authorization: `Bearer ${modelKey}` } : {}),
      },
      body: JSON.stringify({ model: modelName, messages, stream: false }),
      signal: AbortSignal.timeout(180000),
    });
    if (!modelResponse.ok) throw new Error(`Model returned ${modelResponse.status}`);
    const completion = await modelResponse.json();
    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Model returned no reply');

    const saved = await supabaseRequest('/rest/v1/ps5_messages', token, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ conversation_id: conversationId, role: 'assistant', content }),
    });
    return sendJson(response, 200, { message: saved[0] });
  } finally {
    activeGenerations.delete(conversationId);
  }
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
    return sendJson(response, 404, { error: 'Not found' });
  }
  try {
    const content = await readFile(path);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(path)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
  }
}

createServer(async (request, response) => {
  try {
    if (request.url === '/health') return sendJson(response, 200, { ok: true });
    if (request.url === '/api/chat' && request.method === 'POST') return await generate(request, response);
    if (request.url?.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found' });
    return await serveStatic(request, response);
  } catch (error) {
    console.error('Request failed:', error.message);
    const status = error.status === 401 ? 401 : error instanceof SyntaxError ? 400 : 502;
    sendJson(response, status, { error: status === 401 ? 'Session expired' : 'Request failed. Try again.' });
  }
}).listen(port, '127.0.0.1', () => console.log(`PS5 PRO CHAT ready at http://localhost:${port}`));
