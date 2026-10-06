-- Household Books — Supabase schema.
--
-- Run this once, whole, in the SQL editor of a new project. It is idempotent:
-- every statement guards itself, so re-running after a change is safe.
--
-- ONE TABLE, because the app has one shape of data: fourteen independent
-- documents, each the whole value of one store. Every derivation in this app
-- (envelopes, net worth, the retirement projection, the spending report) loads
-- a whole array and computes over it in JavaScript, so there is nothing for a
-- relational split to buy — and a great deal for it to cost, since every
-- mutator here returns `{ ok, error }` synchronously and ~40 call sites plus
-- the invariant tripwires depend on that.
--
-- The security story is correspondingly small: one table, one policy pair, one
-- predicate to get right. `user_id = auth.uid()` is the whole of it.

create table if not exists public.app_state (
  -- On delete cascade: closing an account takes its books with it. There is no
  -- other copy on the server, which is what the export on the account panel is
  -- for.
  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- The store's own key — "budgets", "transactions", "accountBalances". Bounded
  -- rather than enumerated: a CHECK listing today's fourteen would mean a
  -- schema migration every time a store is added, and the client is the thing
  -- that knows what a key means.
  key        text        not null check (char_length(key) between 1 and 64),

  -- The whole value of that store, exactly as it sat in localStorage. Migrations
  -- still run client-side on the way in, so a document written by an older
  -- build is upgraded by a newer one on read, the same as it always was.
  value      jsonb       not null,

  -- Maintained by the trigger below, never by the client. It is what lets a
  -- second device tell a stale push from a fresh one.
  updated_at timestamptz not null default now(),

  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- The anon key ships inside the JavaScript bundle — it is public by design, and
-- anyone who opens devtools on the deployed app has it. RLS is therefore not a
-- second line of defence here, it is the only one.

alter table public.app_state enable row level security;

-- Granted to `authenticated` only, so an unauthenticated caller holding the
-- anon key matches no policy and reads nothing. USING governs the rows a
-- statement may see; WITH CHECK governs the rows it may leave behind — both are
-- needed, or a user could UPDATE their own row into someone else's user_id.
drop policy if exists "app_state owner access" on public.app_state;
create policy "app_state owner access"
  on public.app_state
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- Set server-side rather than trusted from the client: a device with a wrong
-- clock would otherwise be able to write a timestamp far in the future and
-- permanently win every conflict comparison against every other device.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_state_touch_updated_at on public.app_state;
create trigger app_state_touch_updated_at
  before insert or update on public.app_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- What replaces the `storage` event that kept two browser tabs in step. Without
-- it, two devices hold independent copies and — because every write replaces a
-- whole document — the last to save silently destroys what the other logged.
--
-- Realtime respects RLS, so a subscriber is only ever sent their own rows.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end
$$;

-- Realtime sends only the replica-identity columns for the *old* tuple, which by
-- default is the primary key alone. `SyncContext`'s subscription reads
-- `payload.old` on a DELETE, and Supabase evaluates RLS against the old row for
-- UPDATE and DELETE, so the table has to replicate the whole thing.
--
-- `FULL` and not the bare statement: `ALTER TABLE ... REPLICA IDENTITY` takes a
-- mode (DEFAULT / FULL / NOTHING / USING INDEX) and is a syntax error without
-- one — which, in the SQL editor, rejects the *whole* script before any of it
-- runs, so this line failing means nothing above it was applied either.
alter table public.app_state replica identity full;
