-- PGlite does not ship Supabase Auth. This narrow compatibility layer exposes
-- the auth objects used by application migrations; hosted smoke tests remain
-- responsible for validating the real Supabase implementation.
create schema auth;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table auth.users (
  id uuid primary key,
  email text,
  encrypted_password text not null default 'test-password-hash',
  email_confirmed_at timestamptz default now(),
  raw_app_meta_data jsonb not null default
    '{"provider":"google","providers":["google"]}'::jsonb
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
