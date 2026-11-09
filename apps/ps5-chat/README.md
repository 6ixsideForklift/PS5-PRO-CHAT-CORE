# PS5 PRO CHAT with Supabase

This is a separate local app. It uses the `ps5-pro-chat-dev` Supabase project for
email/password accounts and all conversations and messages. Its server checks the
Supabase access token before calling the local PS5 model. The existing LibreChat
stack on ports 3080 and 3081 is unaffected.

The Supabase schema in `schema.sql` has been applied as the
`create_ps5_chat_tables` migration. Both tables have row level security; users
can access only their own chats.

Local setup:

1. Configure `.env.local` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
   `PS5_MODEL_URL`, `PS5_MODEL_NAME`, and `PS5_MODEL_API_KEY`.
2. Run `npm ci`, `npm run build`, and `npm start` in this directory.
3. Open http://localhost:3082.

Supabase email confirmations are enabled. Add `http://localhost:3082/**` to
Authentication → URL Configuration → Redirect URLs so confirmation links return
to this app. Only the publishable key is used in the browser. Keep the model key
in the ignored `.env.local` file.

This is a focused sign-in and text-chat app. LibreChat's agents, admin panel,
file uploads, and other advanced features are not yet implemented here.
