// Run with: node hype-fetch-row-workout-dates.selfcheck.js
// Verifies hypeFetchRowWorkoutDates (sync.js) requests only the sessions
// JSON path out of Row's po-coach app_state row -- not the full workout
// payload -- and returns just the date-key Set. Mirrors
// vessel/tests/vessel-fetch-row-workout-dates.test.js's coverage of the
// same narrow-export pattern.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');

function loadSandbox(fakeSupa) {
  // sync.js reads window.SUPABASE_CONFIG at load (supabase-config.js in the
  // browser) -- the sandbox has to provide it or the script throws before
  // hypeFetchRowWorkoutDates is ever defined. Placeholder values only: the
  // fake client below never touches the network.
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

async function main() {
  // Requests only the sessions JSON path, not the full po-coach payload --
  // structurally asserts no other field (weights, exercises, etc.) is ever
  // selected.
  {
    let selectedColumns = null;
    const fakeSupa = {
      from: () => ({
        select: (cols) => {
          selectedColumns = cols;
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { sessions: { '2026-08-18': {}, '2026-08-19': {} } }, error: null }),
            }),
          };
        },
      }),
    };
    const sandbox = loadSandbox(fakeSupa);
    const dates = await sandbox.window.hypeFetchRowWorkoutDates();
    assertEqual(selectedColumns, 'sessions:data->po_coach_v1->sessions', 'requests only the sessions JSON path');
    assertEqual(selectedColumns.indexOf('*') === -1, true, 'never requests the full row (no wildcard select)');
    assertEqual([...dates].sort(), ['2026-08-18', '2026-08-19'], 'returns the session date keys');
  }

  // Missing row (no Row data synced yet) degrades to an empty Set, not a throw.
  {
    const fakeSupa = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    };
    const sandbox = loadSandbox(fakeSupa);
    const dates = await sandbox.window.hypeFetchRowWorkoutDates();
    assertEqual([...dates], [], 'a missing po-coach row returns an empty Set');
  }

  // A stalled (never-resolving) request degrades to an empty Set within the
  // timeout instead of hanging renderWeeklyRecap() forever -- Codex review
  // 2026-08-21 caught this gap in the original implementation.
  {
    const fakeSupa = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
      }),
    };
    const sandbox = loadSandbox(fakeSupa);
    const dates = await sandbox.window.hypeFetchRowWorkoutDates();
    assertEqual([...dates], [], 'a stalled request degrades to an empty Set instead of hanging');
  }

  console.log('hype-fetch-row-workout-dates.selfcheck.js: all assertions passed');
}

main();
