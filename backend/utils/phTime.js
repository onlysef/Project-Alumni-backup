// Every "date" + "time" pair stored as separate strings in this app (office
// appointments, employer interviews) is always chosen and displayed as
// Philippine wall-clock time — but reconstructing them with the plain
// multi-arg `new Date(y, m, d, h, mi)` constructor interprets those numbers
// in the RUNNING PROCESS's own local timezone. That's harmless on a
// developer's own machine (usually already set to Philippine time), but
// Railway's containers default to UTC — 8 hours off — so any comparison
// against `Date.now()`/`new Date()` (e.g. "has this appointment's time
// already passed?") was silently wrong by exactly that much in production
// while appearing to work fine on localhost. The Philippines has no DST, so
// a fixed +08:00 offset is always correct, without needing the IANA
// tz database.

// "YYYY-MM-DD" + "HH:mm" (Philippine wall-clock) → the true absolute Date
// instant, independent of the server process's own local timezone.
function phDateTime(dateStr, timeStr = '00:00') {
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
}

// Today's date, as it currently reads on a wall clock in the Philippines —
// NOT the server process's own local "today", which can be a whole
// calendar day behind during the Philippines' morning hours (UTC+8 means
// midnight PH is already 4pm UTC the day before).
function todayInPH() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

module.exports = { phDateTime, todayInPH };
