// "What moved you" weekly recap -- deterministic, local-only aggregation
// over HypeAudio's own event log (plays + thumbs feedback, see
// hype-audio.js's logHypeEvent/listHypeEvents). No LLM, no external
// analytics API -- pure math over already-logged local events.
//
// This app doesn't log workout sessions itself (that's Row's domain, a
// separate app/repo) -- workoutDates is an optional injectable input, kept
// separate from the fetch so the join stays testable without a real schema
// for data this repo doesn't own. index.html now feeds it real dates via
// hypeFetchRowWorkoutDates() (sync.js); when that fetch is unavailable or
// empty (offline, no logged sessions), the recap says so plainly instead of
// fabricating a training-day correlation. See
// docs/superpowers/specs/2026-08-20-queue-explainer-recap-design.md.
(function () {
  'use strict';

  function dateKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function tally(events, field) {
    var counts = {};
    events.forEach(function (e) {
      var key = e[field];
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  // Highest count wins; ties break alphabetically so the result is
  // deterministic instead of depending on object key insertion order.
  function topEntry(counts) {
    var keys = Object.keys(counts);
    if (!keys.length) return null;
    keys.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return [keys[0], counts[keys[0]]];
  }

  function buildWeeklyRecap(options) {
    options = options || {};
    var now = typeof options.now === 'number' ? options.now : Date.now();
    var windowMs = 7 * 24 * 60 * 60 * 1000;
    var since = now - windowMs;
    var allEvents = options.eventLog ||
      (typeof window !== 'undefined' && window.HypeAudio ? window.HypeAudio.listHypeEvents() : []);
    var events = allEvents.filter(function (e) {
      return e && typeof e.at === 'number' && e.at >= since && e.at <= now;
    });
    var workoutDates = Array.isArray(options.workoutDates) && options.workoutDates.length ? options.workoutDates : null;

    var plays = events.filter(function (e) { return e.type === 'play'; });
    var ups = events.filter(function (e) { return e.type === 'feedback_up'; });
    var downs = events.filter(function (e) { return e.type === 'feedback_down'; });

    var result = {
      windowStart: since,
      windowEnd: now,
      hasPlaybackData: plays.length > 0,
      hasWorkoutData: !!workoutDates,
      playCount: plays.length,
      upCount: ups.length,
      downCount: downs.length,
      topMentality: null,
      topPillar: null,
      suggestedQueue: null,
    };

    if (!result.hasPlaybackData) {
      result.markdown = '## What Moved You This Week\n\n' +
        'No hype-clip plays logged this week — nothing to recap yet.';
      return result;
    }

    var topMentalityEntry = topEntry(tally(plays, 'mentality'));
    var topPillarEntry = topEntry(tally(plays, 'pillar'));
    result.topMentality = topMentalityEntry ? topMentalityEntry[0] : null;
    result.topPillar = topPillarEntry ? topPillarEntry[0] : null;

    var lines = ['## What Moved You This Week', ''];
    lines.push('- ' + plays.length + ' hype clip' + (plays.length === 1 ? '' : 's') + ' played this week.');
    if (topMentalityEntry) {
      lines.push('- Most-played mentality: **' + topMentalityEntry[0] + '** (' +
        topMentalityEntry[1] + ' play' + (topMentalityEntry[1] === 1 ? '' : 's') + ').');
    }
    if (ups.length) lines.push('- 👍 ' + ups.length + ' time' + (ups.length === 1 ? '' : 's') + '.');
    if (downs.length) lines.push('- 👎 ' + downs.length + ' time' + (downs.length === 1 ? '' : 's') + '.');

    if (!workoutDates) {
      lines.push('', '_No workout session data available this week — showing hype-clip activity only._');
    } else {
      var trainingDays = {};
      workoutDates.forEach(function (d) { trainingDays[d] = true; });
      var onTrainingDays = plays.filter(function (e) { return trainingDays[dateKey(e.at)]; }).length;
      var pct = Math.round((onTrainingDays / plays.length) * 100);
      result.pctPlaysOnTrainingDays = pct;
      lines.push('', '- ' + pct + '% of this week\'s plays landed on a logged training day ' +
        '(correlation, not causation — this doesn\'t mean the clips caused the training).');
    }

    if (topMentalityEntry) {
      result.suggestedQueue = { mentality: topMentalityEntry[0], reason: 'most-played mentality this week' };
      lines.push('', '**Suggested queue for next week:** ' + topMentalityEntry[0] +
        ' (' + topMentalityEntry[1] + ' play' + (topMentalityEntry[1] === 1 ? '' : 's') + ' this week).');
    }

    result.markdown = lines.join('\n');
    return result;
  }

  if (typeof window !== 'undefined') {
    window.WeeklyRecap = { buildWeeklyRecap: buildWeeklyRecap };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildWeeklyRecap: buildWeeklyRecap };
  }
})();
