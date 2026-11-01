-- EPC Dimbokro, 2026–2027, Arabic primary only.
-- Idempotent and scoped. Does NOT delete historical subject rows, grades,
-- teacher assignments, fees, other schools, or French curricula.
-- Teacher attribution for newly split subjects follows the former grouped
-- subject assignment, to be checked with the teaching director.
BEGIN;
DO $epc$
DECLARE
  school_id uuid := '2b897cd4-e1c3-40c3-9569-03e01e1877b4';
  year_code text := '2026-2027';
  settings jsonb;
  catalog jsonb := '{"CP1":{"classId":"704bad54-ea01-4a42-a781-68fefba6d699","subjects":["7d515de5-45f2-41b0-b513-6b236fe35d80","code:EPC26_AR_CHANT","e7cf1b09-3270-428c-8b0e-d8cd8c4be17e","f77d1b1e-c11d-44ed-9052-33e0de962fe0","7fc4ce03-b3d2-415d-81b9-85d8c457d1f5","a934f8db-75af-4d19-a8a3-573e2b220fab","3fc70482-7fa9-4cad-ba20-6070e28179e3","4f662cbc-3bac-49bd-8fc4-59df6ffa47e4","3930bf9a-676f-4a4d-9613-98ff420aa11a"]},"CP2":{"classId":"16e6ea13-70dd-4f41-93b3-df106c45b0ad","subjects":["7d515de5-45f2-41b0-b513-6b236fe35d80","code:EPC26_AR_CHANT","e7cf1b09-3270-428c-8b0e-d8cd8c4be17e","f77d1b1e-c11d-44ed-9052-33e0de962fe0","7fc4ce03-b3d2-415d-81b9-85d8c457d1f5","a934f8db-75af-4d19-a8a3-573e2b220fab","3fc70482-7fa9-4cad-ba20-6070e28179e3","4f662cbc-3bac-49bd-8fc4-59df6ffa47e4","3930bf9a-676f-4a4d-9613-98ff420aa11a"]},"CE1":{"classId":"02c14444-8cf1-4032-8b03-d1c77233848c","subjects":["7d515de5-45f2-41b0-b513-6b236fe35d80","f77d1b1e-c11d-44ed-9052-33e0de962fe0","7fc4ce03-b3d2-415d-81b9-85d8c457d1f5","a934f8db-75af-4d19-a8a3-573e2b220fab","3fc70482-7fa9-4cad-ba20-6070e28179e3","3930bf9a-676f-4a4d-9613-98ff420aa11a","dac4da9c-5fae-4b8c-adb8-d21ddb2b9102","4f662cbc-3bac-49bd-8fc4-59df6ffa47e4"]},"CE2":{"classId":"a6016d56-68a2-4c6e-9604-56473e7398b3","subjects":["f77d1b1e-c11d-44ed-9052-33e0de962fe0","7fc4ce03-b3d2-415d-81b9-85d8c457d1f5","a934f8db-75af-4d19-a8a3-573e2b220fab","code:EPC26_AR_DICTEE","dac4da9c-5fae-4b8c-adb8-d21ddb2b9102","3fc70482-7fa9-4cad-ba20-6070e28179e3","af2a8e7d-3e88-4d5d-8fa3-e19e84cc8cd8","4f662cbc-3bac-49bd-8fc4-59df6ffa47e4"]},"CM1":{"classId":"195bf25f-d26f-4d87-8c42-ab024a3afeda","subjects":["f77d1b1e-c11d-44ed-9052-33e0de962fe0","3fc70482-7fa9-4cad-ba20-6070e28179e3","727b4812-e662-46db-8add-8e39bc56f56d","af2a8e7d-3e88-4d5d-8fa3-e19e84cc8cd8","a934f8db-75af-4d19-a8a3-573e2b220fab","code:EPC26_AR_DICTEE","2870e068-cd45-46a7-a466-58e2db5ddaf8","f8c16ddc-ef62-45d3-9864-4f83430d2843"]},"CM2":{"classId":"3541a6bd-0714-4122-ae52-23caebb68a43","subjects":["3b12a699-57e9-4252-849b-16d2f31555ff","code:EPC26_AR_MEMORISATION_CORAN","code:EPC26_AR_TAJWID","code:EPC26_AR_TAFSIR","2870e068-cd45-46a7-a466-58e2db5ddaf8","f8c16ddc-ef62-45d3-9864-4f83430d2843","af2a8e7d-3e88-4d5d-8fa3-e19e84cc8cd8","727b4812-e662-46db-8add-8e39bc56f56d","code:EPC26_AR_DICTEE","a934f8db-75af-4d19-a8a3-573e2b220fab","f5d90560-3ad7-459e-97bc-4dc2f51fc380","aa1380ba-0d3e-4145-8e37-d6b18e7bb050","7fc4ce03-b3d2-415d-81b9-85d8c457d1f5"]}}'::jsonb;
  subject_map jsonb := '{"Apprentissage des lettres":"7d515de5-45f2-41b0-b513-6b236fe35d80","Chant":"code:EPC26_AR_CHANT","Dessin":"e7cf1b09-3270-428c-8b0e-d8cd8c4be17e","Coran":"f77d1b1e-c11d-44ed-9052-33e0de962fe0","Poème":"7fc4ce03-b3d2-415d-81b9-85d8c457d1f5","Écriture":"a934f8db-75af-4d19-a8a3-573e2b220fab","Hadith (tradition prophétique)":"3fc70482-7fa9-4cad-ba20-6070e28179e3","Jurisprudence et croyance (Al-Muslim As-Saghîr)":"4f662cbc-3bac-49bd-8fc4-59df6ffa47e4","Mathématiques":"3930bf9a-676f-4a4d-9613-98ff420aa11a","Expression orale":"dac4da9c-5fae-4b8c-adb8-d21ddb2b9102","Lecture":"af2a8e7d-3e88-4d5d-8fa3-e19e84cc8cd8","Dictée":"code:EPC26_AR_DICTEE","Jurisprudence islamique (Fiqh)":"2870e068-cd45-46a7-a466-58e2db5ddaf8","Unicité divine (Tawhîd)":"f8c16ddc-ef62-45d3-9864-4f83430d2843","Biographie du Prophète (SAW)":"727b4812-e662-46db-8add-8e39bc56f56d","Grammaire arabe":"f5d90560-3ad7-459e-97bc-4dc2f51fc380","Conjugaison arabe":"aa1380ba-0d3e-4145-8e37-d6b18e7bb050","Lecture du Coran":"3b12a699-57e9-4252-849b-16d2f31555ff","Mémorisation du Coran":"code:EPC26_AR_MEMORISATION_CORAN","Règles de lecture du Coran (Tajwid)":"code:EPC26_AR_TAJWID","Interprétation du Coran (Tafsir)":"code:EPC26_AR_TAFSIR"}'::jsonb;
  item record;
  level_name text;
  name_or_id text;
  subject_name text;
  token text;
  canonical_id uuid;
  inst_subject_id uuid;
  teacher_id_from_source uuid;
  teacher_count integer;
  class_id uuid;
  selected jsonb;
  current_tracks jsonb;
BEGIN
  SELECT settings_json INTO STRICT settings FROM public.institutions
  WHERE id=school_id FOR UPDATE;
  IF settings#>>'{franco_arabic_reports_v1,primaryArabicDefaultScale}' IS DISTINCT FROM 'true'
    OR NOT (settings#>'{school_cycles_v1,teachingTracksByCycle,primary}' ? 'arabic') THEN
    RAISE EXCEPTION 'EPC Arabic primary teaching and /10 default must be configured';
  END IF;
  IF (SELECT count(*) FROM public.classes
      WHERE institution_id=school_id AND academic_year=year_code
      AND id IN ('704bad54-ea01-4a42-a781-68fefba6d699','16e6ea13-70dd-4f41-93b3-df106c45b0ad','02c14444-8cf1-4032-8b03-d1c77233848c','a6016d56-68a2-4c6e-9604-56473e7398b3','195bf25f-d26f-4d87-8c42-ab024a3afeda','3541a6bd-0714-4122-ae52-23caebb68a43')) <> 6 THEN
    RAISE EXCEPTION 'The expected six EPC primary Arabic classes are not present';
  END IF;
  IF EXISTS (SELECT 1 FROM public.grade_evaluations g
    WHERE g.class_id IN ('704bad54-ea01-4a42-a781-68fefba6d699','16e6ea13-70dd-4f41-93b3-df106c45b0ad','02c14444-8cf1-4032-8b03-d1c77233848c','a6016d56-68a2-4c6e-9604-56473e7398b3','195bf25f-d26f-4d87-8c42-ab024a3afeda','3541a6bd-0714-4122-ae52-23caebb68a43'))
    OR EXISTS (SELECT 1 FROM public.grade_flat_marks gf
    WHERE gf.class_id IN ('704bad54-ea01-4a42-a781-68fefba6d699','16e6ea13-70dd-4f41-93b3-df106c45b0ad','02c14444-8cf1-4032-8b03-d1c77233848c','a6016d56-68a2-4c6e-9604-56473e7398b3','195bf25f-d26f-4d87-8c42-ab024a3afeda','3541a6bd-0714-4122-ae52-23caebb68a43')) THEN
    RAISE EXCEPTION 'Existing Arabic evaluation history must be reviewed before replacing the current subjects';
  END IF;
  INSERT INTO public.subjects(code,name,subject_key) VALUES
  ('EPC26_AR_CHANT','Chant','chant'),
  ('EPC26_AR_DICTEE','Dictée','dictee'),
  ('EPC26_AR_MEMORISATION_CORAN','Mémorisation du Coran','memorisation du coran'),
  ('EPC26_AR_TAJWID','Règles de lecture du Coran (Tajwid)','regles de lecture du coran (tajwid)'),
  ('EPC26_AR_TAFSIR','Interprétation du Coran (Tafsir)','interpretation du coran (tafsir)')
  ON CONFLICT (code) DO NOTHING;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('EPC26_AR_CHANT','Chant'),
    ('EPC26_AR_DICTEE','Dictée'),
    ('EPC26_AR_MEMORISATION_CORAN','Mémorisation du Coran'),
    ('EPC26_AR_TAJWID','Règles de lecture du Coran (Tajwid)'),
    ('EPC26_AR_TAFSIR','Interprétation du Coran (Tafsir)')
    ) x(code,name) LEFT JOIN public.subjects s ON s.code=x.code
    WHERE s.id IS NULL OR s.name <> x.name) THEN
    RAISE EXCEPTION 'One of the reserved EPC Arabic subject codes conflicts with an existing subject';
  END IF;
  FOR level_name, item IN SELECT key, value FROM jsonb_each(catalog) LOOP
    class_id := (item.value->>'classId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id=class_id
      AND c.institution_id=school_id AND c.academic_year=year_code
      AND c.level=level_name AND c.label ILIKE '%Arabe%')
      OR (settings#>ARRAY['school_student_programs_v1','years',year_code,'classes',class_id::text,'tracks']) <> '["arabic"]'::jsonb THEN
      RAISE EXCEPTION 'Wrong class or teaching configuration for grade %', level_name;
    END IF;
    selected := '[]'::jsonb;
    FOR name_or_id IN SELECT jsonb_array_elements_text(item.value->'subjects') LOOP
      token := name_or_id;
      IF left(token,5)='code:' THEN
        SELECT s.id INTO canonical_id FROM public.subjects s WHERE s.code=substring(token FROM 6);
      ELSE
        canonical_id := token::uuid;
      END IF;
      IF canonical_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.id=canonical_id) THEN
        RAISE EXCEPTION 'Missing canonical subject % for grade %', token, level_name;
      END IF;
      INSERT INTO public.institution_subjects(institution_id,subject_id,is_active)
        VALUES(school_id,canonical_id,true)
      ON CONFLICT(institution_id,subject_id) DO UPDATE SET is_active=true;
      selected := selected || to_jsonb(canonical_id::text);
      current_tracks := COALESCE(settings#>ARRAY['school_cycles_v1','subjectTracksByCycle','primary',canonical_id::text], '[]'::jsonb);
      IF NOT (current_tracks ? 'arabic') THEN
        settings := jsonb_set(settings,
          ARRAY['school_cycles_v1','subjectTracksByCycle','primary',canonical_id::text],
          current_tracks || '["arabic"]'::jsonb, true);
      END IF;
    END LOOP;
    settings := jsonb_set(settings,
      ARRAY['school_class_subjects_v1','years',year_code,'classes',class_id::text],
      selected, true);
  END LOOP;
  -- Split old teaching assignments, retaining the same teacher for each new
  -- formerly combined component. No change to the teachers of retained subjects.
  FOR item IN SELECT * FROM (VALUES
    ('CP1','Chant','c3bdc6db-43e5-4846-9845-94920443f5a8'::uuid),
    ('CP1','Dessin','c3bdc6db-43e5-4846-9845-94920443f5a8'::uuid),
    ('CP1','Coran','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CP1','Poème','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CP1','Écriture','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CP2','Chant','ad3735df-5bbb-4057-9e30-d494e7459862'::uuid),
    ('CP2','Dessin','ad3735df-5bbb-4057-9e30-d494e7459862'::uuid),
    ('CP2','Coran','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CP2','Écriture','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CE1','Coran','2ef37fbc-c644-4fa0-8b45-6116d7d49c43'::uuid),
    ('CE1','Écriture','2ef37fbc-c644-4fa0-8b45-6116d7d49c43'::uuid),
    ('CE1','Jurisprudence et croyance (Al-Muslim As-Saghîr)','77852243-a3d8-40a7b499-1609cd006a6a'::uuid),
    ('CE2','Coran','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CE2','Poème','40e5bd99-1f0f-4d3d-b930-3c98c888d044'::uuid),
    ('CE2','Écriture','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid),
    ('CE2','Dictée','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid),
    ('CE2','Jurisprudence et croyance (Al-Muslim As-Saghîr)','77852243-a3d8-40a7b499-1609cd006a6a'::uuid),
    ('CM1','Coran','afd105c1-f220-4d54-9adf-b3676a7c028f'::uuid),
    ('CM1','Écriture','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid),
    ('CM1','Dictée','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid),
    ('CM2','Lecture du Coran','f77d1b1e-c11d-44ed-9052-33e0de962fe0'::uuid),
    ('CM2','Mémorisation du Coran','f77d1b1e-c11d-44ed-9052-33e0de962fe0'::uuid),
    ('CM2','Règles de lecture du Coran (Tajwid)','24c5ba45-ff36-4fac-824f-999a7d7d8eac'::uuid),
    ('CM2','Interprétation du Coran (Tafsir)','2fab51c6-772c-4521-a0b3-00cfb5a48b50'::uuid),
    ('CM2','Écriture','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid),
    ('CM2','Dictée','149d6bcd-dd4a-4e17-9572-886b27eff9e7'::uuid)
  ) x(level,target_name,old_global_id) LOOP
    class_id := (catalog->item.level->>'classId')::uuid;
    token := subject_map->>item.target_name;
    IF left(token,5)='code:' THEN
      SELECT s.id INTO canonical_id FROM public.subjects s WHERE s.code=substring(token FROM 6);
    ELSE canonical_id := token::uuid;
    END IF;
    SELECT i.id INTO inst_subject_id FROM public.institution_subjects i
      WHERE i.institution_id=school_id AND i.subject_id=canonical_id;
    IF NOT EXISTS (SELECT 1 FROM public.class_teachers ct
        WHERE ct.institution_id=school_id AND ct.class_id=class_id
          AND ct.subject_id=inst_subject_id AND ct.end_date IS NULL) THEN
      SELECT count(DISTINCT ct.teacher_id), min(ct.teacher_id::text)::uuid
        INTO teacher_count, teacher_id_from_source
      FROM public.class_teachers ct
      JOIN public.institution_subjects i ON i.id=ct.subject_id
      WHERE ct.institution_id=school_id AND ct.class_id=class_id
        AND ct.end_date IS NULL AND i.subject_id=item.old_global_id;
      IF teacher_count <> 1 THEN
        RAISE EXCEPTION 'Cannot establish a unique teacher for % % (old subject %)',
        item.level,item.target_name,item.old_global_id;
      END IF;
      INSERT INTO public.class_teachers(institution_id,class_id,subject_id,teacher_id,start_date)
      VALUES(school_id,class_id,inst_subject_id,teacher_id_from_source,CURRENT_DATE)
      ON CONFLICT (class_id,subject_id,teacher_id,start_date) DO NOTHING;
    END IF;
  END LOOP;
  -- Retire only current teaching links excluded by the new reference. Preserve
  -- all historical rows, including their former teacher identities.
  UPDATE public.class_teachers ct SET end_date=CURRENT_DATE
  WHERE ct.institution_id=school_id AND ct.end_date IS NULL
    AND ct.class_id IN ('704bad54-ea01-4a42-a781-68fefba6d699','16e6ea13-70dd-4f41-93b3-df106c45b0ad','02c14444-8cf1-4032-8b03-d1c77233848c','a6016d56-68a2-4c6e-9604-56473e7398b3','195bf25f-d26f-4d87-8c42-ab024a3afeda','3541a6bd-0714-4122-ae52-23caebb68a43')
    AND NOT EXISTS (
      SELECT 1 FROM public.institution_subjects i,
        jsonb_array_elements_text(settings#>ARRAY['school_class_subjects_v1','years',year_code,'classes',ct.class_id::text]) desired(canonical_id)
      WHERE i.id=ct.subject_id AND desired.canonical_id=i.subject_id::text
    );
  UPDATE public.institutions SET settings_json=settings WHERE id=school_id;
END
$epc$;
COMMIT;
