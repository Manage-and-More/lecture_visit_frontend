-- Branding: the outreach emails say "Manage and More", never "Manage & More".
-- Fixes the stored mail settings (subject and templates, also if an admin edited them) and the
-- column defaults from 20261108_outreach.sql. Only the brand name changes; nothing else in the texts.
begin;

do $$
declare
  c text;
  d text;
begin
  foreach c in array array['subject_request', 'template_request', 'template_followup',
                           'template_ack_yes', 'template_ack_no', 'template_confirmation'] loop
    select pg_get_expr(ad.adbin, ad.adrelid) into d
    from pg_attrdef ad
    join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
    where ad.adrelid = 'public.mail_settings'::regclass and a.attname = c;

    if d is not null then
      execute format('alter table public.mail_settings alter column %I set default %s', c,
        replace(replace(d, 'Manage & More', 'Manage and More'), 'MANAGE & MORE', 'MANAGE AND MORE'));
    end if;

    execute format(
      'update public.mail_settings set %1$I = replace(replace(%1$I, %2$L, %3$L), %4$L, %5$L)',
      c, 'Manage & More', 'Manage and More', 'MANAGE & MORE', 'MANAGE AND MORE');
  end loop;
end $$;

commit;
