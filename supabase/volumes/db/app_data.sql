-- =========================================
-- A) 拡張・スキーマ・共通関数
-- =========================================
create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists vector;      -- pgvector
create schema   if not exists app;

-- updated_at 自動更新
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- 文字列ドメイン（公開/共有など）
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'visibility_t' and n.nspname = 'app'
  ) then
    create domain app.visibility_t as text
      check (value in ('private','public'));
  end if;
end $$;

-- principal_type_t
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'principal_type_t' and n.nspname = 'app'
  ) then
    create domain app.principal_type_t as text
      check (value in ('user','group'));
  end if;
end $$;

-- create domain if not exists app.visibility_t     as text check (value in ('private','public'));
-- create domain if not exists app.principal_type_t as text check (value in ('user','org','project'));

-- =========================================
-- B) Storage 初期化（Supabase Storage）
-- =========================================
-- 非公開バケット
insert into storage.buckets (id, name, public)
values ('private', 'private', false)
on conflict (id) do nothing;
-- 公開バケット
insert into storage.buckets (id, name, public)
values ('public', 'public', true)
on conflict (id) do nothing;

-- =========================================
-- C) コア実体: profiles / projects / threads / messages
-- =========================================

-- C-1) profiles
create table if not exists app.profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  name              text not null default '',
  research_group_id uuid,
  internal          jsonb not null default '{}',
  external          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  first_sign_in_at  timestamptz,
  last_sign_in_at   timestamptz
);
drop trigger if exists trg_profiles_touch_updated_at on app.profiles;
create trigger trg_profiles_touch_updated_at
before update on app.profiles
for each row execute function app.touch_updated_at();

-- C-2) projects
create table if not exists app.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  overview   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 拡張: ハイブリッド/RAG/将来拡張用
-- プロジェクトテーブルにコンテナIDと拡張用のjsonbカラムを追加
alter table app.projects
  add column if not exists active_container_id uuid,
  add column if not exists extras jsonb not null default '{}'::jsonb;
-- 検索高速化のための索引を作成
create index if not exists idx_projects_user on app.projects(user_id);
create index if not exists idx_projects_active_container on app.projects(active_container_id);
-- プロジェクトの変更のたびにtouch_updated_at(trg_projects_touch_updated_at)を実行
drop trigger if exists trg_projects_touch_updated_at on app.projects;
create trigger trg_projects_touch_updated_at
before update on app.projects
for each row execute function app.touch_updated_at();

-- C-3) threads
create table if not exists app.threads (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  name       text not null,
  overview   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 検索高速化のための索引を作成
create index if not exists idx_threads_project on app.threads(project_id);
-- スレッドの変更のたびにtouch_updated_at(trg_threads_touch_updated_at)を実行
drop trigger if exists trg_threads_touch_updated_at on app.threads;
create trigger trg_threads_touch_updated_at
before update on app.threads
for each row execute function app.touch_updated_at();

-- C-4) messages
create table if not exists app.messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references app.threads(id) on delete cascade,
  role                text not null check (role in ('user','assistant','system')),
  content             text not null,
  include_in_context  boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- 検索高速化のための索引を作成
create index if not exists idx_messages_thread_created
  on app.messages(thread_id, created_at);

-- =========================================
-- D) グローバル権限（辞書＋割当）＆ヘルパ
-- =========================================
create table if not exists app.global_roles (
  role_key text primary key,
  weight   int  not null,
  can_read_all_users boolean not null default false,
  can_register_user  boolean not null default false,
  can_delete_user    boolean not null default false,
  can_grant_admin    boolean not null default false,
  can_grant_developer boolean not null default false,
  can_grant_user     boolean not null default false,
  can_access_dev_system boolean not null default false
);

insert into app.global_roles(role_key, weight,
  can_read_all_users, can_register_user, can_delete_user,
  can_grant_admin, can_grant_developer, can_grant_user,
  can_access_dev_system)
values
  ('superuser', 100, true,  true,  true,  true,  true,  true,  true),
  ('admin',      80, false, true,  true,  false, true,  true,  true),
  ('developer',  60, false, false, false, false, false, false, true),
  ('user',       20, false, false, false, false, false, false, false)
on conflict (role_key) do update set
  weight = excluded.weight,
  can_read_all_users = excluded.can_read_all_users,
  can_register_user  = excluded.can_register_user,
  can_delete_user    = excluded.can_delete_user,
  can_grant_admin    = excluded.can_grant_admin,
  can_grant_developer= excluded.can_grant_developer,
  can_grant_user     = excluded.can_grant_user,
  can_access_dev_system = excluded.can_access_dev_system;

create table if not exists app.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role_key   text not null references app.global_roles(role_key),
  granted_at timestamptz not null default now(),
  granted_by uuid null references auth.users(id)
);

-- 権限ヘルパ
-- ログイン中のユーザの権限を取得する関数（RPC）
create or replace function app.current_global_role()
returns text language sql stable as $$
  select coalesce((select ur.role_key from app.user_roles ur
                   where ur.user_id = auth.uid() limit 1),'user')
$$;

-- 権限判定関数群
create or replace function app.is_superuser()
returns boolean language sql stable as $$ select app.current_global_role() = 'superuser' $$;

create or replace function app.is_admin()
returns boolean language sql stable as $$ select app.current_global_role() = 'admin' $$;

create or replace function app.is_admin_or_superuser()
returns boolean language sql stable as $$ select app.current_global_role() in ('superuser','admin') $$;

create or replace function app.can_read_all_users()
returns boolean language sql stable as $$
  select coalesce((select gr.can_read_all_users
                   from app.global_roles gr
                   where gr.role_key = app.current_global_role()), false)
$$;

create or replace function app.can_register_user()
returns boolean language sql stable as $$
  select coalesce((select gr.can_register_user
                   from app.global_roles gr
                   where gr.role_key = app.current_global_role()), false)
$$;

create or replace function app.can_delete_user()
returns boolean language sql stable as $$
  select coalesce((select gr.can_delete_user
                   from app.global_roles gr
                   where gr.role_key = app.current_global_role()), false)
$$;

create or replace function app.can_access_dev_system()
returns boolean language sql stable as $$
  select coalesce((select gr.can_access_dev_system
                   from app.global_roles gr
                   where gr.role_key = app.current_global_role()), false)
$$;

-- ログイン中のユーザよりも低い権限のユーザのみ権限を付与可能
create or replace function app.may_assign_role(target_role text)
returns boolean language sql stable as $$
  select case
    when app.current_global_role() = 'superuser' and target_role in ('admin','developer','user') then true
    when app.current_global_role() = 'admin'      and target_role in ('developer','user')        then true
    else false
  end
$$;

-- JWT に埋め込まれている情報からログイン中のユーザの権限を読み取る関数
create or replace function app.jwt_role()
returns text language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role')::text, 'user')
$$;

create or replace function app.is_admin_or_superuser_claim()
returns boolean language sql stable as $$ select app.jwt_role() in ('superuser','admin') $$;

create or replace function app.may_assign_role_from_claim(target_role text)
returns boolean language sql stable as $$
  select case
    when app.jwt_role() = 'superuser' and target_role in ('admin','developer','user') then true
    when app.jwt_role() = 'admin'      and target_role in ('developer','user')        then true
    else false
  end
$$;
-- superuserのみ全ユーザのデータを取得可能
create or replace function app.can_read_all_users_from_claim()
returns boolean language sql stable as $$
  select coalesce((select gr.can_read_all_users
                   from app.global_roles gr
                   where gr.role_key = app.jwt_role()), false)
$$;

-- =========================================
-- E) RLS の有効化（コア）
-- =========================================
-- E-1) 初期整備
-- 既存ユーザに 'user' 付与
insert into app.user_roles(user_id, role_key)
select u.id, 'user'
from auth.users u
left join app.user_roles r on r.user_id = u.id
where r.user_id is null;

-- RLSを有効化
alter table app.profiles   enable row level security;
alter table app.projects   enable row level security;
alter table app.threads    enable row level security;
alter table app.messages   enable row level security;
alter table app.user_roles enable row level security;
-- スーパーユーザやテーブル所持者でもRLSを強制
alter table app.profiles   force row level security;
alter table app.projects   force row level security;
alter table app.threads    force row level security;
alter table app.messages   force row level security;
alter table app.user_roles force row level security;

-- E-2) policies
-- profiles

-- select（データ読み取り）
drop policy if exists prf_sel on app.profiles;
create policy prf_sel on app.profiles
for select using (auth.uid() is not null and (user_id = auth.uid() or app.can_read_all_users_from_claim()));
-- insert（データ追加）
drop policy if exists prf_ins on app.profiles;
create policy prf_ins on app.profiles
for insert with check (auth.uid() is not null and user_id = auth.uid());
-- update（データ更新）
drop policy if exists prf_upd on app.profiles;
create policy prf_upd on app.profiles
for update using (auth.uid() is not null and user_id = auth.uid())
with check   (auth.uid() is not null and user_id = auth.uid());

-- E-3) projects
drop policy if exists prj_sel on app.projects;
create policy prj_sel on app.projects
for select using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists prj_ins on app.projects;
create policy prj_ins on app.projects
for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists prj_upd on app.projects;
create policy prj_upd on app.projects
for update using (auth.uid() is not null and user_id = auth.uid())
with check   (auth.uid() is not null and user_id = auth.uid());

drop policy if exists prj_del on app.projects;
create policy prj_del on app.projects
for delete using (auth.uid() is not null and user_id = auth.uid());

-- E-4) threads
drop policy if exists th_sel on app.threads;
create policy th_sel on app.threads
for select using (
  auth.uid() is not null and exists (
    select 1 from app.projects p where p.id = app.threads.project_id and p.user_id = auth.uid()
  )
);

drop policy if exists th_ins on app.threads;
create policy th_ins on app.threads
for insert with check (
  auth.uid() is not null and exists (
    select 1 from app.projects p where p.id = app.threads.project_id and p.user_id = auth.uid()
  )
);

drop policy if exists th_upd on app.threads;
create policy th_upd on app.threads
for update using (
  auth.uid() is not null and exists (
    select 1 from app.projects p where p.id = app.threads.project_id and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() is not null and exists (
    select 1 from app.projects p where p.id = app.threads.project_id and p.user_id = auth.uid()
  )
);

drop policy if exists th_del on app.threads;
create policy th_del on app.threads
for delete using (
  auth.uid() is not null and exists (
    select 1 from app.projects p where p.id = app.threads.project_id and p.user_id = auth.uid()
  )
);

-- E-5) messages
drop policy if exists msg_sel on app.messages;
create policy msg_sel on app.messages
for select using (
  auth.uid() is not null and exists (
    select 1 from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id and p.user_id = auth.uid()
  )
);

drop policy if exists msg_ins on app.messages;
create policy msg_ins on app.messages
for insert with check (
  auth.uid() is not null and role in ('user','assistant','system') and exists (
    select 1 from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id and p.user_id = auth.uid()
  )
);

drop policy if exists msg_upd on app.messages;
create policy msg_upd on app.messages
for update using (
  auth.uid() is not null and exists (
    select 1 from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() is not null and role in ('user','assistant','system') and exists (
    select 1 from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id and p.user_id = auth.uid()
  )
);

drop policy if exists msg_del on app.messages;
create policy msg_del on app.messages
for delete using (
  auth.uid() is not null and exists (
    select 1 from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id and p.user_id = auth.uid()
  )
);

-- E-6) user_roles（ユーザ権限テーブルの変更（権限付与機能））
drop policy if exists ur_sel on app.user_roles;
create policy ur_sel on app.user_roles
for select using (auth.uid() is not null and (user_id = auth.uid() or app.is_admin_or_superuser_claim()));

drop policy if exists ur_ins on app.user_roles;
create policy ur_ins on app.user_roles
for insert with check (auth.uid() is not null and app.may_assign_role_from_claim(target_role := role_key));

drop policy if exists ur_upd on app.user_roles;
create policy ur_upd on app.user_roles
for update using (auth.uid() is not null and app.is_admin_or_superuser_claim())
with check (auth.uid() is not null and app.may_assign_role_from_claim(target_role := role_key));

drop policy if exists ur_del on app.user_roles;
create policy ur_del on app.user_roles
for delete using (auth.uid() is not null and app.is_admin_or_superuser_claim()
                  and app.may_assign_role_from_claim(target_role := role_key));

-- =========================================
-- F) 認証連携（新規ユーザ初期化 / ログイン反映の修正）
-- =========================================
drop trigger if exists trg_handle_new_user on auth.users;
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  -- 新規ユーザのユーザプロフィールテーブルへ追加
  insert into app.profiles(user_id, name, first_sign_in_at, last_sign_in_at)
  values (new.id, coalesce((new.raw_user_meta_data->>'name')::text, ''), new.created_at, new.created_at)
  on conflict (user_id) do nothing;
  -- 新規ユーザのユーザ権限の付与
  insert into app.user_roles(user_id, role_key, granted_by)
  values (new.id, 'user', new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

create trigger trg_handle_new_user
after insert on auth.users
for each row execute function app.handle_new_user();

drop trigger if exists trg_handle_user_login on auth.users;
create or replace function app.handle_login_event()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update app.profiles p
       set
         first_sign_in_at = coalesce(p.first_sign_in_at, new.last_sign_in_at, now()),
         last_sign_in_at  = coalesce(new.last_sign_in_at, now())
     where p.user_id = new.id;
  end if;
  return new;
end $$;

create trigger trg_handle_user_login
after update of last_sign_in_at on auth.users
for each row
when (new.last_sign_in_at is distinct from old.last_sign_in_at)
execute function app.handle_login_event();

alter table auth.users enable always trigger trg_handle_new_user;
alter table auth.users enable always trigger trg_handle_user_login;

-- トリガー関数を“直接実行”できないようにする（トリガーでのみ実行可）
revoke all on function app.handle_new_user()   from public;
revoke all on function app.handle_login_event() from public;

-- 専用の最小権限ロールを用意（存在しない場合のみ作成）
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_triggers_owner') then
    create role app_triggers_owner noinherit;
    grant usage on schema app to app_triggers_owner;
  end if;

end $$;

-- 関数が触るテーブルに必要最小の権限だけを付与
grant insert, update on app.profiles   to app_triggers_owner;
grant insert         on app.user_roles to app_triggers_owner;

-- 関数の所有者を専用ロールに付け替え
alter function app.handle_new_user()   owner to app_triggers_owner;
alter function app.handle_login_event() owner to app_triggers_owner;

-- RLS を通すための“システム用”ポリシー（トリガー所有者ロールでの実行を許可）
-- profiles: INSERT/UPDATE を app_triggers_owner だけ特別許可
drop policy if exists prf_ins_sys on app.profiles;
create policy prf_ins_sys on app.profiles
for insert
with check (pg_has_role(current_user, 'app_triggers_owner', 'USAGE'));

drop policy if exists prf_upd_sys on app.profiles;
create policy prf_upd_sys on app.profiles
for update
using     (pg_has_role(current_user, 'app_triggers_owner', 'USAGE'))
with check (pg_has_role(current_user, 'app_triggers_owner', 'USAGE'));

-- user_roles: INSERT を app_triggers_owner だけ特別許可
drop policy if exists ur_ins_sys on app.user_roles;
create policy ur_ins_sys on app.user_roles
for insert
with check (pg_has_role(current_user, 'app_triggers_owner', 'USAGE'));


-- =========================================
-- G) ビュー / 管理RPC
-- =========================================
-- G-1) ビュー
create or replace view app.v_users as
select user_id as id, name, updated_at from app.profiles;

create or replace view app.v_projects as
select id, name, user_id as "userId", overview, created_at, updated_at
from app.projects;

create or replace view app.v_threads as
select id, name, project_id as "projectId", created_at, updated_at
from app.threads;

create or replace view app.v_messages as
select id, content, thread_id as "threadId", role, created_at
from app.messages;

create or replace view app.v_me as
select user_id as id, name, updated_at
from app.profiles
where user_id = auth.uid();

create or replace view app.v_my_role as
select ur.user_id as id, ur.role_key
from app.user_roles ur
where ur.user_id = auth.uid();

drop view if exists app.v_admin_users cascade;
create view app.v_admin_users as
select
  u.id,
  u.email::text as email,
  u.created_at,
  u.last_sign_in_at,
  coalesce(p.name, '')::text as name,
  coalesce(r.role_key, 'user')::text as role
from auth.users u
left join app.profiles p on p.user_id = u.id
left join app.user_roles r on r.user_id = u.id;
comment on view app.v_admin_users is 'Use app.admin_list_users() for UI. This view is restricted to app_admins only.';

-- G-2) 管理RPC（ユーザ一覧取得関数、権限付与関数）
-- ユーザ一覧取得
drop function if exists app.admin_list_users() cascade;
create or replace function app.admin_list_users()
returns table(
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  name text,
  role text
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if not (app.is_admin_or_superuser_claim() or app.can_read_all_users_from_claim()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select
      u.id,
      u.email::text,
      u.created_at,
      u.last_sign_in_at,
      coalesce(p.name, '')::text as name,
      coalesce(r.role_key, 'user')::text as role
    from auth.users u
    left join app.profiles p on p.user_id = u.id
    left join app.user_roles r on r.user_id = u.id
    order by u.created_at desc;
end $$;

-- 権限付与関数
drop function if exists app.admin_set_user_role(uuid, text) cascade;
create or replace function app.admin_set_user_role(target_user_id uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.may_assign_role_from_claim(target_role) then
    raise exception 'forbidden to assign role %', target_role using errcode = '42501';
  end if;

  if not exists (select 1 from app.global_roles where role_key = target_role) then
    raise exception 'unknown role %', target_role using errcode = '22P02';
  end if;

  insert into app.user_roles(user_id, role_key, granted_by)
  values (target_user_id, target_role, auth.uid())
  on conflict (user_id) do update
    set role_key = excluded.role_key,
        granted_by = auth.uid(),
        granted_at = now();
end $$;

-- -- システムプロンプトを作成するRPC
-- drop function if exists app.insert_system_message(uuid, text, boolean) cascade;
-- create or replace function app.insert_system_message(
--   in_thread_id         uuid,
--   in_content           text,
--   in_include_in_context boolean default true
-- )
-- returns uuid
-- language plpgsql
-- security definer
-- set search_path = app, pg_temp
-- as $$
-- declare
--   v_owner uuid;
--   v_id    uuid;
-- begin
--   -- 1) ログイン必須
--   if auth.uid() is null then
--     raise exception 'unauthenticated' using errcode = '28000';
--   end if;

--   -- 2) スレッド所有権チェック（呼出ユーザがこのthreadのprojectのownerか）
--   select p.user_id
--     into v_owner
--   from app.threads t
--   join app.projects p on p.id = t.project_id
--   where t.id = in_thread_id
--   limit 1;

--   if v_owner is null then
--     raise exception 'thread not found: %', in_thread_id using errcode = '22P02';
--   end if;

--   if v_owner <> auth.uid() then
--     raise exception 'forbidden' using errcode = '42501';
--   end if;

--   -- 3) 入力の軽いバリデーション（任意：長さチェックなど）
--   if in_content is null or length(in_content) = 0 then
--     raise exception 'content must not be empty' using errcode = '22023';
--   end if;
--   -- 長さ上限制限（必要に応じて数値を調整）
--   if length(in_content) > 50000 then
--     raise exception 'content too long' using errcode = '22001';
--   end if;

--   -- 4) systemメッセージを作成（RLSはsecurity definerでバイパスするが、上で所有権を厳密チェック）
--   insert into app.messages (thread_id, role, content, include_in_context)
--   values (in_thread_id, 'system', in_content, coalesce(in_include_in_context, true))
--   returning id into v_id;

--   return v_id;
-- end
-- $$;

-- -- 実行権限は認証済みユーザ（一般ユーザ）に付与
-- revoke all on function app.insert_system_message(uuid, text, boolean) from public;
-- grant execute on function app.insert_system_message(uuid, text, boolean) to authenticated;


-- =========================================
-- H) RAG 物理層（attachments / documents / chunks / lc_documents + RLS）
-- =========================================
-- H-1) テーブル定義
-- ストレージに保存しているファイルデータのメタ情報のテーブル
create table if not exists app.attachments (
  id             uuid primary key default gen_random_uuid(),
  storage_path   text not null,
  mime           text not null,
  size           bigint not null,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  project_id     uuid null references app.projects(id) on delete cascade,
  thread_id      uuid null references app.threads(id)  on delete cascade,
  title          text,
  sha256         text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_att_owner   on app.attachments(owner_user_id);
create index if not exists idx_att_project on app.attachments(project_id);
create index if not exists idx_att_thread  on app.attachments(thread_id);
create index if not exists idx_att_sha256  on app.attachments(sha256);
create unique index if not exists uq_attachments_storage_path on app.attachments(storage_path);

-- ファイルをテキスト化したメタデータ（本体は持たない）
create table if not exists app.documents (
  id            uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references app.attachments(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  project_id    uuid null references app.projects(id) on delete cascade,
  thread_id     uuid null references app.threads(id)  on delete cascade,
  title         text not null,
  status        text not null default 'ready',
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_documents_touch_updated_at on app.documents;
create trigger trg_documents_touch_updated_at
before update on app.documents
for each row execute function app.touch_updated_at();

-- チャンク化したデータを保存
-- 1536次元（例: text-embedding-3-small）
create table if not exists app.chunks (
  id            bigserial primary key,
  document_id   uuid not null references app.documents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  project_id    uuid null references app.projects(id) on delete cascade,
  thread_id     uuid null references app.threads(id)  on delete cascade,
  chunk_index   int  not null,
  text          text not null,
  embedding     vector(1536) not null,
  meta          jsonb not null default '{}'
);
create index if not exists idx_chunks_owner   on app.chunks(owner_user_id);
create index if not exists idx_chunks_project on app.chunks(project_id);
create index if not exists idx_chunks_thread  on app.chunks(thread_id);
create index if not exists idx_chunks_meta    on app.chunks using gin (meta);

drop index if exists app.idx_chunks_hnsw_cos;
create index idx_chunks_hnsw_cos on app.chunks using hnsw (embedding vector_cosine_ops);

-- =========================================
-- I) ベクトル検索RPC（スコープ(スレッド内、プロジェクト内など)、一部指定。全探索）
-- =========================================
drop function if exists app.match_documents_scoped(vector,int,uuid,uuid) cascade;
create or replace function app.match_documents_scoped(
  query_embedding vector,
  match_count int,
  in_thread_id uuid,
  in_project_id uuid
)
returns table(
  id bigint,
  document_id uuid,
  owner_user_id uuid,
  project_id uuid,
  thread_id uuid,
  text text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.owner_user_id,
    c.project_id,
    c.thread_id,
    c.text,
    c.meta as metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from app.chunks c
  where (
      (in_thread_id  is not null and c.thread_id  = in_thread_id)
   or (in_project_id is not null and c.project_id = in_project_id)
   or (c.owner_user_id = auth.uid())
  )
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
grant execute on function app.match_documents_scoped(vector,int,uuid,uuid) to authenticated;

drop function if exists app.match_by_document_ids(vector,int,uuid[]) cascade;
create or replace function app.match_by_document_ids(
  query_embedding vector,
  match_count int,
  in_document_ids uuid[]
)
returns table(
  id bigint,
  document_id uuid,
  owner_user_id uuid,
  project_id uuid,
  thread_id uuid,
  text text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.owner_user_id,
    c.project_id,
    c.thread_id,
    c.text,
    c.meta as metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from app.chunks c
  where c.document_id = any(in_document_ids)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
-- ログインユーザがRAG検索関数を使用可能にする
grant execute on function app.match_by_document_ids(vector,int,uuid[]) to authenticated;

-- 既存の検索関数を削除
drop function if exists app.match_documents(vector,int,jsonb) cascade;
drop function if exists app.match_documents(vector,int) cascade;
drop function if exists app.match_documents(vector) cascade;
-- 検索関数
create or replace function app.match_documents(
  query_embedding vector,
  match_count int
)
returns table(
  id            bigint,
  document_id   uuid,
  owner_user_id uuid,
  project_id    uuid,
  thread_id     uuid,
  text          text,
  metadata      jsonb,
  similarity    double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.owner_user_id,
    c.project_id,
    c.thread_id,
    c.text,
    c.meta as metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from app.chunks c
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
grant execute on function app.match_documents(vector,int) to authenticated;

-- LangChain簡易互換（Langchainの機能の一部をSQLで実装）
create table if not exists app.lc_documents (
  id            bigserial primary key,
  content       text not null,
  metadata      jsonb not null default '{}',
  embedding     vector(1536) not null,
  owner_user_id uuid not null,                -- アプリ側から設定が必須（default文でauth.uid()が使えないため）
  project_id    uuid null,
  thread_id     uuid null,
  created_at    timestamptz not null default now()
);
alter table app.lc_documents enable row level security;
alter table app.lc_documents force row level security;

drop policy if exists lc_sel on app.lc_documents;
create policy lc_sel on app.lc_documents
for select using (auth.uid() is not null and owner_user_id = auth.uid());

drop policy if exists lc_ins on app.lc_documents;
create policy lc_ins on app.lc_documents
for insert with check (auth.uid() is not null and owner_user_id = auth.uid());

drop policy if exists lc_upd on app.lc_documents;
create policy lc_upd on app.lc_documents
for update using (auth.uid() is not null and owner_user_id = auth.uid())
with check   (auth.uid() is not null and owner_user_id = auth.uid());

drop function if exists app.match_lc_documents(vector,int) cascade;
create or replace function app.match_lc_documents(
  query_embedding vector,
  match_count int
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from app.lc_documents d
  order by d.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
grant execute on function app.match_lc_documents(vector,int) to authenticated;

-- ベクトル検索の高速化（コサイン）
create index if not exists idx_lc_documents_hnsw_cos on app.lc_documents using hnsw (embedding vector_cosine_ops);

-- =========================================
-- J) RAG 論理層（Datasets と コンテナ/パッケージ設計 追加）
-- =========================================

-- J-1) datasets（RAGの検索対象: チャンクをまとめたもの）
create table if not exists app.datasets (
  id            uuid primary key default gen_random_uuid(),                 -- 主キー
  owner_id      uuid not null references auth.users(id) on delete cascade,  -- 所有者
  project_id    uuid references app.projects(id) on delete set null,        -- 所属プロジェクト
  name          text not null,                                              -- データセット名
  description   text,                                                       -- 内容説明
  visibility    app.visibility_t not null default 'private',                -- 公開/非公開
  source_type   text,                                                       -- データの種類（storage / gitlab / web / etc）
  metadata      jsonb not null default '{}'::jsonb,                         -- ソース構成（フォルダパス(URL)・ファイルIDなど）
  created_at    timestamptz not null default now(),                         -- 作成日時
  updated_at    timestamptz not null default now()                          -- 更新日時
);
-- 検索用の索引
create index if not exists idx_datasets_owner on app.datasets(owner_id);
create index if not exists idx_datasets_project   on app.datasets(project_id);
create index if not exists idx_datasets_name      on app.datasets(name);
create index if not exists idx_datasets_meta_gin  on app.datasets using gin (metadata jsonb_path_ops);
-- updated_at 自動更新
drop trigger if exists trg_datasets_touch_updated_at on app.datasets;
create trigger trg_datasets_touch_updated_at
before update on app.datasets
for each row execute function app.touch_updated_at();

-- J-1b) dataset_documents（データセットは複数のドキュメントを持つ）
create table if not exists app.dataset_documents (
  dataset_id   uuid not null references app.datasets(id)   on delete cascade,
  document_id  uuid not null references app.documents(id)  on delete cascade,
  added_by     uuid not null,                                                 -- アプリ側から設定が必須（default文でauth.uid()が使えないため）
  created_at   timestamptz not null default now(),
  primary key (dataset_id, document_id) -- データセットに同一ドキュメントを複数追加できない
);
-- 検索用の索引
create index if not exists idx_dataset_documents_dataset  on app.dataset_documents(dataset_id);
create index if not exists idx_dataset_documents_document on app.dataset_documents(document_id);

-- J-2) packages（ファイルやシステムプロンプトなどをまとめたもの）
create table if not exists app.packages (
  id                       uuid primary key default gen_random_uuid(),                  -- 主キー
  owner_id                 uuid not null references auth.users(id) on delete cascade,   -- 所有者ID
  name                     text not null,                                               -- パッケージ名
  category                 text,                                                        -- 用途（system, validator, summarizerなど）
  description              text,                                                        -- 概要
  visibility               app.visibility_t not null default 'private',                 -- 公開/非公開
  forked_from_package_id   uuid references app.packages(id) on delete set null,         -- コピー元
  tags                     text[],                                                      -- タグ
  metadata                 jsonb not null default '{}'::jsonb,                          -- メタデータ
  created_at               timestamptz not null default now(),                          -- 作成日時
  updated_at               timestamptz not null default now()                           -- 更新日時
);
-- 検索用の索引
create index if not exists idx_packages_owner_visibility on app.packages(owner_id, visibility);
create index if not exists idx_packages_name             on app.packages(name);
create index if not exists idx_packages_forked_from      on app.packages(forked_from_package_id);
create index if not exists idx_packages_tags_gin         on app.packages using gin (tags);
-- 更新日時の更新
drop trigger if exists trg_packages_touch_updated_at on app.packages;
create trigger trg_packages_touch_updated_at
before update on app.packages
for each row execute function app.touch_updated_at();

-- J-2b) package_versions
create table if not exists app.package_versions (
  id             uuid primary key default gen_random_uuid(),                    -- 主キー
  package_id     uuid not null references app.packages(id) on delete cascade,   -- 親パッケージ
  version        text not null,                                                 -- バージョン
  system_prompt  text,                                                          -- システムプロンプト
  templates      jsonb not null default '{}'::jsonb,                            -- 出力テンプレート群（出力の形式を設定）
  assets         jsonb not null default '{}'::jsonb,                            -- 添付ファイルや外部リソースのメタ情報
  published      boolean not null default false,                                -- 公開/非公開
  created_at     timestamptz not null default now(),                            -- 作成日時
  constraint uq_package_version unique (package_id, version)                    -- バージョンの重複を防ぐ
);

create index if not exists idx_package_versions_package on app.package_versions(package_id);

-- J-2c) package_datasets（パッケージとデータセットの接続）
create table if not exists app.package_datasets (
  package_id uuid not null references app.packages(id) on delete cascade,
  dataset_id uuid not null references app.datasets(id) on delete cascade,
  primary key (package_id, dataset_id)
);
create index if not exists idx_package_datasets_pkg on app.package_datasets(package_id);
create index if not exists idx_package_datasets_ds  on app.package_datasets(dataset_id);

-- J-3) containers（複数のパッケージやチャットボット環境をまとめた基盤）
create table if not exists app.containers (
  id                        uuid primary key default gen_random_uuid(),                   -- 主キー
  project_id                uuid references app.projects(id) on delete set null,          -- 接続先のプロジェクト
  owner_id                  uuid not null references auth.users(id) on delete cascade,    -- 作成者ID
  name                      text not null,                                                -- コンテナ名
  description               text,                                                         -- 概要（システムプロンプト）
  visibility                app.visibility_t not null default 'private',                  -- 公開/非公開
  forked_from_container_id  uuid references app.containers(id) on delete set null,        -- コピー元のコンテナ
  temperature               numeric not null default 0,                                   -- 出力温度（ランダム性を指定）
  rag_top_k                 integer,                                                      -- RAGの検索数（抽出数）
  metadata                  jsonb not null default '{}'::jsonb,                           -- メタデータ
  created_at                timestamptz not null default now(),                           -- 作成日時
  updated_at                timestamptz not null default now(),                           -- 更新日時
  constraint containers_temperature_chk check (temperature >= 0 and temperature <= 2)
);
-- 検索用の索引
create index if not exists idx_containers_project      on app.containers(project_id);
create index if not exists idx_containers_owner_vis    on app.containers(owner_id, visibility);
create index if not exists idx_containers_forked_from  on app.containers(forked_from_container_id);
-- 更新日時の更新
drop trigger if exists trg_containers_touch_updated_at on app.containers;
create trigger trg_containers_touch_updated_at
before update on app.containers
for each row execute function app.touch_updated_at();

-- J-4) container_packages（順序設定）
create table if not exists app.container_packages (
  container_id         uuid not null references app.containers(id) on delete cascade,         -- コンテナID
  package_version_id   uuid not null references app.package_versions(id) on delete restrict,  -- パッケージ(バージョン)ID
  order_index          integer not null default 0,                                            -- 順番
  is_enabled           boolean not null default false,                                        -- 順序性の作成
  notes                jsonb not null default '{}'::jsonb,                                    -- 補足メモ
  primary key (container_id, package_version_id),
  constraint uq_container_order unique (container_id, order_index)
);
create index if not exists idx_container_packages_order on app.container_packages(container_id, order_index);

-- J-5) container_datasets（RAGスコープ）
create table if not exists app.container_datasets (
  container_id   uuid not null references app.containers(id) on delete cascade,     -- コンテナID
  dataset_id     uuid not null references app.datasets(id)   on delete restrict,    -- データセットID
  weight         numeric not null default 1 check (weight >= 0 and weight <= 1),    -- 各データセットの重みづけ（0以上1以下）
  filters        jsonb not null default '{}'::jsonb,                                -- フィルター（日付など）
  primary key (container_id, dataset_id)                                            -- コンテナに同一データセットを適用できないようにする
);
create index if not exists idx_container_datasets_container on app.container_datasets(container_id);
create index if not exists idx_container_datasets_dataset   on app.container_datasets(dataset_id);

-- J-6) container_releases（スナップショット：immutable運用推奨）
create table if not exists app.container_releases (
  id                      uuid primary key default gen_random_uuid(),                     -- 主キー
  container_id            uuid not null references app.containers(id) on delete cascade,  -- 親コンテナID
  release_tag             text not null,                                                  -- リリース名
  snapshot_temperature    numeric not null default 0,                                     -- ランダム性
  snapshot_rag_settings   jsonb not null default '{}'::jsonb,                             -- RAGの設定
  snapshot_packages       jsonb not null,      -- [{package_version_id, order_index}]     -- パッケージ設定
  snapshot_datasets       jsonb not null,      -- [{dataset_id, weight, filters}]         -- データセット設定
  snapshot_meta           jsonb not null default '{}'::jsonb,                             -- その他のメタデータ
  published_at            timestamptz not null default now(),                             -- 公開日時
  constraint uq_container_releases_container_tag unique (container_id, release_tag)
);
create index if not exists idx_container_releases_container on app.container_releases(container_id);
create index if not exists idx_container_releases_tag       on app.container_releases(release_tag);

-- J-7) 限定公開
-- 限定公開データセット
create table if not exists app.dataset_shares (
  dataset_id     uuid not null references app.datasets(id) on delete cascade,
  principal_type app.principal_type_t not null,
  principal_id   uuid not null,
  created_at     timestamptz not null default now(),
  primary key (dataset_id, principal_type, principal_id)
);
create index if not exists idx_dataset_shares_principal on app.dataset_shares(principal_type, principal_id);

-- 限定公開パッケージ
create table if not exists app.package_shares (
  package_id      uuid not null references app.packages(id) on delete cascade,  -- 主キー
  principal_type  app.principal_type_t not null,                                -- 共有グループ（ user / team など）
  principal_id    uuid not null,                                                -- 共有先のID
  created_at      timestamptz not null default now(),                           -- 共有日
  primary key (package_id, principal_type, principal_id)                        -- 一意設定
);
create index if not exists idx_package_shares_principal on app.package_shares(principal_type, principal_id);

-- 限定公開コンテナ
create table if not exists app.container_shares (
  container_id    uuid not null references app.containers(id) on delete cascade,  -- 主キー
  principal_type  app.principal_type_t not null,                                  -- 共有グループ
  principal_id    uuid not null,                                                  -- 共有先のID
  created_at      timestamptz not null default now(),                             -- 共有日
  primary key (container_id, principal_type, principal_id)                        -- 一意設定
);
create index if not exists idx_container_shares_principal on app.container_shares(principal_type, principal_id);

-- J-8) 後付FK: プロジェクトとコンテナが接続されているかをチェック
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='app' and table_name='projects' and column_name='active_container_id'
  ) then
    if not exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      where tc.table_schema='app' and tc.table_name='projects'
        and tc.constraint_type='FOREIGN KEY'
        and kcu.column_name='active_container_id'
    ) then
      alter table app.projects
        add constraint fk_projects_active_container
        foreign key (active_container_id) references app.containers(id) on delete set null;
    end if;
  end if;
end $$;

-- J-9) RLS（datasets / packages / containers と関連テーブル：owner_id / visibility ベース）
-- J-9-1) attachments、documents、chunksのRLS
alter table app.attachments enable row level security;
alter table app.documents  enable row level security;
alter table app.chunks     enable row level security;

alter table app.attachments force row level security;
alter table app.documents  force row level security;
alter table app.chunks     force row level security;

-- attachments policy
drop policy if exists att_sel on app.attachments;
create policy att_sel on app.attachments
for select using (
  auth.uid() is not null and (
    owner_user_id = auth.uid()
    or (project_id is not null and exists (select 1 from app.projects p where p.id = project_id and p.user_id = auth.uid()))
    or (thread_id  is not null and exists (
          select 1 from app.threads t join app.projects p on p.id = t.project_id
          where t.id = thread_id and p.user_id = auth.uid()))
  )
);

drop policy if exists att_ins on app.attachments;
create policy att_ins on app.attachments
for insert with check (auth.uid() is not null and owner_user_id = auth.uid());

drop policy if exists att_del on app.attachments;
create policy att_del on app.attachments
for delete using (auth.uid() is not null and owner_user_id = auth.uid());

-- documents policy
drop policy if exists doc_sel on app.documents;
create policy doc_sel on app.documents
for select using (
  auth.uid() is not null and (
    owner_user_id = auth.uid()
    or (project_id is not null and exists (select 1 from app.projects p where p.id = project_id and p.user_id = auth.uid()))
    or (thread_id  is not null and exists (
          select 1 from app.threads t join app.projects p on p.id = t.project_id
          where t.id = thread_id and p.user_id = auth.uid()))
    or exists (
      select 1
        from app.dataset_documents dd
        join app.datasets d on d.id = dd.dataset_id
       where dd.document_id = app.documents.id
         and d.visibility = 'public'
    )
  )
);

drop policy if exists doc_ins on app.documents;
create policy doc_ins on app.documents
for insert with check (auth.uid() is not null and owner_user_id = auth.uid());

-- chunks policy
drop policy if exists chk_sel on app.chunks;
create policy chk_sel on app.chunks
for select using (
  auth.uid() is not null and (
    owner_user_id = auth.uid()
    or (project_id is not null and exists (select 1 from app.projects p where p.id = project_id and p.user_id = auth.uid()))
    or (thread_id  is not null and exists (
          select 1 from app.threads t join app.projects p on p.id = t.project_id
          where t.id = thread_id and p.user_id = auth.uid()))
    or exists (
      select 1
        from app.dataset_documents dd
        join app.datasets d on d.id = dd.dataset_id
       where dd.document_id = app.chunks.document_id
         and d.visibility = 'public'
    )
  )
);
drop policy if exists chk_ins on app.chunks;
create policy chk_ins on app.chunks
for insert with check (auth.uid() is not null and owner_user_id = auth.uid());

-- J-9-2) datasets, package, containerに関するRLS
-- datasets：プロジェクト所有者のみ（現状プロジェクトは非公開）
alter table app.datasets enable row level security;
alter table app.datasets force row level security;

drop policy if exists ds_sel on app.datasets;
create policy ds_sel on app.datasets
for select using (
  auth.uid() is not null and(
    visibility = 'public'
    or owner_id = auth.uid()
    or exists (
      select 1 from app.dataset_shares s
      where s.dataset_id = app.datasets.id
        and s.principal_type = 'user'
        and s.principal_id = auth.uid()
    )
  )
);

drop policy if exists ds_ins on app.datasets;
create policy ds_ins on app.datasets
for insert with check (
  auth.uid() is not null and owner_id = auth.uid()
);

drop policy if exists ds_upd on app.datasets;
create policy ds_upd on app.datasets
for update using (
  auth.uid() is not null and owner_id = auth.uid()

)
with check (
  auth.uid() is not null and owner_id = auth.uid()

);

drop policy if exists ds_del on app.datasets;
create policy ds_del on app.datasets
for delete using (
  auth.uid() is not null and owner_id = auth.uid()
);

-- dataset_documents：そのデータセットの属するプロジェクト所有者のみ
alter table app.dataset_documents enable row level security;
alter table app.dataset_documents force row level security;
-- データの取得はデータセットの所有者アクセスまたは共有データセットの場合のみ
drop policy if exists dsdoc_sel on app.dataset_documents;
create policy dsdoc_sel on app.dataset_documents
for select using (
  auth.uid() is not null
  and exists (
    select 1
      from app.datasets d
     where d.id = app.dataset_documents.dataset_id
       and (
         d.visibility = 'public'
         or d.owner_id = auth.uid()
         or exists (
         select 1 from app.dataset_shares s
         where s.dataset_id = d.id
           and s.principal_type = 'user'
           and s.principal_id = auth.uid()         
         )
       )
  )
);
-- データの追加はデータセットの所有者アクセスの場合のみ
drop policy if exists dsdoc_ins on app.dataset_documents;
create policy dsdoc_ins on app.dataset_documents
for insert with check (
  auth.uid() is not null
  and exists (
    select 1
      from app.datasets d
     where d.id = app.dataset_documents.dataset_id
       and d.owner_id = auth.uid()
  )
  and exists (
    select 1
      from app.documents doc
     where doc.id = app.dataset_documents.document_id
       and doc.owner_user_id = auth.uid()
  )
);
-- データの削除はデータセットの所有者アクセスの場合のみ
drop policy if exists dsdoc_del on app.dataset_documents;
create policy dsdoc_del on app.dataset_documents
for delete using (
  auth.uid() is not null
  and exists (
    select 1
      from app.datasets d
     where d.id = app.dataset_documents.dataset_id
       and d.owner_id = auth.uid()
  )
);

-- packages：owner private / public（後でshare拡張可）
alter table app.packages enable row level security;
alter table app.packages force row level security;
-- パッケージ取得
drop policy if exists pkg_sel on app.packages;
create policy pkg_sel on app.packages
for select using (
  auth.uid() is not null and (
    owner_id = auth.uid() 
    or visibility = 'public'
    or exists (
      select 1 from app.package_shares s
      where s.package_id = app.packages.id
        and s.principal_type = 'user'
        and s.principal_id = auth.uid()
    )
  )
);
-- パッケージ追加
drop policy if exists pkg_ins on app.packages;
create policy pkg_ins on app.packages
for insert with check (auth.uid() is not null and owner_id = auth.uid());
-- パッケージ更新
drop policy if exists pkg_upd on app.packages;
create policy pkg_upd on app.packages
for update using (auth.uid() is not null and owner_id = auth.uid())
with check   (auth.uid() is not null and owner_id = auth.uid());
-- パッケージ削除
drop policy if exists pkg_del on app.packages;
create policy pkg_del on app.packages
for delete using (auth.uid() is not null and owner_id = auth.uid());

-- package_versions：親パッケージのRLSに準拠
alter table app.package_versions enable row level security;
alter table app.package_versions force row level security;

-- パッケージバージョンの取得
drop policy if exists pkv_sel on app.package_versions;
create policy pkv_sel on app.package_versions
for select using (
  exists (
    select 1 from app.packages p 
    where p.id = package_id and (
      p.owner_id = auth.uid() 
      or p.visibility = 'public'
      or exists (
        select 1 from app.package_shares s
        where s.package_id = p.id
          and s.principal_type = 'user'
          and s.principal_id = auth.uid()
      )
    )
  )
);
-- パッケージバージョンの追加
drop policy if exists pkv_ins on app.package_versions;
create policy pkv_ins on app.package_versions
for insert with check (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);
-- パッケージバージョンの更新
drop policy if exists pkv_upd on app.package_versions;
create policy pkv_upd on app.package_versions
for update using (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
)
with check (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);
-- パッケージバージョンの削除
drop policy if exists pkv_del on app.package_versions;
create policy pkv_del on app.package_versions
for delete using (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);

-- package_datasets：パッケージのownerのみ編集可、閲覧はownerまたはpublicパッケージ
alter table app.package_datasets enable row level security;
alter table app.package_datasets force row level security;
-- パッケージ、データセットの紐づけテーブルの閲覧
drop policy if exists pkgds_sel on app.package_datasets;
create policy pkgds_sel on app.package_datasets
for select using (
  exists (
    select 1 from app.packages p
    where p.id = package_id and (
      p.owner_id = auth.uid()
      or p.visibility = 'public'
      or exists (
        select 1 from app.package_shares s
        where s.package_id = p.id
          and s.principal_type = 'user'
          and s.principal_id = auth.uid()
      )
    )
  )
);

-- パッケージ、データセットの紐づけテーブルの追加
drop policy if exists pkgds_ins on app.package_datasets;
create policy pkgds_ins on app.package_datasets
for insert with check (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);

-- パッケージ、データセットの紐づけテーブルの削除
drop policy if exists pkgds_del on app.package_datasets;
create policy pkgds_del on app.package_datasets
for delete using (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);

-- containers：owner private / public
alter table app.containers enable row level security;
alter table app.containers force row level security;
-- コンテナの取得
drop policy if exists ctr_sel on app.containers;
create policy ctr_sel on app.containers
for select using (
  auth.uid() is not null and (
    owner_id = auth.uid()
    or visibility = 'public'
    or exists (
      select 1 from app.container_shares s
      where s.container_id = app.containers.id
        and s.principal_type = 'user'
        and s.principal_id = auth.uid()
    )
  )
);

-- コンテナの追加
drop policy if exists ctr_ins on app.containers;
create policy ctr_ins on app.containers
for insert with check (auth.uid() is not null and owner_id = auth.uid());

-- コンテナの更新
drop policy if exists ctr_upd on app.containers;
create policy ctr_upd on app.containers
for update using (auth.uid() is not null and owner_id = auth.uid())
with check   (auth.uid() is not null and owner_id = auth.uid());

-- コンテナの削除
drop policy if exists ctr_del on app.containers;
create policy ctr_del on app.containers
for delete using (auth.uid() is not null and owner_id = auth.uid());

-- container_packages：コンテナowner（またはpublic閲覧）に準拠
alter table app.container_packages enable row level security;
alter table app.container_packages force row level security;
-- コンテナとパッケージの紐づけテーブルの閲覧
drop policy if exists cpk_sel on app.container_packages;
create policy cpk_sel on app.container_packages
for select using (
  exists (
    select 1 from app.containers c
    where c.id = container_id and (
      c.owner_id = auth.uid()
      or c.visibility = 'public'
      or exists (
        select 1 from app.container_shares s
        where s.container_id = c.id
          and s.principal_type = 'user'
          and s.principal_id = auth.uid()
      )
    )
  )
);

-- コンテナとパッケージの紐づけテーブルの追加
drop policy if exists cpk_ins on app.container_packages;
create policy cpk_ins on app.container_packages
for insert with check (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- コンテナとパッケージの紐づけテーブルの削除
drop policy if exists cpk_del on app.container_packages;
create policy cpk_del on app.container_packages
for delete using (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- container_datasets
alter table app.container_datasets enable row level security;
alter table app.container_datasets force row level security;
-- コンテナとデータセットの紐づけテーブルの閲覧
drop policy if exists cds_sel on app.container_datasets;
create policy cds_sel on app.container_datasets
for select using (
  exists (
    select 1 from app.containers c
    where c.id = container_id and (
      c.owner_id = auth.uid()
      or c.visibility = 'public'
      or exists (
        select 1 from app.container_shares s
        where s.container_id = c.id
          and s.principal_type = 'user'
          and s.principal_id = auth.uid()
      )
    )
  )
);

-- コンテナとデータセットの紐づけテーブルの追加
drop policy if exists cds_ins on app.container_datasets;
create policy cds_ins on app.container_datasets
for insert with check (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- コンテナとデータセットの紐づけテーブルの削除
drop policy if exists cds_del on app.container_datasets;
create policy cds_del on app.container_datasets
for delete using (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- container_releases：コンテナownerのみ編集、閲覧はownerまたはpublic
alter table app.container_releases enable row level security;
alter table app.container_releases force row level security;
-- 公開コンテナの閲覧
drop policy if exists cr_sel on app.container_releases;
create policy cr_sel on app.container_releases
for select using (
  exists (
    select 1 from app.containers c
    where c.id = container_id and (
      c.owner_id = auth.uid()
      or c.visibility = 'public'
      or exists (
        select 1 from app.container_shares s
        where s.container_id = c.id
          and s.principal_type = 'user'
          and s.principal_id = auth.uid()
      )
    )
  )
);

-- 公開コンテナの追加
drop policy if exists cr_ins on app.container_releases;
create policy cr_ins on app.container_releases
for insert with check (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- 公開コンテナの削除
drop policy if exists cr_del on app.container_releases;
create policy cr_del on app.container_releases
for delete using (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- shares テーブル自体の閲覧/編集は「当該リソースのownerのみ」
alter table app.package_shares   enable row level security;
alter table app.package_shares   force row level security;
alter table app.container_shares enable row level security;
alter table app.container_shares force row level security;
-- パッケージの限定公開先テーブルに対するすべての操作（取得、追加、更新、削除）
drop policy if exists pshare_all on app.package_shares;
create policy pshare_all on app.package_shares
for all using (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
)
with check (
  exists (select 1 from app.packages p where p.id = package_id and p.owner_id = auth.uid())
);

-- コンテナの限定公開先テーブルに対するすべての操作（取得、追加、更新、削除）
drop policy if exists cshare_all on app.container_shares;
create policy cshare_all on app.container_shares
for all using (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
)
with check (
  exists (select 1 from app.containers c where c.id = container_id and c.owner_id = auth.uid())
);

-- =========================================
-- K) RPC: 添付の追加/再割当/削除・一覧
-- =========================================
-- 添付ファイルの追加
drop function if exists app.add_attachment(text, text, bigint, text, uuid, uuid) cascade;
create or replace function app.add_attachment(
  in_storage_path text,                 -- ファイルの保存先（主キー）
  in_mime         text,                 -- MIMEタイプ
  in_size         bigint,               -- ファイルサイズ
  in_title        text default null,    -- タイトル
  in_project_id   uuid  default null,   -- プロジェクトID
  in_thread_id    uuid  default null    -- スレッドID
)
returns app.attachments
language plpgsql
volatile
set search_path = app, pg_temp
as $$
declare new_row app.attachments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- プロジェクト所有（自分）チェック
  if in_project_id is not null and not exists (
    select 1 from app.projects p
     where p.id = in_project_id and p.user_id = auth.uid()
  ) then
    raise exception 'forbidden project: %', in_project_id using errcode='42501';
  end if;

  -- スレッド所有（自分）チェック（thread は自分プロジェクト配下）
  if in_thread_id is not null and not exists (
    select 1
      from app.threads t
      join app.projects p on p.id = t.project_id
     where t.id = in_thread_id and p.user_id = auth.uid()
  ) then
    raise exception 'forbidden thread: %', in_thread_id using errcode='42501';
  end if;

  -- 両方指定時の整合性チェック（thread が project 配下か）
  if in_project_id is not null and in_thread_id is not null and not exists (
    select 1 from app.threads t
     where t.id = in_thread_id and t.project_id = in_project_id
  ) then
    raise exception 'thread % does not belong to project %', in_thread_id, in_project_id using errcode='22P02';
  end if;

  insert into app.attachments(storage_path, mime, size, owner_user_id, project_id, thread_id, title)
  values (in_storage_path, in_mime, in_size, auth.uid(), in_project_id, in_thread_id, in_title)
  returning * into new_row;

  return new_row; -- 保存したデータをRPCの呼び出し元の返す
end $$;
grant execute on function app.add_attachment(text, text, bigint, text, uuid, uuid) to authenticated; -- ログイン済みユーザに関数の権限を付与

-- 添付ファイルの再割当（添付ファイルの紐づけ先の変更）
drop function if exists app.reassign_attachment(uuid, uuid, uuid, text) cascade;
create or replace function app.reassign_attachment(
  in_id         uuid,
  in_project_id uuid default null,
  in_thread_id  uuid default null,
  in_title      text default null
)
returns app.attachments
language plpgsql
volatile
set search_path = app, pg_temp
as $$
declare updated_row app.attachments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- プロジェクト所有（自分）チェック
  if in_project_id is not null and not exists (
    select 1 from app.projects p
     where p.id = in_project_id and p.user_id = auth.uid()
  ) then
    raise exception 'forbidden project: %', in_project_id using errcode='42501';
  end if;

  -- スレッド所有（自分）チェック（thread は自分プロジェクト配下）
  if in_thread_id is not null and not exists (
    select 1
      from app.threads t
      join app.projects p on p.id = t.project_id
     where t.id = in_thread_id and p.user_id = auth.uid()
  ) then
    raise exception 'forbidden thread: %', in_thread_id using errcode='42501';
  end if;

  -- 両方指定時の整合性チェック（thread が project 配下か）
  if in_project_id is not null and in_thread_id is not null and not exists (
    select 1 from app.threads t
     where t.id = in_thread_id and t.project_id = in_project_id
  ) then
    raise exception 'thread % does not belong to project %', in_thread_id, in_project_id using errcode='22P02';
  end if;

  if not exists(select 1 from app.attachments a where a.id = in_id and a.owner_user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update app.attachments a
     set project_id = in_project_id,
         thread_id  = in_thread_id,
         title      = coalesce(in_title, a.title) -- 紐づけ先だけ変える場合、変更なし
   where a.id = in_id
  returning * into updated_row;

  return updated_row;
end $$;
grant execute on function app.reassign_attachment(uuid, uuid, uuid, text) to authenticated; -- ログイン済みユーザに関数の権限を付与

-- ファイルの削除
drop function if exists app.delete_attachment(uuid) cascade;
create or replace function app.delete_attachment(in_id uuid)
returns void
language plpgsql
volatile
set search_path = app, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  if not exists(select 1 from app.attachments a where a.id = in_id and a.owner_user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from app.attachments where id = in_id;
end $$;
grant execute on function app.delete_attachment(uuid) to authenticated; -- ログイン済みユーザに関数の権限を付与

-- 添付ファイル一覧の取得
drop function if exists app.list_my_attachments(uuid, uuid, text) cascade;
create or replace function app.list_my_attachments(
  in_project_id uuid default null,
  in_thread_id  uuid default null,
  in_mime_prefix text default 'image/'
)
returns setof app.attachments
language sql
stable
set search_path = app, pg_temp
as $$
  select *
    from app.attachments a
   where a.owner_user_id = auth.uid()
     and (in_project_id is null or a.project_id = in_project_id)
     and (in_thread_id  is null or a.thread_id  = in_thread_id)
     and (in_mime_prefix is null or a.mime like in_mime_prefix || '%')
   order by a.created_at desc
$$;
grant execute on function app.list_my_attachments(uuid, uuid, text) to authenticated; -- ログイン済みユーザに関数の権限を付与

-- =========================================
-- K-2) RPC: RAG 公開・クローン（datasets公開 / packageクローン / containerクローン）
-- =========================================

-- 1-1) データセットの公開/非公開切替
drop function if exists app.publish_dataset(uuid, boolean) cascade;
create or replace function app.publish_dataset(
  in_dataset_id uuid,
  in_public     boolean default true
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_owner uuid;
begin
  -- データセット所有者か確認（存在チェックも兼ねる）
  select d.owner_id
    into v_owner
  from app.datasets d
  where d.id = in_dataset_id;
  -- 存在チェック
  if v_owner is null then
    raise exception 'dataset not found: %', in_dataset_id using errcode = '22P02';
  end if;
  -- データの所有者チェック
  if v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update app.datasets
     -- 公開/非公開の変更
     set visibility = case when in_public then 'public'::app.visibility_t
                           else 'private'::app.visibility_t end,
         updated_at = now()
   where id = in_dataset_id;
end $$;
revoke all on function app.publish_dataset(uuid, boolean) from public;
grant execute on function app.publish_dataset(uuid, boolean) to authenticated;

-- 1-2) パッケージの公開/非公開切替
drop function if exists app.publish_package(uuid, boolean) cascade;
create or replace function app.publish_package(
  in_package_id uuid,
  in_public     boolean default true
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare v_owner uuid;
begin
  select p.owner_id into v_owner
  from app.packages p
  where p.id = in_package_id;

  if v_owner is null then
    raise exception 'package not found: %', in_package_id using errcode = '22P02';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update app.packages
     set visibility = case when in_public then 'public'::app.visibility_t else 'private'::app.visibility_t end,
         updated_at = now()
   where id = in_package_id;
end $$;
revoke all on function app.publish_package(uuid, boolean) from public;
grant execute on function app.publish_package(uuid, boolean) to authenticated;

-- 1-3) コンテナの公開/非公開切替
drop function if exists app.publish_container(uuid, boolean) cascade;
create or replace function app.publish_container(
  in_container_id uuid,
  in_public       boolean default true
)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare v_owner uuid;
begin
  select c.owner_id into v_owner
  from app.containers c
  where c.id = in_container_id;

  if v_owner is null then
    raise exception 'container not found: %', in_container_id using errcode = '22P02';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update app.containers
     set visibility = case when in_public then 'public'::app.visibility_t else 'private'::app.visibility_t end,
         updated_at = now()
   where id = in_container_id;
end $$;
revoke all on function app.publish_container(uuid, boolean) from public;
grant execute on function app.publish_container(uuid, boolean) to authenticated;

-- 2-1) 公開（または参照可能）データセットを自分名義にクローン
drop function if exists app.clone_dataset(uuid, uuid, text) cascade;
create or replace function app.clone_dataset(
  in_dataset_id uuid,                   -- 元データセット
  in_project_id uuid default null,      -- クローンの紐づけ先プロジェクト（null可）
  in_new_name  text default null        -- 名前を変えたいとき
)
returns uuid  -- 作成した新しい dataset_id
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  new_ds_id uuid;
begin
  -- 元データセットの読み取りは RLS により「自分が見えるもの」のみ許可されている想定
  -- クローン本体（owner=自分, visibility=private、projectは引数で上書き）
  insert into app.datasets (owner_id, project_id, name, description, visibility, source_type, metadata)
  select auth.uid(),
         in_project_id,                        -- ← 任意で紐づけ（null可）
         coalesce(in_new_name, d.name),
         d.description,
         'private',
         d.source_type,
         d.metadata
    from app.datasets d
   where d.id = in_dataset_id
   returning id into new_ds_id;

  -- dataset_documents の結線を複製
  insert into app.dataset_documents (dataset_id, document_id, added_by)
  select new_ds_id, dd.document_id, auth.uid()
    from app.dataset_documents dd
   where dd.dataset_id = in_dataset_id;

  return new_ds_id;
end $$;
revoke all on function app.clone_dataset(uuid, uuid, text) from public;
grant execute on function app.clone_dataset(uuid, uuid, text) to authenticated;


-- 2-2) 公開（または参照可能）パッケージを自分名義にクローン
drop function if exists app.clone_package(uuid, text) cascade;
create or replace function app.clone_package(in_package_id uuid, in_new_name text default null)
returns uuid  -- 作成した新しい package_id
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare new_pkg_id uuid;
begin
  -- 読めること（owner or public）前提（RLSが強制）
  insert into app.packages (owner_id, name, category, description, visibility, forked_from_package_id, tags, metadata)  -- 複製
  select auth.uid(),
         coalesce(in_new_name, p.name),
         p.category, p.description, 'private', p.id, p.tags, p.metadata
    from app.packages p
   where p.id = in_package_id
   returning id into new_pkg_id;

  -- versions を複製
  insert into app.package_versions (package_id, version, system_prompt, templates, assets, published)
  select new_pkg_id, pv.version, pv.system_prompt, pv.templates, pv.assets, false
    from app.package_versions pv
   where pv.package_id = in_package_id;

  -- package_datasets を複製
  insert into app.package_datasets (package_id, dataset_id)
  select new_pkg_id, pd.dataset_id
    from app.package_datasets pd
   where pd.package_id = in_package_id;

  return new_pkg_id;
end $$;
revoke all on function app.clone_package(uuid, text) from public;
grant execute on function app.clone_package(uuid, text) to authenticated;


-- 2-3) 公開（または参照可能）コンテナを自分のプロジェクトへクローン
drop function if exists app.clone_container(uuid, uuid, text) cascade;
create or replace function app.clone_container(in_container_id uuid, in_project_id uuid default null, in_new_name text default null)
returns uuid  -- 作成する新しい container_id
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare new_ctr_id uuid;
begin
  insert into app.containers (project_id, owner_id, name, description, visibility, forked_from_container_id,
                              temperature, rag_top_k, metadata)
  select in_project_id, auth.uid(), coalesce(in_new_name, c.name), c.description, 'private', c.id,
         c.temperature, c.rag_top_k, c.metadata
    from app.containers c
   where c.id = in_container_id
   returning id into new_ctr_id;

  -- パッケージ順序の複製
  insert into app.container_packages (container_id, package_version_id, order_index, is_enabled, notes)
  select new_ctr_id, cp.package_version_id, cp.order_index, cp.is_enabled, cp.notes
    from app.container_packages cp
   where cp.container_id = in_container_id;

  -- データセット参照の複製（公開集合はそのまま参照。編集したい場合は後で自分の集合を作って差し替える）
  insert into app.container_datasets (container_id, dataset_id, weight, filters)
  select new_ctr_id, cd.dataset_id, cd.weight, cd.filters
    from app.container_datasets cd
   where cd.container_id = in_container_id;

  return new_ctr_id;
end $$;
revoke all on function app.clone_container(uuid, uuid, text) from public;
grant execute on function app.clone_container(uuid, uuid, text) to authenticated;



-- ============================
-- L) RPC（メイン）
-- ============================

-- L-1) project関連
create or replace function app.create_project(
  name text,
  overview text default null
)
returns app.projects
language plpgsql
security definer
set search_path = app, public, extensions
as $func$
declare
  new_project app.projects;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  insert into app.projects (user_id, name, overview)
  values (auth.uid(), name, overview)
  returning * into new_project;

  return new_project;
end
$func$;

revoke all on function app.create_project(text, text) from public;
grant execute on function app.create_project(text, text) to authenticated;




-- =========================================
-- M) GRANT / REVOKE / 既存ユーザ初期整備 / ANALYZE
-- =========================================
revoke all on schema app from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
  -- 管理者DB権限の作成
    if not exists (select 1 from pg_roles where rolname = 'app_admins') then
      execute 'create role app_admins noinherit nologin';
    end if;
    
    grant usage on schema app to authenticated;
    grant usage on schema auth    to authenticated;
    grant usage on schema storage to authenticated;
    
    -- 認証済みユーザに各種権限を付与（RLSには順守）
    grant select, insert, update, delete
      on app.profiles, app.projects, app.threads, app.messages
      to authenticated;
    grant select on app.user_roles to authenticated;

    grant select, insert, update, delete
      on app.attachments, app.documents, app.chunks, app.lc_documents
      to authenticated;

    grant select
      on app.v_users, app.v_projects, app.v_threads, app.v_messages, app.v_me, app.v_my_role
      to authenticated;
    grant select on app.v_admin_users to app_admins;

    revoke all on function app.admin_list_users()                 from public;
    revoke all on function app.admin_set_user_role(uuid, text)    from public;
    grant execute on function app.admin_list_users()              to app_admins;
    grant execute on function app.admin_set_user_role(uuid, text) to app_admins; 

    grant execute on function app.jwt_role()                             to authenticated;
    grant execute on function app.is_admin_or_superuser_claim()          to authenticated;
    grant execute on function app.may_assign_role_from_claim(text)       to authenticated;
    grant execute on function app.can_read_all_users_from_claim()        to authenticated;

    grant execute on function app.match_documents_scoped(vector,int,uuid,uuid) to authenticated;
    grant execute on function app.match_by_document_ids(vector,int,uuid[])     to authenticated;
    grant execute on function app.match_documents(vector,int)                  to authenticated;
    grant execute on function app.match_lc_documents(vector,int)               to authenticated;

  end if;
  -- anonの権利をはく奪
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema app from anon;
    revoke all on all sequences in schema app from anon;
    revoke usage on schema app from anon;
  end if;
end $$;

-- service_roleと認証済みユーザに
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage, select on all sequences in schema app to service_role;
    grant select, insert, update, delete on all tables in schema app to service_role;
    grant usage on schema app to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage, select on all sequences in schema app to authenticated;
  end if;
end $$;

alter default privileges in schema app grant usage, select on sequences to service_role;
alter default privileges in schema app grant usage, select on sequences to authenticated;

grant usage, select on sequence app.chunks_id_seq to authenticated;

-- 統計
analyze app.chunks;
