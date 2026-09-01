import { inquiryThreadPath, inquiryThreadRecipientPath } from "./index.ts";

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

Deno.test("thread links route account recipients to the inquiry inbox", () => {
  assertEquals(
    inquiryThreadPath("thread/id"),
    "/account/?tab=inquiries&thread=thread%2Fid",
  );
});

Deno.test("thread links route support recipients to admin messages", () => {
  assertEquals(
    inquiryThreadPath("thread/id", true),
    "/admin/?tab=messages&thread=thread%2Fid",
  );
});

Deno.test("legacy static-support jobs use the admin messages inbox", () => {
  assertEquals(
    inquiryThreadRecipientPath("legacy-thread", null),
    "/admin/?tab=messages&thread=legacy-thread",
  );
  assertEquals(
    inquiryThreadRecipientPath("legacy-thread", "instructor@example.com"),
    "/account/?tab=inquiries&thread=legacy-thread",
  );
});
