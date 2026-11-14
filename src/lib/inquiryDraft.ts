// Saves an unsent inquiry while the organizer signs in with Google, so the
// details survive the redirect and send automatically on return.

export type InquiryDraftForm = {
  eventType: string;
  eventDate: string;
  startTime: string;
  venueName: string;
  city: string;
  region: string;
  postalCode: string;
  guestCount: string;
  budget: string;
  musicRequests: string;
  venueHasSpeakers: string;
  venueHasMicrophone: string;
  message: string;
};

export type InquiryDraft = {
  v: 1;
  instructor: string;
  form: InquiryDraftForm;
  firstName: string;
  lastName: string;
  savedAt: number;
};

const prefix = "hld-inquiry-draft:";
/** A draft older than this is ignored and removed. */
export const inquiryDraftMaxAgeMs = 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function stores(): StorageLike[] {
  const found: StorageLike[] = [];
  for (const name of ["sessionStorage", "localStorage"] as const) {
    try {
      const store = (globalThis as unknown as Record<string, StorageLike | undefined>)[name];
      if (store) found.push(store);
    } catch {
      // Storage can throw when it is disabled. Skip it.
    }
  }
  return found;
}

export function inquiryDraftKey(instructor: string) {
  return `${prefix}${instructor}`;
}

/** Saves to session storage, falling back to local storage. Returns false if neither works. */
export function saveInquiryDraft(draft: InquiryDraft): boolean {
  const value = JSON.stringify(draft);
  for (const store of stores()) {
    try {
      store.setItem(inquiryDraftKey(draft.instructor), value);
      return true;
    } catch {
      // Try the next store.
    }
  }
  return false;
}

export function readInquiryDraft(instructor: string, now = Date.now()): InquiryDraft | null {
  for (const store of stores()) {
    try {
      const raw = store.getItem(inquiryDraftKey(instructor));
      if (!raw) continue;
      const draft = JSON.parse(raw) as InquiryDraft;
      if (draft?.v !== 1 || draft.instructor !== instructor || !draft.form || now - draft.savedAt > inquiryDraftMaxAgeMs) {
        store.removeItem(inquiryDraftKey(instructor));
        continue;
      }
      return draft;
    } catch {
      // A corrupt or unreadable draft is ignored.
    }
  }
  return null;
}

export function clearInquiryDraft(instructor: string) {
  for (const store of stores()) {
    try {
      store.removeItem(inquiryDraftKey(instructor));
    } catch {
      // Nothing else to do.
    }
  }
}
