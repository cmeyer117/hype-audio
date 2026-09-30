// Run with: node hype-fetch-row-workout-dates.selfcheck.js
// Verifies hypeFetchRowWorkoutDates / hypeFetchRowPhase (sync.js) read Row's
// training signals ONLY through the get_row_training_signals() RPC (session
// dates + season phase) and never select from app_state directly -- the
// po-coach row's public anon SELECT policy is being retired (plan: Claude
// Outputs/2026-09-30-row-rls-plan.md), so a direct read would silently come
// back empty once it drops.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');

function loadSandbox(fakeSupa) {
  // sync.js reads window.SUPABASE_CONFIG at load (supabase-config.js in the
  // browser) -- the sandbox has to provide it or the script throws before
  // the fetch helpers are ever defined. Placeholder values only: the fake
  // client below never touches the network.
  const sandbox = {
    window: {
      supabase: { createClient: () => fakeSupa },
      SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'selfcheck-key' },
    },
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}

// A fake client that records every call. rpc() answers with `result`; from()
// must never be called (a direct app_state read is the thing being retired).
function fake(rpcImpl) {
  const calls = { rpc: [], from: 0 };
  return {
    calls,
    rpc: (name, args) => { calls.rpc.push([name, args]); return rpcImpl(); },
    from: () => { calls.from++; throw new Error('direct table read is not allowed'); },
  };
}

async function main() {
  // Dates: reads through the RPC only, returns the date-key Set.
  {
    const supa = fake(() => Promise.resolve({ data: { session_dates: ['2026-08-18', '2026-08-19'], phase: 'peak' }, error: null }));
    const sandbox = loadSandbox(supa);
    const dates = await sandbox.window.hypeFetchRowWorkoutDates();
    assertEqual([...dates].sort(), ['2026-08-18', '2026-08-19'], 'returns the session date keys');
    assertEqual(supa.calls.rpc.map((c) => c[0]), ['get_row_training_signals'], 'calls only the training-signals RPC');
    assertEqual(supa.calls.from, 0, 'never selects from app_state directly');
  }

  // Phase: same RPC, returns just the phase name.
  {
    const supa = fake(() => Promise.resolve({ data: { session_dates: [], phase: 'peak' }, error: null }));
    const sandbox = loadSandbox(supa);
    assertEqual(await sandbox.window.hypeFetchRowPhase(), 'peak', 'returns the season phase name');
    assertEqual(supa.calls.rpc.map((c) => c[0]), ['get_row_training_signals'], 'phase read calls only the training-signals RPC');
    assertEqual(supa.calls.from, 0, 'phase read never selects from app_state directly');
  }

  // Missing row (no Row data synced yet: RPC returns null or an empty object)
  // degrades to an empty Set / null phase, not a throw.
  for (const data of [null, {}, { session_dates: null, phase: null }]) {
    const sandbox = loadSandbox(fake(() => Promise.resolve({ data, error: null })));
    assertEqual([...(await sandbox.window.hypeFetchRowWorkoutDates())], [], `no data (${JSON.stringify(data)}) -> empty Set`);
    assertEqual(await sandbox.window.hypeFetchRowPhase(), null, `no data (${JSON.stringify(data)}) -> null phase`);
  }

  // An RPC error (or a rejected call) degrades the same way instead of throwing.
  {
    const sandbox = loadSandbox(fake(() => Promise.resolve({ data: null, error: { message: 'boom' } })));
    assertEqual([...(await sandbox.window.hypeFetchRowWorkoutDates())], [], 'an RPC error degrades to an empty Set');
    const rejecting = loadSandbox(fake(() => Promise.reject(new Error('network down'))));
    assertEqual([...(await rejecting.window.hypeFetchRowWorkoutDates())], [], 'a rejected call degrades to an empty Set');
    assertEqual(await rejecting.window.hypeFetchRowPhase(), null, 'a rejected call degrades to a null phase');
  }

  // A stalled (never-resolving) request degrades within the timeout instead of
  // hanging renderWeeklyRecap() forever -- Codex review 2026-08-21.
  {
    const sandbox = loadSandbox(fake(() => new Promise(() => {})));
    assertEqual([...(await sandbox.window.hypeFetchRowWorkoutDates())], [], 'a stalled request degrades to an empty Set instead of hanging');
    assertEqual(await sandbox.window.hypeFetchRowPhase(), null, 'a stalled request degrades to a null phase');
  }

  console.log('hype-fetch-row-workout-dates.selfcheck.js: all assertions passed');
}

main();
