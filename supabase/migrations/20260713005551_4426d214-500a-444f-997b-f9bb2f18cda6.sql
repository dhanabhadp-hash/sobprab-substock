CREATE TABLE public.requisitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_date DATE NOT NULL DEFAULT current_date,
  department TEXT NOT NULL DEFAULT 'เภสัชกรรมและคุ้มครองผู้บริโภค',
  purpose TEXT NOT NULL DEFAULT 'บริการผู้ป่วยที่เข้ารับการรักษา',
  requester_id UUID,
  requester_name TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.requisitions TO authenticated;
GRANT ALL ON public.requisitions TO service_role;

ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view requisitions"
  ON public.requisitions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert requisitions"
  ON public.requisitions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins delete requisitions"
  ON public.requisitions FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_requisitions_created_at ON public.requisitions (created_at DESC);