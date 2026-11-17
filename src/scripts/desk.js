// Desk engine.
// - Cards: one requestAnimationFrame loop with a damped spring per property.
// - Views: "/", "/notes" and "/projects" are the same desk; switching flies cards
//   that don't belong off-screen and settles the rest into a grid.
// - Reading: a card grows into a sheet (Web Animations, compositor-only transform
//   and opacity) while the other cards slide off; "put back" reverses it.
// Runs inline right after the desk markup, so cards are placed before first paint.
(() => {
  const desk = document.querySelector('[data-desk]');
  if (!desk) return;

  const KEY = 'pliffdax:desk:v2';
  const MODE_KEY = 'pliffdax:desk:mode';
  const DEALT_KEY = 'pliffdax:desk:dealt';
  const HINT_KEY = 'pliffdax:desk:hinted';
  const RETURN_KEY = 'pliffdax:desk:return';

  const read = (s, k) => { try { return JSON.parse(s.getItem(k)); } catch { return null; } };
  const write = (s, k, v) => { try { s.setItem(k, JSON.stringify(v)); } catch {} };
  const local = (() => { try { return window.localStorage; } catch { return null; } })();
  const session = (() => { try { return window.sessionStorage; } catch { return null; } })();
  const get = (k) => (local ? read(local, k) : null);
  const put = (k, v) => local && write(local, k, v);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 760px)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

  // Focus moved by script (open, close, flip) shows the ring only after keyboard use.
  // Taps on iOS Safari don't focus links, so without this every scripted focus
  // after a tap counts as :focus-visible and the card is left outlined.
  let viaKeyboard = false;
  addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) viaKeyboard = true; }, true);
  addEventListener('pointerdown', () => { viaKeyboard = false; }, true);
  const moveFocus = (el) => {
    if (!el) return;
    if (!viaKeyboard) {
      // fallback for engines that ignore the focusVisible option
      el.classList.add('is-quiet-focus');
      el.addEventListener('blur', () => el.classList.remove('is-quiet-focus'), { once: true });
    }
    el.focus({ preventScroll: true, focusVisible: viaKeyboard });
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const root = document.documentElement;

  // stiffness / damping / rest threshold per animated property
  const SPRING = {
    x: [170, 20, 0.05],
    y: [170, 20, 0.05],
    r: [150, 13, 0.01],
    s: [380, 26, 0.0005],
    l: [240, 24, 0.001],
    o: [180, 26, 0.002],
  };
  const PROPS = Object.keys(SPRING);
  const PAD = 12;

  const TITLES = { desk: 'pliffdax.dev', notes: 'Notes · pliffdax.dev', projects: 'Projects · pliffdax.dev' };
  const PATHS = { desk: '/', notes: '/notes', projects: '/projects' };
  const viewFromPath = (p) => (p === '/notes' ? 'notes' : p === '/projects' ? 'projects' : p === '/' || p === '/index.html' ? 'desk' : null);

  // ---------------------------------------------------------------- bodies
  const saved = get(KEY) || {};
  const bodies = [...desk.querySelectorAll('[data-item]')].map((el, i) => {
    const id = el.dataset.item;
    const def = { cx: +el.dataset.cx || 0.5, cy: +el.dataset.cy || 0.5, r: +el.dataset.r || 0 };
    const s = saved[id];
    const home = s && Number.isFinite(s.cx) && Number.isFinite(s.cy)
      ? { cx: s.cx, cy: s.cy, r: Number.isFinite(s.r) ? s.r : def.r }
      : def;
    return {
      el, id, i, home,
      kind: id.startsWith('note-') ? 'notes' : id.startsWith('project-') ? 'projects' : 'intro',
      z: (s && s.z) || i + 1,
      x: 0, y: 0, r: 0, s: 1, l: 0, o: 1,
      v: { x: 0, y: 0, r: 0, s: 0, l: 0, o: 0 },
      t: { x: 0, y: 0, r: 0, s: 1, l: 0, o: 1 },
      w: 0, h: 0, held: false, hover: false, away: false,
      tf: '', lift: '', op: '', zi: '',
    };
  });
  const byEl = new Map(bodies.map((b) => [b.el, b]));
  let zTop = Math.max(0, ...bodies.map((b) => b.z));

  let W = 0, H = 0;
  const measure = () => {
    W = desk.clientWidth;
    H = desk.clientHeight;
    for (const b of bodies) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; }
  };

  const homeXY = (b) => ({
    x: clamp(b.home.cx * W - b.w / 2, PAD, Math.max(PAD, W - b.w - PAD)),
    y: clamp(b.home.cy * H - b.h / 2, PAD, Math.max(PAD, H - b.h - PAD)),
  });

  // Write styles only when they actually change: every write costs a style recalc,
  // and a --lift change repaints that card's shadow.
  const render = (b) => {
    const st = b.el.style;
    const tf = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotate(${b.r.toFixed(2)}deg) scale(${b.s.toFixed(4)})`;
    if (tf !== b.tf) { st.transform = tf; b.tf = tf; }
    const lift = clamp(b.l, 0, 1.2).toFixed(2);
    if (lift !== b.lift) { st.setProperty('--lift', lift); b.lift = lift; }
    const o = clamp(b.o, 0, 1);
    const op = o > 0.995 ? '' : o.toFixed(2);
    if (op !== b.op) { st.opacity = op; b.op = op; }
    const zi = String(b.z);
    if (zi !== b.zi) { st.zIndex = zi; b.zi = zi; }
  };

  const snap = (b) => {
    for (const p of PROPS) { b[p] = b.t[p]; b.v[p] = 0; }
    render(b);
  };

  const save = () => {
    const out = {};
    for (const b of bodies) out[b.id] = { cx: +b.home.cx.toFixed(4), cy: +b.home.cy.toFixed(4), r: +b.home.r.toFixed(2), z: b.z };
    put(KEY, out);
  };

  // ---------------------------------------------------------------- loop
  let raf = 0, last = 0, drag = null;
  const kick = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  };

  function step(now) {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / n;
    let busy = false;
    for (const b of bodies) {
      let moving = false;
      for (const p of PROPS) {
        if (b.held && (p === 'x' || p === 'y')) { moving = true; continue; }
        const target = b.t[p];
        let x = b[p], v = b.v[p];
        if (x === target && v === 0) continue;
        const [k, c, eps] = SPRING[p];
        for (let j = 0; j < n; j++) {
          v += (-k * (x - target) - c * v) * h;
          x += v * h;
        }
        if (Math.abs(x - target) < eps && Math.abs(v) < eps * 10) { x = target; v = 0; }
        else busy = true;
        b[p] = x; b.v[p] = v;
        moving = true;
      }
      if (moving) render(b);
    }
    raf = busy || drag ? requestAnimationFrame(step) : 0;
  }

  // ---------------------------------------------------------------- layout & views
  const toggle = document.querySelector('[data-tidy-toggle]');
  const toggleLabel = toggle && toggle.querySelector('[data-tidy-label]');
  const hint = desk.querySelector('[data-hint]');
  const navLinks = [...document.querySelectorAll('[data-nav]')];

  let view = viewFromPath(location.pathname) || desk.dataset.view || 'desk';
  let preferred = get(MODE_KEY) === 'tidy' ? 'tidy' : 'scatter';
  const layoutFor = (v) => (v !== 'desk' ? 'shelf' : narrow.matches ? 'tidy' : preferred);
  const inView = (b) => view === 'desk' || b.kind === view;
  let layout = layoutFor(view);

  const syncChrome = () => {
    if (toggle) {
      toggle.hidden = narrow.matches || view !== 'desk';
      toggle.setAttribute('aria-pressed', String(layout === 'tidy'));
      if (toggleLabel) toggleLabel.textContent = layout === 'tidy' ? 'scatter' : 'tidy up';
    }
    for (const a of navLinks) {
      if (a.dataset.nav === view && view !== 'desk') a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };

  // A spot fully outside the viewport, straight out from `origin` through the card.
  function awayFrom(b, origin) {
    const r = b.el.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    let dx = (r.left + r.right) / 2 - origin.x, dy = (r.top + r.bottom) / 2 - origin.y;
    let len = Math.hypot(dx, dy);
    if (len < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
    dx /= len; dy /= len;
    const kx = dx > 0.01 ? (vw - r.left) / dx : dx < -0.01 ? r.right / -dx : Infinity;
    const ky = dy > 0.01 ? (vh - r.top) / dy : dy < -0.01 ? r.bottom / -dy : Infinity;
    const k = Math.min(kx, ky) + 90;
    return { x: b.x + dx * k, y: b.y + dy * k, r: b.r + rand(-16, 16), dist: len };
  }
  const screenCenter = () => ({ x: innerWidth / 2, y: innerHeight * 0.45 });

  // Re-lay everything for the current `view` / mode. Each card keeps its on-screen
  // position across the layout switch, then springs to where it now belongs.
  function relayout(animate) {
    const seen = bodies.map((b) => ({ x: b.el.offsetLeft + b.x, y: b.el.offsetTop + b.y }));
    layout = layoutFor(view);
    desk.dataset.layout = layout;
    desk.dataset.view = view;
    measure();
    const motion = animate && !reduce.matches;
    bodies.forEach((b, k) => {
      b.x = seen[k].x - b.el.offsetLeft;
      b.y = seen[k].y - b.el.offsetTop;
      b.t.x = b.x; b.t.y = b.y;
      render(b);
    });
    const center = screenCenter();
    let leaving = 0, arriving = 0;
    for (const b of bodies) {
      let goal;
      let delay = 0;
      if (inView(b)) {
        goal = layout === 'scatter' ? { ...homeXY(b), r: b.home.r } : { x: 0, y: 0, r: 0 };
        delay = 70 + arriving++ * 40;
        b.away = false;
      } else if (b.away) {
        continue; // already parked off-screen; parked cards keep their spot
      } else {
        goal = awayFrom(b, center);
        delay = leaving++ * 22;
        b.away = true;
      }
      b.el.inert = b.away;
      if (!motion) {
        b.t.x = goal.x; b.t.y = goal.y; b.t.r = goal.r; b.t.l = 0;
        snap(b);
        continue;
      }
      setTimeout(() => {
        b.t.x = goal.x; b.t.y = goal.y; b.t.r = goal.r;
        if (!b.away) b.v.r += rand(-40, 40);
        kick();
      }, delay);
    }
    syncChrome();
  }

  function setView(next, animate, push) {
    if (!next || next === view) return;
    view = next;
    if (push) history.pushState({ view }, '', PATHS[view]);
    document.title = TITLES[view];
    if (animate && scrollY > 0) window.scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' });
    relayout(animate);
  }

  function setMode(next) {
    preferred = next;
    put(MODE_KEY, next);
    if (view !== 'desk') return;
    relayout(true);
  }

  // ---------------------------------------------------------------- initial placement
  desk.dataset.layout = layout;
  desk.dataset.view = view;
  desk.dataset.live = '';
  measure();

  const returning = session ? read(session, RETURN_KEY) : null;
  if (returning && session) session.removeItem(RETURN_KEY);
  const firstVisit = !returning && !(session && read(session, DEALT_KEY)) && !reduce.matches;
  if (session) write(session, DEALT_KEY, true);

  const center0 = screenCenter();
  for (const b of bodies) {
    if (inView(b)) {
      const goal = layout === 'scatter' ? { ...homeXY(b), r: b.home.r } : { x: 0, y: 0, r: 0 };
      b.t.x = goal.x; b.t.y = goal.y; b.t.r = goal.r;
      snap(b);
    } else {
      // park it: put it at its desk spot first so "away" points the right way
      const g = homeXY(b);
      b.t.x = g.x; b.t.y = g.y; b.t.r = b.home.r;
      snap(b);
      const a = awayFrom(b, center0);
      b.t.x = a.x; b.t.y = a.y; b.t.r = a.r;
      snap(b);
      b.away = true;
      b.el.inert = true;
    }
  }

  if (firstVisit) {
    // deal the cards in from just below the desk edge (the desk clips them, like a table edge)
    const dealt = bodies.filter((b) => !b.away);
    dealt.forEach((b, k) => {
      const goal = { x: b.t.x, y: b.t.y, r: b.t.r };
      if (layout === 'scatter') {
        b.x = W / 2 - b.w / 2 + rand(-40, 40);
        b.y = H + 40 + k * 12;
        b.r = goal.r + rand(-28, 28);
        b.s = 0.94;
      } else {
        b.y = goal.y + 28;
        b.o = 0;
      }
      b.t.x = b.x; b.t.y = b.y; b.t.r = b.r; b.t.s = b.s; b.t.o = b.o;
      render(b);
      setTimeout(() => {
        // aim at the spot as it is now: fonts may have resized the card meanwhile
        const now = layout === 'scatter' ? { ...homeXY(b), r: b.home.r } : { x: 0, y: 0, r: 0 };
        Object.assign(b.t, b.away ? goal : now, { s: 1, o: 1 });
        if (layout === 'scatter') { b.v.y = -900; b.v.r = rand(-80, 80); }
        kick();
      }, 140 + k * (layout === 'scatter' ? 85 : 55));
    });
  }

  syncChrome();
  if (hint && get(HINT_KEY)) hint.classList.add('is-gone');
  history.replaceState({ ...(history.state || {}), view }, '');

  // Card sizes change once the web fonts arrive (and on any reflow). Keep each
  // card centred on its spot: re-aim the springs instead of jumping.
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      const before = bodies.map((b) => b.w + 'x' + b.h).join();
      measure();
      if (bodies.map((b) => b.w + 'x' + b.h).join() === before) return;
      if (layout !== 'scatter') return;
      for (const b of bodies) {
        if (b.held || b.away || b.rest) continue;
        const g = homeXY(b);
        b.t.x = g.x; b.t.y = g.y;
      }
      kick();
    });
    for (const b of bodies) ro.observe(b.el);
  }

  // ---------------------------------------------------------------- dragging
  let suppressClick = false;
  let reading = null; // the card currently opened as a sheet

  desk.addEventListener('dragstart', (e) => e.preventDefault());

  desk.addEventListener('pointerdown', (e) => {
    if (layout !== 'scatter' || e.button !== 0 || drag || reading) return;
    const el = e.target.closest('[data-item]');
    if (!el || e.target.closest('button')) return;
    const b = byEl.get(el);
    suppressClick = false;
    // no pointer capture yet: capturing here would retarget the click away from
    // links inside the card (e.g. the socials on the business card)
    drag = {
      b, id: e.pointerId,
      sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y,
      lx: e.clientX, ly: e.clientY, lt: e.timeStamp,
      vx: 0, vy: 0, active: false,
    };
  });

  desk.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { b } = drag;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.active = true;
      try { b.el.setPointerCapture(e.pointerId); } catch {}
      b.held = true;
      b.v.x = b.v.y = 0;
      b.z = ++zTop;
      b.t.l = 1;
      b.t.s = 1.035;
      b.el.classList.add('is-held');
      if (hint && !hint.classList.contains('is-gone')) { hint.classList.add('is-gone'); put(HINT_KEY, true); }
    }
    b.x = clamp(drag.bx + dx, -b.w * 0.5, W - b.w * 0.5);
    b.y = clamp(drag.by + dy, -b.h * 0.3, H - b.h * 0.5);

    const dt = (e.timeStamp - drag.lt) / 1000;
    if (dt > 0.001) {
      const ivx = (e.clientX - drag.lx) / dt, ivy = (e.clientY - drag.ly) / dt;
      drag.vx = drag.vx * 0.55 + ivx * 0.45;
      drag.vy = drag.vy * 0.55 + ivy * 0.45;
      drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = e.timeStamp;
    }
    // paper leans into the direction it's pulled
    b.t.r = b.home.r + clamp(drag.vx * 0.012, -16, 16);
    kick();
  });

  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { b } = drag;
    if (drag.active) {
      suppressClick = true;
      if (e.timeStamp - drag.lt > 90) { drag.vx = 0; drag.vy = 0; }
      const vx = clamp(drag.vx, -4000, 4000), vy = clamp(drag.vy, -4000, 4000);
      const tx = clamp(b.x + vx * 0.12, PAD, Math.max(PAD, W - b.w - PAD));
      const ty = clamp(b.y + vy * 0.12, PAD, Math.max(PAD, H - b.h - PAD));
      b.held = false;
      b.v.x = vx * 0.3; b.v.y = vy * 0.3;
      const r = clamp(b.home.r + vx * 0.0022, -9, 9);
      Object.assign(b.t, { x: tx, y: ty, r, l: b.hover ? 0.3 : 0, s: 1 });
      b.home = { cx: (tx + b.w / 2) / W, cy: (ty + b.h / 2) / H, r };
      b.el.classList.remove('is-held');
      save();
    }
    drag = null;
    kick();
  };
  desk.addEventListener('pointerup', release);
  desk.addEventListener('pointercancel', release);

  desk.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // hover lift
  for (const b of bodies) {
    b.el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !finePointer.matches || reading) return;
      b.hover = true;
      if (!b.held) { b.t.l = 0.3; b.t.s = 1.012; kick(); }
    });
    b.el.addEventListener('pointerleave', () => {
      b.hover = false;
      if (!b.held) { b.t.l = 0; b.t.s = 1; kick(); }
    });
  }

  // ---------------------------------------------------------------- now note flip
  desk.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flip]');
    if (!btn) return;
    const note = btn.closest('.now');
    const flipped = note.classList.toggle('is-flipped');
    const [front, back] = note.querySelectorAll('.now__face');
    front.inert = flipped;
    back.inert = !flipped;
    moveFocus(note.querySelector('.now__face:not([inert]) [data-flip]'));
    note.querySelector('[data-flip][aria-expanded]')?.setAttribute('aria-expanded', String(flipped));
    const b = byEl.get(note);
    if (b && !reduce.matches) { b.v.s += 1.6; kick(); }
  });

  // ---------------------------------------------------------------- socials without a link (Discord)
  desk.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    const label = btn.querySelector('[data-label]');
    const original = label.dataset.original || (label.dataset.original = label.textContent);
    let ok = false;
    try { await navigator.clipboard.writeText(btn.dataset.copy); ok = true; } catch {}
    label.textContent = ok ? 'copied' : btn.dataset.copy; // no clipboard: at least show the handle
    btn.classList.add('is-copied');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { label.textContent = original; btn.classList.remove('is-copied'); }, 1600);
  });

  // ---------------------------------------------------------------- controls & resize
  if (toggle) {
    toggle.addEventListener('click', () => {
      if (reading) return;
      setMode(layout === 'tidy' ? 'scatter' : 'tidy');
    });
  }

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (layoutFor(view) !== layout) { relayout(false); return; }
      measure();
      if (layout !== 'scatter') return;
      for (const b of bodies) {
        if (b.held || b.away) continue;
        const g = homeXY(b);
        b.t.x = g.x; b.t.y = g.y;
        b.x = g.x; b.y = g.y; b.v.x = b.v.y = 0;
        render(b);
      }
    });
  });

  // coming back via bfcache: don't leave a card stuck mid-air
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    drag = null;
    for (const b of bodies) { b.held = false; b.el.classList.remove('is-held'); b.t.l = 0; b.t.s = 1; }
    kick();
  });

  // ---------------------------------------------------------------- fly out / in (reading)
  function flyOut(origin, except, instant) {
    const list = bodies
      .filter((b) => b !== except && !b.away)
      .map((b) => ({ b, goal: awayFrom(b, origin) }))
      .sort((a, c) => a.goal.dist - c.goal.dist);
    list.forEach((item, i) => {
      const { b, goal } = item;
      b.rest = { x: b.t.x, y: b.t.y, r: b.t.r };
      const go = () => {
        if (!b.rest) return;
        b.t.x = goal.x; b.t.y = goal.y; b.t.r = goal.r;
        if (instant) snap(b); else kick();
      };
      if (instant) go(); else item.timer = setTimeout(go, i * 24);
    });
    return list;
  }

  function flyIn(list) {
    for (const item of list) clearTimeout(item.timer); // still leaving? turn around now
    [...list].reverse().forEach(({ b }, i) => {
      setTimeout(() => {
        if (!b.rest) return;
        b.t.x = b.rest.x; b.t.y = b.rest.y; b.t.r = b.rest.r;
        b.rest = null;
        kick();
      }, 60 + i * 34);
    });
  }

  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  };

  // Back from a sheet opened as its own page: the view transition shrinks it onto
  // its card, and the rest of the desk slides back in around it.
  if (returning && !reduce.matches) {
    const home = bodies.find((b) => b.id === returning && !b.away);
    if (home) {
      const list = flyOut(centerOf(home.el), home, true);
      setTimeout(() => flyIn(list), 160);
    }
  }

  // ---------------------------------------------------------------- navigation in place
  let pendingView = null;
  for (const a of navLinks) {
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const next = a.dataset.nav;
      if (reading) { if (next !== view) pendingView = { view: next, push: true }; requestClose(); return; }
      if (next === view) { if (scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      setView(next, true, true);
    });
  }

  // ---------------------------------------------------------------- reading on the desk
  const reader = document.querySelector('[data-reader]');
  const slot = reader && reader.querySelector('[data-reader-slot]');

  // spring -> CSS linear() easing, so Web Animations can run it on the compositor
  function springEasing(k, c) {
    let x = 0, v = 0, t = 0;
    const dt = 1 / 600, pts = [0];
    let next = 1 / 60;
    while (t < 2) {
      v += (-k * (x - 1) - c * v) * dt;
      x += v * dt;
      t += dt;
      if (t >= next) { pts.push(x); next += 1 / 60; }
      if (Math.abs(1 - x) < 0.0015 && Math.abs(v) < 0.02 && t > 0.1) break;
    }
    pts.push(1);
    return { easing: `linear(${pts.map((p) => +p.toFixed(4)).join(', ')})`, duration: Math.round(t * 1000) };
  }
  // critically damped: no overshoot, so the paper never pokes out past the sheet
  const OPEN = springEasing(170, 2 * Math.sqrt(170));
  const CLOSE = springEasing(200, 2 * Math.sqrt(200));
  if (!(window.CSS && CSS.supports('transition-timing-function', 'linear(0, 1)'))) {
    OPEN.easing = CLOSE.easing = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
  }

  let opening = false, closing = false, runId = 0, anims = [], morph = null;

  const stopAnims = () => { for (const a of anims) { try { a.finish(); } catch {} } anims = []; };
  const cancelAnims = () => { for (const a of anims) { try { a.cancel(); } catch {} } anims = []; };
  const dropMorph = () => { if (morph) { morph.root.remove(); morph = null; } };
  const allDone = (list) => Promise.all(list.map((a) => a.finished));
  const at = (x, y, r, sx, sy) =>
    `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

  // where the card's paper sits on screen: top-left corners, size, rotation
  function paperOf(b) {
    const d = desk.getBoundingClientRect();
    const body = b.el.querySelector('.folder__body');
    const inset = body ? body.offsetTop : 0;
    const L = d.left + b.el.offsetLeft + b.x, T = d.top + b.el.offsetTop + b.y;
    const ox = b.w * 0.5, oy = b.h * 0.4; // matches .item transform-origin: 50% 40%
    const a = (b.r * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), s = b.s;
    const corner = (px, py) => ({
      x: L + ox + s * (cos * (px - ox) - sin * (py - oy)),
      y: T + oy + s * (sin * (px - ox) + cos * (py - oy)),
    });
    return { card: corner(0, 0), paper: corner(0, inset), inset, w: b.w * s, h: (b.h - inset) * s, r: b.r, s };
  }

  // The card's text rides along with the paper, scaled with its width.
  function ghostKeys(b, P, S) {
    const k = S.width / b.w;
    return [at(P.card.x, P.card.y, P.r, P.s, P.s), at(S.left, S.top - P.inset * k, 0, k, k)];
  }
  const paperKeys = (P, S) => [at(P.paper.x, P.paper.y, P.r, P.w / S.width, P.h / S.height), at(S.left, S.top, 0, 1, 1)];
  // the sheet's text scales with the paper's width and stays pinned to its top edge
  const textKeys = (P, S) => [at(P.paper.x, P.paper.y, P.r, P.w / S.width, P.w / S.width), at(S.left, S.top, 0, 1, 1)];

  // The flying object: a paper (shadow + face) that stretches between card and sheet,
  // the card's text and the sheet's text riding on it. Only one paper ever exists.
  function buildMorph(b, S, sheet) {
    const kind = b.kind === 'projects' ? 'folder' : 'note';
    const rootEl = document.createElement('div');
    rootEl.className = `morph morph--${kind}`;
    rootEl.setAttribute('aria-hidden', 'true');
    const paper = document.createElement('div');
    paper.className = 'morph__paper';
    paper.style.width = `${S.width}px`;
    paper.style.height = `${S.height}px`;
    const face = document.createElement('div');
    face.className = 'morph__face';
    paper.append(face);
    let tint = null;
    if (kind === 'folder') {
      tint = document.createElement('div');
      tint.className = 'morph__tint';
      face.append(tint);
    }
    const text = sheet.cloneNode(true);
    text.removeAttribute('style');
    text.removeAttribute('tabindex');
    text.classList.add('morph__sheet');
    text.style.width = `${S.width}px`;
    const ghost = b.el.cloneNode(true);
    ghost.removeAttribute('style');
    ghost.style.width = `${b.w}px`;
    ghost.style.height = `${b.h}px`;
    ghost.removeAttribute('href');
    ghost.removeAttribute('data-item');
    ghost.classList.remove('surface');
    for (const el of ghost.querySelectorAll('.surface')) el.classList.remove('surface');
    ghost.classList.add('morph__card');
    rootEl.append(paper, text, ghost);
    document.body.append(rootEl);
    return { root: rootEl, paper, ghost, text, tint };
  }

  const cache = new Map();
  function load(href) {
    const path = new URL(href, location.href).pathname;
    if (!cache.has(path)) {
      cache.set(path, fetch(path, { credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then((text) => {
          const doc = new DOMParser().parseFromString(text, 'text/html');
          const f = doc.querySelector('.sheet-frame');
          if (!f) throw new Error('no sheet');
          return { html: f.outerHTML, title: doc.title };
        })
        .catch((err) => { cache.delete(path); throw err; }));
    }
    return cache.get(path);
  }

  const prefetch = (e) => {
    const a = e.target.closest && e.target.closest('a[data-open]');
    if (a) load(a.href).catch(() => {});
  };
  desk.addEventListener('pointerover', prefetch);
  desk.addEventListener('focusin', prefetch);

  async function open(b, href, push) {
    if (!reader || reading || opening || closing) return;
    opening = true;
    let data;
    try { data = await load(href); } catch { location.href = href; return; }
    const token = ++runId;

    slot.innerHTML = data.html;
    const frame = slot.querySelector('.sheet-frame');
    const sheet = frame.querySelector('.sheet');
    sheet.style.viewTransitionName = 'none';
    reading = { b, frame, sheet, prevTitle: document.title, list: [] };
    reader.setAttribute('aria-label', data.title);
    reader.hidden = false;
    reader.scrollTop = 0;
    root.classList.add('is-reading');
    desk.inert = true;
    if (toggle) toggle.disabled = true;
    b.hover = false; b.t.l = 0; b.t.s = 1;
    if (push) history.pushState({ view, reader: b.id, href }, '', href);
    document.title = data.title;

    const finish = () => {
      opening = false;
      reader.classList.remove('is-morphing');
      dropMorph();
      cancelAnims();
      moveFocus(sheet);
      if (!(history.state && history.state.reader)) close(); // back was pressed mid-open
    };

    if (reduce.matches) {
      b.el.style.visibility = 'hidden';
      reading.list = flyOut(centerOf(b.el), b, true);
      finish();
      return;
    }

    const S = frame.getBoundingClientRect();
    const P = paperOf(b);
    b.el.style.visibility = 'hidden';
    reader.classList.add('is-morphing');
    morph = buildMorph(b, S, sheet);
    const D = OPEN.duration;
    const timing = { duration: D, easing: OPEN.easing, fill: 'both' };
    anims = [
      morph.paper.animate(paperKeys(P, S).map((transform) => ({ transform })), timing),
      morph.text.animate(textKeys(P, S).map((transform) => ({ transform })), timing),
      morph.ghost.animate(ghostKeys(b, P, S).map((transform) => ({ transform })), timing),
      morph.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * 0.28, easing: 'ease-out', fill: 'both' }),
      morph.text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.4, delay: D * 0.38, easing: 'ease-out', fill: 'both' }),
    ];
    if (morph.tint) anims.push(morph.tint.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * 0.5, easing: 'ease-in-out', fill: 'both' }));
    reading.list = flyOut(centerOf(b.el), b, false);
    allDone(anims).then(() => { if (token === runId) finish(); }).catch(() => {});
  }

  function close() {
    if (!reading || closing) return;
    closing = true;
    opening = false; // closing mid-open: the open's finish step will never run
    const token = ++runId;
    stopAnims();
    dropMorph();
    const { b, frame, list, prevTitle } = reading;
    root.classList.add('is-closing');

    const done = () => {
      b.el.style.visibility = '';
      dropMorph();
      cancelAnims();
      reader.hidden = true;
      reader.classList.remove('is-morphing');
      reader.style.overflowY = '';
      slot.innerHTML = '';
      root.classList.remove('is-reading', 'is-closing');
      desk.inert = false;
      if (toggle) toggle.disabled = false;
      document.title = prevTitle;
      reading = null;
      closing = false;
      moveFocus(b.el);
      if (pendingView) { const p = pendingView; pendingView = null; setView(p.view, true, p.push); }
    };

    if (reduce.matches) {
      for (const { b: o } of list) {
        if (!o.rest) continue;
        o.t.x = o.rest.x; o.t.y = o.rest.y; o.t.r = o.rest.r;
        o.rest = null;
        snap(o);
      }
      done();
      return;
    }

    reader.style.overflowY = 'hidden';
    const S = frame.getBoundingClientRect();
    const P = paperOf(b);
    reader.classList.add('is-morphing');
    morph = buildMorph(b, S, reading.sheet);
    const D = CLOSE.duration;
    const timing = { duration: D, easing: CLOSE.easing, fill: 'both' };
    anims = [
      morph.paper.animate(paperKeys(P, S).reverse().map((transform) => ({ transform })), timing),
      morph.text.animate(textKeys(P, S).reverse().map((transform) => ({ transform })), timing),
      morph.ghost.animate(ghostKeys(b, P, S).reverse().map((transform) => ({ transform })), timing),
      morph.text.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * 0.3, easing: 'ease-out', fill: 'both' }),
      morph.ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.32, delay: D * 0.5, easing: 'ease-in', fill: 'both' }),
    ];
    if (morph.tint) anims.push(morph.tint.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D * 0.45, delay: D * 0.4, easing: 'ease-in-out', fill: 'both' }));
    flyIn(list);
    allDone(anims).then(() => { if (token === runId) done(); }).catch(() => {});
  }

  function requestClose() {
    if (!reading || closing) return;
    if (history.state && history.state.reader) history.back(); // popstate closes it
    else { close(); history.replaceState({ view }, '', PATHS[view]); }
  }

  desk.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-open]');
    if (!a || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const b = byEl.get(a);
    if (!b) return;
    e.preventDefault();
    open(b, a.href, true);
  });

  if (reader) {
    // the folded corner, or any empty space around the sheet, puts it back
    reader.addEventListener('click', (e) => {
      const corner = e.target.closest('[data-put-back]');
      if (corner) { e.preventDefault(); requestClose(); return; }
      if (opening || e.target.closest('.sheet-frame')) return;
      if (getSelection()?.toString()) return;
      requestClose();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && reading && !closing) { e.preventDefault(); requestClose(); }
  });

  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    if (reading && !st.reader) close();
    const v = viewFromPath(location.pathname) || st.view;
    if (!st.reader && v && v !== view) {
      if (reading) pendingView = { view: v, push: false };
      else setView(v, true, false);
    }
    if (!reading && st.reader) {
      const b = bodies.find((x) => x.id === st.reader);
      if (b) open(b, st.href, false);
    }
  });
})();
