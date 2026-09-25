CREATE TABLE public.import_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_key text NOT NULL UNIQUE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_aliases TO authenticated;
GRANT ALL ON public.import_aliases TO service_role;
ALTER TABLE public.import_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth view aliases" ON public.import_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write aliases" ON public.import_aliases FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'user'));
CREATE POLICY "Staff update aliases" ON public.import_aliases FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'user'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'user'));
CREATE POLICY "Admins delete aliases" ON public.import_aliases FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text,
  user_id uuid,
  username text,
  item_count integer NOT NULL DEFAULT 0,
  total_qty numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by text
);
GRANT SELECT ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth view batches" ON public.import_batches FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.import_receive_batch(_file_name text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); uname text; it jsonb; r record;
  out_items jsonb := '[]'::jsonb; total numeric := 0; cnt int := 0; bid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'ไม่ได้เข้าสู่ระบบ'; END IF;
  IF NOT (has_role(uid,'admin') OR has_role(uid,'user')) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ทำรายการนี้'; END IF;
  SELECT username INTO uname FROM profiles WHERE id = uid;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO r FROM process_transaction((it->>'medicine_id')::uuid, 'receive',
      (it->>'quantity')::numeric, COALESCE(NULLIF(it->>'note',''), 'นำเข้าไฟล์: ' || COALESCE(_file_name,'')));
    out_items := out_items || jsonb_build_object('medicine_id', it->>'medicine_id',
      'quantity', (it->>'quantity')::numeric, 'tx_id', r.tx_id);
    total := total + (it->>'quantity')::numeric; cnt := cnt + 1;
  END LOOP;
  INSERT INTO import_batches (file_name, user_id, username, item_count, total_qty, items)
  VALUES (_file_name, uid, uname, cnt, total, out_items) RETURNING id INTO bid;
  RETURN bid;
END; $$;

CREATE OR REPLACE FUNCTION public.revert_import_batch(_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); uname text; b record; it jsonb; med record; nb numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'ไม่ได้เข้าสู่ระบบ'; END IF;
  IF NOT (has_role(uid,'admin') OR has_role(uid,'user')) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ทำรายการนี้'; END IF;
  SELECT * INTO b FROM import_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบรอบนำเข้า'; END IF;
  IF b.reverted_at IS NOT NULL THEN RAISE EXCEPTION 'รอบนี้ถูกเรียกคืนไปแล้ว'; END IF;
  SELECT username INTO uname FROM profiles WHERE id = uid;
  FOR it IN SELECT * FROM jsonb_array_elements(b.items) LOOP
    SELECT * INTO med FROM medicines WHERE id = (it->>'medicine_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    nb := med.current_stock - (it->>'quantity')::numeric;
    IF nb < 0 THEN RAISE EXCEPTION 'เรียกคืนไม่ได้: % คงเหลือ % น้อยกว่าจำนวนที่นำเข้า (ถูกเบิกไปแล้ว)', med.drug_name, med.current_stock; END IF;
    UPDATE medicines SET current_stock = nb, updated_at = now() WHERE id = med.id;
    INSERT INTO transactions (medicine_id, user_id, username, type, quantity, balance_after, unit_price, note)
    VALUES (med.id, uid, uname, 'adjust', nb, nb, med.price_per_unit,
      'เรียกคืนการนำเข้าไฟล์: ' || COALESCE(b.file_name,'') || ' (-' || (it->>'quantity') || ')');
  END LOOP;
  UPDATE import_batches SET reverted_at = now(), reverted_by = uname WHERE id = _batch_id;
  INSERT INTO system_logs (user_id, username, action, status, detail)
  VALUES (uid, uname, 'เรียกคืนการนำเข้าไฟล์', 'success', COALESCE(b.file_name,'') || ' · ' || b.item_count || ' รายการ');
END; $$;