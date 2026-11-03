"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Account, Category } from "./types";

export function useLookups() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    supabase.from("categories").select("*").order("name").then(({ data }) => setCategories((data as Category[]) ?? []));
    supabase.from("accounts").select("*").order("name").then(({ data }) => setAccounts((data as Account[]) ?? []));
  }, [reload]);
  return { categories, accounts, refresh: () => setReload((n) => n + 1) };
}
