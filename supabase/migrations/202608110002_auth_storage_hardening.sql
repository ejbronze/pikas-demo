-- Prevent self-service privilege escalation while allowing safe profile fields.
revoke update on public.profiles from authenticated;
grant update(full_name,phone,avatar_url,preferred_language,updated_at) on public.profiles to authenticated;

-- Student code lookup is performed only by a server using the service-role key;
-- student credentials remain inside Supabase Auth's password hashing/rate limits.
create index if not exists students_active_code_idx on public.students(student_code) where status='active';

-- Private avatars. Signed URLs are generated after an authorization check.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,2000000,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy avatar_owner_read on storage.objects for select to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy avatar_owner_insert on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy avatar_owner_update on storage.objects for update to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

-- Parent/student mutations are intentionally performed with the authenticated
-- client so RLS remains authoritative even when a Server Action is bypassed.
