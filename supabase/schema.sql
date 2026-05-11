insert into storage.buckets (id, name, public)
values ('user_scripts', 'user_scripts', false)
on conflict (id) do nothing;

create policy "user_scripts_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user_scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "user_scripts_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user_scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "user_scripts_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user_scripts'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'user_scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "user_scripts_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user_scripts'
  and auth.uid()::text = split_part(name, '/', 1)
);
