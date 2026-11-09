create table public.ps5_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) <= 200),
  created_at timestamptz not null default now()
);
create index ps5_conversations_user_created_idx on public.ps5_conversations (user_id, created_at desc);

create table public.ps5_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ps5_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 1000000),
  created_at timestamptz not null default now()
);
create index ps5_messages_conversation_created_idx on public.ps5_messages (conversation_id, created_at, id);

alter table public.ps5_conversations enable row level security;
alter table public.ps5_messages enable row level security;
revoke all on public.ps5_conversations, public.ps5_messages from anon;
grant select, insert, update, delete on public.ps5_conversations to authenticated;
grant select, insert, delete on public.ps5_messages to authenticated;

create policy "Owners read conversations" on public.ps5_conversations for select to authenticated using (user_id = (select auth.uid()));
create policy "Owners create conversations" on public.ps5_conversations for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owners update conversations" on public.ps5_conversations for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owners delete conversations" on public.ps5_conversations for delete to authenticated using (user_id = (select auth.uid()));
create policy "Owners read messages" on public.ps5_messages for select to authenticated using (exists (select 1 from public.ps5_conversations conversation where conversation.id = conversation_id and conversation.user_id = (select auth.uid())));
create policy "Owners create messages" on public.ps5_messages for insert to authenticated with check (exists (select 1 from public.ps5_conversations conversation where conversation.id = conversation_id and conversation.user_id = (select auth.uid())));
create policy "Owners delete messages" on public.ps5_messages for delete to authenticated using (exists (select 1 from public.ps5_conversations conversation where conversation.id = conversation_id and conversation.user_id = (select auth.uid())));
