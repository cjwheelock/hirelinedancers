"use client";

import { useEffect, useState } from "react";
import { getMarketplaceClient } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

export function InstructorSmsSettings() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const client = getMarketplaceClient();
    if (client) void client.functions.invoke("instructor-sms", { body: { action: "status" } }).then(({ data }) => {
      if (active && data) {
        setAvailable(data.available === true);
        setEnabled(data.enabled === true);
        setPhone(data.phone || "");
      }
    });
    return () => { active = false; };
  }, []);

  async function update(action: "start" | "confirm" | "disable") {
    const client = getMarketplaceClient();
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: invokeError } = await client.functions.invoke("instructor-sms", { body: { action, phone, consent, verificationId, code } });
    let errorMessage = data?.error;
    if (invokeError && "context" in invokeError && invokeError.context instanceof Response) {
      errorMessage = (await invokeError.context.json().catch(() => ({}))).error;
    }
    if (invokeError || errorMessage) setError(errorMessage || "Unable to update text alerts. Please try again.");
    else if (action === "start") {
      setVerificationId(data.verificationId);
      setMessage("Enter the verification code sent to your phone.");
    } else {
      setEnabled(data.enabled === true);
      setVerificationId(null);
      setCode("");
      setMessage(action === "disable" ? "Text alerts are off." : "Text alerts are on.");
    }
    setBusy(false);
  }

  if (!available && !enabled) return null;
  return (
    <section className={`${styles.card} ${styles.stack}`} aria-label="Text alerts">
      <h3>Text alerts</h3>
      {enabled ? <>
        <p>Inquiry alerts go to {phone}. Reply on Hire Line Dancers to keep your conversation in one place.</p>
        <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => void update("disable")}>Turn off text alerts</button>
      </> : <>
        <label className={styles.field}><span>Mobile phone with country code</span><input type="tel" autoComplete="tel" value={phone} placeholder="+15551234567" disabled={busy || Boolean(verificationId)} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className={styles.check}><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to receive Hire Line Dancers inquiry alerts, messages, and response reminders by text at this number. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is optional. <a href="/legal/terms/">Terms</a> and <a href="/legal/privacy/">Privacy Policy</a>.</span></label>
        {verificationId ? <>
          <label className={styles.field}><span>Verification code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
          <div className={styles.buttonRow}>
            <button className={styles.button} type="button" disabled={busy || !consent || code.length < 4} onClick={() => void update("confirm")}>Verify and enable</button>
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => { setVerificationId(null); setCode(""); setMessage(null); }}>Use another number or code</button>
          </div>
        </> : <button className={styles.secondaryButton} type="button" disabled={busy || !consent || !/^\+[1-9][0-9]{7,14}$/.test(phone.trim())} onClick={() => void update("start")}>{busy ? "Sending code..." : "Send verification code"}</button>}
      </>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
