/* ══════════════════════════════════════════════════════════════════════════
   Shared ROCK Hub top navigation — injected on every authenticated page.

   Replaces the old per-page dark sidebar/topbar. Renders the navy top nav
   (logo, role-aware links, notifications bell, user chip, mobile hamburger)
   into the top of <body>. One component so every page stays in sync.

   Each page opts in with:
     <body class="hub-page ..." data-hub-active="events" [data-hub-back]>
     <script src="/js/api.js"></script>
     <script src="/js/hub-nav.js"></script>
     <script src="/js/<page>.js"></script>   (optional; calls initUser etc.)

   On the single-page dashboards (board.html / volunteer.html) the section
   links call showSection() in place; on every other page they navigate.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const active   = document.body.dataset.hubActive || '';
  const showBack = document.body.hasAttribute('data-hub-back');

  // Link sets by role. `section` links switch sections in-page on the SPA
  // dashboards and otherwise navigate to `href`.
  const BOARD_LINKS = [
    { label: 'Dashboard',    section: 'dashboard',  href: '/board' },
    { label: 'Events',       section: 'events',     href: '/board?s=events' },
    { label: 'Contacts',     section: 'members',    href: '/board?s=members' },
    { label: 'Volunteers',   section: 'volunteers', href: '/board?s=volunteers' },
    { label: 'Board', dropdown: [
        { label: 'Board Directory',   section: 'contacts', href: '/board?s=contacts' },
        { label: 'Meeting Minutes',   section: 'minutes',  href: '/board?s=minutes' },
        { label: 'Action Items',      section: 'tasks',    href: '/board?s=tasks' },
        { label: 'Pending Volunteers', href: '/volunteers/pending', badgeId: 'pendingVolunteersBadge' },
        { label: 'Social Media',      href: '/social-feed' },
        { label: 'Usage Report',      href: '/admin/usage', id: 'adminUsageLink', vpOnly: true }
    ]},
    { label: 'Files & Docs', section: 'files',    href: '/board?s=files' },
    { label: 'Reports',      section: 'reports',  href: '/board?s=reports' },
    { label: 'Settings',     section: 'settings', href: '/board?s=settings' }
  ];

  const VOLUNTEER_LINKS = [
    { label: 'Dashboard',   section: 'dashboard', href: '/volunteer' },
    { label: 'Events',      section: 'events',    href: '/volunteer?s=events' },
    { label: 'My Sign-Ups', section: 'mysignups', href: '/volunteer?s=mysignups' },
    { label: 'My Tasks',    section: 'mytasks',   href: '/volunteer?s=mytasks' },
    { label: 'My Hours',    section: 'myhours',   href: '/volunteer?s=myhours' },
    { label: 'Resources',   section: 'resources', href: '/volunteer?s=resources' },
    { label: 'My Team',     section: 'myteam',    href: '/volunteer?s=myteam' }
  ];

  const ICON = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    burger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
  };

  // ── Shell (injected synchronously so #userChip etc. exist for page initUser) ──
  const header = document.createElement('header');
  header.className = 'hub-topnav';
  header.id = 'hubTopnav';
  header.innerHTML = `
    ${showBack ? `<button class="hub-back" id="backBtn" aria-label="Go back">${ICON.back}</button>` : ''}
    <a href="/" class="hub-brand" id="topbarHome">
      <img src="/img/rock-logo.png" class="hub-brand-img" alt="The ROCK Association">
      <span class="hub-brand-text">
        <span class="hub-logo-rock">ROCK</span>
        <span class="hub-logo-hub">Hub</span>
      </span>
    </a>
    <span class="hub-page-title" id="pageTitle"></span>
    <nav class="hub-nav" id="hubNavLinks"></nav>
    <div class="topbar-right">
      <div class="notif-wrap" style="position:relative;">
        <button class="icon-btn" title="Notifications" id="notifBtn" onclick="toggleNotifDropdown()">
          ${ICON.bell}<span class="notif-badge" id="notifBadge" style="display:none;"></span>
        </button>
        <div class="notif-dropdown" id="notifDropdown"></div>
      </div>
      <div class="user-chip" id="userChip">
        <span class="user-chip-info">
          <span class="user-chip-name" id="userName">—</span>
          <span class="user-chip-email" id="userEmail">—</span>
        </span>
        <img class="avatar" id="userAvatar" src="" alt="">
        <div class="user-dropdown" id="userDropdown">
          <form method="POST" action="/auth/logout"><button type="submit">Sign out</button></form>
        </div>
      </div>
      <button class="hub-hamburger" id="hubHamburger" aria-label="Menu" aria-expanded="false">${ICON.burger}</button>
    </div>
    <div class="hub-mobile-menu" id="hubMobileMenu"></div>
  `;
  document.body.insertBefore(header, document.body.firstChild);

  // ── Hamburger toggle ──────────────────────────────────────────────────────
  const burger = document.getElementById('hubHamburger');
  const mobile = document.getElementById('hubMobileMenu');
  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = mobile.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => {
    if (!mobile.contains(e.target) && e.target !== burger) mobile.classList.remove('open');
  });

  // Is this an in-page SPA dashboard? (board.html / volunteer.html have sections)
  const isSPA = typeof window.showSection === 'function' && !!document.getElementById('dashboard');

  function activateSection(section, el) {
    // Highlight this link + its mobile twin, then switch the section.
    document.querySelectorAll('#hubNavLinks .nav-item, #hubMobileMenu .nav-item')
      .forEach(n => n.classList.remove('active'));
    document.querySelectorAll(`[data-section="${section}"]`).forEach(n => n.classList.add('active'));
    window.showSection(section, el);
    mobile.classList.remove('open');
  }

  function onLinkClick(link) {
    return function (e) {
      if (link.section && isSPA && document.getElementById(link.section)) {
        e.preventDefault();
        activateSection(link.section, this);
      } else {
        mobile.classList.remove('open'); // let the href navigate
      }
    };
  }

  function makeLink(link, forMobile) {
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = link.href || '#';
    a.textContent = link.label;
    if (link.section) a.dataset.section = link.section;
    if (link.id && !forMobile) a.id = link.id;
    if (link.vpOnly) a.dataset.vpOnly = '1';
    if ((link.section && link.section === active) ||
        (!link.section && link.activeKey === active)) a.classList.add('active');
    if (link.badgeId && !forMobile) {
      const b = document.createElement('span');
      b.className = 'nav-badge';
      b.id = link.badgeId;
      b.style.display = 'none';
      b.style.marginLeft = 'auto';
      a.appendChild(b);
      a.style.justifyContent = 'space-between';
    }
    a.addEventListener('click', onLinkClick(link));
    return a;
  }

  const BOARD_DROPDOWN_SECTIONS = ['contacts', 'minutes', 'tasks'];

  function buildDesktop(links) {
    const nav = document.getElementById('hubNavLinks');
    nav.innerHTML = '';
    links.forEach(link => {
      if (link.dropdown) {
        const dd = document.createElement('div');
        dd.className = 'hub-dd';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-item hub-dd-toggle';
        toggle.id = 'boardNavBtn';
        toggle.textContent = link.label;
        if (BOARD_DROPDOWN_SECTIONS.includes(active)) toggle.classList.add('active');
        const menu = document.createElement('div');
        menu.className = 'hub-dd-menu';
        link.dropdown.forEach(item => menu.appendChild(makeLink(item, false)));
        dd.appendChild(toggle);
        dd.appendChild(menu);
        nav.appendChild(dd);
      } else {
        nav.appendChild(makeLink(link, false));
      }
    });
  }

  function buildMobile(links) {
    const menu = document.getElementById('hubMobileMenu');
    menu.innerHTML = '';
    links.forEach(link => {
      if (link.dropdown) {
        const label = document.createElement('div');
        label.className = 'hub-mm-label';
        label.textContent = link.label;
        menu.appendChild(label);
        link.dropdown.forEach(item => menu.appendChild(makeLink(item, true)));
      } else {
        menu.appendChild(makeLink(link, true));
      }
    });
  }

  // ── Role resolution → build links ─────────────────────────────────────────
  // initUser() (api.js) fills the user chip AND returns the profile; using it
  // here means every page's chip is populated by the shared nav, and it is
  // idempotent so pages that also call initUser() are unaffected.
  const getUser = typeof initUser === 'function'
    ? initUser()
    : fetch('/api/me').then(r => (r.ok ? r.json() : null));

  getUser.then(user => {
    const role = user && user.role === 'Board' ? 'Board' : 'Volunteer';
    const links = role === 'Board' ? BOARD_LINKS : VOLUNTEER_LINKS;
    const roleHome = role === 'Board' ? '/board' : '/volunteer';

    buildDesktop(links);
    buildMobile(links);

    // Brand → role home (event-detail.js also sets this; harmless overlap).
    const home = document.getElementById('topbarHome');
    if (home) home.href = roleHome;

    // Back button (detail pages) — go back, or fall to the role home.
    const back = document.getElementById('backBtn');
    if (back && !back.dataset.wired) {
      back.dataset.wired = '1';
      back.addEventListener('click', () => {
        if (history.length > 1) history.back(); else location.href = roleHome;
      });
    }

    // VP-only usage link.
    if (user && user.email === 'vicepresident@gorock.org') {
      document.querySelectorAll('[data-vp-only]').forEach(el => { el.style.display = ''; });
    } else {
      document.querySelectorAll('[data-vp-only]').forEach(el => { el.style.display = 'none'; });
    }

    // Board: pending-volunteer badge count.
    if (role === 'Board') {
      fetch('/api/volunteers/pending').then(r => (r.ok ? r.json() : [])).then(list => {
        if (!list || !list.length) return;
        document.querySelectorAll('#pendingVolunteersBadge').forEach(b => {
          b.textContent = list.length; b.style.display = 'flex';
        });
      }).catch(() => {});
    }

    // On non-SPA pages the bell needs announcements loaded (SPA pages do this
    // themselves in their page script).
    if (!isSPA && typeof initNotifications === 'function') {
      initNotifications(role === 'Board' ? ['All', 'Board'] : ['All', 'Volunteers']);
    }

    // Cross-page deep link: /board?s=events → open that section on arrival.
    if (isSPA) {
      const s = new URLSearchParams(location.search).get('s');
      if (s && document.getElementById(s)) {
        activateSection(s, document.querySelector(`#hubNavLinks [data-section="${s}"]`));
      }
    }
  }).catch(() => {
    // If /api/me fails, still render board links so the page is navigable.
    buildDesktop(BOARD_LINKS);
    buildMobile(BOARD_LINKS);
  });
})();
