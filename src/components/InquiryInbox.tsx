"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Clock3, Inbox, RefreshCw, Search, Send } from "lucide-react";
import { eventTypes } from "@/data/site";
import {
  getMarketplaceClient,
  readableError,
  type InquiryFallbackCandidate,
  type InquiryInboxThread,
  type InquiryThreadDetail,
  type InquiryThreadMessage,
  type MarketplaceInquiry
} from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type InboxPerspective = "organizer" | "instructor" | "admin";
type InboxFilter = "all" | "unread" | "needs_reply" | "active" | "closed";
type InboxSort = "recent" | "oldest_waiting" | "event_date";
const inboxPageSize = 50;

function eventTypeLabel(value: string | null | undefined) {
  if (!value) return "Event";
  return eventTypes.find((item) => item.slug === value)?.label ?? value.replaceAll("-", " ");
}

function statusLabel(value: string | null | undefined) {
  return (value || "active").replaceAll("_", " ");
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
  ).format(date);
}

function responseDeadline(value: string | null) {
  if (!value) return null;
  const difference = new Date(value).getTime() - Date.now();
  if (difference <= 0) return "Response overdue";
  const hours = Math.ceil(difference / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} to respond`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} to respond`;
}

function normalizeDetail(data: unknown): InquiryThreadDetail | null {
  if (!data || typeof data !== "object") return null;
  const detail = data as Partial<InquiryThreadDetail>;
  if (!detail.thread || !detail.inquiry) return null;
  return {
    thread: detail.thread,
    inquiry: detail.inquiry as MarketplaceInquiry,
    participants: Array.isArray(detail.participants) ? detail.participants : [],
    messages: Array.isArray(detail.messages) ? detail.messages : [],
    admin_notes: Array.isArray(detail.admin_notes) ? detail.admin_notes : []
  };
}

function senderLabel(message: InquiryThreadMessage, perspective: InboxPerspective) {
  if (message.message_type === "system" || message.sender_role === "system") return "Hire Line Dancers";
  if (message.sender_role === "admin") return perspective === "admin" ? "Administrator" : "Hire Line Dancers";
  if (perspective === "admin") return statusLabel(message.sender_role);
  if (message.sender_role === perspective) return "You";
  return message.sender_role === "instructor" ? "Instructor" : "Organizer";
}

export function InquiryInbox({
  perspective,
  accountId = null,
  focusInquiryId = null,
  focusThreadId = null,
  onDataChange
}: {
  perspective: InboxPerspective;
  accountId?: string | null;
  focusInquiryId?: string | null;
  focusThreadId?: string | null;
  onDataChange?: () => void;
}) {
  const [threads, setThreads] = useState<InquiryInboxThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(focusThreadId);
  const [detail, setDetail] = useState<InquiryThreadDetail | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [sort, setSort] = useState<InboxSort>(perspective === "instructor" ? "oldest_waiting" : "recent");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<InquiryFallbackCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateSearchComplete, setCandidateSearchComplete] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const detailRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const moreRequestRef = useRef(0);
  const selectedThreadRef = useRef(selectedThreadId);
  selectedThreadRef.current = selectedThreadId;
  const queryKey = JSON.stringify([searchInput.trim(), filter, sort, perspective]);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const sendRequestRef = useRef(false);
  const sendKeysRef = useRef<Record<string, { body: string; key: string }>>({});
  const openThreadId = typeof detail?.thread.id === "string" ? detail.thread.id : null;
  const messageBody = openThreadId ? drafts[openThreadId] ?? "" : "";
  const initialFocusResolvedRef = useRef(false);
  const selectionInitializedRef = useRef(Boolean(focusThreadId));

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadThreads = useCallback(async (silent = false) => {
    const client = getMarketplaceClient();
    if (!client) return;
    const requestId = ++listRequestRef.current;
    const requestQuery = JSON.stringify([search, filter, sort, perspective]);
    const current = () => requestId === listRequestRef.current && requestQuery === queryKeyRef.current;
    moreRequestRef.current += 1;
    setLoadingMore(false);
    if (!silent) setLoadingThreads(true);
    setError(null);
    const { data, error: loadError } = await client.rpc("list_inquiry_threads", {
      p_search: search || null,
      p_filter: filter,
      p_sort: sort,
      p_limit: inboxPageSize,
      p_cursor_at: null,
      p_cursor_id: null,
      p_admin: perspective === "admin"
    });
    if (!current()) return;
    if (loadError) {
      setError(loadError.message);
      setLoadingThreads(false);
      return;
    }
    const rows = Array.isArray(data) ? data as InquiryInboxThread[] : [];
    const lastRow = rows.at(-1);
    setHasMore(rows.length === inboxPageSize && Boolean(lastRow?.next_cursor_at && lastRow.next_cursor_id));
    let requestedThreadId: string | null = null;
    if (!initialFocusResolvedRef.current) {
      requestedThreadId = focusThreadId;
      if (!requestedThreadId && focusInquiryId) {
        requestedThreadId = rows.find((row) => row.inquiry_id === focusInquiryId)?.thread_id ?? null;
        if (!requestedThreadId) {
          const { data: primaryThreadId } = await client.rpc("get_inquiry_primary_thread", {
            p_inquiry_id: focusInquiryId
          });
          if (!current()) return;
          if (typeof primaryThreadId === "string") requestedThreadId = primaryThreadId;
        }
      }
      initialFocusResolvedRef.current = true;
    }
    const selectionWasInitialized = selectionInitializedRef.current;
    selectionInitializedRef.current = true;
    setThreads(rows);
    setSelectedThreadId((current) => {
      if (requestedThreadId) return requestedThreadId;
      if (current) return current;
      return selectionWasInitialized ? null : rows[0]?.thread_id ?? null;
    });
    setLoadingThreads(false);
  }, [filter, focusInquiryId, focusThreadId, perspective, search, sort]);

  const loadDetail = useCallback(async (threadId: string, silent = false) => {
    const client = getMarketplaceClient();
    if (!client) return;
    const requestId = ++detailRequestRef.current;
    if (!silent) setLoadingDetail(true);
    setError(null);
    const { data, error: loadError } = await client.rpc("get_inquiry_thread", {
      p_thread_id: threadId
    });
    if (requestId !== detailRequestRef.current) return;
    if (loadError) {
      setError(loadError.message);
      setLoadingDetail(false);
      return;
    }
    const normalized = normalizeDetail(data);
    setDetail(normalized ? { ...normalized, thread: { ...normalized.thread, id: threadId } } : null);
    setLoadingDetail(false);
    if (normalized) {
      const url = new URL(window.location.href);
      url.searchParams.set("thread", threadId);
      url.searchParams.set("inquiry", normalized.inquiry.id);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      if (perspective !== "admin") {
        await client.rpc("mark_inquiry_thread_read", { p_thread_id: threadId });
        setThreads((current) => current.map((row) => row.thread_id === threadId ? { ...row, unread_count: 0 } : row));
      }
    }
  }, [perspective]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      detailRequestRef.current += 1;
      setDetail(null);
      return;
    }
    setCandidates([]);
    setCandidateSearchComplete(false);
    setSelectedCandidateId("");
    setActionMessage(null);
    void loadDetail(selectedThreadId);
  }, [loadDetail, selectedThreadId]);

  useEffect(() => {
    const client = getMarketplaceClient();
    if (!client) return;
    const channel = client
      .channel(`inquiry-inbox-${perspective}-${accountId || "current"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inquiry_messages" },
        (payload) => {
          const changedThreadId = (payload.new as { thread_id?: string }).thread_id;
          if (selectedThreadId && changedThreadId === selectedThreadId) void loadDetail(selectedThreadId, true);
          void loadThreads(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inquiry_threads" },
        (payload) => {
          const changedThreadId = (payload.new as { id?: string }).id ?? (payload.old as { id?: string }).id;
          if (selectedThreadId && changedThreadId === selectedThreadId) void loadDetail(selectedThreadId, true);
          void loadThreads(true);
        }
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [accountId, loadDetail, loadThreads, perspective, selectedThreadId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  function chooseThread(threadId: string | null) {
    if (threadId === selectedThreadId) {
      if (threadId && !loadingDetail && openThreadId !== threadId) void loadDetail(threadId);
      return;
    }
    detailRequestRef.current += 1;
    selectionInitializedRef.current = true;
    selectedThreadRef.current = threadId;
    if (!threadId) {
      setDetail(null);
      setLoadingDetail(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("thread");
      url.searchParams.delete("inquiry");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setSelectedThreadId(threadId);
  }

  async function loadMoreThreads() {
    const client = getMarketplaceClient();
    const lastRow = threads.at(-1);
    if (loadingMore || loadingThreads) return;
    if (!client || !lastRow?.next_cursor_at || !lastRow.next_cursor_id) {
      setHasMore(false);
      return;
    }
    const listGeneration = listRequestRef.current;
    const requestId = ++moreRequestRef.current;
    const requestQuery = JSON.stringify([search, filter, sort, perspective]);
    setLoadingMore(true);
    setError(null);
    const { data, error: loadError } = await client.rpc("list_inquiry_threads", {
      p_search: search || null,
      p_filter: filter,
      p_sort: sort,
      p_limit: inboxPageSize,
      p_cursor_at: lastRow.next_cursor_at,
      p_cursor_id: lastRow.next_cursor_id,
      p_admin: perspective === "admin"
    });
    if (listGeneration !== listRequestRef.current || requestId !== moreRequestRef.current || requestQuery !== queryKeyRef.current) return;
    if (loadError) {
      setError(loadError.message);
      setLoadingMore(false);
      return;
    }
    const rows = Array.isArray(data) ? data as InquiryInboxThread[] : [];
    setThreads((current) => {
      const existingIds = new Set(current.map((row) => row.thread_id));
      return [...current, ...rows.filter((row) => !existingIds.has(row.thread_id))];
    });
    const nextLastRow = rows.at(-1);
    setHasMore(rows.length === inboxPageSize && Boolean(nextLastRow?.next_cursor_at && nextLastRow.next_cursor_id));
    setLoadingMore(false);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    const threadId = openThreadId;
    const draft = messageBody;
    const body = draft.trim();
    if (!client || !threadId || !body || sendRequestRef.current) return;
    sendRequestRef.current = true;
    const previous = sendKeysRef.current[threadId];
    const request = previous?.body === body ? previous : { body, key: crypto.randomUUID() };
    sendKeysRef.current[threadId] = request;
    setSending(true);
    setError(null);
    try {
      const { error: sendError } = await client.rpc("send_inquiry_message", {
        p_thread_id: threadId,
        p_body: body,
        p_client_request_id: request.key
      });
      if (sendError) {
        if (selectedThreadRef.current === threadId) setError(sendError.message);
      } else {
        setDrafts((current) => current[threadId] === draft ? { ...current, [threadId]: "" } : current);
        delete sendKeysRef.current[threadId];
        await Promise.all([
          selectedThreadRef.current === threadId ? loadDetail(threadId, true) : Promise.resolve(),
          loadThreads(true)
        ]);
        onDataChange?.();
      }
    } catch (sendError) {
      if (selectedThreadRef.current === threadId) setError(readableError(sendError));
    } finally {
      sendRequestRef.current = false;
      setSending(false);
    }
  }

  async function runThreadAction(action: "decline" | "withdraw") {
    const client = getMarketplaceClient();
    if (!client || !detail || !openThreadId) return;
    setBusyAction(action);
    setError(null);
    setActionMessage(null);
    const result = action === "decline"
      ? await client.rpc("decline_inquiry_thread", { p_thread_id: openThreadId, p_message: null })
      : await client.rpc("withdraw_inquiry", { p_inquiry_id: detail.inquiry.id });
    if (result.error) setError(result.error.message);
    else {
      setActionMessage(action === "decline" ? "The organizer was notified that you are unavailable." : "The inquiry was withdrawn.");
      await Promise.all([selectedThreadRef.current === openThreadId ? loadDetail(openThreadId, true) : Promise.resolve(), loadThreads(true)]);
      onDataChange?.();
    }
    setBusyAction(null);
  }

  async function loadFallbackCandidates() {
    const client = getMarketplaceClient();
    if (!client || !openThreadId) return;
    setLoadingCandidates(true);
    setError(null);
    const { data, error: candidateError } = await client.rpc("admin_list_fallback_candidates", {
      p_thread_id: openThreadId
    });
    if (candidateError) setError(candidateError.message);
    else setCandidates((Array.isArray(data) ? data : []) as InquiryFallbackCandidate[]);
    setCandidateSearchComplete(!candidateError);
    setLoadingCandidates(false);
  }

  async function routeInquiry() {
    const client = getMarketplaceClient();
    if (!client || !openThreadId || !selectedCandidateId) return;
    setBusyAction("route");
    setError(null);
    setActionMessage(null);
    const { data, error: routeError } = await client.rpc("admin_route_inquiry", {
      p_thread_id: openThreadId,
      p_instructor_profile_id: selectedCandidateId,
      p_note: null
    });
    if (routeError) setError(routeError.message);
    else {
      const newThreadId = typeof data === "string" ? data : null;
      setActionMessage("The inquiry was routed to the selected instructor.");
      setAdminNote("");
      setCandidates([]);
      await loadThreads(true);
      if (newThreadId) chooseThread(newThreadId);
      onDataChange?.();
    }
    setBusyAction(null);
  }

  async function addAdminNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !openThreadId || !adminNote.trim()) return;
    setBusyAction("note");
    setError(null);
    const { error: noteError } = await client.rpc("admin_add_inquiry_note", {
      p_thread_id: openThreadId,
      p_note: adminNote.trim()
    });
    if (noteError) setError(noteError.message);
    else {
      setAdminNote("");
      if (selectedThreadRef.current === openThreadId) await loadDetail(openThreadId, true);
    }
    setBusyAction(null);
  }

  const selectedRow = useMemo(
    () => threads.find((row) => row.thread_id === openThreadId) ?? null,
    [openThreadId, threads]
  );
  const threadStatus = String(detail?.thread.thread_status ?? detail?.thread.status ?? selectedRow?.thread_status ?? "active");
  const canReply = (
    perspective !== "admin"
      || detail?.thread.assignment_source === "static_support"
  ) && !["declined", "timed_out", "withdrawn", "closed"].includes(threadStatus);
  const canRouteFallback = perspective === "admin"
    && Boolean(detail?.inquiry.fallback_consent)
    && ["declined", "timed_out"].includes(threadStatus);

  return (
    <section className={styles.inboxSection} aria-label="Messages">
      <div className={styles.inboxToolbar}>
        <label className={styles.inboxSearch}>
          <Search aria-hidden="true" size={18} />
          <span className={styles.srOnly}>Search conversations</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search conversations" />
        </label>
        <label className={styles.inboxSelect}>
          <span>Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as InboxFilter)}>
            <option value="all">All</option>
            <option value="unread">Unread</option>
            {perspective !== "organizer" ? <option value="needs_reply">Needs reply</option> : null}
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className={styles.inboxSelect}>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as InboxSort)}>
            <option value="recent">Recent activity</option>
            <option value="oldest_waiting">Oldest waiting</option>
            <option value="event_date">Event date</option>
          </select>
        </label>
        <button className={styles.iconButton} type="button" aria-label="Refresh conversations" onClick={() => void loadThreads()}>
          <RefreshCw aria-hidden="true" size={18} />
        </button>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {actionMessage ? <p className={styles.success} role="status">{actionMessage}</p> : null}

      <div className={`${styles.inboxLayout} ${selectedThreadId ? styles.hasSelectedThread : ""}`}>
        <aside className={styles.threadList} aria-label="Conversations">
          {loadingThreads && !threads.length ? <div className={styles.inboxLoading}>Loading conversations...</div> : null}
          {!loadingThreads && !threads.length ? (
            <div className={styles.inboxEmpty}>
              <Inbox aria-hidden="true" size={28} />
              <p>No conversations match these filters.</p>
            </div>
          ) : null}
          {threads.map((thread) => {
            const deadline = responseDeadline(thread.response_due_at);
            return (
              <button
                className={`${styles.threadListItem} ${thread.thread_id === openThreadId ? styles.selectedThread : ""}`}
                key={thread.thread_id}
                type="button"
                onClick={() => chooseThread(thread.thread_id)}
              >
                <span className={styles.threadListHeading}>
                  <strong>{thread.counterparty_name || "Conversation"}</strong>
                  {thread.unread_count > 0 ? <span className={styles.unreadBadge}>{thread.unread_count}</span> : null}
                </span>
                <span>{eventTypeLabel(thread.event_type)}{thread.event_date ? ` · ${formatDate(thread.event_date)}` : ""}</span>
                <span className={styles.threadPreview}>{thread.last_message_body || "Inquiry submitted"}</span>
                <span className={styles.threadListMeta}>
                  <span className={styles.status}>{statusLabel(thread.thread_status)}</span>
                  {deadline && thread.thread_status === "awaiting_response" ? <small><Clock3 aria-hidden="true" size={13} />{deadline}</small> : null}
                </span>
              </button>
            );
          })}
          {hasMore ? (
            <button className={styles.threadLoadMore} disabled={loadingMore || loadingThreads} type="button" onClick={() => void loadMoreThreads()}>
              {loadingMore ? "Loading..." : "Load more conversations"}
            </button>
          ) : null}
        </aside>

        <div className={styles.threadPanel}>
          {selectedThreadId ? (
            <button className={styles.mobileBackButton} type="button" onClick={() => chooseThread(null)}>
              <ChevronLeft aria-hidden="true" size={18} /> Conversations
            </button>
          ) : null}
          {loadingDetail && !detail ? <div className={styles.inboxLoading}>Opening conversation...</div> : null}
          {!loadingDetail && !detail ? (
            <div className={styles.inboxEmpty}>
              <Inbox aria-hidden="true" size={32} />
              <p>Select a conversation to open it.</p>
            </div>
          ) : null}
          {detail ? (
            <>
              <header className={styles.threadHeader}>
                <div>
                  <p className={styles.eyebrow}>{eventTypeLabel(detail.inquiry.event_type)}</p>
                  <h2>{selectedRow?.counterparty_name || detail.inquiry.instructor_name || detail.inquiry.contact_name || "Conversation"}</h2>
                  <p>{[detail.inquiry.event_date ? formatDate(detail.inquiry.event_date) : null, detail.inquiry.event_city, detail.inquiry.event_region].filter(Boolean).join(" · ")}</p>
                </div>
                <span className={styles.status}>{statusLabel(threadStatus)}</span>
              </header>

              <div className={styles.threadBody}>
                <aside className={styles.eventSummary}>
                  <h3>Event details</h3>
                  <dl>
                    <div><dt>Event</dt><dd>{eventTypeLabel(detail.inquiry.event_type)}</dd></div>
                    {detail.inquiry.event_date ? <div><dt>Date</dt><dd>{formatDate(detail.inquiry.event_date)}</dd></div> : null}
                    {(detail.inquiry.event_city || detail.inquiry.event_region) ? <div><dt>Location</dt><dd>{[detail.inquiry.event_city, detail.inquiry.event_region].filter(Boolean).join(", ")}</dd></div> : null}
                    {detail.inquiry.guest_count ? <div><dt>Attendees</dt><dd>{detail.inquiry.guest_count}</dd></div> : null}
                    {perspective === "admin" ? <div><dt>Contact</dt><dd>{detail.inquiry.contact_name || detail.inquiry.contact_email || "Organizer"}</dd></div> : null}
                  </dl>
                  {selectedRow?.counterparty_profile_slug && perspective !== "instructor" ? (
                    <Link href={`/profile/?instructor=${encodeURIComponent(selectedRow.counterparty_profile_slug)}`}>View instructor profile</Link>
                  ) : null}
                  {perspective !== "instructor" || detail.thread.is_current_assignment === true ? (
                    <InquiryOutcomeActions
                      inquiry={detail.inquiry}
                      perspective={perspective}
                      onChanged={async () => {
                        if (openThreadId && selectedThreadRef.current === openThreadId) await loadDetail(openThreadId, true);
                        onDataChange?.();
                      }}
                    />
                  ) : null}
                  {perspective === "instructor" && !["declined", "timed_out", "withdrawn", "closed"].includes(threadStatus) ? (
                    <button className={styles.dangerButton} disabled={busyAction !== null} type="button" onClick={() => void runThreadAction("decline")}>
                      {busyAction === "decline" ? "Updating..." : "Unavailable"}
                    </button>
                  ) : null}
                  {perspective === "organizer" && !["withdrawn", "closed"].includes(threadStatus) ? (
                    <button className={styles.dangerButton} disabled={busyAction !== null} type="button" onClick={() => void runThreadAction("withdraw")}>
                      {busyAction === "withdraw" ? "Withdrawing..." : "Withdraw inquiry"}
                    </button>
                  ) : null}
                </aside>

                <div className={styles.conversationColumn}>
                  <div className={styles.messageTimeline} aria-live="polite">
                    {detail.messages.map((message) => {
                      const ownMessage = Boolean(accountId && message.sender_account_id === accountId);
                      const systemMessage = message.message_type === "system" || message.sender_role === "system";
                      return (
                        <article className={`${styles.messageBubble} ${ownMessage ? styles.ownMessage : ""} ${systemMessage ? styles.systemMessage : ""}`} key={message.id}>
                          <div><strong>{senderLabel(message, perspective)}</strong><time dateTime={message.created_at}>{formatDate(message.created_at, true)}</time></div>
                          <p>{message.redacted_at ? "This message was removed by Hire Line Dancers." : message.body}</p>
                        </article>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </div>
                  {canReply ? (
                    <form className={styles.messageComposer} onSubmit={sendMessage}>
                      <label>
                        <span className={styles.srOnly}>Reply</span>
                        <textarea required maxLength={4000} value={messageBody} onChange={(event) => {
                          const value = event.target.value;
                          if (openThreadId) setDrafts((current) => ({ ...current, [openThreadId]: value }));
                        }} placeholder="Write a reply" />
                      </label>
                      <button className={styles.button} disabled={sending || !messageBody.trim()} type="submit">
                        <Send aria-hidden="true" size={17} /> {sending ? "Sending..." : "Send"}
                      </button>
                    </form>
                  ) : perspective !== "admin" ? <p className={styles.notice}>This conversation is closed for replies.</p> : null}

                  {perspective === "admin" ? (
                    <div className={styles.adminThreadTools}>
                      <section>
                        <h3>Private notes</h3>
                        {detail.admin_notes?.length ? <div className={styles.adminNoteList}>{detail.admin_notes.map((note) => (
                          <article key={note.id}><p>{note.note}</p><small>{note.author_name || "Administrator"} · {formatDate(note.created_at, true)}</small></article>
                        ))}</div> : <p className={styles.muted}>No private notes.</p>}
                        <form className={styles.stack} onSubmit={addAdminNote}>
                          <label className={styles.field}><span>Private note</span><textarea maxLength={4000} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} /></label>
                          <button className={styles.secondaryButton} disabled={busyAction !== null || !adminNote.trim()} type="submit">{busyAction === "note" ? "Saving..." : "Add note"}</button>
                        </form>
                      </section>
                      {canRouteFallback ? <section>
                        <h3>Fallback routing</h3>
                        <button className={styles.secondaryButton} disabled={loadingCandidates} type="button" onClick={() => void loadFallbackCandidates()}>
                          {loadingCandidates ? "Checking..." : "Find eligible instructors"}
                        </button>
                        {candidates.length ? (
                          <div className={styles.stack}>
                            <label className={styles.field}>
                              <span>Instructor</span>
                              <select value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}>
                                <option value="">Select an instructor</option>
                                {candidates.map((candidate) => (
                                  <option key={candidate.instructor_profile_id} value={candidate.instructor_profile_id}>
                                    {candidate.display_name} · {candidate.service_market_name || "Market"} · {candidate.active_thread_count} active
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button className={styles.button} disabled={busyAction !== null || !selectedCandidateId} type="button" onClick={() => void routeInquiry()}>
                              {busyAction === "route" ? "Routing..." : "Route inquiry"}
                            </button>
                          </div>
                        ) : candidateSearchComplete ? <p className={styles.muted}>No eligible instructors were found.</p> : null}
                      </section> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function InquiryOutcomeActions({
  inquiry,
  perspective,
  onChanged
}: {
  inquiry: MarketplaceInquiry;
  perspective: InboxPerspective;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState(inquiry.booking_event_date || inquiry.event_date || "");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setEventDate(inquiry.booking_event_date || inquiry.event_date || "");
    setComment("");
  }, [inquiry.id, inquiry.booking_event_date, inquiry.event_date]);

  async function organizerOutcome(outcome: "booked" | "not_booked") {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(outcome);
    setError(null);
    const { error: outcomeError } = await client.rpc("report_booking_outcome", {
      p_inquiry_id: inquiry.id,
      p_outcome: outcome,
      p_booking_value_cents: null,
      p_note: null
    });
    if (outcomeError) setError(outcomeError.message);
    else await onChanged();
    setBusy(null);
  }

  async function instructorFeedback(stage: "booking" | "completion", response: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(`${stage}:${response}`);
    setError(null);
    const { error: feedbackError } = await client.rpc("submit_instructor_inquiry_feedback", {
      p_inquiry_id: inquiry.id,
      p_stage: stage,
      p_response: response,
      p_private_comment: comment.trim() || null,
      p_confirmed_event_date: stage === "booking" && response === "booked" ? eventDate || inquiry.event_date : null
    });
    if (feedbackError) setError(feedbackError.message);
    else {
      setComment("");
      await onChanged();
    }
    setBusy(null);
  }

  if (perspective === "admin") return null;
  if (perspective === "organizer") {
    if (!["unknown", "still_deciding"].includes(inquiry.booking_outcome)) return null;
    return (
      <div className={styles.outcomeActions}>
        <strong>Did you book this instructor?</strong>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.buttonRow}>
          <button className={styles.button} disabled={busy !== null} type="button" onClick={() => void organizerOutcome("booked")}>Booked</button>
          <button className={styles.dangerButton} disabled={busy !== null} type="button" onClick={() => void organizerOutcome("not_booked")}>Not booked</button>
        </div>
      </div>
    );
  }

  const bookingOpen = inquiry.completion_status === "unknown";
  const bookingDate = inquiry.booking_event_date || inquiry.event_date;
  const eventHasArrived = !bookingDate || bookingDate <= new Date().toISOString().slice(0, 10);
  return (
    <div className={styles.outcomeActions}>
      <strong>Did this inquiry turn into a booking?</strong>
      <p>Current result: {statusLabel(inquiry.booking_outcome)}</p>
      <label className={styles.field}><span>Confirmed event date</span><input disabled={!bookingOpen} type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
      <label className={styles.field}><span>Private comments (optional)</span><textarea disabled={!bookingOpen} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.buttonRow}>
        <button className={styles.button} disabled={!bookingOpen || busy !== null} type="button" onClick={() => void instructorFeedback("booking", "booked")}>Yes, booked</button>
        <button className={styles.dangerButton} disabled={!bookingOpen || busy !== null} type="button" onClick={() => void instructorFeedback("booking", "not_booked")}>No</button>
        <button className={styles.secondaryButton} disabled={!bookingOpen || busy !== null} type="button" onClick={() => void instructorFeedback("booking", "still_deciding")}>In progress</button>
      </div>
      {inquiry.booking_outcome === "booked" && eventHasArrived ? (
        <div className={styles.completionActions}>
          <strong>Did the booked event happen?</strong>
          <div className={styles.buttonRow}>
            <button className={styles.button} disabled={busy !== null} type="button" onClick={() => void instructorFeedback("completion", "completed")}>Yes, completed</button>
            <button className={styles.dangerButton} disabled={busy !== null} type="button" onClick={() => void instructorFeedback("completion", "did_not_happen")}>No</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
