set check_function_bodies = off;
-- Drink Tracker keeps users/{uid}/distinctDrinks as one list (an array), so
-- it is one record, not a folder of them.
create or replace function drinks.depth(p text[]) returns int language sql immutable set search_path = '' as $$
  select case p[1]
    when 'users' then case when p[3] in ('drinks', 'scannedProducts') then 4 else 3 end
    when 'parties' then case when p[3] in ('members', 'entries') then 4 else 3 end
    when 'friendRequests' then 3 when 'friendships' then 3
    when 'drinkListShareRequests' then 3 when 'drinkListShares' then 3
    when 'userParties' then 3
  end
$$;
