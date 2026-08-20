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

// Deterministic tie-break: equal counts break alphabetically, not by
// insertion order, so the recap never flips between two equally-true runs.
const tie = [
  { type: 'play', clipId: 'x', pillar: 'iron', mentality: 'zeta', at: NOW - 1 * DAY },
  { type: 'play', clipId: 'y', pillar: 'iron', mentality: 'alpha', at: NOW - 1 * DAY },
];
const tieRecap = WeeklyRecap.buildWeeklyRecap({ now: NOW, eventLog: tie });
assertEqual(tieRecap.topMentality, 'alpha', 'a tie in play count breaks alphabetically, deterministically');

console.log('weekly-recap.selfcheck.js: all assertions passed');
