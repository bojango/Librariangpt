import { durationHms } from '../features/reading-session.js';
import { readingDayCount } from '../ui/format.js';

// Keep exact elapsed seconds until formatting, including fractional timestamps.
function completedReadingInterval(session) {
  if (session?.session_kind !== 'reading' || !session.started_at || !session.ended_at) return null;
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}

export function bookReadingTime(sessions = [], book = {}, now = new Date()) {
  const totalSeconds = (sessions || []).reduce((total, session) => {
    const interval = session.book_id === book.id ? completedReadingInterval(session) : null;
    return total + (interval ? (interval.end - interval.start) / 1000 : 0);
  }, 0);
  const days = readingDayCount(book.started_at, book.completed_at, now);
  return { totalSeconds, perDaySeconds: days == null ? 0 : totalSeconds / Math.max(1, days) };
}

export function profileReadingTime(sessions = [], now = new Date()) {
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const days = new Map();
  let totalSeconds = 0;
  let yearSeconds = 0;
  let sessionCount = 0;
  for (const session of sessions || []) {
    const interval = completedReadingInterval(session);
    if (!interval) continue;
    sessionCount += 1;
    totalSeconds += (interval.end - interval.start) / 1000;
    yearSeconds += Math.max(0, Math.min(interval.end, yearEnd) - Math.max(interval.start, yearStart)) / 1000;
    // Local midnight boundaries also handle 23/25-hour daylight-saving days.
    let cursor = interval.start;
    do {
      const date = new Date(cursor);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const end = Math.min(interval.end, midnight);
      days.set(key, (days.get(key) || 0) + (end - cursor) / 1000);
      cursor = end;
    } while (cursor < interval.end);
  }
  return {
    totalSeconds, yearSeconds,
    averageDaySeconds: days.size ? totalSeconds / days.size : 0,
    averageSessionSeconds: sessionCount ? totalSeconds / sessionCount : 0
  };
}

export { durationHms };

export function durationCompact(seconds) {
  const minutes = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds / 60)) : 0;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}
