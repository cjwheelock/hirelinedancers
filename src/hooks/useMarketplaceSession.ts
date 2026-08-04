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
  isAdmin: boolean;
  isOwner: boolean;
  loading: boolean;
  error: string | null;
};

export function useMarketplaceSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    account: null,
    isAdmin: false,
    isOwner: false,
    loading: true,
    error: null
  });

  const loadAccount = useCallback(async (session: Session | null) => {
    const client = getMarketplaceClient();
    if (!client || !session) {
      setState({ session, account: null, isAdmin: false, isOwner: false, loading: false, error: null });
      return;
    }

    const [accountResult, adminResult, ownerResult] = await Promise.all([
      client
        .from("accounts")
        .select("id,email,full_name,role,company_name,phone_e164,sms_opt_in,onboarding_completed_at")
        .eq("id", session.user.id)
        .maybeSingle(),
      client.rpc("current_marketplace_admin_status"),
      client.rpc("current_marketplace_owner_status")
    ]);

    const account = (accountResult.data as MarketplaceAccount | null) ?? null;

    setState({
      session,
      account,
      isAdmin: Boolean(adminResult.data) || account?.role === "admin",
      isOwner: Boolean(ownerResult.data) || account?.role === "admin",
      loading: false,
      error: accountResult.error?.message ?? adminResult.error?.message ?? ownerResult.error?.message ?? null
    });
  }, []);

  useEffect(() => {
    const client = getMarketplaceClient();
    if (!marketplaceConfigured || !client) {
      setState({
        session: null,
        account: null,
        isAdmin: false,
        isOwner: false,
        loading: false,
        error: "Supabase is not configured for this build."
      });
      return;
    }

    let active = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setState({ session: null, account: null, isAdmin: false, isOwner: false, loading: false, error: error.message });
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
