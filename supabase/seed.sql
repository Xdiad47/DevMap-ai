-- =====================================================================
-- DevMap.in | LOCAL DEVELOPMENT SEED | 15 mock talent profiles across India
--
-- Loaded automatically by `supabase start` (fresh DB) and `supabase db reset`.
-- The Supabase CLI never applies this file to a hosted project unless you pass --include-seed: don't.
--
-- EVERYTHING HERE IS FAKE: people, phone numbers (+91 90000 000xx), emails (.invalid), Telegram chat ids
-- (negative numbers). `telegram_chat_id` is mocked so the "must link Telegram to go Online" trigger allows
-- these profiles to be Online while the bot doesn't exist yet.
--
-- Scores are NOT typed in. Each profile gets a work-depth value and real verified projects with real ping
-- history; the database's own functions (recompute_proof, take_rank_snapshot) turn that into proof scores,
-- tiers and ranks, so the seed exercises the same logic production will.
--
-- Deterministic ids: 00000000-0000-4000-8000-0000000000NN  (NN = 01..15), handy in tests.
-- =====================================================================
do $seed$
declare
  r        record;
  v_id     uuid;
  v_proj   uuid;
  n_down   int;
  p        int;
begin
  if exists (select 1 from public.talent_public where id = '00000000-0000-4000-8000-000000000001') then
    raise notice 'seed: already loaded, skipping';
    return;
  end if;

  for r in
    select * from (values
      -- n, role,        full name,           city,        state,            lat,      lng,      native,     others,                   skills,                                   rate, work, review,       velocity, projects, uptime, online, days_idle, at_cap
      ( 1, 'developer', 'Rahul Sharma',      'Bengaluru', 'Karnataka',      12.9716,  77.5946,  'Hindi',    '{English,Kannada}',       '{flutter,kotlin}',                          600, 40, 'unverified',  92, 2, 99.0, true,  0, false),
      ( 2, 'developer', 'Priya Nair',        'Kochi',     'Kerala',          9.9312,   76.2673,  'Malayalam','{English}',               '{react,nextjs,nodejs}',                     800, 36, 'unverified',  88, 2, 97.0, true,  0, false),
      ( 3, 'developer', 'Rohit Deshmukh',    'Pune',      'Maharashtra',     18.5204,  73.8567,  'Marathi',  '{Hindi}',                 '{python,go}',                               500, 30, 'unverified',  75, 1, 92.0, false, 1, false),
      ( 4, 'developer', 'Arnab Sen',         'Kolkata',   'West Bengal',     22.5726,  88.3639,  'Bengali',  '{Hindi,English}',         '{java,kotlin}',                             450, 27, 'unverified',  80, 1, 88.0, true,  0, false),
      ( 5, 'developer', 'Nandini Reddy',     'Hyderabad', 'Telangana',       17.3850,  78.4867,  'Telugu',   '{}',                      '{vue,react}',                               350, 14, 'unverified',  70, 0, 0,    false, 3, false),
      ( 6, 'developer', 'Karthik Iyer',      'Chennai',   'Tamil Nadu',      13.0827,  80.2707,  'Tamil',    '{Hindi,Telugu}',          '{flutter,swift}',                           700, 33, 'unverified',  85, 2, 95.0, true,  0, false),
      ( 7, 'designer',  'Aditi Mehta',       'Ahmedabad', 'Gujarat',         23.0225,  72.5714,  'Gujarati', '{English}',               '{figma,mobile-app-design}',                 650, 32, 'verified',    90, 1, 98.0, true,  0, false),
      ( 8, 'designer',  'Meera Joshi',       'Mumbai',    'Maharashtra',     19.0760,  72.8777,  'Marathi',  '{Hindi}',                 '{figma,web-design,design-systems}',         550, 28, 'reviewed',    78, 1, 94.0, false, 2, false),
      ( 9, 'designer',  'Sourav Ghosh',      'Kolkata',   'West Bengal',     22.5726,  88.3639,  'Bengali',  '{Hindi}',                 '{web-design}',                              400, 18, 'reviewed',    72, 0, 0,    true,  0, false),
      (10, 'designer',  'Rupa Malhotra',     'Delhi',     'Delhi',           28.6139,  77.2090,  'Hindi',    '{English,Punjabi}',       '{design-systems,figma}',                    900, 38, 'verified',    94, 2, 99.0, true,  0, false),
      (11, 'marketer',  'Vikram Singh',      'Jaipur',    'Rajasthan',       26.9124,  75.7873,  'Hindi',    '{English}',               '{meta-ads,google-ads}',                     500, 30, 'reviewed',    82, 1, 90.0, true,  0, false),
      (12, 'marketer',  'Jyoti Patil',       'Pune',      'Maharashtra',     18.5204,  73.8567,  'Marathi',  '{}',                      '{vernacular-copywriting,social-media-growth}', 350, 26, 'reviewed', 76, 0, 0,    false, 4, false),
      (13, 'marketer',  'Tanmoy Dutta',      'Kolkata',   'West Bengal',     22.5726,  88.3639,  'Bengali',  '{Hindi}',                 '{seo,google-ads}',                          450, 22, 'reviewed',    74, 1, 85.0, true,  0, false),
      (14, 'marketer',  'Pallavi Rao',       'Bengaluru', 'Karnataka',       12.9716,  77.5946,  'Kannada',  '{Telugu}',                '{vernacular-copywriting,meta-ads}',         600, 35, 'verified',    91, 2, 96.0, true,  0, false),
      -- #15: strong score but idle for 10 days (so NOT Tier 1: the tier needs recent activity) AND at today's unlock cap.
      (15, 'developer', 'Dhruv Khanna',      'Delhi',     'Delhi',           28.6139,  77.2090,  'Hindi',    '{English}',               '{python,nodejs}',                           550, 38, 'unverified',  86, 2, 97.0, false, 10, true)
    ) as t(n, role, full_name, city, state, lat, lng, native, others, skills, rate, work, review, velocity, projects, uptime, online, days_idle, at_cap)
  loop
    v_id := ('00000000-0000-4000-8000-' || lpad(r.n::text, 12, '0'))::uuid;

    -- 1. public card (offline first: going Online needs the private row to exist)
    insert into public.talent_public
      (id, role, masked_name, city, state, latitude, longitude, native_language, secondary_languages, skills,
       hourly_rate_paise, review_status, response_velocity_score, score_breakdown)
    values
      (v_id, r.role::public.role_type, private.mask_name(r.full_name), r.city, r.state, r.lat, r.lng,
       r.native, r.others::text[], r.skills::text[], r.rate * 100, r.review::public.review_tier, r.velocity,
       jsonb_build_object('work_depth', r.work, 'seed', true));

    -- 2. contact vault: phone verified, Telegram chat id mocked (negative = obviously not a real chat)
    insert into public.talent_private
      (talent_id, full_name, phone_e164, whatsapp_number, telegram_handle, telegram_chat_id, email,
       github_username, portfolio_links, is_phone_verified, daily_unlock_cap)
    values
      (v_id, r.full_name, '+9190000000' || lpad(r.n::text, 2, '0'), '+9190000000' || lpad(r.n::text, 2, '0'),
       '@mock_talent_' || lpad(r.n::text, 2, '0'), -1000000000 - r.n, 'mock' || r.n || '@example.invalid',
       case when r.role = 'developer' then 'mock-dev-' || r.n end, '[]'::jsonb, true, 5);

    -- 3. verified projects with a real ping history (4 pings/day for ~10 days = 40 samples).
    --    Each ping insert fires the triggers that recompute uptime and the proof score.
    for p in 1 .. r.projects loop
      insert into public.projects
        (talent_id, generic_title, live_url, repo_url, verification_method, is_ownership_verified, verified_at)
      values (
        v_id,
        case r.role
          when 'developer' then (array['Logistics mobile app', 'B2B SaaS dashboard', 'Retail e-commerce web app'])[p + (r.n % 2)]
          when 'designer'  then (array['Fintech app design system', 'Healthcare booking redesign', 'Retail web redesign'])[p + (r.n % 2)]
          else                  (array['Regional lead-gen landing page', 'D2C brand ads funnel', 'Local services campaign site'])[p + (r.n % 2)]
        end,
        'https://mock-' || r.n || '-' || p || '.example.invalid',
        null, 'well_known_file', true, now() - interval '12 days');
    end loop;

    for v_proj in select id from public.projects where talent_id = v_id loop
      n_down := round(40 * (100 - r.uptime) / 100.0);
      insert into public.ping_results (project_id, http_status, latency_ms, is_up, checked_at)
      select v_proj,
             case when g <= n_down then 503 else 200 end,
             90 + (g * 7) % 120,
             g > n_down,
             now() - ((g * 6) || ' hours')::interval
      from generate_series(1, 40) g;
    end loop;

    -- 4. recompute proof once more (designer/marketer rows without projects still need their rubric points), then status
    perform private.recompute_proof(v_id);

    update public.talent_public
       set is_online = r.online,                  -- allowed: telegram_chat_id is set
           is_at_daily_cap = r.at_cap
     where id = v_id;

    if r.at_cap then   -- make the cap real: the unlock function counts unlocks_today for today's IST date
      update public.talent_private
         set unlocks_today = daily_unlock_cap, cap_date = (now() at time zone 'Asia/Kolkata')::date
       where talent_id = v_id;
    end if;

    -- activity timestamp last, so the Online toggle's own "just now" doesn't overwrite the idle profiles
    update public.talent_public
       set last_active_at = now() - make_interval(days => r.days_idle),
           last_proof_activity_at = now() - make_interval(days => r.days_idle)
     where id = v_id;
  end loop;

  -- state leaderboards (normally a nightly cron job)
  perform private.take_rank_snapshot();
  raise notice 'seed: loaded 15 mock talents across India';
end
$seed$;
