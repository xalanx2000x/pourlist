-- Fix: add missing DELETE policy for venues
drop policy if exists "Public delete venues" on venues;
create policy "Public delete venues" on venues for delete using (true);
