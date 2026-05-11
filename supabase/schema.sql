create table if not exists public.user_scripts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_scripts enable row level security;

create policy "user_scripts_select_own"
on public.user_scripts
for select
to authenticated
using (auth.uid() = user_id);

create policy "user_scripts_insert_own"
on public.user_scripts
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "user_scripts_update_own"
on public.user_scripts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_scripts_delete_own"
on public.user_scripts
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('psc-scripts', 'psc-scripts', false)
on conflict (id) do nothing;

create policy "psc_scripts_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'psc-scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "psc_scripts_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'psc-scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "psc_scripts_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'psc-scripts'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'psc-scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "psc_scripts_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'psc-scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);
