// Run with: node hype-auth.selfcheck.js
// hype-auth.js: owner check, session status (owner / signedout / unknown), sign-in that
// rejects a non-owner account, and the synchronously readable access token that
// flushOnUnload needs.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'hype-auth.js'), 'utf8');
const OWNER = 'carl.meyer.business@gmail.com';

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

function load(auth) {
  const listeners = [];
  const calls = { signOut: 0 };
  const client = {
    auth: {
      getSession: auth.getSession || (() => Promise.resolve({ data: { session: null } })),
      signInWithPassword: auth.signInWithPassword || (() => Promise.resolve({ data: { session: null }, error: { message: 'no' } })),
      signOut: () => { calls.signOut++; return Promise.resolve({}); },
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: {} } }; },
    },
  };
  const sandbox = {
    window: { supabase: { createClient: () => client }, SUPABASE_CONFIG: { URL: 'https://x.invalid', KEY: 'k' } },
    document: {}, console, setTimeout, clearTimeout, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { HypeAuth: sandbox.window.HypeAuth, calls, listeners };
}

(async () => {
  // isOwner
  const { HypeAuth } = load({});
  eq(HypeAuth.isOwner({ user: { email: OWNER } }), true, 'the owner email is the owner');
  eq(HypeAuth.isOwner({ user: { email: 'someone@else.com' } }), false, 'another account is not the owner');
  eq(HypeAuth.isOwner(null), false, 'no session is not the owner');
  eq(HypeAuth.isOwner({}), false, 'a session without a user is not the owner');

  // status(): owner / signedout / non-owner / unknown (transport failure)
  eq(await load({ getSession: () => Promise.resolve({ data: { session: { user: { email: OWNER }, access_token: 't' } } }) }).HypeAuth.status(), 'owner', 'an owner session -> owner');
  eq(await load({ getSession: () => Promise.resolve({ data: { session: null } }) }).HypeAuth.status(), 'signedout', 'no session -> signedout');
  eq(await load({ getSession: () => Promise.resolve({ data: { session: { user: { email: 'x@y.z' } } } }) }).HypeAuth.status(), 'signedout', 'a non-owner session is treated as signedout');
  eq(await load({ getSession: () => Promise.reject(new Error('network down')) }).HypeAuth.status(), 'unknown', 'an unreachable auth server -> unknown (offline), not a sign-in prompt');

  // signIn: owner succeeds and exposes the token synchronously; non-owner is refused and signed out; errors surface
  {
    const ctx = load({ signInWithPassword: () => Promise.resolve({ data: { session: { user: { email: OWNER }, access_token: 'jwt-123' } }, error: null }) });
    let notified = 0; ctx.HypeAuth.onChange(() => notified++);
    eq(ctx.HypeAuth.accessToken(), null, 'no token before sign-in');
    await ctx.HypeAuth.signIn(OWNER, 'pw');
    eq(ctx.HypeAuth.accessToken(), 'jwt-123', 'the token is readable synchronously after sign-in (flushOnUnload cannot await)');
    eq(notified, 1, 'onChange listeners are notified on sign-in');
    await ctx.HypeAuth.signOut();
    eq(ctx.HypeAuth.accessToken(), null, 'no token after sign-out');
  }
  {
    const ctx = load({ signInWithPassword: () => Promise.resolve({ data: { session: { user: { email: 'intruder@x.com' }, access_token: 'evil' } }, error: null }) });
    let threw = false;
    try { await ctx.HypeAuth.signIn('intruder@x.com', 'pw'); } catch (e) { threw = /not the owner/i.test(e.message); }
    eq(threw, true, 'a non-owner account is refused');
    eq(ctx.calls.signOut, 1, 'and is signed straight back out');
    eq(ctx.HypeAuth.accessToken(), null, 'and never exposes a token');
  }
  {
    const ctx = load({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'Invalid login credentials' } }) });
    let msg = '';
    try { await ctx.HypeAuth.signIn(OWNER, 'wrong'); } catch (e) { msg = e.message; }
    eq(msg, 'Invalid login credentials', 'a sign-in error surfaces its message');
  }

  console.log('hype-auth.selfcheck.js: all assertions passed');
  process.exit(0);
})();
