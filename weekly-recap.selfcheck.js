// Run with: node weekly-recap.selfcheck.js
'use strict';

const WeeklyRecap = require('./weekly-recap.js');

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}

const NOW = Date.parse('2026-08-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// No-playback-data case: an empty event log must say so plainly, not
// fabricate a conclusion.
const empty = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: [] });
assertEqual(empty.hasPlaybackData, false, 'an empty event log reports hasPlaybackData: false');
assertEqual(empty.hasWorkoutData, false, 'an empty event log reports hasWorkoutData: false');
assertEqual(empty.markdown.indexOf('No hype-clip plays logged') !== -1, true, 'the empty-state markdown says plainly there is nothing to recap');
assertEqual(empty.suggestedQueue, null, 'no suggested queue when there is no playback data');

// Events outside the 7-day window are excluded entirely.
const outOfWindow = [
  { type: 'play', clipId: 'old1', pillar: 'iron', mentality: 'dorian', at: NOW - 8 * DAY },
];
const excluded = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: outOfWindow });
assertEqual(excluded.hasPlaybackData, false, 'a play older than 7 days does not count toward this week\'s recap');

// Plays only, no workout data -- the "no-workout-data" case must say so
// plainly rather than inventing a training-day correlation.
const playsOnly = [
  { type: 'play', clipId: 'a', pillar: 'mindset', mentality: 'goggins', at: NOW - 1 * DAY },
  { type: 'play', clipId: 'b', pillar: 'mindset', mentality: 'goggins', at: NOW - 2 * DAY },
  { type: 'play', clipId: 'c', pillar: 'iron', mentality: 'dorian', at: NOW - 3 * DAY },
  { type: 'feedback_up', clipId: 'a', pillar: 'mindset', mentality: 'goggins', at: NOW - 1 * DAY },
  { type: 'feedback_down', clipId: 'c', pillar: 'iron', mentality: 'dorian', at: NOW - 3 * DAY },
];
const recap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: playsOnly });
assertEqual(recap.hasPlaybackData, true, 'three plays this week means playback data exists');
assertEqual(recap.hasWorkoutData, false, 'no workoutDates supplied means hasWorkoutData is false');
assertEqual(recap.playCount, 3, 'playCount tallies only type:play events');
assertEqual(recap.upCount, 1, 'upCount tallies feedback_up events');
assertEqual(recap.downCount, 1, 'downCount tallies feedback_down events');
assertEqual(recap.topMentality, 'goggins', 'the most-played mentality wins (goggins: 2 plays vs dorian: 1)');
assertEqual(recap.suggestedQueue, { mentality: 'goggins', reason: 'most-played mentality this week' }, 'suggestedQueue names the top mentality');
assertEqual(recap.markdown.indexOf('No workout session data available') !== -1, true, 'no-workout-data case states it plainly instead of fabricating a conclusion');
assertEqual(recap.markdown.indexOf('correlation') === -1, true, 'no correlation language appears when there is no workout data to correlate against');

// Plays + workout dates: correlation is computed and explicitly labeled as
// correlation, not causation.
const withWorkouts = WeeklyRecap.buildWeeklyRecap({
  now: NOW,
  eventLog: playsOnly,
  workoutDates: ['2026-08-19', '2026-08-18'], // NOW - 1 day and NOW - 2 days
});
assertEqual(withWorkouts.hasWorkoutData, true, 'supplying workoutDates sets hasWorkoutData true');
assertEqual(withWorkouts.pctPlaysOnTrainingDays, 67, '2 of 3 plays landed on a training day (67%, rounded)');
assertEqual(withWorkouts.markdown.indexOf('correlation, not causation') !== -1, true, 'the workout-day match is explicitly labeled correlation, not causation');
assertEqual(withWorkouts.markdown.indexOf('No workout session data') === -1, true, 'the no-workout-data line does not appear once workoutDates is supplied');

// Item 4.4: hard-week + heavy-faith-play cross-reference. Hard week = 5+
// logged training days in the window; heavy faith play = 3+ faith-pillar
// plays. Both must hold for the note to appear.
const hardWeekEvents = [
  { type: 'play', clipId: 'f1', pillar: 'faith', mentality: 'scripture', at: NOW - 1 * DAY },
  { type: 'play', clipId: 'f2', pillar: 'faith', mentality: 'grace', at: NOW - 2 * DAY },
  { type: 'play', clipId: 'f3', pillar: 'faith', mentality: 'warfare', at: NOW - 3 * DAY },
  { type: 'play', clipId: 'i1', pillar: 'iron', mentality: 'dorian', at: NOW - 4 * DAY },
];
const hardWeekTrainingDates = ['2026-08-19', '2026-08-18', '2026-08-17', '2026-08-16', '2026-08-15'];
const hardWeekRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: hardWeekEvents, workoutDates: hardWeekTrainingDates });
assertEqual(hardWeekRecap.hardWeekFaithNote !== null, true, 'a hard week (5+ training days) with heavy faith plays (3+) produces a connective note');
assertEqual(hardWeekRecap.markdown.indexOf('🙏') !== -1, true, 'the hard-week faith note appears in the rendered markdown');

// A normal (non-hard) week with the same faith plays does not force the note.
const normalWeekTrainingDates = ['2026-08-19', '2026-08-18'];
const normalWeekRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: hardWeekEvents, workoutDates: normalWeekTrainingDates });
assertEqual(normalWeekRecap.hardWeekFaithNote, null, 'a normal (under-5-training-day) week does not get the hard-week faith note even with heavy faith plays');

// A hard week without heavy faith plays also does not force the note.
const lowFaithEvents = [
  { type: 'play', clipId: 'f1', pillar: 'faith', mentality: 'scripture', at: NOW - 1 * DAY },
  { type: 'play', clipId: 'i1', pillar: 'iron', mentality: 'dorian', at: NOW - 2 * DAY },
];
const lowFaithRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: lowFaithEvents, workoutDates: hardWeekTrainingDates });
assertEqual(lowFaithRecap.hardWeekFaithNote, null, 'a hard week with fewer than 3 faith plays does not get the note');

// Codex review 2026-08-21: workoutDates must be scoped to this week's
// window, not counted from Row's entire training history -- 5+ ancient
// dates outside the 7-day window shouldn't satisfy "hard week."
const staleTrainingDates = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05'];
const staleWeekRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: hardWeekEvents, workoutDates: staleTrainingDates });
assertEqual(staleWeekRecap.hardWeekFaithNote, null, 'training dates outside the 7-day window do not count toward a hard week');

// Codex review 2026-08-21: faith plays and hard-training days must actually
// overlap -- 3+ faith plays and 5+ training days with zero shared dates
// should not imply a connection between them.
const noOverlapEvents = [
  { type: 'play', clipId: 'f1', pillar: 'faith', mentality: 'scripture', at: NOW - 6 * DAY },
  { type: 'play', clipId: 'f2', pillar: 'faith', mentality: 'grace', at: NOW - 6 * DAY },
  { type: 'play', clipId: 'f3', pillar: 'faith', mentality: 'warfare', at: NOW - 6 * DAY },
];
const noOverlapTrainingDates = ['2026-08-19', '2026-08-18', '2026-08-17', '2026-08-16', '2026-08-15'];
const noOverlapRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: noOverlapEvents, workoutDates: noOverlapTrainingDates });
assertEqual(noOverlapRecap.hardWeekFaithNote, null, 'faith plays that never land on a training day do not get the hard-week note, even with enough of each independently');

// Deterministic tie-break: equal counts break alphabetically, not by
// insertion order, so the recap never flips between two equally-true runs.
const tie = [
  { type: 'play', clipId: 'x', pillar: 'iron', mentality: 'zeta', at: NOW - 1 * DAY },
  { type: 'play', clipId: 'y', pillar: 'iron', mentality: 'alpha', at: NOW - 1 * DAY },
];
const tieRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: tie });
assertEqual(tieRecap.topMentality, 'alpha', 'a tie in play count breaks alphabetically, deterministically');

console.log('weekly-recap.selfcheck.js: all assertions passed');
