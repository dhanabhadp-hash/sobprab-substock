
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'user', 'visitor');
CREATE TYPE public.transaction_type AS ENUM ('disburse', 'receive', 'adjust');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER_ROLES
CREATE TABLE public.user_roles (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- MEDICINES
CREATE TABLE public.medicines (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  drug_name TEXT NOT NULL,
  strength TEXT,
  form TEXT,
  unit TEXT NOT NULL DEFAULT 'หน่วย',
  barcode TEXT,
  price_per_unit NUMERIC NOT NULL DEFAULT 0,
  usage_rate NUMERIC NOT NULL DEFAULT 0,
  minimum_stock NUMERIC NOT NULL DEFAULT 0,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicines TO authenticated;
GRANT ALL ON public.medicines TO service_role;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_medicines_barcode ON public.medicines(barcode);
CREATE INDEX idx_medicines_product_code ON public.medicines(product_code);

CREATE TRIGGER trg_medicines_updated_at
BEFORE UPDATE ON public.medicines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TRANSACTIONS
CREATE TABLE public.transactions (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username TEXT,
  type transaction_type NOT NULL,
  quantity NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_transactions_medicine ON public.transactions(medicine_id);
CREATE INDEX idx_transactions_created ON public.transactions(created_at);

-- SYSTEM_LOGS
CREATE TABLE public.system_logs (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_system_logs_created ON public.system_logs(created_at);

-- RLS POLICIES
-- profiles
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- user_roles
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- medicines
CREATE POLICY "Authenticated view medicines" ON public.medicines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage medicines" ON public.medicines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- transactions
CREATE POLICY "Authenticated view transactions" ON public.transactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage transactions" ON public.transactions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- system_logs
CREATE POLICY "Authenticated insert logs" ON public.system_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins view logs" ON public.system_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- handle_new_user: create profile + assign role (first user = admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
  assigned_role app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  );

  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'user';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- process_transaction: controlled stock mutation (disburse/receive/adjust)
CREATE OR REPLACE FUNCTION public.process_transaction(
  _medicine_id UUID,
  _type transaction_type,
  _quantity NUMERIC,
  _note TEXT DEFAULT NULL
)
RETURNS TABLE (new_balance NUMERIC, tx_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  uname TEXT;
  med RECORD;
  new_bal NUMERIC;
  new_tx UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ไม่ได้เข้าสู่ระบบ';
  END IF;

  IF NOT (public.has_role(uid, 'admin') OR public.has_role(uid, 'user')) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ทำรายการนี้';
  END IF;

  IF _quantity < 0 THEN
    RAISE EXCEPTION 'จำนวนต้องไม่ติดลบ';
  END IF;

  SELECT * INTO med FROM public.medicines WHERE id = _medicine_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการยา';
  END IF;

  SELECT username INTO uname FROM public.profiles WHERE id = uid;

  IF _type = 'disburse' THEN
    IF med.current_stock < _quantity THEN
      RAISE EXCEPTION 'สต็อกไม่พอ (คงเหลือ %)', med.current_stock;
    END IF;
    new_bal := med.current_stock - _quantity;
  ELSIF _type = 'receive' THEN
    new_bal := med.current_stock + _quantity;
  ELSE -- adjust: set absolute
    new_bal := _quantity;
  END IF;

  UPDATE public.medicines SET current_stock = new_bal, updated_at = now()
  WHERE id = _medicine_id;

  INSERT INTO public.transactions (medicine_id, user_id, username, type, quantity, balance_after, unit_price, note)
  VALUES (_medicine_id, uid, uname, _type, _quantity, new_bal, med.price_per_unit, _note)
  RETURNING id INTO new_tx;

  INSERT INTO public.system_logs (user_id, username, action, status, detail)
  VALUES (uid, uname,
    CASE _type WHEN 'disburse' THEN 'เบิกจ่ายยา' WHEN 'receive' THEN 'รับยาเข้า' ELSE 'ปรับยอดสต็อก' END,
    'success',
    med.drug_name || ' จำนวน ' || _quantity || ' ' || med.unit || ' (คงเหลือ ' || new_bal || ')');

  RETURN QUERY SELECT new_bal, new_tx;
END;
$$;

-- log_event: helper to append system log for the current user
CREATE OR REPLACE FUNCTION public.log_event(_action TEXT, _status TEXT DEFAULT 'success', _detail TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  uname TEXT;
BEGIN
  SELECT username INTO uname FROM public.profiles WHERE id = uid;
  INSERT INTO public.system_logs (user_id, username, action, status, detail)
  VALUES (uid, uname, _action, _status, _detail);
END;
$$;

-- Realtime
ALTER TABLE public.medicines REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medicines;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
