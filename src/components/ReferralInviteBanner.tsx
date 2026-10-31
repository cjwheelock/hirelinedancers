"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { foundingInstructorDeadline } from "@/lib/commercialTerms";
import { captureReferralFromUrl, lookupReferralCode, storedReferral } from "@/lib/referrals";
import styles from "./ReferralInviteBanner.module.css";

/** Shown on the instructor join page when someone arrives through a referral link. */
export function ReferralInviteBanner() {
  const [referrerName, setReferrerName] = useState<string | null>(null);

  useEffect(() => {
    const code = captureReferralFromUrl() ?? storedReferral()?.code;
    if (!code) return;
    let active = true;
    lookupReferralCode(code)
      .then((result) => {
        if (active && result) setReferrerName(result.referrerName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!referrerName) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.who}>
        <UserPlus size={18} aria-hidden="true" />
        {referrerName} invited you
      </span>
      <span className={styles.offer}>Join by {foundingInstructorDeadline} and the $49 listing fee is waived.</span>
    </div>
  );
}
