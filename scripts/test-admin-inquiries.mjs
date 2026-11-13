import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/components/AdminInquiries.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness(props = {}) {
  let cursor = 0, dirty = true, tree;
  const slots = [], effects = [], calls = [], replies = [], opened = [];
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(v, slots[i])) { slots[i] = v; dirty = true; } }]; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((v,j) => !Object.is(v,effects[i].deps[j]))) { effects[i]?.cleanup?.(); effects[i] = { deps, pending: fn }; } }
  };
  const client = { from(table) { const call = { table, methods: [] }; calls.push(call); const query = {}; for (const name of ['select','order','range','or','eq']) query[name] = (...args) => { call.methods.push([name,...args]); return query; }; query.abortSignal = () => Promise.resolve(replies.shift() ?? { data: [], count: 0 }); return query; }, async rpc(name,args) { calls.push({name,args}); return replies.shift() ?? {data:null}; } };
  const compiledModule = {exports:{}};
  new Function('require','module','exports', compiled)((name) => name === 'react' ? react : name === 'react/jsx-runtime' ? {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})} : name.includes('marketplace') ? {getMarketplaceClient:()=>client,readableError:e=>e.message} : {default:{}}, compiledModule,compiledModule.exports);
  function render() { cursor=0; dirty=false; tree=compiledModule.exports.AdminInquiries({...props,onOpenThread:id=>opened.push(id)}); for(const effect of effects) if(effect?.pending) {const fn=effect.pending; delete effect.pending; effect.cleanup=fn();} }
  return {calls,replies,opened,filter:compiledModule.exports.inquirySearchFilter, async settle() { for(let n=0;n<15;n++){if(dirty)render(); await Promise.resolve();} }, nodes() { function walk(n){return !n || typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];} return walk(tree); } };
}
const row = { id:'test-id',contact_name:'Test organizer',contact_email:'test@example.test',contact_phone_e164:'+15555550123',instructor_name:'Test instructor',status:'timed_out',created_at:'2020-01-01T00:00:00Z',message:'Old inquiry',booking_outcome:'unknown',completion_status:'unknown' };
const button=(h,label)=>h.nodes().find(n=>n.type==='button' && n.props.children===label);

test('all historical inquiry details are visible without a thread or status filter',async()=>{const h=harness();h.replies.push({data:[row],count:121});await h.settle();assert.equal(h.calls[0].table,'inquiries');assert.deepEqual(h.calls[0].methods,[['select','*',{count:'exact'}],['order','created_at',{ascending:false}],['order','id',{ascending:false}],['range',0,49]]);assert.ok(h.nodes().some(n=>n.type==='dd'&&n.props.children==='+15555550123'));button(h,'Next').props.onClick();await h.settle();assert.ok(h.calls[1].methods.some(m=>m[0]==='range'&&m[1]===50&&m[2]===99));});
test('search is applied server-side and resets pagination',async()=>{const h=harness();h.replies.push({data:[row],count:121});await h.settle();h.nodes().find(n=>n.type==='input').props.onChange({target:{value:'test@example.test'}});await h.settle();h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.settle();assert.ok(h.calls.at(-1).methods.some(m=>m[0]==='or'&&m[1].includes('contact_email.ilike."%test@example.test%"')));});
test('search quotes punctuation and escapes filter/LIKE characters',()=>{const h=harness();assert.ok(h.filter('a,b)%_"').includes('contact_name.ilike."%a,b)\\%\\_\\"%"'));});
test('failed query is an error, not an empty successful result',async()=>{const h=harness();h.replies.push({error:{message:'Denied'}});await h.settle();assert.ok(h.nodes().some(n=>n.props?.role==='alert'&&n.props.children==='Denied'));assert.equal(button(h,'Next'),undefined);});
test('unthreaded historical inquiries stay readable without navigating elsewhere',async()=>{const h=harness();h.replies.push({data:[row],count:1});await h.settle();await button(h,'View conversation').props.onClick();await h.settle();assert.equal(h.opened.length,0);assert.ok(h.nodes().some(n=>n.props?.role==='status'&&typeof n.props.children==='string'&&n.props.children.includes('no message thread')));});
test('thread drilldown resolves the selected inquiry before opening',async()=>{const h=harness();h.replies.push({data:[row],count:1});await h.settle();h.replies.push({data:'thread-id'});button(h,'View conversation').props.onClick();await h.settle();assert.deepEqual(h.opened,['thread-id']);assert.deepEqual(h.calls.at(-1),{name:'get_inquiry_primary_thread',args:{p_inquiry_id:'test-id'}});});

test('notification links display and expand the exact inquiry, with return to all',async()=>{const h=harness({focusInquiryId:row.id});h.replies.push({data:[row],count:1});await h.settle();assert.ok(h.calls[0].methods.some(m=>m[0]==='eq'&&m[1]==='id'&&m[2]===row.id));assert.equal(h.nodes().find(n=>n.type==='details').props.open,true);button(h,'View all inquiries').props.onClick();await h.settle();assert.ok(!h.calls.at(-1).methods.some(m=>m[0]==='eq'));});

test('legacy inquiry fields remain searchable and visible with nullable status',async()=>{const h=harness();h.replies.push({data:[{...row,contact_name:null,contact_email:null,name:'Legacy name',email:'legacy@example.test',location:'Legacy location',time_zone:'America/New_York',reply_by_date:'2020-01-02',status:null}],count:1});await h.settle();for(const value of ['Legacy name','legacy@example.test','Legacy location','America/New_York','2020-01-02'])assert.ok(h.nodes().some(n=>n.type==='dd'&&n.props.children===value));for(const field of ['name','email','location'])assert.ok(h.filter('legacy').includes(`${field}.ilike.`));});
