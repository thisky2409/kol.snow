-- KOL Manager v2.0 — Supabase schema
-- Run this file once in Supabase Dashboard → SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null default '',
  role text not null default 'Marketing' check (role in ('Admin', 'Booking', 'Marketing')),
  market text not null default 'VN' check (market in ('VN', 'TH', 'TW', 'Global')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_name text,
  market text not null check (market in ('VN', 'TH', 'TW', 'Global')),
  city text,
  languages text[] not null default '{}',
  categories text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  platform text not null check (platform in ('TikTok', 'Instagram', 'Threads', 'X', 'YouTube', 'Facebook', 'Other')),
  username text,
  profile_url text not null,
  followers bigint not null default 0 check (followers >= 0),
  avg_views bigint not null default 0 check (avg_views >= 0),
  engagement_rate numeric(7,3) not null default 0 check (engagement_rate >= 0),
  starting_fee numeric(18,2) not null default 0 check (starting_fee >= 0),
  currency text not null default 'VND' check (currency in ('VND', 'THB', 'TWD', 'USD')),
  app_fit text[] not null default '{}',
  last_verified date,
  source text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, profile_url)
);

-- Contact and outreach fields are deliberately separated from public creator data.
-- Marketing cannot select this table, even by calling Supabase directly.
create table if not exists public.outreach_profiles (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  status text not null default 'New' check (status in ('New', 'Contacted', 'Replied', 'Negotiating', 'Deal', 'Not interested', 'Do not contact')),
  pic text,
  contact_channel text,
  contact_value text,
  email text,
  phone text,
  line_id text,
  note text,
  source_reference text,
  last_contacted_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  app text not null,
  market text not null check (market in ('VN', 'TH', 'TW', 'Global')),
  objective text,
  platforms text[] not null default '{}',
  start_date date,
  end_date date,
  posting_start date,
  posting_end date,
  target_kols integer not null default 1 check (target_kols > 0),
  budget numeric(18,2) not null default 0 check (budget >= 0),
  currency text not null default 'VND' check (currency in ('VND', 'THB', 'TWD', 'USD')),
  status text not null default 'Planning' check (status in ('Planning', 'Sourcing', 'Active', 'Paused', 'Completed', 'Cancelled')),
  owner_email text not null,
  assigned_marketing text[] not null default '{}',
  brief_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shortlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  market text not null check (market in ('VN', 'TH', 'TW', 'Global')),
  month text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  owner_email text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Reviewing', 'Approved', 'Archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shortlist_accounts (
  id uuid primary key default gen_random_uuid(),
  shortlist_id uuid not null references public.shortlists(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  picked boolean not null default false,
  review_status text not null default 'New' check (review_status in ('New', 'Reviewing', 'Approved', 'Rejected', 'Backup')),
  reviewer_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shortlist_id, account_id)
);

create table if not exists public.campaign_kols (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  creator_id uuid not null references public.creators(id) on delete restrict,
  role text not null default 'Primary' check (role in ('Primary', 'Backup', 'Organic', 'Paid')),
  pic_email text,
  booking_status text not null default 'Picked' check (booking_status in ('Picked', 'Approved', 'Contacted', 'Negotiating', 'Confirmed', 'Declined', 'Cancelled')),
  quoted_fee numeric(18,2) not null default 0 check (quoted_fee >= 0),
  final_fee numeric(18,2) not null default 0 check (final_fee >= 0),
  currency text not null default 'VND' check (currency in ('VND', 'THB', 'TWD', 'USD')),
  deliverable_summary text,
  content_status text not null default 'Not started' check (content_status in ('Not started', 'Draft submitted', 'Need edit', 'Approved', 'Posted')),
  posting_date date,
  post_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, account_id)
);

create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  campaign_kol_id uuid not null references public.campaign_kols(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  type text not null,
  platform text not null,
  brief_url text,
  draft_due date,
  draft_url text,
  revision_round integer not null default 0,
  content_status text not null default 'Not started' check (content_status in ('Not started', 'Draft submitted', 'Need edit', 'Approved', 'Posted')),
  approved_at timestamptz,
  posting_date date,
  post_url text,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  draft_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  campaign_kol_id uuid not null references public.campaign_kols(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete restrict,
  contract_no text,
  template_name text,
  contract_url text,
  sign_status text not null default 'Not started' check (sign_status in ('Not started', 'Info pending', 'Draft', 'Sent', 'Signed', 'Cancelled')),
  sent_date date,
  signed_date date,
  due_date date,
  owner_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  campaign_kol_id uuid not null references public.campaign_kols(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete restrict,
  amount numeric(18,2) not null default 0,
  currency text not null default 'VND' check (currency in ('VND', 'THB', 'TWD', 'USD')),
  tax_amount numeric(18,2) not null default 0,
  service_fee numeric(18,2) not null default 0,
  payment_status text not null default 'Not started' check (payment_status in ('Not started', 'Info pending', 'Ready', 'Processing', 'Paid', 'On hold', 'Cancelled')),
  due_date date,
  payment_date date,
  invoice_url text,
  owner_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists accounts_creator_idx on public.accounts(creator_id);
create index if not exists accounts_fee_idx on public.accounts(starting_fee) where active = true;
create index if not exists campaigns_market_status_idx on public.campaigns(market, status);
create index if not exists campaign_kols_campaign_idx on public.campaign_kols(campaign_id);
create index if not exists deliverables_campaign_date_idx on public.deliverables(campaign_id, posting_date);
create index if not exists shortlist_accounts_shortlist_idx on public.shortlist_accounts(shortlist_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','creators','accounts','outreach_profiles','campaigns','shortlists','shortlist_accounts','campaign_kols','deliverables','contracts','payments']
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', t, t);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, market, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    'Marketing',
    'VN',
    true
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.app_role()
returns text
language sql
stable
security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.app_market()
returns text
language sql
stable
security definer set search_path = public
as $$ select market from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.app_email()
returns text
language sql
stable
security definer set search_path = public
as $$ select email from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.can_access_campaign(target public.campaigns)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when public.app_role() = 'Admin' then true
    when public.app_role() = 'Booking' then public.app_market() = 'Global' or target.market in (public.app_market(), 'Global')
    when public.app_role() = 'Marketing' then target.owner_email = public.app_email() or public.app_email() = any(target.assigned_marketing)
    else false
  end
$$;

alter table public.profiles enable row level security;
alter table public.creators enable row level security;
alter table public.accounts enable row level security;
alter table public.outreach_profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_accounts enable row level security;
alter table public.campaign_kols enable row level security;
alter table public.deliverables enable row level security;
alter table public.contracts enable row level security;
alter table public.payments enable row level security;
alter table public.activity_log enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.app_role() = 'Admin');
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated using (public.app_role() = 'Admin') with check (public.app_role() = 'Admin');

drop policy if exists creators_read on public.creators;
create policy creators_read on public.creators for select to authenticated using (
  active = true and public.app_role() is not null and (
    public.app_role() = 'Admin' or public.app_market() = 'Global' or market in (public.app_market(), 'Global')
  )
);
drop policy if exists creators_operate on public.creators;
create policy creators_operate on public.creators for all to authenticated using (
  public.app_role() = 'Admin' or (public.app_role() = 'Booking' and (public.app_market() = 'Global' or market in (public.app_market(), 'Global')))
) with check (
  public.app_role() = 'Admin' or (public.app_role() = 'Booking' and (public.app_market() = 'Global' or market in (public.app_market(), 'Global')))
);

drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (
  active = true and exists (
    select 1 from public.creators cr where cr.id = accounts.creator_id
  ) and (
    public.app_role() in ('Admin','Booking') or
    starting_fee > 0 or
    exists (select 1 from public.campaign_kols ck join public.campaigns c on c.id = ck.campaign_id where ck.account_id = accounts.id and public.can_access_campaign(c))
  )
);
drop policy if exists accounts_operate on public.accounts;
create policy accounts_operate on public.accounts for all to authenticated using (
  public.app_role() in ('Admin','Booking') and exists (select 1 from public.creators cr where cr.id = accounts.creator_id)
) with check (
  public.app_role() in ('Admin','Booking') and exists (select 1 from public.creators cr where cr.id = accounts.creator_id)
);

drop policy if exists outreach_operate on public.outreach_profiles;
create policy outreach_operate on public.outreach_profiles for all to authenticated using (
  public.app_role() in ('Admin','Booking') and exists (select 1 from public.creators cr where cr.id = outreach_profiles.creator_id)
) with check (
  public.app_role() in ('Admin','Booking') and exists (select 1 from public.creators cr where cr.id = outreach_profiles.creator_id)
);

drop policy if exists campaigns_read on public.campaigns;
create policy campaigns_read on public.campaigns for select to authenticated using (public.can_access_campaign(campaigns));
drop policy if exists campaigns_operate on public.campaigns;
create policy campaigns_operate on public.campaigns for all to authenticated using (
  public.app_role() in ('Admin','Booking') and public.can_access_campaign(campaigns)
) with check (
  public.app_role() in ('Admin','Booking') and public.can_access_campaign(campaigns)
);

drop policy if exists shortlists_read on public.shortlists;
create policy shortlists_read on public.shortlists for select to authenticated using (
  public.app_role() = 'Admin' or owner_email = public.app_email() or public.app_market() = 'Global' or market in (public.app_market(), 'Global')
);
drop policy if exists shortlists_create on public.shortlists;
create policy shortlists_create on public.shortlists for insert to authenticated with check (public.app_role() is not null and owner_email = public.app_email());
drop policy if exists shortlists_update on public.shortlists;
create policy shortlists_update on public.shortlists for update to authenticated using (public.app_role() = 'Admin' or owner_email = public.app_email()) with check (public.app_role() = 'Admin' or owner_email = public.app_email());

drop policy if exists shortlist_accounts_read on public.shortlist_accounts;
create policy shortlist_accounts_read on public.shortlist_accounts for select to authenticated using (exists (select 1 from public.shortlists s where s.id = shortlist_id));
drop policy if exists shortlist_accounts_write on public.shortlist_accounts;
create policy shortlist_accounts_write on public.shortlist_accounts for all to authenticated using (exists (select 1 from public.shortlists s where s.id = shortlist_id)) with check (
  exists (select 1 from public.shortlists s where s.id = shortlist_id) and
  exists (select 1 from public.accounts a where a.id = account_id and a.starting_fee > 0)
);

drop policy if exists campaign_kols_read on public.campaign_kols;
create policy campaign_kols_read on public.campaign_kols for select to authenticated using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c)));
drop policy if exists campaign_kols_insert on public.campaign_kols;
create policy campaign_kols_insert on public.campaign_kols for insert to authenticated with check (
  exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c)) and
  exists (select 1 from public.accounts a where a.id = account_id and a.starting_fee > 0)
);
drop policy if exists campaign_kols_operate on public.campaign_kols;
create policy campaign_kols_operate on public.campaign_kols for update to authenticated using (public.app_role() in ('Admin','Booking') and exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c))) with check (public.app_role() in ('Admin','Booking'));

drop policy if exists deliverables_read on public.deliverables;
create policy deliverables_read on public.deliverables for select to authenticated using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c)));
drop policy if exists deliverables_write on public.deliverables;
create policy deliverables_write on public.deliverables for all to authenticated using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c))) with check (exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c)));

drop policy if exists contracts_operate on public.contracts;
create policy contracts_operate on public.contracts for all to authenticated using (public.app_role() in ('Admin','Booking') and exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c))) with check (public.app_role() in ('Admin','Booking'));
drop policy if exists payments_operate on public.payments;
create policy payments_operate on public.payments for all to authenticated using (public.app_role() in ('Admin','Booking') and exists (select 1 from public.campaigns c where c.id = campaign_id and public.can_access_campaign(c))) with check (public.app_role() in ('Admin','Booking'));

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated with check (public.app_role() is not null);
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select to authenticated using (public.app_role() in ('Admin','Booking'));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- After creating your first Auth user, promote it to Admin:
-- update public.profiles set role = 'Admin', market = 'Global' where email = 'YOUR_EMAIL';
