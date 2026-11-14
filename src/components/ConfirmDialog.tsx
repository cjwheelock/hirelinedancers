"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./ConfirmDialog.module.css";

/**
 * In-app confirmation sheet. Replaces one-click destructive actions and
 * browser confirm/prompt dialogs. Children render between the message and the
 * buttons, for example a reason field.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busyLabel,
  danger = false,
  busy = false,
  confirmDisabled = false,
  error,
  children,
  onConfirm,
  onCancel
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busyLabel?: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstField = sheet.current?.querySelector<HTMLElement>("textarea, input");
    (firstField ?? cancelButton.current)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      origin?.focus({ preventScroll: true });
    };
  }, []);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...(sheet.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input, a[href]") ?? [])];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={handleKeys}>
        <h2 id={headingId} className={styles.title}>{title}</h2>
        {message ? <p className={styles.message}>{message}</p> : null}
        {children}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button className={danger ? styles.danger : styles.confirm} type="button" disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
          <button ref={cancelButton} className={styles.cancel} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
