/** Keep detail selection inside the currently visible queue without interrupting a visible review. */
export function selectVisibleReport(incidents, filter, selectedId) {
  const reports = incidents.filter(item => filter === 'all' || (item.status === 'operator-reviewed') === (filter === 'reviewed'));
  const selectedReport = reports.find(item => item.id === selectedId) || reports[0] || null;
  return { reports, selectedId: selectedReport?.id ?? null, selectedReport };
}
