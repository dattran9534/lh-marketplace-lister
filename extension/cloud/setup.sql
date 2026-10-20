-- LH Marketplace Lister: cloud setup for the phone app.
-- Paste all of this into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- Cars (same data as the app on your PC).
create table if not exists public.vehicles (
  id          text        not null,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default 'pc',      -- 'pc' or 'phone'
  deleted     boolean     not null default false,
  primary key (user_id, id)
);

-- Your Facebook listings as of the last sync.
create table if not exists public.fb_state (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  listings   jsonb not null default '[]'::jsonb,
  synced_at  timestamptz,
  pc_seen_at timestamptz                              -- last time your PC checked in
);

-- Things you ask for on the phone that your PC does on Facebook
-- (change price, mark sold, post, import a car...).
create table if not exists public.commands (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result     text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists commands_user_status on public.commands (user_id, status, created_at);
create index if not exists vehicles_user_updated on public.vehicles (user_id, updated_at);

-- Only you can see or change your rows.
alter table public.vehicles enable row level security;
alter table public.fb_state enable row level security;
alter table public.commands enable row level security;

drop policy if exists "own vehicles" on public.vehicles;
create policy "own vehicles" on public.vehicles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own fb_state" on public.fb_state;
create policy "own fb_state" on public.fb_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own commands" on public.commands;
create policy "own commands" on public.commands for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Private photo storage. Each person's photos live in a folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "own photos add" on storage.objects;
create policy "own photos add" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "own photos change" on storage.objects;
create policy "own photos change" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "own photos remove" on storage.objects;
create policy "own photos remove" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
