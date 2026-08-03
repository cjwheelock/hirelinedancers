"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getMarketplaceClient,
  marketplaceConfigured,
  type MarketplaceAccount
} from "@/lib/marketplace";

type SessionState = {
  session: Session | null;
  account: MarketplaceAccount | null;
  loading: boolean;
  error: string | null;
};

export function useMarketplaceSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    account: null,
    loading: true,
    error: null
  });

  const loadAccount = useCallback(async (session: Session | null) => {
    const client = getMarketplaceClient();
    if (!client || !session) {
      setState({ session, account: null, loading: false, error: null });
      return;
    }

    const { data, error } = await client
      .from("accounts")
      .select("id,email,full_name,role,company_name,phone_e164,sms_opt_in,onboarding_completed_at")
      .eq("id", session.user.id)
      .maybeSingle();

    setState({
      session,
      account: (data as MarketplaceAccount | null) ?? null,
      loading: false,
      error: error?.message ?? null
    });
  }, []);

  useEffect(() => {
    const client = getMarketplaceClient();
    if (!marketplaceConfigured || !client) {
      setState({
        session: null,
        account: null,
        loading: false,
        error: "Supabase is not configured for this build."
      });
      return;
    }

    let active = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setState({ session: null, account: null, loading: false, error: error.message });
        return;
      }
      void loadAccount(data.session);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (active) void loadAccount(session);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadAccount]);

  return {
    ...state,
    configured: marketplaceConfigured,
    refresh: () => loadAccount(state.session)
  };
}
