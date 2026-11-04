-- =====================================================================
-- DevMap.in | Sprint 2 | discovery helpers
--
-- The discovery page shows ~30 cards at once. Two things on a card are NOT readable with the
-- public/RLS access from migration 1, and must stay that way:
--   1. the unlock price (tier depends on score + recent activity -> computed by the database)
--   2. abstracted project titles (the `projects` table is owner-only because it holds live URLs)
-- These two functions expose exactly that, for exactly the profiles a recruiter could already see,
-- in ONE round trip each instead of ~30. They never return a URL, contact, or any private column.
-- =====================================================================

-- One definition of "this profile may appear in public results". It mirrors the RLS policy
-- `talent_public_read_listed` from migration 1; the SQL tests assert that the two never disagree.
create function private.talent_is_visible(t public.talent_public) returns boolean
language sql stable as
$$
  select t.is_listed
     and not t.is_paused
     and not t.is_banned
     and t.deleted_at is null
     and (t.suspended_until is null or t.suspended_until <= now())
$$;

-- Batch version of public.unlock_quote(): { "<talent id>": { "tier": "top_tier", "credits": 2 }, ... }
-- Ids that are not visible are simply absent (no information about hidden profiles).
create function public.unlock_quotes(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as
$$
  select coalesce(
    jsonb_object_agg(
      t.id::text,
      jsonb_build_object(
        'tier',    private.tier_for(t.composite_rank_score, t.last_active_at),
        'credits', case private.tier_for(t.composite_rank_score, t.last_active_at)
                     when 'top_tier' then private.cfg('tier1_unlock_credits')
                     else private.cfg('standard_unlock_credits')
                   end
      )
    ),
    '{}'::jsonb)
  from public.talent_public t
  where t.id = any (p_ids[1:100])          -- hard cap: one page of cards, not a table scan
    and private.talent_is_visible(t)
$$;

-- Generic titles of a profile's OWNERSHIP-VERIFIED projects (never the URL, never the repo).
-- Unverified projects are not shown: a claim nobody has checked is not "proof of work".
create function public.talent_project_titles(p_ids uuid[])
returns table (talent_id uuid, generic_title text, uptime_30d numeric, is_up boolean)
language sql stable security definer set search_path = public, pg_temp as
$$
  select pr.talent_id, pr.generic_title, pr.uptime_30d, pr.is_up
  from public.projects pr
  join public.talent_public t on t.id = pr.talent_id
  where pr.talent_id = any (p_ids[1:100])
    and pr.is_ownership_verified
    and private.talent_is_visible(t)
  order by pr.talent_id, pr.created_at
$$;

-- Signed-in users only. (unlock_quote, from migration 1, stays callable by anon.)
revoke execute on function public.unlock_quotes(uuid[])            from public, anon, authenticated;
revoke execute on function public.talent_project_titles(uuid[])    from public, anon, authenticated;
grant  execute on function public.unlock_quotes(uuid[])            to authenticated;
grant  execute on function public.talent_project_titles(uuid[])    to authenticated;
