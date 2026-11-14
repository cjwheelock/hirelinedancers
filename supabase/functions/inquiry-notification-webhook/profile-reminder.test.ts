import { Webhook } from "npm:standardwebhooks@1.1.1";
import worker from "./index.ts";
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
Deno.test("signature gate, suppression routing, and existing delivery routing", async () => {
  const secret = "whsec_" + btoa("test-secret-only-not-a-real-key-12345");
  const oldFetch = globalThis.fetch;
  Deno.env.set("RESEND_WEBHOOK_SECRET",secret);
  Deno.env.set("SUPABASE_URL","https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-only");
  const calls: string[] = [];
  globalThis.fetch = ((url: string | URL | Request) => {
    calls.push(url instanceof Request ? url.url : String(url)); return Promise.resolve(Response.json(null));
  }) as typeof fetch;
  try {
    const payload = JSON.stringify({type:"email.suppressed",created_at:new Date().toISOString(),data:{email_id:"example-id"}});
    const bad = await worker.fetch(new Request("https://example.test/webhook",{method:"POST",body:payload}));
    assert(bad.status===401 && calls.length===0,"unsigned webhook must never reach database");
    const send = async (type: string) => {
      const body=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:"example-id"}});
      const timestamp=new Date(); const id="test-event";
      return worker.fetch(new Request("https://example.test/webhook",{method:"POST",body,headers:{
        "webhook-id":id,"webhook-timestamp":String(Math.floor(timestamp.getTime()/1000)),
        "webhook-signature":new Webhook(secret).sign(id,timestamp,body)
      }}));
    };
    assert((await send("email.suppressed")).status===200,"signed suppressed event accepted");
    assert(calls.length===1 && calls[0].includes("record_profile_reminder_delivery"),"suppressed only goes to compatible new RPC");
    calls.length=0;
    assert((await send("email.delivered")).status===200,"signed delivered event accepted");
    assert(calls.length===2 && calls[0].includes("record_inquiry_notification_delivery") && calls[1].includes("record_profile_reminder_delivery"),"existing delivery path preserved");
  } finally { globalThis.fetch=oldFetch; Deno.env.delete("RESEND_WEBHOOK_SECRET"); Deno.env.delete("SUPABASE_URL"); Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); }
});
