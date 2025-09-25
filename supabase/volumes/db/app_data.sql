-- =========================================
-- 0) 準備
-- =========================================
create extension if not exists pgcrypto;    -- gebn_random_uuid()などの暗号化関連の関数が使用できるようにする
create schema if not exists app;            -- app スキーマを作成
-- appスキーマ内にtouch_update_at()関数を作成
create or replace function app.touch_updated_at()
-- 関数の本体を PL/pgSQL 言語で書くという宣言
returns trigger language plpgsql as $$      -- $$で囲まれた部分が関数本体
begin
  new.updated_at := now();
  return new;
end $$;

-- =========================================
-- 1) 物理テーブル
--    profiles / projects / threads / messages
-- =========================================

-- 1-1) profiles (Zustand: User)
create table if not exists app.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 
-- 再実行安全のための文で、trg_profiles_touch_updated_atが何回でも生成できるようにする
drop trigger if exists trg_profiles_touch_updated_at on app.profiles;
create trigger trg_profiles_touch_updated_at
before update on app.profiles
for each row execute function app.touch_updated_at();

-- 1-2) projects (Zustand: Project, 単一オーナー制)
create table if not exists app.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  overview   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_user on app.projects(user_id);
drop trigger if exists trg_projects_touch_updated_at on app.projects;
create trigger trg_projects_touch_updated_at
before update on app.projects
for each row execute function app.touch_updated_at();

-- 1-3) threads (Zustand: Thread)
create table if not exists app.threads (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_threads_project on app.threads(project_id);
drop trigger if exists trg_threads_touch_updated_at on app.threads;
create trigger trg_threads_touch_updated_at
before update on app.threads
for each row execute function app.touch_updated_at();

-- 1-4) messages (Zustand: Message)
create table if not exists app.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references app.threads(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_thread_created
  on app.messages(thread_id, created_at);

-- =========================================
-- 2) グローバル権限（ユーザ権限）※ Userテーブルに直書きしない
-- =========================================
create table if not exists app.global_roles (
  role_key text primary key,              -- 'superuser' | 'admin' | 'developer' | 'user'
  weight   int  not null,                 -- 強さ: superuser=100 > admin=80 > developer=60 > user=20
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

-- 各ユーザのグローバル権限割当（1人1役）
create table if not exists app.user_roles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  role_key  text not null references app.global_roles(role_key),
  granted_at timestamptz not null default now(),
  granted_by uuid null references auth.users(id)
);

-- =========================================
-- 3) 権限ヘルパ関数
-- =========================================

-- 現在ユーザの role_key（未割当なら 'user' とみなす）
create or replace function app.current_global_role()
returns text language sql stable as $$
  select coalesce(
    (select ur.role_key from app.user_roles ur
      where ur.user_id = auth.uid() limit 1),
    'user'
  )
$$;

create or replace function app.is_superuser()
returns boolean language sql stable as $$
  select app.current_global_role() = 'superuser'
$$;

create or replace function app.is_admin()
returns boolean language sql stable as $$
  select app.current_global_role() = 'admin'
$$;

create or replace function app.is_admin_or_superuser()
returns boolean language sql stable as $$
  select app.current_global_role() in ('superuser','admin')
$$;

create or replace function app.can_read_all_users()
returns boolean language sql stable as $$
  select coalesce((
    select gr.can_read_all_users
    from app.global_roles gr
    where gr.role_key = app.current_global_role()
  ), false)
$$;

create or replace function app.can_register_user()
returns boolean language sql stable as $$
  select coalesce((
    select gr.can_register_user
    from app.global_roles gr
    where gr.role_key = app.current_global_role()
  ), false)
$$;

create or replace function app.can_delete_user()
returns boolean language sql stable as $$
  select coalesce((
    select gr.can_delete_user
    from app.global_roles gr
    where gr.role_key = app.current_global_role()
  ), false)
$$;

create or replace function app.can_access_dev_system()
returns boolean language sql stable as $$
  select coalesce((
    select gr.can_access_dev_system
    from app.global_roles gr
    where gr.role_key = app.current_global_role()
  ), false)
$$;

-- 付与可能か（spec: superuser→admin/dev/user、admin→dev/user）
create or replace function app.may_assign_role(target_role text)
returns boolean language sql stable as $$
  select case
    when app.current_global_role() = 'superuser' and target_role in ('admin','developer','user') then true
    when app.current_global_role() = 'admin'      and target_role in ('developer','user')        then true
    else false
  end
$$;

-- ここから追記: JWTクレームのみで判定する軽量関数（RLS内で使用）
create or replace function app.jwt_role()
returns text language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role')::text, 'user')
$$;

create or replace function app.is_admin_or_superuser_claim()
returns boolean language sql stable as $$
  select app.jwt_role() in ('superuser','admin')
$$;

create or replace function app.may_assign_role_from_claim(target_role text)
returns boolean language sql stable as $$
  select case
    when app.jwt_role() = 'superuser' and target_role in ('admin','developer','user') then true
    when app.jwt_role() = 'admin'      and target_role in ('developer','user')        then true
    else false
  end
$$;

create or replace function app.can_read_all_users_from_claim()
returns boolean language sql stable as $$
  select coalesce((
    select gr.can_read_all_users
    from app.global_roles gr
    where gr.role_key = app.jwt_role()
  ), false)
$$;

-- =========================================
-- 4) RLS（行レベルセキュリティ）
-- =========================================
alter table app.profiles  enable row level security;
alter table app.projects  enable row level security;
alter table app.threads   enable row level security;
alter table app.messages  enable row level security;
alter table app.user_roles enable row level security;

-- 所有者でも RLS 必須（推奨）
alter table app.profiles  force row level security;
alter table app.projects  force row level security;
alter table app.threads   force row level security;
alter table app.messages  force row level security;
alter table app.user_roles force row level security;

-- profiles: 自分 or can_read_all_users()
drop policy if exists prf_sel on app.profiles;
create policy prf_sel on app.profiles
for select using (auth.uid() is not null and (user_id = auth.uid() or app.can_read_all_users()));

drop policy if exists prf_ins on app.profiles;
create policy prf_ins on app.profiles
for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists prf_upd on app.profiles;
create policy prf_upd on app.profiles
for update using (auth.uid() is not null and user_id = auth.uid())
with check   (auth.uid() is not null and user_id = auth.uid());

-- projects/threads/messages: これまで通り“自分のものだけ”
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

drop policy if exists th_sel on app.threads;
create policy th_sel on app.threads
for select using (
  auth.uid() is not null and exists (
    select 1 from app.projects p
    where p.id = app.threads.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists th_ins on app.threads;
create policy th_ins on app.threads
for insert with check (
  auth.uid() is not null and exists (
    select 1 from app.projects p
    where p.id = app.threads.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists th_upd on app.threads;
create policy th_upd on app.threads
for update using (
  auth.uid() is not null and exists (
    select 1 from app.projects p
    where p.id = app.threads.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() is not null and exists (
    select 1 from app.projects p
    where p.id = app.threads.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists th_del on app.threads;
create policy th_del on app.threads
for delete using (
  auth.uid() is not null and exists (
    select 1 from app.projects p
    where p.id = app.threads.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists msg_sel on app.messages;
create policy msg_sel on app.messages
for select using (
  auth.uid() is not null and exists (
    select 1
    from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists msg_ins on app.messages;
create policy msg_ins on app.messages
for insert with check (
  auth.uid() is not null and role in ('user','assistant') and exists (
    select 1
    from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists msg_upd on app.messages;
create policy msg_upd on app.messages
for update using (
  auth.uid() is not null and exists (
    select 1
    from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id
      and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() is not null and role in ('user','assistant') and exists (
    select 1
    from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists msg_del on app.messages;
create policy msg_del on app.messages
for delete using (
  auth.uid() is not null and exists (
    select 1
    from app.threads t
    join app.projects p on p.id = t.project_id
    where t.id = app.messages.thread_id
      and p.user_id = auth.uid()
  )
);

-- user_roles: 自分の行は閲覧可、管理のため admin/superuser は全件閲覧可
alter table app.user_roles enable row level security;
alter table app.user_roles force row level security;

drop policy if exists ur_sel on app.user_roles;
create policy ur_sel on app.user_roles
for select using (
  auth.uid() is not null
  and (user_id = auth.uid() or app.is_admin_or_superuser_claim())
);

-- 付与（INSERT/UPDATE）は may_assign_role() で制限
drop policy if exists ur_ins on app.user_roles;
create policy ur_ins on app.user_roles
for insert with check (
  auth.uid() is not null
  and app.may_assign_role_from_claim(role_key)
);

drop policy if exists ur_upd on app.user_roles;
create policy ur_upd on app.user_roles
for update using (
  auth.uid() is not null
  and app.is_admin_or_superuser_claim()
)
with check (
  auth.uid() is not null
  and app.may_assign_role_from_claim(role_key)
);

-- 削除（= 役割の解除）: admin/superuser のみ、かつ対象ロールが付与可能な範囲だけ
drop policy if exists ur_del on app.user_roles;
create policy ur_del on app.user_roles
for delete using (
  auth.uid() is not null
  and app.is_admin_or_superuser_claim()
  and app.may_assign_role_from_claim(role_key)
);

-- =========================================
-- 5) 認証連携（新規ユーザ作成時の初期化）
--    profiles と user_roles を自動作成（role は 'user' 初期値）
-- =========================================
drop trigger if exists trg_handle_new_user on auth.users;
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = app, public, extensions
as $$
begin
  insert into app.profiles(user_id, name)
  values (new.id, coalesce((new.raw_user_meta_data->>'name')::text, ''))
  on conflict (user_id) do nothing;

  insert into app.user_roles(user_id, role_key, granted_by)
  values (new.id, 'user', new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

create trigger trg_handle_new_user
after insert on auth.users
for each row execute function app.handle_new_user();

-- =========================================
-- 6) ビュー（camelCase ＋ おまけ）
-- =========================================
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

-- ============================================================
-- 6-A) 管理ページ用: 全ユーザ参照のためのビュー（参考）
--      ※ [追加] RLSはビューに直接効かないため、"参考/内部用"。
--         実際の取得は下の SECURITY DEFINER 関数経由を推奨。
-- ============================================================
create or replace view app.v_admin_users as
select
  u.id,
  u.email::text as email,                 -- [追加] 型不一致対策: 明示キャスト
  u.created_at,
  u.last_sign_in_at,
  coalesce(p.name, '')::text as name,     -- [追加] 明示キャスト
  coalesce(r.role_key, 'user')::text as role  -- [追加] 明示キャスト
from auth.users u
left join app.profiles p on p.user_id = u.id
left join app.user_roles r on r.user_id = u.id;

-- ============================================================
-- 6-B) 管理ページ用: 全ユーザ一覧取得の安全なRPC
--      ※ [追加] 権限を関数内部でチェックし、auth.users を安全に返す
-- ============================================================
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
set search_path = app, public, extensions
as $$
begin
  -- [追加] 権限チェック: admin 以上 または can_read_all_users() フラグ
  if not (app.is_admin_or_superuser_claim() or app.can_read_all_users_from_claim()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select
      u.id,
      u.email::text,                              -- [追加] 戻り型 text と一致させる
      u.created_at,
      u.last_sign_in_at,
      coalesce(p.name, '')::text as name,         -- [追加] 明示キャスト
      coalesce(r.role_key, 'user')::text as role  -- [追加] 明示キャスト
    from auth.users u
    left join app.profiles p on p.user_id = u.id
    left join app.user_roles r on r.user_id = u.id
    order by u.created_at desc;
end
$$;

-- ============================================================
-- 6-C) 管理ページ用: ロール付与/変更の安全なRPC（任意）
--      ※ [追加] admin/superuser の許可範囲内のみアップサート
-- ============================================================
drop function if exists app.admin_set_user_role(uuid, text) cascade;
create or replace function app.admin_set_user_role(target_user_id uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = app, public, extensions
as $$
begin
  -- [追加] 呼出ユーザが対象ロールを付与できるか
  if not app.may_assign_role_from_claim(target_role) then
    raise exception 'forbidden to assign role %', target_role using errcode = '42501';
  end if;

  -- [追加] 存在するロールか
  if not exists (select 1 from app.global_roles where role_key = target_role) then
    raise exception 'unknown role %', target_role using errcode = '22P02';
  end if;

  insert into app.user_roles(user_id, role_key, granted_by)
  values (target_user_id, target_role, auth.uid())
  on conflict (user_id) do update
    set role_key = excluded.role_key,
        granted_by = auth.uid(),
        granted_at = now();
end
$$;

-- =========================================
-- 7) 権限（GRANT/REVOKE）
-- =========================================
revoke all on schema app from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema app to authenticated;

    grant select, insert, update, delete
      on app.profiles, app.projects, app.threads, app.messages, app.user_roles
      to authenticated;

    grant select, insert, update, delete
      on app.v_users, app.v_projects, app.v_threads, app.v_messages, app.v_me, app.v_my_role
      to authenticated;

    grant select on app.global_roles to authenticated;

    -- [追加] 管理用ビューは「直接用途は限定」。読み取り権限は付けるが、
    --        原則は admin_list_users() 関数経由で取得すること
    grant select on app.v_admin_users to authenticated;

    -- [追加] 管理用RPCを認証ユーザに許可（関数内部で権限チェック）
    grant execute on function app.admin_list_users() to authenticated;
    grant execute on function app.admin_set_user_role(uuid, text) to authenticated;

    -- [追加] API側で RPC として呼ぶための実行権限
    grant execute on function app.is_admin_or_superuser() to authenticated;

    -- 追記: JWTクレーム判定系も実行許可
    grant execute on function app.jwt_role()                             to authenticated;
    grant execute on function app.is_admin_or_superuser_claim()          to authenticated;
    grant execute on function app.may_assign_role_from_claim(text)       to authenticated;
    grant execute on function app.can_read_all_users_from_claim()        to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema app from anon;
    revoke all on all sequences in schema app from anon;
    revoke usage on schema app from anon;
  end if;
end$$;

-- =========================================
-- 8) 初期整備メモ（手動）
-- =========================================
-- 1) 既存ユーザに role が付いていない場合は 'user' で補完
insert into app.user_roles(user_id, role_key)
select u.id, 'user'
from auth.users u
left join app.user_roles r on r.user_id = u.id
where r.user_id is null;

-- 2) 初回の“自分を superuser に”する（UUID を差し替え）
-- update app.user_roles set role_key = 'superuser' where user_id = '<YOUR-UUID>';

-- ============================
-- app.create_project (RPC)
-- ============================
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
  -- ログイン中ユーザを特定（NULL なら弾く）
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000'; -- invalid authorization specification
  end if;

  insert into app.projects (user_id, name, overview)
  values (auth.uid(), name, overview)
  returning * into new_project;

  return new_project;
end
$func$;

-- 公開権限は外す（セキュリティ）
revoke all on function app.create_project(text, text) from public;

-- 認証済みユーザにだけ実行を許可
grant execute on function app.create_project(text, text) to authenticated;
