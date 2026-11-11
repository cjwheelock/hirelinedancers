import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261111222432_strip_public_instructor_package_pricing.sql', import.meta.url), 'utf8');

test('public package projection uses an explicit non-price field allowlist', () => {
  const projection = sql.match(/jsonb_build_object\(([\s\S]*?)\)\)/)?.[1];
  assert.ok(projection);
  assert.deepEqual([...projection.matchAll(/'([^']+)'\s*,\s*item\.value/g)].map((match) => match[1]), ['name', 'description', 'durationHours']);
  assert.doesNotMatch(projection, /price|rate|cost|amount/i);
  assert.match(sql, /order by item\.ordinality/);
  assert.match(sql, /'\[\]'::jsonb/);
});

test('public entry point still returns published profiles only with constrained privileges', () => {
  assert.match(sql, /where profile\.status = 'published'/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function private\.published_instructor_profile_extras\(\) from public;/);
  assert.match(sql, /grant execute on function private\.published_instructor_profile_extras\(\) to anon, authenticated, service_role;/);
});

test('migration never edits stored packages or changes owner/admin access', () => {
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(statements, /\b(update|delete|truncate|drop|insert)\b/i);
  assert.doesNotMatch(statements, /alter\s+table|create\s+policy|drop\s+policy/i);
  assert.match(sql, /create or replace function private\.published_instructor_profile_extras\(\)/);
});
