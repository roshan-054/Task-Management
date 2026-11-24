// Turns raw KPI counts (from kpi_stats) into the numbers shown on profiles.
// Change the weights here to tune how the performance score is calculated.
export const WEIGHTS = { completion: 0.4, onTime: 0.4, noOverdue: 0.2 };

export function computeKpi(s) {
  const total = s.total || 0;
  const completed = s.completed || 0;
  const open = total - completed;
  const completionRate = total ? completed / total : 0;
  const onTimeRate = completed ? (s.completed_on_time || 0) / completed : 0;
  const overdueRatio = open ? (s.overdue_open || 0) / open : 0;
  const score = total
    ? Math.round(100 * (WEIGHTS.completion * completionRate + WEIGHTS.onTime * onTimeRate + WEIGHTS.noOverdue * (1 - overdueRatio)))
    : null;
  return {
    ...s,
    open,
    completionRate,
    onTimeRate,
    score,
    band: bandFor(score),
    weekly: Array.isArray(s.weekly) ? s.weekly.map(Number) : [],
  };
}

export function bandFor(score) {
  if (score === null || score === undefined) return { label: 'No tasks yet', tone: 'neutral' };
  if (score >= 85) return { label: 'Excellent', tone: 'green' };
  if (score >= 70) return { label: 'Good', tone: 'blue' };
  if (score >= 50) return { label: 'Fair', tone: 'orange' };
  return { label: 'Needs attention', tone: 'red' };
}

export function formatHours(h) {
  if (h === null || h === undefined) return '—';
  const n = Number(h);
  if (n < 1) return '< 1 h';
  if (n < 48) return `${Math.round(n)} h`;
  return `${Math.round(n / 24)} days`;
}
