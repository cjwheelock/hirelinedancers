import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync('src/components/AccountWorkspace.tsx', 'utf8');
const inbox = readFileSync('src/components/InquiryInbox.tsx', 'utf8');
const css = readFileSync('src/components/Marketplace.module.css', 'utf8');

test('manual workspace selection clears detail links before mounting the next workspace', () => {
  const body = workspace.match(/function selectWorkspace\(next:[\s\S]*?\n {2}}/)[0];
  const run = new Function('next', 'workspaceMode', 'window', 'setWorkspaceMode', body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')));
  for (const next of ['admin', 'account', 'organizer']) {
    let destination, mode;
    const window = { location: { href: 'https://hirelinedancers.com/account/?tab=messages&thread=test&inquiry=test&profile=test&followup=1#instructor-spotlights' }, history: { replaceState: (_, __, path) => { destination = path; } } };
    run(next, 'other', window, value => { mode = value; assert.equal(destination, '/account/'); });
    assert.equal(mode, next);
  }
  assert.doesNotMatch(workspace, /onClick=\{\(\) => setWorkspaceMode/);
});

test('incoming messages scroll their timeline only, never the workspace document', () => {
  const effect = inbox.match(/useEffect\(\(\) => \{\n {4}\/\/ Keep new messages[\s\S]*?\}, \[detail\?\.messages.length\]\);/)[0];
  const timeline = { scrollTop: 0, scrollHeight: 900 };
  new Function('messageTimelineRef', effect.slice(effect.indexOf('{') + 1, effect.lastIndexOf('},')))({ current: timeline });
  assert.equal(timeline.scrollTop, 900);
  assert.doesNotMatch(effect, /scrollIntoView/);
  assert.match(inbox, /<div ref=\{messageTimelineRef\} className=\{styles.messageTimeline\}/);
  assert.match(css, /overflow-anchor: none/);
});

test('review summary precedes performance and opens the existing review queue', () => {
  assert.ok(workspace.indexOf('styles.pendingReviewBanner') < workspace.indexOf('<h2>Marketplace performance</h2>'));
  assert.match(workspace, /pending.length === 1 \? "instructor awaiting review" : "instructors awaiting review"/);
  assert.match(workspace, /onClick=\{\(\) => selectAdminTab\("profiles"\)\}>\s+Review instructors/);
  assert.match(workspace, /name === "profiles" \? `Instructor reviews/);
});

test('admin review queue omits spotlights while instructor review remains available', () => {
  assert.doesNotMatch(workspace, /<SpotlightReview profiles=/);
  assert.match(workspace, /<SpotlightReview[^>]+profile=/);
});
