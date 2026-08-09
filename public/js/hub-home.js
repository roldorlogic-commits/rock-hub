/* Board dashboard — home widgets (mini calendar) + Board nav helper.
   Loaded after board.js. Reuses /api/events for the calendar event dots. */

// Board dropdown / task jumps: switch section while keeping the top-level
// "Board" tab underlined (showSection highlights whichever nav-item we pass).
function selectBoard(id) {
  showSection(id, document.getElementById('boardNavBtn'));
}

(function () {
  function renderCalendar(eventDays) {
    const el = document.getElementById('miniCalendar');
    if (!el) return;

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    const firstDow  = new Date(year, month, 1).getDay();
    const daysInMon = new Date(year, month + 1, 0).getDate();
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
      .map(d => `<div class="cal-dow">${d}</div>`).join('');

    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMon; d++) {
      const isToday = d === today;
      const hasEvt  = eventDays.has(d);
      cells += `<div class="cal-cell${isToday ? ' today' : ''}">${d}${hasEvt ? '<span class="cal-dot"></span>' : ''}</div>`;
    }

    el.innerHTML = `<div class="cal-head">${monthName}</div><div class="cal-grid">${cells}</div>`;
  }

  async function initCalendar() {
    const eventDays = new Set();
    try {
      const events = await fetch('/api/events').then(r => (r.ok ? r.json() : []));
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      (events || []).forEach(e => {
        if (!e.StartDate) return;
        const d = new Date(e.StartDate + 'T00:00:00');
        if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) eventDays.add(d.getDate());
      });
    } catch (_) { /* calendar still renders without dots */ }
    renderCalendar(eventDays);
  }

  if (document.readyState !== 'loading') initCalendar();
  else document.addEventListener('DOMContentLoaded', initCalendar);
})();
