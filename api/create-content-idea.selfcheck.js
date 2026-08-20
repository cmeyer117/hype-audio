// Self-check for create-content-idea.mjs's handleCreateContentIdeaRequest --
// exercises the idempotent-dedup path against a fake supabase client (no
// live writes), same "extract the real function" convention as
// sync.selfcheck.js, but via import since this is a module with a
// dedicated exported handler rather than an inline IIFE.
'use strict';

async function main() {
  const { handleCreateContentIdeaRequest } = await import('./create-content-idea.mjs');

  function assert(cond, label) {
    if (!cond) { console.error('FAIL: ' + label); process.exit(1); }
  }

  // Minimal fake of the chainable supabase-js surface this handler uses:
  // .from(t).select(c).eq(col,val).maybeSingle() and
  // .from(t).insert(payload).select(c).single(). Backed by an in-memory
  // array with a unique-constraint simulation on source_hype_clip_id,
  // mirroring the real partial unique index added in this migration.
  function makeFakeSupabase(rows) {
    let idCounter = 1;
    return {
      from() {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    const row = rows.find((r) => r[col] === val);
                    return { data: row ? { id: row.id } : null, error: null };
                  },
                };
              },
            };
          },
          insert(payload) {
            return {
              select() {
                return {
                  async single() {
                    if (payload.source_hype_clip_id &&
                        rows.some((r) => r.source_hype_clip_id === payload.source_hype_clip_id)) {
                      return { data: null, error: { code: '23505', message: 'duplicate key' } };
                    }
                    const row = Object.assign({ id: 'id-' + idCounter++ }, payload);
                    rows.push(row);
                    return { data: { id: row.id }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  const baseBody = { title: 'Test idea', pillar: 'mindset', hook: 'h', body: 'b', sourceClipId: 'clip1', sourceStorageUrl: 'https://x' };

  // First send: inserts and succeeds.
  const rows = [];
  const supabase = makeFakeSupabase(rows);
  const first = await handleCreateContentIdeaRequest(baseBody, supabase);
  assert(first.status === 200 && first.body.id, 'first send succeeds with an id');
  assert(rows.length === 1, 'first send inserts exactly one row');

  // Same sourceClipId sent again: idempotent success, no second row, same id back.
  const second = await handleCreateContentIdeaRequest(baseBody, supabase);
  assert(second.status === 200, 'duplicate send still returns success (idempotent)');
  assert(second.body.id === first.body.id, 'duplicate send returns the SAME content_ideas id');
  assert(rows.length === 1, 'duplicate send does not create a second row');

  // Race: two requests both pass the pre-insert dedup check (stale read),
  // second one's insert hits the unique-constraint conflict and must
  // recover by re-querying instead of erroring.
  const raceRows = [];
  const raceSupabase = makeFakeSupabase(raceRows);
  let selectCalls = 0;
  const realFrom = raceSupabase.from.bind(raceSupabase);
  raceSupabase.from = function (table) {
    const real = realFrom(table);
    const realSelect = real.select.bind(real);
    real.select = function (cols) {
      const chain = realSelect(cols);
      const realEq = chain.eq.bind(chain);
      chain.eq = function (col, val) {
        const eqChain = realEq(col, val);
        const realMaybeSingle = eqChain.maybeSingle.bind(eqChain);
        eqChain.maybeSingle = async function () {
          selectCalls++;
          if (selectCalls === 1) return { data: null, error: null }; // stale read: misses the concurrent insert
          return realMaybeSingle();
        };
        return eqChain;
      };
      return chain;
    };
    return real;
  };
  raceRows.push({ id: 'existing-id', source_hype_clip_id: 'clip1' }); // the "concurrent" insert that already landed
  const raced = await handleCreateContentIdeaRequest(baseBody, raceSupabase);
  assert(raced.status === 200, 'race (stale dedup check + insert conflict) still returns success');
  assert(raced.body.id === 'existing-id', 'race recovers the existing row id via re-query, not an error');
  assert(raceRows.length === 1, 'race does not leave a duplicate row behind');

  // Validation still works.
  const missingTitle = await handleCreateContentIdeaRequest({ pillar: 'mindset' }, makeFakeSupabase([]));
  assert(missingTitle.status === 400, 'missing title is rejected');

  const badPillar = await handleCreateContentIdeaRequest({ title: 'x', pillar: 'nope' }, makeFakeSupabase([]));
  assert(badPillar.status === 400, 'invalid pillar is rejected');

  // No sourceClipId at all: skips dedup, inserts normally (existing behavior preserved).
  const noClipRows = [];
  const noClip = await handleCreateContentIdeaRequest({ title: 'manual idea', pillar: 'training' }, makeFakeSupabase(noClipRows));
  assert(noClip.status === 200 && noClip.body.id, 'no sourceClipId still inserts fine');

  console.log('create-content-idea.selfcheck.js: all assertions passed');
}

main().catch((e) => { console.error('FAIL: unexpected error', e); process.exit(1); });
