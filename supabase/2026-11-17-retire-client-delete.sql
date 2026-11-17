-- UNAPPLIED DRAFT. Close the old cached-client path during Hype rollout.
-- Service-role cleanup remains available. Verify no other permissive DELETE/ALL
-- policy grants deletion in this bucket before applying.
begin;
set local lock_timeout = '2s';
do $migration$
declare p record; previous_comment text;
begin
  select policy.oid, policy.polcmd, pg_get_expr(policy.polqual, policy.polrelid) as qualification
    into p from pg_policy policy
    where policy.polrelid = 'storage.objects'::regclass and policy.polname = 'owner delete hype-audio';
  if not found or p.polcmd <> 'd' then raise exception 'Expected bucket DELETE policy is absent or changed'; end if;
  previous_comment := obj_description(p.oid, 'pg_policy');
  if p.qualification = 'false' and position('"codex_hype_delete_v1": true' in coalesce(previous_comment,'')) > 0 then return; end if;
  if position('hype-audio' in coalesce(p.qualification,'')) = 0 then raise exception 'Refusing to alter a different bucket policy'; end if;
  execute 'alter policy "owner delete hype-audio" on storage.objects using (false)';
  execute format('comment on policy "owner delete hype-audio" on storage.objects is %L',
    jsonb_build_object('codex_hype_delete_v1', true, 'qualification', p.qualification, 'comment', previous_comment)::text);
end;
$migration$;
commit;
