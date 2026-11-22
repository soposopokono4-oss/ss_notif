-- Jalankan seluruh SQL ini di Supabase Dashboard > SQL Editor > New query.
-- Satu baris data untuk setiap user yang login. Row Level Security mencegah user
-- membaca atau mengubah jadwal/tugas milik user lain.
create table if not exists public.study_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schedules jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint schedules_is_array check (jsonb_typeof(schedules) = 'array'),
  constraint tasks_is_array check (jsonb_typeof(tasks) = 'array')
);

alter table public.study_data enable row level security;

drop policy if exists "Users can read own study data" on public.study_data;
create policy "Users can read own study data"
  on public.study_data for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own study data" on public.study_data;
create policy "Users can insert own study data"
  on public.study_data for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own study data" on public.study_data;
create policy "Users can update own study data"
  on public.study_data for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.study_data to authenticated;


-- Web Push: satu baris untuk setiap browser/perangkat yang didaftarkan user.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  device_label text not null default 'Perangkat Web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Users can read own push subscriptions" on public.push_subscriptions;
create policy "Users can read own push subscriptions" on public.push_subscriptions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own push subscriptions" on public.push_subscriptions;
create policy "Users can insert own push subscriptions" on public.push_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own push subscriptions" on public.push_subscriptions;
create policy "Users can update own push subscriptions" on public.push_subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own push subscriptions" on public.push_subscriptions;
create policy "Users can delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Riwayat pengingat untuk mencegah pengiriman duplikat. Hanya service role yang mengaksesnya.
create table if not exists public.sent_reminders (
  reminder_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz not null default now()
);
alter table public.sent_reminders enable row level security;
