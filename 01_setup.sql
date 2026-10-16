-- =====================================================================
--  ORDER PULSE — DATABASE SETUP
--  Run this whole file ONCE in Supabase → SQL Editor → New query → Run.
--  It is safe to run again later (it updates functions/policies in place).
--
--  >>> BEFORE RUNNING: replace  YOUR_ADMIN_EMAIL@example.com  (bottom of
--      this file, section 12) with the email you will use as administrator.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Emails that automatically become administrators when they sign up.
create table if not exists public.admin_emails (
  email text primary key
);

-- One row per registered user (created automatically on sign-up).
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  full_name    text,
  role         text not null default 'user'    check (role in ('user','admin')),
  status       text not null default 'pending' check (status in ('pending','approved','blocked')),
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  last_seen    timestamptz
);

-- App-wide settings (exactly one row, id = 1).
create table if not exists public.app_settings (
  id                     int primary key default 1 check (id = 1),
  order_timeout_seconds  int     not null default 120 check (order_timeout_seconds >= 0),
  trading_enabled        boolean not null default true,
  announcement           text    not null default '',
  updated_at             timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- Private admin-only settings (for future Telegram alerts etc.).
create table if not exists public.admin_secrets (
  id                  int primary key default 1 check (id = 1),
  telegram_enabled    boolean not null default false,
  telegram_bot_token  text,
  telegram_chat_id    text
);
insert into public.admin_secrets (id) values (1) on conflict (id) do nothing;

-- THE SHARE LIST shown to users. Edit this table to change what users see.
create table if not exists public.shares (
  id               bigint generated always as identity primary key,
  name             text    not null,
  status           text    not null default 'open'
                   check (status in ('upcoming','open','closed','allotted','listed')),
  open_date        date,                 -- "Date" (IPO opens)
  close_date       date,                 -- IPO closes
  price            numeric(12,2),        -- issue price (upper band) per share
  issue_size_cr    numeric(14,2),        -- issue size in ₹ crore
  gmp              numeric(12,2) not null default 0,   -- GMP rumour per share
  buy_price        numeric(12,2),        -- price at which USERS can BUY
  sell_price       numeric(12,2),        -- price at which USERS can SELL
  lot_size         int     not null default 1 check (lot_size > 0),   -- shares per lot
  retail_lots      int     not null default 1 check (retail_lots > 0),
  hni_lots         int     not null default 14 check (hni_lots > 0),  -- # of lots for HNI
  allotment_date   date,
  listing_date     date,
  trading_enabled  boolean not null default true,   -- show/hide the Trade button
  visible          boolean not null default true,   -- show/hide the share in the list
  sort_order       int     not null default 0,      -- lower number = higher in list
  notes            text,
  profit_retail    numeric(14,2) generated always as (gmp * lot_size * retail_lots) stored,
  profit_hni       numeric(14,2) generated always as (gmp * lot_size * hni_lots) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Every Buy/Sell offer a user makes.
create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  share_id       bigint references public.shares(id) on delete set null,
  share_name     text   not null,
  side           text   not null check (side in ('buy','sell')),   -- from the USER's point of view
  qty            int    not null check (qty > 0),
  price          numeric(12,2) not null,
  gmp            numeric(12,2),
  status         text   not null default 'pending'
                 check (status in ('pending','accepted','countered','rejected','expired','cancelled')),
  counter_price  numeric(12,2),
  admin_note     text,
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  responded_by   uuid
);
create index if not exists orders_user_idx    on public.orders(user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders(status, created_at desc);

-- Ledger: one line per ACCEPTED order.
--   User BUY  → shares credited (qty_credit),  rupees debited  (amount_debit)
--   User SELL → shares debited  (qty_debit),   rupees credited (amount_credit)
create table if not exists public.ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid   not null references public.profiles(id) on delete cascade,
  order_id       bigint unique references public.orders(id) on delete set null,
  share_id       bigint references public.shares(id) on delete set null,
  share_name     text   not null,
  side           text   not null check (side in ('buy','sell')),
  qty            int    not null,
  price          numeric(12,2) not null,
  amount         numeric(16,2) not null,
  qty_debit      int    not null default 0,
  qty_credit     int    not null default 0,
  amount_debit   numeric(16,2) not null default 0,
  amount_credit  numeric(16,2) not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists ledger_user_idx on public.ledger(user_id, created_at);

-- Everything that happens, with timestamp.
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  actor        uuid,
  actor_email  text,
  action       text not null,
  entity       text,
  entity_id    text,
  details      jsonb not null default '{}'::jsonb
);
create index if not exists audit_ts_idx on public.audit_log(ts desc);

-- Daily summary reports (generated automatically every night).
create table if not exists public.daily_reports (
  report_date   date primary key,
  generated_at  timestamptz not null default now(),
  data          jsonb not null
);

-- Ledger with running balances (respects each viewer's permissions).
create or replace view public.ledger_view with (security_invoker = true) as
select l.*,
       p.email,
       p.full_name,
       sum(l.amount_credit - l.amount_debit)
         over (partition by l.user_id order by l.created_at, l.id)              as balance,
       sum(l.qty_credit - l.qty_debit)
         over (partition by l.user_id, l.share_name order by l.created_at, l.id) as share_holding
from public.ledger l
join public.profiles p on p.id = l.user_id;

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'approved');
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists shares_touch on public.shares;
create trigger shares_touch before update on public.shares
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.app_settings;
create trigger settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. AUTO-CREATE PROFILE ON SIGN-UP
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_admin boolean;
begin
  v_admin := exists (select 1 from public.admin_emails where lower(email) = lower(new.email));
  insert into public.profiles (id, email, full_name, role, status, approved_at)
  values (new.id, lower(new.email),
          nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), ''),
          case when v_admin then 'admin' else 'user' end,
          case when v_admin then 'approved' else 'pending' end,
          case when v_admin then now() end)
  on conflict (id) do nothing;
  insert into public.audit_log (actor, actor_email, action, entity, entity_id)
  values (new.id, lower(new.email), 'signup', 'profiles', new.id::text);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. AUDIT TRIGGER — logs every change to shares, users and settings,
--    including edits made directly in the Supabase Table Editor.
-- ---------------------------------------------------------------------
create or replace function public.audit_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_email   text;
  v_id      text;
  v_details jsonb;
begin
  if v_actor is not null then
    select email into v_email from public.profiles where id = v_actor;
  end if;

  if tg_op = 'DELETE' then
    v_id := to_jsonb(old)->>'id';
    v_details := jsonb_build_object('deleted', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    v_id := to_jsonb(new)->>'id';
    v_details := jsonb_build_object('created', to_jsonb(new));
  else
    v_id := to_jsonb(new)->>'id';
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_details
      from jsonb_each(to_jsonb(new)) as n(key, value)
      join jsonb_each(to_jsonb(old)) as o(key, value) on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('updated_at','last_seen','profit_retail','profit_hni');
    if v_details is null then return new; end if;   -- nothing meaningful changed
  end if;

  insert into public.audit_log (actor, actor_email, action, entity, entity_id, details)
  values (v_actor,
          coalesce(v_email, case when v_actor is null then 'supabase dashboard' end),
          lower(tg_op), tg_table_name, v_id, v_details);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_shares on public.shares;
create trigger audit_shares after insert or update or delete on public.shares
  for each row execute function public.audit_changes();
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update or delete on public.profiles
  for each row execute function public.audit_changes();
drop trigger if exists audit_settings on public.app_settings;
create trigger audit_settings after update on public.app_settings
  for each row execute function public.audit_changes();

-- ---------------------------------------------------------------------
-- 5. APP FUNCTIONS (called by the app)
-- ---------------------------------------------------------------------

-- Login page: tells the app whether an email is registered.
-- Returns 'none' | 'pending' | 'approved' | 'blocked'
create or replace function public.check_email(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select status from public.profiles where email = lower(trim(p_email))), 'none');
$$;

-- Users call this every minute so admin can see "last seen".
create or replace function public.heartbeat() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now() where id = auth.uid();
$$;

-- Expire orders the admin did not answer in time (0 = never expire).
create or replace function public.expire_stale_orders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.orders o
     set status = 'expired', responded_at = now()
    from public.app_settings s
   where s.id = 1
     and s.order_timeout_seconds > 0
     and o.status = 'pending'
     and o.created_at < now() - make_interval(secs => s.order_timeout_seconds);
  get diagnostics n = row_count;
  return n;
end $$;

-- User places a Buy / Sell offer. Price is always taken from the database.
create or replace function public.place_order(
  p_share_id bigint, p_side text, p_qty int, p_expected_price numeric default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  public.profiles;
  v_set   public.app_settings;
  v_share public.shares;
  v_price numeric;
  v_order public.orders;
begin
  if v_uid is null then raise exception 'OP_NOT_SIGNED_IN'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  if not found or v_prof.status <> 'approved' then raise exception 'OP_NOT_APPROVED'; end if;

  select * into v_set from public.app_settings where id = 1;
  if not v_set.trading_enabled then raise exception 'OP_TRADING_PAUSED'; end if;
  if p_side not in ('buy','sell') then raise exception 'OP_BAD_SIDE'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'OP_BAD_QTY'; end if;

  select * into v_share from public.shares where id = p_share_id;
  if not found or not v_share.visible then raise exception 'OP_SHARE_NOT_FOUND'; end if;
  if not v_share.trading_enabled then raise exception 'OP_SHARE_CLOSED'; end if;

  v_price := case when p_side = 'buy' then v_share.buy_price else v_share.sell_price end;
  if v_price is null or v_price <= 0 then raise exception 'OP_NO_PRICE'; end if;
  if p_expected_price is not null and p_expected_price <> v_price then
    raise exception 'OP_PRICE_CHANGED';
  end if;

  perform public.expire_stale_orders();
  if exists (select 1 from public.orders where user_id = v_uid and status = 'pending') then
    raise exception 'OP_ORDER_PENDING';
  end if;

  insert into public.orders (user_id, share_id, share_name, side, qty, price, gmp)
  values (v_uid, v_share.id, v_share.name, p_side, p_qty, v_price, v_share.gmp)
  returning * into v_order;

  insert into public.audit_log (actor, actor_email, action, entity, entity_id, details)
  values (v_uid, v_prof.email, 'order_placed', 'orders', v_order.id::text,
          jsonb_build_object('share', v_share.name, 'side', p_side, 'qty', p_qty, 'price', v_price));
  return v_order;
end $$;

-- User withdraws their own pending order.
create or replace function public.cancel_my_order(p_order_id bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  update public.orders set status = 'cancelled', responded_at = now()
   where id = p_order_id and user_id = auth.uid() and status = 'pending'
  returning * into v_o;
  if found then
    insert into public.audit_log (actor, actor_email, action, entity, entity_id)
    values (auth.uid(), (select email from public.profiles where id = auth.uid()),
            'order_cancelled', 'orders', p_order_id::text);
  end if;
  return v_o;
end $$;

-- Admin answers an order: 'accept' | 'counter' | 'reject'
create or replace function public.respond_order(
  p_order_id bigint, p_action text, p_new_price numeric default null, p_note text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_o      public.orders;
  v_admin  uuid := auth.uid();
  v_email  text;
begin
  if not public.is_admin() then raise exception 'OP_NOT_ADMIN'; end if;
  select email into v_email from public.profiles where id = v_admin;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'OP_ORDER_NOT_FOUND'; end if;
  if v_o.status <> 'pending' then raise exception 'OP_ALREADY_HANDLED'; end if;

  if p_action = 'accept' then
    update public.orders
       set status = 'accepted', responded_at = now(), responded_by = v_admin, admin_note = p_note
     where id = v_o.id returning * into v_o;

    insert into public.ledger (user_id, order_id, share_id, share_name, side, qty, price, amount,
                               qty_debit, qty_credit, amount_debit, amount_credit)
    values (v_o.user_id, v_o.id, v_o.share_id, v_o.share_name, v_o.side, v_o.qty, v_o.price,
            v_o.qty * v_o.price,
            case when v_o.side = 'sell' then v_o.qty else 0 end,
            case when v_o.side = 'buy'  then v_o.qty else 0 end,
            case when v_o.side = 'buy'  then v_o.qty * v_o.price else 0 end,
            case when v_o.side = 'sell' then v_o.qty * v_o.price else 0 end);

  elsif p_action = 'counter' then
    if p_new_price is null or p_new_price <= 0 then raise exception 'OP_BAD_PRICE'; end if;
    -- New price applies to EVERYONE from now on. Accepted orders are untouched.
    if v_o.side = 'buy' then
      update public.shares set buy_price  = p_new_price where id = v_o.share_id;
    else
      update public.shares set sell_price = p_new_price where id = v_o.share_id;
    end if;
    update public.orders
       set status = 'countered', counter_price = p_new_price, responded_at = now(),
           responded_by = v_admin, admin_note = p_note
     where id = v_o.id returning * into v_o;

  elsif p_action = 'reject' then
    update public.orders
       set status = 'rejected', responded_at = now(), responded_by = v_admin, admin_note = p_note
     where id = v_o.id returning * into v_o;
  else
    raise exception 'OP_BAD_ACTION';
  end if;

  insert into public.audit_log (actor, actor_email, action, entity, entity_id, details)
  values (v_admin, v_email, 'order_' || p_action, 'orders', v_o.id::text,
          jsonb_build_object('user_id', v_o.user_id, 'share', v_o.share_name, 'side', v_o.side,
                             'qty', v_o.qty, 'price', v_o.price, 'new_price', p_new_price));
  return v_o;
end $$;

-- Admin approves / blocks a user.
create or replace function public.admin_set_user_status(p_user uuid, p_status text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles;
begin
  if not public.is_admin() then raise exception 'OP_NOT_ADMIN'; end if;
  if p_status not in ('pending','approved','blocked') then raise exception 'OP_BAD_STATUS'; end if;
  if p_user = auth.uid() then raise exception 'OP_CANNOT_CHANGE_SELF'; end if;
  update public.profiles
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else approved_at end
   where id = p_user returning * into v_p;
  return v_p;
end $$;

-- Daily summary report (date in India time). Default = yesterday.
create or replace function public.generate_daily_report(
  p_date date default ((now() at time zone 'Asia/Kolkata')::date - 1))
returns public.daily_reports
language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := (p_date::timestamp       at time zone 'Asia/Kolkata');
  v_to   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Kolkata');
  v_data jsonb;
  r      public.daily_reports;
begin
  -- Allowed for admins, and for the nightly scheduler (no signed-in user).
  if auth.uid() is not null and not public.is_admin() then raise exception 'OP_NOT_ADMIN'; end if;

  select jsonb_build_object(
    'orders', (select jsonb_build_object(
                 'total',     count(*),
                 'accepted',  count(*) filter (where status = 'accepted'),
                 'countered', count(*) filter (where status = 'countered'),
                 'rejected',  count(*) filter (where status = 'rejected'),
                 'expired',   count(*) filter (where status = 'expired'),
                 'cancelled', count(*) filter (where status = 'cancelled'),
                 'pending',   count(*) filter (where status = 'pending'))
               from public.orders where created_at >= v_from and created_at < v_to),
    'trades', (select jsonb_build_object(
                 'count',      count(*),
                 'buy_qty',    coalesce(sum(qty_credit), 0),
                 'buy_value',  coalesce(sum(amount_debit), 0),
                 'sell_qty',   coalesce(sum(qty_debit), 0),
                 'sell_value', coalesce(sum(amount_credit), 0))
               from public.ledger where created_at >= v_from and created_at < v_to),
    'by_share', (select coalesce(jsonb_agg(s.x order by s.x->>'share_name'), '[]'::jsonb) from (
                   select jsonb_build_object(
                     'share_name', share_name, 'trades', count(*),
                     'buy_qty', sum(qty_credit), 'buy_value', sum(amount_debit),
                     'sell_qty', sum(qty_debit), 'sell_value', sum(amount_credit)) as x
                   from public.ledger where created_at >= v_from and created_at < v_to
                   group by share_name) s),
    'by_user', (select coalesce(jsonb_agg(u.x order by u.x->>'email'), '[]'::jsonb) from (
                   select jsonb_build_object(
                     'email', p.email, 'name', p.full_name, 'trades', count(*),
                     'buy_qty', sum(l.qty_credit), 'buy_value', sum(l.amount_debit),
                     'sell_qty', sum(l.qty_debit), 'sell_value', sum(l.amount_credit)) as x
                   from public.ledger l join public.profiles p on p.id = l.user_id
                   where l.created_at >= v_from and l.created_at < v_to
                   group by p.email, p.full_name) u),
    'new_signups',       (select count(*) from public.profiles where created_at >= v_from and created_at < v_to),
    'active_users',      (select count(distinct user_id) from public.orders where created_at >= v_from and created_at < v_to),
    'seen_users',        (select count(*) from public.profiles where last_seen >= v_from and last_seen < v_to),
    'pending_approvals', (select count(*) from public.profiles where status = 'pending'),
    'total_users',       (select count(*) from public.profiles)
  ) into v_data;

  insert into public.daily_reports (report_date, data, generated_at)
  values (p_date, v_data, now())
  on conflict (report_date) do update set data = excluded.data, generated_at = now()
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 6. PERMISSIONS ON FUNCTIONS
-- ---------------------------------------------------------------------
revoke execute on function public.place_order(bigint, text, int, numeric)        from public, anon;
revoke execute on function public.cancel_my_order(bigint)                       from public, anon;
revoke execute on function public.respond_order(bigint, text, numeric, text)    from public, anon;
revoke execute on function public.admin_set_user_status(uuid, text)             from public, anon;
revoke execute on function public.generate_daily_report(date)                   from public, anon;
revoke execute on function public.heartbeat()                                   from public, anon;
revoke execute on function public.expire_stale_orders()                         from public, anon;
grant  execute on function public.place_order(bigint, text, int, numeric)        to authenticated;
grant  execute on function public.cancel_my_order(bigint)                       to authenticated;
grant  execute on function public.respond_order(bigint, text, numeric, text)    to authenticated;
grant  execute on function public.admin_set_user_status(uuid, text)             to authenticated;
grant  execute on function public.generate_daily_report(date)                   to authenticated;
grant  execute on function public.heartbeat()                                   to authenticated;
grant  execute on function public.expire_stale_orders()                         to authenticated;
grant  execute on function public.check_email(text)                             to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY — who can see / change what
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.shares        enable row level security;
alter table public.orders        enable row level security;
alter table public.ledger        enable row level security;
alter table public.audit_log     enable row level security;
alter table public.daily_reports enable row level security;
alter table public.app_settings  enable row level security;
alter table public.admin_secrets enable row level security;
alter table public.admin_emails  enable row level security;

drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists shares_read  on public.shares;
drop policy if exists shares_admin on public.shares;
create policy shares_read  on public.shares for select to authenticated
  using ((visible and public.is_approved()) or public.is_admin());
create policy shares_admin on public.shares for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists ledger_read on public.ledger;
create policy ledger_read on public.ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

drop policy if exists reports_read on public.daily_reports;
create policy reports_read on public.daily_reports for select to authenticated using (public.is_admin());

drop policy if exists settings_read  on public.app_settings;
drop policy if exists settings_admin on public.app_settings;
create policy settings_read  on public.app_settings for select to authenticated using (true);
create policy settings_admin on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists secrets_admin on public.admin_secrets;
create policy secrets_admin on public.admin_secrets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_emails_admin on public.admin_emails;
create policy admin_emails_admin on public.admin_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.ledger_view to authenticated;

-- ---------------------------------------------------------------------
-- 8. LIVE FEED — push table changes to the app instantly
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['shares','orders','profiles','app_settings','ledger','daily_reports'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. SAMPLE DATA (fictional — edit or delete these rows any time)
-- ---------------------------------------------------------------------
insert into public.shares (name, status, open_date, close_date, price, issue_size_cr, gmp,
                           buy_price, sell_price, lot_size, hni_lots, allotment_date, listing_date, sort_order)
select * from (values
  ('Sample: Aarav Infra Ltd',   'open',     current_date,     current_date + 2, 126::numeric, 1200::numeric, 45::numeric, 47::numeric, 43::numeric, 119, 14, current_date + 3, current_date + 5, 1),
  ('Sample: Nilgiri Foods Ltd', 'upcoming', current_date + 3, current_date + 5, 310, 540,  22, 24, 20,  48, 14, current_date + 6, current_date + 8, 2),
  ('Sample: Vayu Green Energy', 'closed',   current_date - 3, current_date - 1,  92, 2350, 18, 19, 16, 160, 13, current_date + 1, current_date + 3, 3)
) as v
where not exists (select 1 from public.shares);

-- ---------------------------------------------------------------------
-- 12. ADMINISTRATOR  >>> EDIT THE EMAIL BELOW <<<
-- ---------------------------------------------------------------------
insert into public.admin_emails (email) values (lower('YOUR_ADMIN_EMAIL@example.com'))
on conflict do nothing;

-- If you had already signed up with that email, this promotes you now:
update public.profiles p
   set role = 'admin', status = 'approved', approved_at = coalesce(approved_at, now())
  from public.admin_emails a
 where p.email = a.email;
