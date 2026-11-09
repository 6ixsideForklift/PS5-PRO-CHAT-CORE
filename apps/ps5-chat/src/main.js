import { createClient } from '@supabase/supabase-js';
import './style.css';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
const app = document.querySelector('#app');
let session = null;
let conversationId = null;
let authMode = 'signin';
let busy = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(message, isError = false) {
  const status = document.querySelector('#status');
  if (status) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }
}

function renderAuth() {
  app.innerHTML = '';
  const page = element('div', 'auth-page');
  const banner = element('div', 'banner');
  const brand = element('div', 'brand');
  const icon = element('img', 'brand-icon');
  icon.src = '/icon.svg';
  icon.alt = '';
  const brandText = element('div');
  brandText.append(element('strong', '', 'PS5 PRO CHAT'));
  brandText.append(element('small', '', 'AI · PS5 PRO · TOOLS · AUTOMATION'));
  brand.append(icon, brandText);

  const card = element('main', 'auth-card');
  card.append(element('h1', '', authMode === 'signin' ? 'Sign in to PS5 PRO CHAT' : 'Create your account'));
  const form = element('form');
  form.id = 'auth-form';
  const email = element('input');
  email.type = 'email';
  email.name = 'email';
  email.placeholder = 'Email address';
  email.autocomplete = 'email';
  email.required = true;
  email.setAttribute('aria-label', 'Email address');
  const password = element('input');
  password.type = 'password';
  password.name = 'password';
  password.placeholder = 'Password';
  password.autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
  password.minLength = 8;
  password.required = true;
  password.setAttribute('aria-label', 'Password');
  const submit = element('button', 'primary', authMode === 'signin' ? 'Sign in' : 'Create account');
  submit.type = 'submit';
  form.append(email, password, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    setStatus('Working…');
    try {
      const credentials = { email: email.value.trim(), password: password.value };
      const result = authMode === 'signin'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: window.location.origin },
          });
      if (result.error) throw result.error;
      if (authMode === 'signup' && !result.data.session) {
        setStatus('Check your email for the confirmation link, then sign in.');
      } else {
        session = result.data.session;
        await renderChat();
      }
    } catch (error) {
      setStatus(error.message || 'Authentication failed', true);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  const switchButton = element('button', 'secondary', authMode === 'signin' ? 'Create an account' : 'Back to sign in');
  switchButton.type = 'button';
  switchButton.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    renderAuth();
  });
  card.append(form, switchButton, element('p', 'status', ''));
  card.lastChild.id = 'status';
  page.append(banner, brand, card);
  app.append(page);
}

async function loadConversations() {
  const { data, error } = await supabase
    .from('ps5_conversations')
    .select('id,title')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const list = document.querySelector('#conversation-list');
  list.replaceChildren();
  for (const conversation of data) {
    const button = element('button', conversation.id === conversationId ? 'selected' : '', conversation.title);
    button.type = 'button';
    button.addEventListener('click', async () => {
      conversationId = conversation.id;
      await loadConversations();
      await loadMessages();
    });
    list.append(button);
  }
}

async function loadMessages() {
  const panel = document.querySelector('#messages');
  panel.replaceChildren();
  if (!conversationId) {
    panel.append(element('p', 'empty', 'Start a new conversation with your PS5 model.'));
    return;
  }
  const { data, error } = await supabase
    .from('ps5_messages')
    .select('id,role,content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const message of data) {
    const article = element('article', `message ${message.role}`);
    article.append(element('strong', '', message.role === 'user' ? 'You' : 'PS5 PRO CHAT'));
    article.append(element('p', '', message.content));
    panel.append(article);
  }
  panel.scrollTop = panel.scrollHeight;
}

async function renderChat() {
  app.innerHTML = `
    <div class="chat-page">
      <aside class="sidebar">
        <img src="/banner.png" alt="6ixside Forklift Repair Inc" />
        <button id="new-chat" class="primary" type="button">New chat</button>
        <nav id="conversation-list" aria-label="Conversations"></nav>
        <div class="account"><span id="account-email"></span><button id="sign-out" type="button">Sign out</button></div>
      </aside>
      <main class="chat-main">
        <header><img src="/icon.svg" alt="" /><h1>PS5 PRO CHAT</h1></header>
        <section id="messages" aria-live="polite"></section>
        <form id="composer"><textarea id="prompt" aria-label="Your message" placeholder="Message your PS5 model…" maxlength="100000" required></textarea><button class="primary" type="submit">Send</button></form>
        <p id="status" class="status" role="status"></p>
      </main>
    </div>`;
  document.querySelector('#account-email').textContent = session.user.email;
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await supabase.auth.signOut();
    session = null;
    conversationId = null;
    renderAuth();
  });
  document.querySelector('#new-chat').addEventListener('click', async () => {
    conversationId = null;
    await loadConversations();
    await loadMessages();
  });
  document.querySelector('#composer').addEventListener('submit', sendMessage);
  try {
    await loadConversations();
    await loadMessages();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (busy) return;
  const input = document.querySelector('#prompt');
  const content = input.value.trim();
  if (!content) return;
  busy = true;
  input.disabled = true;
  setStatus('Thinking…');
  try {
    if (!conversationId) {
      const { data, error } = await supabase
        .from('ps5_conversations')
        .insert({ user_id: session.user.id, title: content.slice(0, 80) })
        .select('id')
        .single();
      if (error) throw error;
      conversationId = data.id;
    }
    const { error } = await supabase
      .from('ps5_messages')
      .insert({ conversation_id: conversationId, role: 'user', content });
    if (error) throw error;
    input.value = '';
    await loadConversations();
    await loadMessages();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ conversationId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Reply failed');
    await loadMessages();
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'Could not send message', true);
  } finally {
    busy = false;
    input.disabled = false;
    input.focus();
  }
}

const { data } = await supabase.auth.getSession();
session = data.session;
if (session) await renderChat();
else renderAuth();
supabase.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
  if (!session && document.querySelector('.chat-page')) renderAuth();
});
