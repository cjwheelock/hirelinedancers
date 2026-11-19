import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('supabase/functions/_shared/hld-profile-reminder.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const {profileReminderEmail,sendProfileReminder}=mod.exports;
const job={id:7,recipient_email:'instructor@example.com',display_name:'<Jenn & "J">',first_name:'<Jenn & "J">',city:null};
test('approved copy, sender, safe fields and city fallback',()=>{const m=profileReminderEmail(job);assert.equal(m.from,'Hire Line Dancers <inquiries@mail.hirelinedancers.com>');assert.equal(m.reply_to,'hello@hirelinedancers.com');assert.equal(m.subject,'Finish your profile and get discovered');assert.ok(m.text.includes('events in your area'));assert.ok(m.html.includes('&lt;Jenn &amp; &quot;J&quot;&gt;'));assert.ok(m.text.includes('https://hirelinedancers.com/account/?tab=profile'));});
test('city escaped and neutral no-name fallback',()=>{const m=profileReminderEmail({...job,display_name:' ',first_name:null,city:'Austin & <area>'});assert.ok(m.text.startsWith('Hey,\n'));assert.ok(m.html.includes('Austin &amp; &lt;area&gt;'));});
test('provider-enforced suppression uses send-only permission; acceptance not delivery',async()=>{let n=0;const id=await sendProfileReminder(job,'key',async(url,o)=>{n++;assert.equal(url,'https://api.resend.com/emails');assert.equal(o.method,'POST');assert.equal(o.headers['Idempotency-Key'],'hld-profile-completion-7');assert.equal(JSON.parse(o.body).to[0],job.recipient_email);return Response.json({id:'accepted'});});assert.equal(id,'accepted');assert.equal(n,1);});
test('explicit provider rejection is held, not retried',async()=>{let n=0;await assert.rejects(()=>sendProfileReminder(job,'key',async()=>{n++;return Response.json({message:'suppressed'},{status:422});}),e=>e.outcome==='failed');assert.equal(n,1);});
test('uncertain network outcome never retried',async()=>{let n=0;await assert.rejects(()=>sendProfileReminder(job,'key',async()=>{n++;throw Error('network');}),e=>e.outcome==='uncertain');assert.equal(n,1);});
test('fixed test recipient and marked subject',async()=>{await assert.rejects(()=>sendProfileReminder(job,'key',fetch,true),e=>e.outcome==='failed');await sendProfileReminder({...job,id:0,recipient_email:'cjwheelock1@gmail.com'},'key',async(_u,o)=>{assert.ok(JSON.parse(o.body).subject.startsWith('[TEST]'));return Response.json({id:'test'});},true);});
test('final state check blocks provider call',async()=>{let n=0;await assert.rejects(()=>sendProfileReminder(job,'key',async()=>{n++;return Response.json({id:'wrong'});},false,async()=>false),e=>e.outcome==='cancelled');assert.equal(n,0);});

test('sequence copy, first-name greeting, test subject per step',()=>{
  const base={id:9,recipient_email:'a@example.com',display_name:'Patricia Lowe ( Tricia)',first_name:'Patricia',city:null};
  const one=profileReminderEmail({...base,step:1});assert.ok(one.text.startsWith('Hey Patricia,\n'));assert.equal(one.subject,'Finish your profile and get discovered');
  const two=profileReminderEmail({...base,step:2});assert.equal(two.subject,'Your profile isn’t live yet');assert.ok(two.text.includes('so planners can’t see you yet. It only takes a few minutes to finish.'));assert.ok(!two.text.includes('just reply here'));
  const three=profileReminderEmail({...base,step:3});assert.equal(three.subject,'Still want to get booked?');assert.ok(three.text.includes('Last nudge from me.'));assert.ok(three.text.includes('Just reply and let me know.'));
  for(const m of [one,two,three]){assert.ok(!m.text.includes('—'));assert.ok(m.text.includes('https://hirelinedancers.com/account/?tab=profile'));assert.ok(m.text.endsWith('CJ'));}
  assert.ok(profileReminderEmail({...base,first_name:null}).text.startsWith('Hey Patricia,'));
});
