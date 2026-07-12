import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Medicine } from "@/lib/format";

export function useMedicines() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["medicines"],
    queryFn: async (): Promise<Medicine[]> => {
      const { data, error } = await supabase
        .from("medicines")
        .select("*")
        .order("drug_name", { ascending: true });
      if (error) throw error;
      return data as Medicine[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("medicines-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "medicines" }, () => {
        qc.invalidateQueries({ queryKey: ["medicines"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

export interface TransactionRow {
  id: string;
  medicine_id: string;
  type: "disburse" | "receive" | "adjust";
  quantity: number;
  balance_after: number;
  unit_price: number;
  note: string | null;
  username: string | null;
  created_at: string;
  medicines?: { drug_name: string; unit: string; product_code: string } | null;
}

export function useTransactions(limit = 100) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["transactions", limit],
    queryFn: async (): Promise<TransactionRow[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, medicines(drug_name, unit, product_code)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as unknown as TransactionRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("transactions-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        qc.invalidateQueries({ queryKey: ["transactions"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}
