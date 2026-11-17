-- Restore the exact expression/comment captured by the matching draft.
begin;
set local lock_timeout = '2s';
do $rollback$
declare saved jsonb; current_qual text;
begin
  select obj_description(p.oid, 'pg_policy')::jsonb, pg_get_expr(p.polqual, p.polrelid)
    into saved,current_qual from pg_policy p
    where p.polrelid='storage.objects'::regclass and p.polname='owner delete hype-audio';
  if saved->>'codex_hype_delete_v1' is distinct from 'true' or current_qual <> 'false' then
    raise exception 'Policy changed after migration; reconcile before rollback';
  end if;
  execute format('alter policy "owner delete hype-audio" on storage.objects using (%s)', saved->>'qualification');
  execute format('comment on policy "owner delete hype-audio" on storage.objects is %L', saved->>'comment');
end;
$rollback$;
commit;
