// The OpenDART sync alert issue, as a plan the workflow carries out. The issue
// remembers which dates are still not synced; a passing run closes it only when
// its range covered every one of them, never just because it passed.

export const ALERT_TITLE = '[Alert] OpenDART daily sync failure';
export const ALERT_MARKER = '<!-- snowshagal-disclosure-sync-alert -->';
const PENDING_MARKER = /<!-- snowshagal-disclosure-sync-pending: ([0-9, -]*) -->/;
const DETAILS_MARKER = '<!-- snowshagal-disclosure-sync-details -->';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates the issue is waiting for, or null for an issue written before dates were tracked. */
export function pendingDates(body) {
  const match = PENDING_MARKER.exec(String(body || ''));
  if (!match) return null;
  return [...new Set(match[1].split(',').map(item => item.trim()).filter(item => ISO_DATE.test(item)))].sort();
}

export function datesInRange(begin, end) {
  if (!ISO_DATE.test(String(begin)) || !ISO_DATE.test(String(end)) || begin > end) return [];
  const dates = [];
  const cursor = new Date(`${begin}T00:00:00Z`);
  for (let guard = 0; guard < 400; guard += 1) {
    const day = cursor.toISOString().slice(0, 10);
    if (day > end) break;
    dates.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function header(pending) {
  return [
    ALERT_MARKER,
    `<!-- snowshagal-disclosure-sync-pending: ${pending.join(',')} -->`,
    'OpenDART daily disclosure synchronization failed.',
    '',
    `**Dates not yet synced:** ${pending.length ? pending.join(', ') : 'none recorded (see the run below)'}`,
    '',
    'Every run also reads the previous KRX trading day again, so one missed day comes back with the next passing run. An older date needs **Run workflow** with that `date`. This issue closes only once every date above has been synced.'
  ].join('\n');
}

function details(result, runUrl) {
  return [
    DETAILS_MARKER,
    `Latest failure: ${runUrl}`,
    '',
    '```',
    String(result?.report || result?.message || 'the sync failed without a report (see the run log)'),
    '```'
  ].join('\n');
}

function existingDetails(body) {
  const index = String(body || '').indexOf(DETAILS_MARKER);
  return index >= 0 ? String(body).slice(index) : '';
}

/**
 * What to do with the alert issue after one run.
 * issue: the open alert issue ({ number, body }) or null.
 * result: what scripts/sync-disclosures.mjs wrote (ok, targetDate, beginDate, endDate, report).
 * Returns { action: 'none' | 'create' | 'update' | 'close' | 'comment', body?, comment? }.
 */
export function planAlert({ issue = null, result, runUrl }) {
  if (!result?.ok) {
    const known = issue ? (pendingDates(issue.body) || []) : [];
    const target = ISO_DATE.test(String(result?.targetDate || '')) ? [result.targetDate] : [];
    const pending = [...new Set([...known, ...target])].sort();
    const body = `${header(pending)}\n\n${details(result, runUrl)}`;
    if (!issue) return { action: 'create', body };
    return {
      action: 'update',
      body,
      comment: `Daily sync failed again: ${runUrl}\n\n\`\`\`\n${String(result?.report || result?.message || '')}\n\`\`\``
    };
  }

  if (!issue) return { action: 'none' };
  const covered = datesInRange(result.beginDate, result.endDate);
  const range = covered.length ? `${result.beginDate}..${result.endDate}` : 'an unknown range';
  const pending = pendingDates(issue.body);
  if (pending === null) {
    return {
      action: 'comment',
      comment: `A sync passed in ${runUrl} (${range}), but this alert was opened before the dates were tracked, so it cannot tell whether the failed date was synced. It stays open: close it by hand once that date has been synced (**Run workflow** with its \`date\`).`
    };
  }
  const recovered = pending.filter(day => covered.includes(day));
  const remaining = pending.filter(day => !covered.includes(day));
  if (!remaining.length) {
    return {
      action: 'close',
      comment: `Recovered: ${runUrl} synced ${range}, which covers every date this alert was waiting for (${pending.join(', ') || 'none'}).`
    };
  }
  return {
    action: 'update',
    body: `${header(remaining)}\n\n${existingDetails(issue.body) || details(null, runUrl)}`,
    comment: `${runUrl} synced ${range}. Recovered: ${recovered.join(', ') || 'none'}. Still not synced: ${remaining.join(', ')}.`
  };
}
