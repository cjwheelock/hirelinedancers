"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { displayDate, displayDateTime, displayTime, money, type Booking } from "@/lib/booking";
import styles from "./BookingAgreementReview.module.css";

type PdfState = { pdf: PDFDocumentProxy; bytes: ArrayBuffer; hash: string };

export function BookingAgreementReview({ booking, busy = false, error, onClose, onSubmit }: {
  booking: Booking;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit?: (typedName: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const headingId = useId();
  const signatureKey = JSON.stringify(booking.signatures);
  // The agreement hash binds the immutable quote fields. Refresh the document
  // for a new quote or saved signature, not unrelated inbox refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => booking, [booking.id, booking.agreement_sha256, signatureKey]);
  const [pdfState, setPdfState] = useState<PdfState | null>(null);
  const [requestedPage, setRequestedPage] = useState(1);
  const [displayed, setDisplayed] = useState<{ hash: string; page: number } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [textView, setTextView] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [typedName, setTypedName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [retry, setRetry] = useState(0);
  const canSign = Boolean(onSubmit);
  const currentDocument = displayed?.hash === snapshot.agreement_sha256 && pdfState?.hash === snapshot.agreement_sha256;
  const ready = textView || currentDocument;

  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog.current);
    const previousInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    document.body.style.overflow = "hidden";
    backButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      origin?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    let loading: { destroy: () => Promise<void> } | undefined;
    setPdfError(null);
    setPdfState(null);
    setRequestedPage(1);
    void (async () => {
      try {
        const [documentTools, pdfjs] = await Promise.all([import("@/lib/bookingDocument"), import("pdfjs-dist")]);
        const font = await documentTools.loadBookingPdfFont();
        if (!active) return;
        const bytes = documentTools.createBookingPdf(snapshot, font);
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ data: bytes.slice(0), useSystemFonts: true });
        loading = task;
        const pdf = await task.promise;
        if (!active) { await task.destroy(); return; }
        setPdfState({ pdf, bytes, hash: snapshot.agreement_sha256 });
      } catch {
        if (active) setPdfError("Unable to prepare the PDF. You can read the full agreement in text view or try again.");
      }
    })();
    return () => { active = false; void loading?.destroy().catch(() => {}); };
  }, [snapshot, retry]);

  useEffect(() => {
    setTypedName("");
    setReviewed(false);
    setAgreed(false);
  }, [snapshot.id, snapshot.agreement_sha256]);

  useEffect(() => {
    if (!pdfState || textView) return;
    let active = true;
    let renderTask: { cancel: () => void } | undefined;
    void (async () => {
      try {
        const page = await pdfState.pdf.getPage(requestedPage);
        if (!active) return;
        const viewport = page.getViewport({ scale: 2 });
        const buffer = document.createElement("canvas");
        buffer.width = Math.ceil(viewport.width);
        buffer.height = Math.ceil(viewport.height);
        const context = buffer.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const task = page.render({ canvas: buffer, canvasContext: context, viewport });
        renderTask = task;
        await task.promise;
        if (!active || !canvas.current) return;
        const target = canvas.current;
        const targetContext = target.getContext("2d");
        if (!targetContext) throw new Error("Canvas unavailable");
        // Render offscreen first, then replace the visible page synchronously.
        // Rapid selections cancel older renders without clearing the current one.
        target.width = buffer.width;
        target.height = buffer.height;
        targetContext.drawImage(buffer, 0, 0);
        setDisplayed({ hash: pdfState.hash, page: requestedPage });
      } catch {
        if (active) setPdfError("Unable to display this PDF page. You can read the full agreement in text view or try again.");
      }
    })();
    return () => { active = false; renderTask?.cancel(); };
  }, [pdfState, requestedPage, textView]);

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])].filter(element => element.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function downloadPdf() {
    if (!pdfState || pdfState.hash !== snapshot.agreement_sha256) return;
    const url = URL.createObjectURL(new Blob([pdfState.bytes], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `booking-agreement-${snapshot.id.slice(0, 8)}.pdf`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <section ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={handleKeys}>
      <div className={styles.brand}>HIRE LINE DANCERS</div>
      <header className={styles.header}>
        <div>
          <button ref={backButton} className={styles.back} type="button" disabled={busy} onClick={onClose}><ArrowLeft size={16} aria-hidden="true" /> Back to conversation</button>
          <h1 id={headingId}>{canSign ? "Review, sign, and pay" : "Booking agreement"}</h1>
        </div>
        {canSign ? <ol className={styles.steps} aria-label="Booking steps"><li aria-current={typedName ? undefined : "step"}><span>1</span> Review</li><li aria-current={typedName ? "step" : undefined}><span>2</span> Sign</li><li><span>3</span> Pay</li></ol> : null}
      </header>
      <div className={styles.layout}>
        <div className={styles.document}>
          <div className={styles.toolbar}>
            <span>Booking agreement</span>
            <div className={styles.tools}>
              <button type="button" onClick={() => setTextView(value => !value)}>{textView ? "PDF view" : "Text view"}</button>
              <button type="button" onClick={downloadPdf} disabled={!pdfState || pdfState.hash !== snapshot.agreement_sha256}><Download size={15} aria-hidden="true" /> Download PDF</button>
            </div>
          </div>
          {!textView ? <div className={styles.pagination}>
            <label>Zoom <select value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value="1">Fit width</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
            <div className={styles.pageControls}>
              <button type="button" aria-label="Previous page" disabled={!pdfState || requestedPage <= 1} onClick={() => setRequestedPage(page => Math.max(1, page - 1))}><ChevronLeft size={18} aria-hidden="true" /></button>
              <span role="status">{currentDocument ? `${displayed.page} / ${pdfState.pdf.numPages}` : "Preparing PDF..."}</span>
              <button type="button" aria-label="Next page" disabled={!pdfState || requestedPage >= pdfState.pdf.numPages} onClick={() => setRequestedPage(page => Math.min(pdfState?.pdf.numPages ?? 1, page + 1))}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </div> : null}
          {pdfError ? <div className={styles.error} role="alert"><p>{pdfError}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry PDF</button></div> : null}
          <div className={styles.viewport} hidden={textView}>
            <div className={styles.paper} style={{ width: `${zoom * 100}%` }} aria-busy={!currentDocument || requestedPage !== displayed?.page}>
              <canvas ref={canvas} className={displayed ? styles.canvas : styles.pendingCanvas} role="img" aria-label={`Booking agreement, page ${displayed?.page ?? 1}`} />
              {!displayed ? <div className={styles.placeholder}><p className={styles.paperBrand}>HIRE LINE DANCERS</p><h2>Booking agreement</h2><strong className={styles.placeholderTotal}>{money(snapshot.total_cents)}</strong><p>{displayDate(snapshot.event_date)}<br />{displayTime(snapshot.start_time)} to {displayTime(snapshot.end_time)} ({snapshot.time_zone})</p><p>{[snapshot.venue_name, snapshot.venue_address].filter(Boolean).join(", ")}</p><p>{snapshot.service_description}</p><p className={styles.preparing}><FileText size={18} aria-hidden="true" /> Preparing PDF...</p></div> : null}
            </div>
          </div>
          {textView ? <article className={styles.textPaper} aria-label="Full booking agreement"><h2>Booking agreement</h2><div className={styles.agreementContent}>{snapshot.agreement_text}</div><h3>Signatures</h3>{snapshot.signatures.map(signature => <p key={signature.party_role}>{signature.party_role === "instructor" ? "Instructor" : "Client"}: {signature.typed_name}<br />{displayDateTime(signature.signed_at)}</p>)}</article> : null}
        </div>
        <aside className={styles.signCard} aria-label={canSign ? "Electronic signature" : "Signatures"}>
          {canSign ? <form onSubmit={event => { event.preventDefault(); if (ready && reviewed && agreed && typedName.trim().length >= 2 && !busy) onSubmit?.(typedName.trim()); }}>
            <p className={styles.eyebrow}>Signature</p><h2>Sign the agreement</h2>
            <p className={styles.help}>Read the agreement. When you sign, you go straight to secure payment of <strong>{money(snapshot.total_cents)}</strong>.</p>
            <button className={styles.signaturePage} type="button" disabled={!pdfState || textView} onClick={() => setRequestedPage(pdfState?.pdf.numPages ?? 1)}>View signature page <ArrowRight size={15} aria-hidden="true" /></button>
            <label className={styles.nameLabel} htmlFor={`${headingId}-name`}>Type your full name to sign</label>
            <input id={`${headingId}-name`} required minLength={2} maxLength={120} autoComplete="name" value={typedName} disabled={busy} onChange={event => setTypedName(event.target.value)} />
            <div className={styles.signaturePreview} aria-live="polite">{typedName.trim() || <span>Your signature</span>}</div>
            <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy || !ready} onChange={event => setReviewed(event.target.checked)} /><span>I have read the agreement</span></label>
            <label className={styles.check}><input type="checkbox" checked={agreed} disabled={busy || !ready} onChange={event => setAgreed(event.target.checked)} /><span>I agree to this booking agreement and the <a href="/legal/terms/" target="_blank" rel="noreferrer">Terms of Service</a>, and I am signing electronically.</span></label>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.total}><span>Total</span><strong>{money(snapshot.total_cents)}</strong></div>
            <button className={styles.submit} type="submit" disabled={busy || !ready || !agreed || !reviewed || typedName.trim().length < 2}>{busy ? "Opening payment..." : "Agree and continue to payment"}<ArrowRight size={17} aria-hidden="true" /></button>
            <p className={styles.help}>The agreement takes effect only when the payment succeeds.</p>
          </form> : <><p className={styles.eyebrow}>Signatures</p><h2>Booking agreement</h2>{snapshot.signatures.map(signature => <div className={styles.savedSignature} key={signature.party_role}><p>{signature.party_role === "instructor" ? "Instructor" : "Client"}</p><strong>{signature.typed_name}</strong><p>{displayDateTime(signature.signed_at)}</p></div>)}<div className={styles.total}><span>Total</span><strong>{money(snapshot.total_cents)}</strong></div></>}
        </aside>
      </div>
    </section>, document.body
  );
}
