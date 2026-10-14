ALTER POLICY "Authenticated view medicines" ON public.medicines USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'user') OR public.has_role(auth.uid(), 'visitor'));
ALTER POLICY "Authenticated view transactions" ON public.transactions USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'user') OR public.has_role(auth.uid(), 'visitor'));
ALTER POLICY "Authenticated view requisitions" ON public.requisitions USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'user') OR public.has_role(auth.uid(), 'visitor'));
ALTER POLICY "Authenticated insert requisitions" ON public.requisitions WITH CHECK (auth.uid() = requester_id AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'user')));
GRANT SELECT ON public.medicines, public.transactions, public.requisitions TO authenticated;
GRANT INSERT ON public.requisitions TO authenticated;
GRANT ALL ON public.medicines, public.transactions, public.requisitions TO service_role;