-- =========================================================
-- Mon Cahier — Diagnostic Communication Push
-- À exécuter dans Supabase SQL Editor après un envoi test.
-- Ne modifie aucune donnée.
-- =========================================================

-- 1) Dernières campagnes de communication
select
  c.id,
  c.created_at,
  c.sent_at,
  c.audience_type,
  c.target_type,
  c.target_label,
  c.channel,
  c.status,
  c.recipient_count,
  c.push_queued_count,
  c.sms_queued_count,
  c.meta->>'push_dispatch_triggered' as push_dispatch_triggered,
  c.meta->>'sms_dispatch_triggered' as sms_dispatch_triggered
from public.communication_campaigns c
order by c.created_at desc
limit 10;

-- 2) État réel de la file push issue du module Communication
select
  q.status,
  q.last_error,
  count(*) as total
from public.notifications_queue q
where q.meta->>'src' = 'admin_communication'
group by q.status, q.last_error
order by total desc;

-- 3) Dernières notifications Communication en file
select
  q.id,
  q.created_at,
  q.status,
  q.attempts,
  q.last_error,
  q.parent_id,
  q.profile_id,
  q.student_id,
  q.title,
  left(q.body, 120) as body_preview,
  q.meta->>'campaign_id' as campaign_id,
  q.meta->>'recipient_type' as recipient_type
from public.notifications_queue q
where q.meta->>'src' = 'admin_communication'
order by q.created_at desc
limit 30;

-- 4) Abonnements push profils classiques
select
  count(*) as total_profile_push_subscriptions
from public.push_subscriptions;

-- 5) Abonnements push parent/élève, si la table existe
select
  to_regclass('public.push_subscriptions_student') as push_subscriptions_student_table;

-- Si la table existe, exécuter séparément :
-- select count(*) as total_student_push_subscriptions from public.push_subscriptions_student;
