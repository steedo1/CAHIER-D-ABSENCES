-- Suppression permanente atomique d'un élève, y compris ses données pédagogiques
-- et financières. Fonction accessible uniquement au rôle serveur service_role.
-- L'API vérifie auparavant le rôle administrateur et la confirmation explicite.
CREATE OR REPLACE FUNCTION public.admin_hard_delete_student(
  p_institution_id uuid,
  p_student_id uuid,
  p_expected_full_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, finance
AS $fn$
DECLARE
  v_full_name text;
  v_person_id uuid;
BEGIN
  SELECT COALESCE(NULLIF(btrim(s.full_name), ''), btrim(concat_ws(' ', s.last_name, s.first_name))),
         s.student_person_id
  INTO v_full_name, v_person_id
  FROM public.students s
  WHERE s.id = p_student_id AND s.institution_id = p_institution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_full_name IS DISTINCT FROM btrim(p_expected_full_name) THEN
    RAISE EXCEPTION 'student_identity_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Finance : respecter l'ordre des clés étrangères RESTRICT.
  DELETE FROM finance.online_payment_intents o
  WHERE o.school_id = p_institution_id
    AND (o.student_id = p_student_id
         OR o.student_charge_id IN
           (SELECT c.id FROM finance.student_charges c
            WHERE c.school_id = p_institution_id AND c.student_id = p_student_id));

  DELETE FROM finance.reminder_logs r
  WHERE r.school_id = p_institution_id
    AND (r.student_id = p_student_id
         OR r.student_charge_id IN
           (SELECT c.id FROM finance.student_charges c
            WHERE c.school_id = p_institution_id AND c.student_id = p_student_id));

  DELETE FROM finance.receipt_allocations a
  WHERE a.student_charge_id IN
    (SELECT c.id FROM finance.student_charges c
     WHERE c.school_id = p_institution_id AND c.student_id = p_student_id);

  DELETE FROM finance.receipts r
  WHERE r.school_id = p_institution_id AND r.student_id = p_student_id;

  DELETE FROM finance.student_charges c
  WHERE c.school_id = p_institution_id AND c.student_id = p_student_id;

  -- Tables ne disposant pas d'une clé étrangère CASCADE vers students.
  DELETE FROM public.ai_prediction_outcomes
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.ai_prediction_students
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.ai_training_samples
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.ml_student_features_history
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.ml_training_labels
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.nexa_card_preparations
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.preschool_booklet_records
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.whatsapp_outbox
  WHERE institution_id = p_institution_id AND student_id = p_student_id;

  -- Éviter des enregistrements orphelins avec ON DELETE SET NULL.
  DELETE FROM public.parent_connect_payments
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.parent_connect_activations
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.parent_connect_phone_changes
  WHERE institution_id = p_institution_id AND student_id = p_student_id;
  DELETE FROM public.student_transfer_requests
  WHERE (from_student_id = p_student_id OR to_student_id = p_student_id)
    AND (from_institution_id = p_institution_id OR to_institution_id = p_institution_id);
  
  -- Références dans les tableaux d'identifiants multi-élèves.
  UPDATE public.nexa_card_orders
  SET student_ids = array_remove(student_ids, p_student_id)
  WHERE institution_id = p_institution_id AND p_student_id = ANY(student_ids);

  UPDATE public.parent_connect_bulk_operations
  SET student_ids = array_remove(student_ids, p_student_id)
  WHERE institution_id = p_institution_id AND p_student_id = ANY(student_ids);

  UPDATE public.communication_recipients
  SET related_student_ids = array_remove(related_student_ids, p_student_id)
  WHERE institution_id = p_institution_id AND p_student_id = ANY(related_student_ids);

  UPDATE public.ai_remediation_plan_items
  SET student_ids = array_remove(student_ids, p_student_id)
  WHERE institution_id = p_institution_id AND p_student_id = ANY(student_ids);

  -- Déverrouillage transactionnel strictement limité à cette identité.
  -- Le déclencheur EPC vérifie aussi current_user = service_role.
  PERFORM set_config('app.student_hard_delete_id', p_student_id::text, true);
  PERFORM set_config('app.student_hard_delete_institution', p_institution_id::text, true);

  -- La suppression de students déclenche les cascades sur notes, absences,
  -- inscriptions, bulletins, notifications, fiches parents, etc.
  DELETE FROM public.students s
  WHERE s.id = p_student_id AND s.institution_id = p_institution_id;

  UPDATE public.student_persons
  SET canonical_student_id = NULL
  WHERE canonical_student_id = p_student_id;

  -- Supprimer l'identité stable seulement si aucun autre dossier ne la partage.
  IF v_person_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.students WHERE student_person_id = v_person_id)
  THEN
    UPDATE public.ai_remediation_plan_items
    SET student_person_ids = array_remove(student_person_ids, v_person_id)
    WHERE institution_id = p_institution_id AND v_person_id = ANY(student_person_ids);
    DELETE FROM public.student_persons WHERE id = v_person_id;
  END IF;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_hard_delete_student(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_student(uuid,uuid,text) TO service_role;

-- EPC : préserver le blocage des suppressions directes tout en autorisant
-- uniquement l'opération serveur confirmée, ciblée et transactionnelle.
CREATE OR REPLACE FUNCTION epc_internal.block_epc_student_hard_deletes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF OLD.institution_id = '2b897cd4-e1c3-40c3-9569-03e01e1877b4'::uuid THEN
    IF current_user <> 'service_role'
       OR current_setting('app.student_hard_delete_id', true)
          IS DISTINCT FROM OLD.id::text
       OR current_setting('app.student_hard_delete_institution', true)
          IS DISTINCT FROM OLD.institution_id::text
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'EPC : suppression definitive interdite hors confirmation administrateur.';
    END IF;
  END IF;
  RETURN OLD;
END;
$guard$;
