/**
 * ui.js – Complete UI layer for TRAIN.
 *
 * Architecture:
 *   - mountApp(root)  bootstraps the entire DOM once.
 *   - subscribe() receives every state change and calls render().
 *   - render() does a targeted diff: only re-renders the region that changed.
 *   - All user interactions call dispatch() from state.js.
 *
 * BUG FIX (v2):
 *   _handleClick previously used a split two-switch pattern with a broken
 *   guard condition for the day-header accordion.  It is now a single,
 *   linear function that uses e.target.closest() for EVERY clickable target,
 *   so clicks on any child element (pill, chevron, subtitle div, etc.) are
 *   reliably caught.  The same fix is applied to export-option divs and
 *   settings rows that previously used role="button" without data-action.
 */

import {
  getState, dispatch, subscribe, A,
} from './state.js';
import {
  exportJSON, importJSON, exportCSV,
} from './backup.js';
import * as ic from './icons.js';

// ─── Module-level UI state (transient, never persisted) ──────────────────────

/** Set of day-indices whose accordion is currently open. */
const _openDays = new Set();

/** Currently active top-level tab id. */
let _activeTab = 'workout';

/** IntersectionObserver instance for sticky-header detection. */
let _stickyObserver = null;

/** Toast hide timer. */
let _toastTimer = null;

/** Swipe tracking. */
let _swipeStartX = null;
let _swipeStartY = null;

/** Drag-and-drop tracking. */
let _dragSrc = null; // { di, ei }

// ─── DOM references (set once in mountApp) ───────────────────────────────────
let _root        = null;
let _toast       = null;
let _storageWarn = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape HTML special chars for safe innerHTML injection. */
function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Returns YYYY-MM-DD for the *next* Monday from today. */
function nextMonday() {
  const d   = new Date();
  const dow = d.getDay(); // 0 = Sun
  d.setDate(d.getDate() + (dow === 0 ? 1 : 8 - dow));
  return d.toISOString().split('T')[0];
}

/** Returns "KW 18 · 2025" label for a YYYY-MM-DD date string. */
function wkLabel(sd) {
  const d   = new Date(sd + 'T12:00:00');
  const jan = new Date(d.getFullYear(), 0, 1);
  const kw  = Math.ceil(((d - jan) / 86_400_000 + jan.getDay() + 1) / 7);
  return `KW ${String(kw).padStart(2, '0')} · ${d.getFullYear()}`;
}

/** Returns "28. Apr – 04. Mai" */
function wkRange(sd) {
  const d   = new Date(sd + 'T12:00:00');
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  const fmt = x => x.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  return `${fmt(d)} – ${fmt(end)}`;
}

/** Show a toast. type: 'ok' | 'info' | 'warn' */
function showToast(msg, type = 'info') {
  if (!_toast) return;
  _toast.textContent = msg;
  _toast.className   = `toast is-visible toast--${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toast.classList.remove('is-visible');
  }, 2600);
}

/** Open a modal by id. */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('is-open');
  const first = el.querySelector('button, input, select, textarea, [tabindex]');
  first?.focus();
  el.addEventListener('click', _modalBackdropClose, { once: true });
}
function _modalBackdropClose(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('is-open');
}

// ─── Sticky observer ─────────────────────────────────────────────────────────
function _initStickyObserver() {
  if (_stickyObserver) _stickyObserver.disconnect();
  _stickyObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        const target = entry.target.nextElementSibling;
        if (target) target.classList.toggle('is-stuck', !entry.isIntersecting);
      });
    },
    { threshold: 0, rootMargin: `-52px 0px 0px 0px` }
  );
  document.querySelectorAll('.sticky-sentinel').forEach(el =>
    _stickyObserver.observe(el)
  );
}

// ─── Swipe navigation ────────────────────────────────────────────────────────
function _initSwipe(container) {
  container.addEventListener('touchstart', e => {
    if (!getState().settings.swipe) return;
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchend', e => {
    if (!getState().settings.swipe || _swipeStartX === null) return;
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dispatch(A.WEEK_NAVIGATE, { delta: dx < 0 ? 1 : -1 });
    }
    _swipeStartX = null;
    _swipeStartY = null;
  }, { passive: true });
}

// ─── Drag-and-drop ───────────────────────────────────────────────────────────
function _bindDrag(container) {
  container.addEventListener('dragstart', e => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle) return;
    const wrap = handle.closest('[data-di][data-ei]');
    if (!wrap) return;
    _dragSrc = { di: +wrap.dataset.di, ei: +wrap.dataset.ei };
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => wrap.classList.add('dragging'));
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    const wrap = e.target.closest('[data-di][data-ei]');
    if (!wrap || !_dragSrc) return;
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (+wrap.dataset.di === _dragSrc.di) wrap.classList.add('drag-over');
  });

  container.addEventListener('dragleave', e => {
    e.target.closest('[data-di][data-ei]')?.classList.remove('drag-over');
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const wrap = e.target.closest('[data-di][data-ei]');
    container.querySelectorAll('.drag-over, .dragging').forEach(el => {
      el.classList.remove('drag-over', 'dragging');
    });
    if (!wrap || !_dragSrc) return;
    const toEi = +wrap.dataset.ei;
    const di   = _dragSrc.di;
    if (+wrap.dataset.di === di && toEi !== _dragSrc.ei) {
      dispatch(A.EX_MOVE, { di, fromEi: _dragSrc.ei, toEi });
    }
    _dragSrc = null;
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.drag-over, .dragging').forEach(el => {
      el.classList.remove('drag-over', 'dragging');
    });
    _dragSrc = null;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

function renderWeekHeader(state) {
  const wk      = state.weeks[state.curIdx];
  const isDl    = wk?.mode === 'deload';
  const isFirst = state.curIdx === 0;
  const isLast  = state.curIdx === state.weeks.length - 1;

  const labelEl = document.getElementById('wk-label');
  const rangeEl = document.getElementById('wk-range');
  const prevBtn = document.getElementById('btn-prev-wk');
  const nextBtn = document.getElementById('btn-next-wk');
  const stdBtn  = document.getElementById('mode-std');
  const dlBtn   = document.getElementById('mode-dl');

  if (labelEl) {
    labelEl.textContent = wk ? wkLabel(wk.startDate) : '–';
    labelEl.className   = 'week-nav__label' + (isDl ? ' week-nav__label--deload' : '');
  }
  if (rangeEl)  rangeEl.textContent = wk ? wkRange(wk.startDate) : '';
  if (prevBtn)  prevBtn.disabled    = isFirst;
  if (nextBtn)  nextBtn.disabled    = isLast;
  if (stdBtn)   stdBtn.classList.toggle('is-active', !isDl);
  if (dlBtn)    dlBtn.classList.toggle('is-active',   isDl);
}

// ─── Day list ────────────────────────────────────────────────────────────────
function renderDayList(state) {
  const container = document.getElementById('days-container');
  if (!container) return;
  const wk = state.weeks[state.curIdx];
  if (!wk) { container.innerHTML = ''; return; }

  // Snapshot which accordions are open before wiping innerHTML
  container.querySelectorAll('.day-card').forEach(card => {
    const di   = +card.dataset.di;
    const body = card.querySelector('.day-card__body');
    if (body?.classList.contains('is-open')) _openDays.add(di);
    else _openDays.delete(di);
  });

  container.innerHTML = wk.days.map((day, di) => renderDayCard(wk, di, state)).join('');

  // Restore open accordions
  _openDays.forEach(di => {
    const body = container.querySelector(`[data-day-body="${di}"]`);
    const hdr  = container.querySelector(`[data-day-hdr="${di}"]`);
    body?.classList.add('is-open');
    hdr?.setAttribute('aria-expanded', 'true');
  });

  _initStickyObserver();
  _bindDrag(container);
}

function renderDayCard(wk, di, state) {
  const day    = wk.days[di];
  const isDl   = wk.mode === 'deload';
  const locked = !!day.locked;
  const done   = !!day.markedDone;

  const totalSets = day.exercises.reduce((s, ex) => s + ex.sets.length, 0);
  const doneSets  = day.exercises.reduce((s, ex) => s + ex.sets.filter(st => st.done).length, 0);

  const dotClass = done
    ? 'day-card__dot day-card__dot--done'
    : locked
      ? 'day-card__dot day-card__dot--locked'
      : 'day-card__dot';

  const cardClass = [
    'day-card',
    done ? 'day-card--done'   : '',
    isDl ? 'day-card--deload' : '',
  ].filter(Boolean).join(' ');

  return `
<article class="${cardClass}" data-di="${di}">
  <div class="sticky-sentinel" aria-hidden="true" style="height:1px;pointer-events:none;"></div>

  <button
    class="day-card__header"
    data-day-hdr="${di}"
    aria-expanded="false"
    aria-controls="day-body-${di}"
    id="day-hdr-${di}"
  >
    <div class="day-card__header-left">
      <div class="${dotClass}" aria-hidden="true"></div>
      <div class="day-card__title-wrap">
        <div class="day-card__title">
          ${h(day.title)}
          ${isDl ? '<span class="deload-badge">Deload</span>' : ''}
        </div>
        <div class="day-card__subtitle">${h(day.subtitle)}</div>
      </div>
    </div>
    <div class="day-card__header-right">
      <span class="day-card__pill" data-set-pill="${di}"
        aria-label="${doneSets} von ${totalSets} Sätzen erledigt">
        ${doneSets}/${totalSets}
      </span>
      <span class="day-card__chevron" aria-hidden="true">${ic.chevronDown()}</span>
    </div>
  </button>

  <div
    class="day-card__body"
    id="day-body-${di}"
    data-day-body="${di}"
    role="region"
    aria-labelledby="day-hdr-${di}"
  >
    <div class="day-card__body-inner">
      ${renderDayBody(wk, di, state)}
    </div>
  </div>
</article>`;
}

function renderDayBody(wk, di, state) {
  const day    = wk.days[di];
  const locked = !!day.locked;
  const done   = !!day.markedDone;

  let prevBanner = '';
  if (state.curIdx > 0) {
    const prevDay = state.weeks[state.curIdx - 1]?.days?.[di];
    if (prevDay) {
      const pvol = prevDay.exercises.reduce(
        (s, ex) => s + ex.sets.reduce((ss, st) => ss + st.weight * st.reps, 0), 0
      );
      prevBanner = `<div class="prev-banner" role="status">
        ${ic.barChart()}<span>Vorwoche: ${pvol} kg Gesamtvolumen</span>
      </div>`;
    }
  }

  const exHtml       = day.exercises.map((ex, ei) => renderExercise(wk, di, ei, state)).join('');
  const lockBtnLabel = done ? 'Tag entsperren' : 'Tag als abgeschlossen markieren und sperren';
  const lockBtnIcon  = done ? ic.unlock() : ic.lock();

  return `
    ${renderInfoBlock('warmup', '🔥 Aufwärmen', day.warmup, di, locked)}
    ${prevBanner}
    <div data-ex-list="${di}">${exHtml}</div>
    ${!locked ? `
    <div class="add-exercise-row">
      <input
        class="add-exercise-input"
        id="add-ex-input-${di}"
        type="text"
        placeholder="Übung hinzufügen …"
        aria-label="Name der neuen Übung"
        maxlength="80"
      />
      <button
        class="btn btn--accent btn--sm"
        data-action="add-ex" data-di="${di}"
        aria-label="Übung hinzufügen"
      >${ic.plus()}${ic.srOnly('Hinzufügen')}</button>
    </div>` : ''}
    <button
      class="complete-btn${done ? ' is-done' : ''}"
      data-action="toggle-complete" data-di="${di}"
      aria-pressed="${done}"
      aria-label="${lockBtnLabel}"
    >
      ${lockBtnIcon}
      ${done ? 'Gesperrt – Tippen zum Entsperren' : 'Abgeschlossen & sperren'}
    </button>
    ${renderInfoBlock('cooldown', '🧘 Cooldown', day.cooldown, di, locked)}
  `;
}

function renderInfoBlock(type, label, value, di, disabled) {
  return `
<div class="info-block info-block--${type}">
  <span class="info-block__label">${label}</span>
  <textarea
    rows="2"
    ${disabled ? 'disabled' : ''}
    data-action="day-field"
    data-di="${di}"
    data-field="${type === 'warmup' ? 'warmup' : 'cooldown'}"
    aria-label="${label}"
  >${h(value ?? '')}</textarea>
</div>`;
}

// ─── Exercise ─────────────────────────────────────────────────────────────────
function renderExercise(wk, di, ei, state) {
  const ex     = wk.days[di].exercises[ei];
  const locked = !!wk.days[di].locked;
  const isDl   = wk.mode === 'deload';
  const drag   = state.settings.drag && !locked;

  const prevEx = state.curIdx > 0
    ? state.weeks[state.curIdx - 1]?.days?.[di]?.exercises?.[ei] ?? null
    : null;

  const setsHtml = ex.sets.map((s, si) =>
    renderSetRow(s, si, ex, di, ei, prevEx, locked, isDl)
  ).join('');

  const pauseRow = ex._showCfg ? `
    <div class="pause-row" role="group" aria-label="Pausenzeit wählen">
      <span class="pause-row__label">Pause:</span>
      ${[30, 60, 90, 120].map(sec => `
        <button
          class="pause-opt${ex.pauseSec === sec ? ' is-selected' : ''}"
          data-action="set-pause" data-di="${di}" data-ei="${ei}" data-sec="${sec}"
          aria-pressed="${ex.pauseSec === sec}"
        >${sec}s</button>`).join('')}
    </div>` : '';

  return `
<div class="exercise" data-di="${di}" data-ei="${ei}" draggable="${drag}">
  <div class="sticky-sentinel" aria-hidden="true" style="height:1px;pointer-events:none;"></div>

    <div class="exercise__name-sticky">
    ${!locked ? `
    <div class="exercise__order-btns">
      <button class="exercise__order-btn" data-action="move-ex-up" data-di="${di}" data-ei="${ei}" aria-label="Nach oben" ${ei === 0 ? 'disabled' : ''}>▲</button>
      <button class="exercise__order-btn" data-action="move-ex-down" data-di="${di}" data-ei="${ei}" aria-label="Nach unten" ${ei === wk.days[di].exercises.length - 1 ? 'disabled' : ''}>▼</button>
    </div>` : ''}
    
    <input
      class="exercise__name-input"
      type="text"
      value="${h(ex.name)}"
      ${locked ? 'disabled' : ''}
      data-action="ex-name" data-di="${di}" data-ei="${ei}"
      aria-label="Übungsname"
      maxlength="80"
    />
    <button
      class="exercise__cfg-btn"
      data-action="toggle-cfg" data-di="${di}" data-ei="${ei}"
      aria-label="Pausenzeit einstellen"
      aria-expanded="${!!ex._showCfg}"
    >${ic.settings()}</button>
    ${!locked ? `
    <button
      class="exercise__remove-btn"
      data-action="remove-ex" data-di="${di}" data-ei="${ei}"
      aria-label="Übung '${h(ex.name)}' entfernen"
    >${ic.trash()}</button>` : ''}
  </div>

  ${pauseRow}

  ${!locked ? `
  <div class="weight-step-row" role="group" aria-label="Gewicht erhöhen">
    <button
      class="btn-inc-weight"
      data-action="inc-weight" data-di="${di}" data-ei="${ei}"
      aria-label="Gewicht um ${ex.weightStep ?? 2.5} kg erhöhen"
    >＋ ${ex.weightStep ?? 2.5} kg</button>
    <div class="weight-step-opts">
      ${[0, 1.25, 2, 2.5, 5, 7.5, 10].map(s => `
        <button
          class="weight-step-btn${(ex.weightStep ?? 2.5) === s ? ' is-selected' : ''}"
          data-action="set-step" data-di="${di}" data-ei="${ei}" data-step="${s}"
          aria-pressed="${(ex.weightStep ?? 2.5) === s}"
        >${s === 0 ? 'Reset' : s}</button>`).join('')}
    </div>
  </div>` : ''}

  <input
    class="exercise__note"
    type="text"
    value="${h(ex.note ?? '')}"
    placeholder="Notiz …"
    ${locked ? 'disabled' : ''}
    data-action="ex-note" data-di="${di}" data-ei="${ei}"
    aria-label="Notiz zu ${h(ex.name)}"
    maxlength="120"
  />

  <div class="set-header" aria-hidden="true">
    <span>#</span><span>kg</span><span>Wdh</span><span>RPE</span><span>✓</span><span></span>
  </div>

  <div data-set-list="${di}-${ei}" role="list" aria-label="Sätze von ${h(ex.name)}">
    ${setsHtml}
  </div>

  ${!locked ? `
  <button
    class="add-set-btn"
    data-action="add-set" data-di="${di}" data-ei="${ei}"
    aria-label="Satz zu '${h(ex.name)}' hinzufügen"
  >${ic.plus()}<span>Satz hinzufügen</span></button>` : ''}
</div>`;
}

// ─── Set row ─────────────────────────────────────────────────────────────────
function renderSetRow(s, si, ex, di, ei, prevEx, locked, isDl) {
  const prevSet = prevEx?.sets?.[si] ?? null;
  const dispW   = isDl ? Math.round(s.weight * 0.75 * 2) / 2 : s.weight;

  return `
<div class="set-row" role="listitem" data-di="${di}" data-ei="${ei}" data-si="${si}">

  <span class="set-idx" aria-hidden="true">${si + 1}</span>

  <div class="set-cell">
    <input class="num-input" type="number" inputmode="decimal"
      min="0" step="0.5" value="${dispW}"
      ${locked ? 'disabled' : ''}
      data-action="set-weight" data-di="${di}" data-ei="${ei}" data-si="${si}"
      aria-label="Satz ${si + 1} Gewicht in kg"
    />
    <span class="prev-hint" aria-hidden="true">${prevSet ? prevSet.weight + ' kg' : ''}</span>
  </div>

  <div class="set-cell">
    <input class="num-input" type="number" inputmode="numeric"
      min="0" value="${s.reps}"
      ${locked ? 'disabled' : ''}
      data-action="set-reps" data-di="${di}" data-ei="${ei}" data-si="${si}"
      aria-label="Satz ${si + 1} Wiederholungen"
    />
    <span class="prev-hint" aria-hidden="true">${prevSet ? prevSet.reps + '×' : ''}</span>
  </div>

  <div class="set-cell">
    <input class="rpe-input" type="number" inputmode="numeric"
      min="1" max="10" value="${s.rpe ?? ''}" placeholder="–"
      ${locked ? 'disabled' : ''}
      data-action="set-rpe" data-di="${di}" data-ei="${ei}" data-si="${si}"
      aria-label="Satz ${si + 1} RPE"
    />
    <span class="prev-hint" aria-hidden="true">${prevSet?.rpe ? 'RPE ' + prevSet.rpe : ''}</span>
  </div>

  <div class="set-done-wrap">
    <button
      class="set-done-btn${s.done ? ' is-done' : ''}"
      ${locked ? 'disabled' : ''}
      data-action="toggle-done" data-di="${di}" data-ei="${ei}" data-si="${si}"
      aria-label="Satz ${si + 1} ${s.done ? 'als nicht erledigt markieren' : 'als erledigt markieren'}"
      aria-pressed="${s.done}"
    >${s.done ? ic.check() : ''}</button>
    <span class="prev-hint" aria-hidden="true"></span>
  </div>

  <button
    class="set-remove-btn"
    ${locked ? 'disabled' : ''}
    data-action="remove-set" data-di="${di}" data-ei="${ei}" data-si="${si}"
    aria-label="Satz ${si + 1} entfernen"
  >${ic.minus()}</button>
</div>`;
}

// ─── Body tab ────────────────────────────────────────────────────────────────
function renderBodyTab(state) {
  const container = document.getElementById('body-tab-content');
  if (!container) return;
  const wk = state.weeks[state.curIdx];
  const bd = wk?.bodyData ?? {};

  const histRows = [...state.weeks]
    .slice().reverse().slice(0, 8)
    .filter(w => w.bodyData && (w.bodyData.weight || w.bodyData.energy || w.bodyData.sleep))
    .map(w => {
      const b = w.bodyData;
      return `
      <div style="background:var(--c-surface);border:1px solid var(--c-border);
        border-radius:var(--r-md);padding:var(--sp-2) var(--sp-4);margin-bottom:var(--sp-2);
        display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:13px;font-weight:600">${wkLabel(w.startDate)}</div>
          <div style="font-size:11px;color:var(--c-text-3)">${wkRange(w.startDate)}</div>
        </div>
        <div style="display:flex;gap:16px;text-align:center">
          ${b.weight ? `<div><div style="font-family:var(--font-display);font-size:18px">${b.weight}</div><div style="font-size:9px;color:var(--c-text-3)">KG</div></div>` : ''}
          ${b.sleep  ? `<div><div style="font-family:var(--font-display);font-size:18px">${b.sleep}</div><div style="font-size:9px;color:var(--c-text-3)">STD</div></div>` : ''}
          ${b.energy ? `<div><div style="font-family:var(--font-display);font-size:18px;color:var(--c-accent)">${b.energy}/5</div><div style="font-size:9px;color:var(--c-text-3)">ENERGIE</div></div>` : ''}
        </div>
      </div>`;
    }).join('');

  const scale = (field, label) => {
    const cur = bd[field];
    return `
    <div class="body-field" style="margin-bottom:var(--sp-3)">
      <label>${label} (1–5)</label>
      <div class="scale-row" role="group" aria-label="${label}">
        ${[1,2,3,4,5].map(n => {
          const isSel = cur === n;
          const mod   = n <= 2 ? ' is-low' : n === 3 ? ' is-mid' : '';
          return `<button
            class="scale-btn${isSel ? ' is-selected' + mod : ''}"
            data-action="body-scale" data-field="${field}" data-val="${n}"
            aria-pressed="${isSel}"
            aria-label="${label}: ${n}"
          >${n}</button>`;
        }).join('')}
      </div>
    </div>`;
  };

  container.innerHTML = `
  <div class="body-section">
    <button class="body-section__header" aria-expanded="true"
      onclick="this.setAttribute('aria-expanded',
        this.getAttribute('aria-expanded')==='true'?'false':'true');
        this.nextElementSibling.classList.toggle('is-open')">
      <span class="body-section__title">${wk ? wkLabel(wk.startDate) : '–'}</span>
      <span aria-hidden="true">${ic.chevronDown()}</span>
    </button>
    <div class="body-section__body is-open">
      <div class="body-section__body-inner">
        <div class="body-grid">
          <div class="body-field">
            <label for="body-weight">Körpergewicht (kg)</label>
            <input id="body-weight" class="body-input" type="number" step="0.1"
              value="${bd.weight ?? ''}" placeholder="78.5"
              data-action="body-field" data-field="weight"
              aria-label="Körpergewicht in kg"
            />
          </div>
          <div class="body-field">
            <label for="body-sleep">Schlaf (Std)</label>
            <input id="body-sleep" class="body-input" type="number" step="0.5"
              value="${bd.sleep ?? ''}" placeholder="7.5"
              data-action="body-field" data-field="sleep"
              aria-label="Schlafdauer in Stunden"
            />
          </div>
        </div>
        ${scale('energy',   'Energielevel')}
        ${scale('wellbeing','Wohlbefinden')}
        <div class="body-field">
          <label for="body-note">Notiz</label>
          <input id="body-note" class="body-input" type="text"
            value="${h(bd.note ?? '')}" placeholder="z. B. leichte Verspannung …"
            data-action="body-field" data-field="note"
            aria-label="Notiz zur Woche"
          />
        </div>
      </div>
    </div>
  </div>
  ${histRows ? `
  <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--c-text-3);margin-bottom:8px">Verlauf</div>
  ${histRows}` : ''}`;
}

// ─── Analysis tab ─────────────────────────────────────────────────────────────
function renderAnalysisTab(state) {
  const container = document.getElementById('analysis-tab-content');
  if (!container) return;

  const streak = _calcStreak(state);
  const sorted = [...state.weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const last8  = sorted.slice(-8);
  const vols   = last8.map(w =>
    w.days.reduce((s, d) =>
      s + d.exercises.reduce((ss, ex) =>
        ss + ex.sets.reduce((sss, st) => sss + st.weight * st.reps, 0), 0), 0)
  );
  const wkLabels = last8.map(w => wkLabel(w.startDate).split('·')[0].trim());

  const allExNames = [...new Set(
    state.weeks.flatMap(w => w.days.flatMap(d => d.exercises.map(e => e.name)))
  )].sort();

  const weekCards = [...sorted].reverse().map((wk, wi, arr) => {
    const tot  = wk.days.reduce((s, d) => s + d.exercises.reduce((ss, ex) => ss + ex.sets.length, 0), 0);
    const don  = wk.days.reduce((s, d) => s + d.exercises.reduce((ss, ex) => ss + ex.sets.filter(st => st.done).length, 0), 0);
    const vol  = wk.days.reduce((s, d) => s + d.exercises.reduce((ss, ex) => ss + ex.sets.reduce((sss, st) => sss + st.weight * st.reps, 0), 0), 0);
    const pct  = tot > 0 ? Math.round(don / tot * 100) : 0;
    const dd   = wk.days.filter(d => !!d.markedDone).length;
    const isDl = wk.mode === 'deload';
    const prev = arr[wi + 1];
    let vd = '';
    if (prev) {
      const pv = prev.days.reduce((s, d) => s + d.exercises.reduce((ss, ex) => ss + ex.sets.reduce((sss, st) => sss + st.weight * st.reps, 0), 0), 0);
      if (pv > 0) {
        const df = Math.round((vol - pv) / pv * 100);
        vd = df > 0
          ? `<span class="diff-up"> ↑${df}%</span>`
          : df < 0 ? `<span class="diff-dn"> ↓${Math.abs(df)}%</span>` : '';
      }
    }
    const avgDur = wk.sessionLog?.length
      ? Math.round(wk.sessionLog.reduce((s, l) => s + l.duration, 0) / wk.sessionLog.length / 60)
      : null;

    return `
    <div class="pw-card${isDl ? ' pw-card--deload' : ''}">
      <div class="pw-card__top">
        <div>
          <div class="pw-card__title">
            ${wkLabel(wk.startDate)}
            ${isDl ? '<span class="deload-badge">Deload</span>' : ''}
          </div>
          <div class="pw-card__date">${wkRange(wk.startDate)}${wk.note ? ' · ' + h(wk.note) : ''}</div>
        </div>
        <div class="pw-card__pct" style="color:${pct===100?'var(--c-ok)':'var(--c-text)'}">${pct}%</div>
      </div>
      <div class="pw-card__stats">
        <div><div class="pw-stat__num" style="color:${isDl?'var(--c-deload)':'var(--c-accent)'}">${dd}/3</div><div class="pw-stat__lbl">Tage</div></div>
        <div><div class="pw-stat__num">${don}</div><div class="pw-stat__lbl">Sätze</div></div>
        <div><div class="pw-stat__num">${vol >= 1000 ? (vol/1000).toFixed(1)+'t' : vol+'kg'}</div><div class="pw-stat__lbl">Volumen${vd}</div></div>
        ${avgDur ? `<div><div class="pw-stat__num">${avgDur}'</div><div class="pw-stat__lbl">Ø Dauer</div></div>` : ''}
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  container.innerHTML = `
  <div class="streak-row">
    <div class="streak-card"><div class="streak-num">${streak.cur}</div><div class="streak-lbl">Streak</div></div>
    <div class="streak-card"><div class="streak-num">${streak.best}</div><div class="streak-lbl">Best</div></div>
    <div class="streak-card"><div class="streak-num">${state.weeks.length}</div><div class="streak-lbl">Wochen</div></div>
  </div>

  <div class="chart-card">
    <div class="chart-card__title">Volumen-Verlauf</div>
    <div class="chart-wrap"><canvas id="chart-vol" aria-label="Volumen-Verlauf Diagramm" role="img"></canvas></div>
  </div>

  <div class="chart-card">
    <div class="chart-card__title">Gewichtsprogression</div>
    <select class="chart-select" id="chart-ex-select" aria-label="Übung für Progressionskurve wählen">
      ${allExNames.map(n => `<option value="${h(n)}">${h(n)}</option>`).join('')}
    </select>
    <div class="chart-wrap"><canvas id="chart-ex" aria-label="Gewichtsprogression Diagramm" role="img"></canvas></div>
  </div>

  <div class="chart-card">
    <div class="chart-card__title">Trainings-Heatmap</div>
    <p style="font-size:11px;color:var(--c-text-3);margin-bottom:6px">Letzte 12 Wochen</p>
    <div class="heatmap" id="heatmap" role="grid" aria-label="Trainings-Heatmap"></div>
    <div style="display:flex;gap:8px;margin-top:8px;align-items:center;font-size:10px;color:var(--c-text-3)">
      <div class="hm-cell" style="width:12px;height:12px" aria-hidden="true"></div><span>0</span>
      <div class="hm-cell hm-cell--1" style="width:12px;height:12px" aria-hidden="true"></div><span>1</span>
      <div class="hm-cell hm-cell--2" style="width:12px;height:12px" aria-hidden="true"></div><span>2</span>
      <div class="hm-cell hm-cell--3" style="width:12px;height:12px" aria-hidden="true"></div><span>3 Tage</span>
    </div>
  </div>

  ${weekCards}`;

  requestAnimationFrame(() => {
    drawLineChart('chart-vol', wkLabels, vols, '#C8FF00');
    _updateExChart(state);
    _drawHeatmap(state);
    document.getElementById('chart-ex-select')?.addEventListener('change', () => {
      _updateExChart(getState());
    });
  });
}

function _calcStreak(state) {
  const sorted = [...state.weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let cur = 0, best = 0, tmp = 0;
  sorted.forEach(w => {
    const done = w.days.some(d => !!d.markedDone);
    if (done) { tmp++; best = Math.max(best, tmp); }
    else tmp = 0;
  });
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].days.some(d => !!d.markedDone)) cur++;
    else break;
  }
  return { cur, best };
}

function _updateExChart(state) {
  const sel = document.getElementById('chart-ex-select');
  if (!sel) return;
  const name = sel.value;
  const labels = [], data = [];
  [...state.weeks]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .forEach(wk => {
      wk.days.forEach(d => {
        d.exercises.forEach(ex => {
          if (ex.name === name && ex.sets.length) {
            labels.push(wkLabel(wk.startDate).split('·')[0].trim());
            data.push(Math.max(0, ...ex.sets.map(s => s.weight)));
          }
        });
      });
    });
  drawLineChart('chart-ex', labels, data, '#4FC3F7');
}

function _drawHeatmap(state) {
  const hm = document.getElementById('heatmap');
  if (!hm) return;
  hm.innerHTML = '';
  [...state.weeks]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-12)
    .forEach(wk => {
      const done = wk.days.filter(d => !!d.markedDone).length;
      const cell = document.createElement('div');
      cell.className = 'hm-cell' + (done === 0 ? '' : ` hm-cell--${Math.min(done, 3)}`);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${wkLabel(wk.startDate)}: ${done}/3 Tage`);
      cell.title = `${wkLabel(wk.startDate)}: ${done}/3 Tage`;
      hm.appendChild(cell);
    });
}

function drawLineChart(id, labels, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 300, H = 120;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  if (!data.length || data.every(v => v === 0)) return;

  const max = Math.max(...data, 1);
  const pad = { l: 10, r: 10, t: 10, b: 20 };
  const gw  = W - pad.l - pad.r;
  const gh  = H - pad.t - pad.b;
  const x   = i => pad.l + i * (gw / (data.length - 1 || 1));
  const y   = v => pad.t + gh - (v / max) * gh;

  ctx.strokeStyle = '#2E2E35'; ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(f => {
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + gh * (1 - f));
    ctx.lineTo(pad.l + gw, pad.t + gh * (1 - f));
    ctx.stroke();
  });

  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(data.length - 1), pad.t + gh);
  ctx.lineTo(pad.l, pad.t + gh);
  ctx.closePath();
  ctx.fillStyle = color === '#C8FF00' ? 'rgba(200,255,0,.08)' : 'rgba(79,195,247,.08)';
  ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  data.forEach((v, i) => i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)));
  ctx.stroke();

  data.forEach((v, i) => {
    ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#666'; ctx.font = '9px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x(i), H - 3);
    if (v > 0) {
      ctx.fillStyle = '#F0F0F0'; ctx.font = '10px DM Sans';
      ctx.fillText(v >= 1000 ? (v/1000).toFixed(1)+'t' : v+'kg', x(i), y(v) - 5);
    }
  });
}

// ─── Settings tab ─────────────────────────────────────────────────────────────
function renderSettingsTab(state) {
  const container = document.getElementById('settings-tab-content');
  if (!container) return;

  const tog = (key, label, desc) => `
  <div class="settings-row">
    <div><div class="settings-row__label">${label}</div><div class="settings-row__desc">${desc}</div></div>
    <button
      class="toggle${state.settings[key] ? ' is-on' : ''}"
      data-action="toggle-setting" data-key="${key}"
      role="switch" aria-checked="${state.settings[key]}"
      aria-label="${label}"
    ></button>
  </div>`;

  container.innerHTML = `
  <div class="settings-section">
    ${tog('swipe', 'Swipe-Navigation', 'Wischen zum Wochenwechsel')}
    ${tog('drag',  'Drag & Drop',       'Übungen per Griff verschieben')}
  </div>

  <div class="settings-section">
    <div class="settings-row settings-row--clickable" data-action="open-tpl">
      <div>
        <div class="settings-row__label">📋 Template bearbeiten</div>
        <div class="settings-row__desc">Vorlage für neue Wochen anpassen</div>
      </div>
      <div class="settings-row__action">${ic.chevronRight()}</div>
    </div>
    <div class="settings-row settings-row--clickable" data-action="reset-to-tpl">
      <div>
        <div class="settings-row__label">🔄 Woche zurücksetzen</div>
        <div class="settings-row__desc">Aktuelle Woche mit Custom-Template überschreiben</div>
      </div>
      <div class="settings-row__action">${ic.chevronRight()}</div>
    </div>
    <div class="settings-row settings-row--clickable" data-action="reset-factory">
      <div>
        <div class="settings-row__label" style="color:var(--c-danger)">↺ Original wiederherstellen</div>
        <div class="settings-row__desc">Custom-Template auf Werkseinstellung zurücksetzen</div>
      </div>
      <div class="settings-row__action">${ic.chevronRight()}</div>
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-row settings-row--clickable" data-action="export-json">
      <div>
        <div class="settings-row__label">${ic.download()} Daten exportieren (JSON)</div>
        <div class="settings-row__desc">Sicherungskopie aller Trainingsdaten</div>
      </div>
      <div class="settings-row__action">${ic.chevronRight()}</div>
    </div>
    <label class="settings-row settings-row--clickable">
      <div>
        <div class="settings-row__label">${ic.upload()} Daten importieren (JSON)</div>
        <div class="settings-row__desc">Backup wiederherstellen</div>
      </div>
      <div class="settings-row__action">${ic.chevronRight()}</div>
      <input type="file" accept=".json" class="sr-only" data-action="import-json" aria-label="JSON-Datei wählen"/>
    </label>
  </div>

  <div class="settings-section">
    <div class="settings-row">
      <div><div class="settings-row__label">Version</div><div class="settings-row__desc">TRAIN v6.0</div></div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Zuletzt gespeichert</div>
        <div class="settings-row__desc">${state.meta.savedAt ? new Date(state.meta.savedAt).toLocaleString('de-DE') : '–'}</div>
      </div>
    </div>
  </div>`;
}

// ─── Template editor ──────────────────────────────────────────────────────────
function renderTemplateEditor(state) {
  const container = document.getElementById('tpl-editor-body');
  if (!container) return;

  container.innerHTML = state.customTemplate.map((day, di) => `
  <div class="tpl-day-section">
    <div class="tpl-day-title">${h(day.title)} — ${h(day.subtitle)}</div>
    ${day.exercises.map((ex, ei) => `
    <div class="tpl-exercise">
      <div class="tpl-ex-top">
        <input class="tpl-name-input" type="text" value="${h(ex.name)}"
          data-tpl-di="${di}" data-tpl-ei="${ei}" data-tpl-field="name"
          aria-label="Übungsname" maxlength="80"
        />
        <button class="exercise__remove-btn" data-tpl-action="rm-ex"
          data-tpl-di="${di}" data-tpl-ei="${ei}"
          aria-label="Übung aus Template entfernen"
        >${ic.trash()}</button>
      </div>
      <input class="tpl-note-input" type="text" value="${h(ex.note ?? '')}"
        placeholder="Notiz …"
        data-tpl-di="${di}" data-tpl-ei="${ei}" data-tpl-field="note"
        aria-label="Notiz"
      />
      <div class="tpl-sets-row">
        <span>Sätze:</span>
        <input class="tpl-num" type="number" min="1" max="8" value="${ex.sets.length}"
          data-tpl-di="${di}" data-tpl-ei="${ei}" data-tpl-field="setsCount"
          aria-label="Anzahl Sätze"
        />
        <span>Wdh:</span>
        <input class="tpl-num" type="number" min="1" value="${ex.sets[0]?.reps ?? 10}"
          data-tpl-di="${di}" data-tpl-ei="${ei}" data-tpl-field="reps"
          aria-label="Standard-Wiederholungen"
        />
        <span>kg:</span>
        <input class="tpl-num" type="number" min="0" step="0.5" value="${ex.sets[0]?.weight ?? 0}"
          data-tpl-di="${di}" data-tpl-ei="${ei}" data-tpl-field="weight"
          aria-label="Standard-Gewicht"
        />
      </div>
    </div>`).join('')}
    <button class="btn btn--ghost btn--sm" data-tpl-action="add-ex" data-tpl-di="${di}"
      style="margin-top:4px" aria-label="Übung hinzufügen">
      ${ic.plus()} Übung hinzufügen
    </button>
  </div>`).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT DELEGATION  ← FIXED: single clean function, closest() everywhere
// ════════════════════════════════════════════════════════════════════════════

function _bindEvents(root) {
  root.addEventListener('click',   _handleClick);
  root.addEventListener('change',  _handleChange);
  root.addEventListener('input',   _handleInput);
  root.addEventListener('keydown', _handleKeydown);
}

/**
 * Single click handler for the entire app.
 *
 * Every branch uses e.target.closest() to walk up the DOM from the actual
 * clicked element to the intended target.  This means clicking on a child
 * element (SVG icon, span, pill, subtitle div) works exactly the same as
 * clicking the parent button/div.
 *
 * Order of precedence (most-specific first):
 *   1. Inputs / textareas inside day-card__header  → absorbed, do nothing
 *   2. Day-card header (accordion toggle)          → uses closest('.day-card__header')
 *   3. Elements with [data-action]                 → uses closest('[data-action]')
 *   4. Template editor actions [data-tpl-action]   → uses closest('[data-tpl-action]')
 */
function _handleClick(e) {

  // ── 1. Day accordion header ──────────────────────────────────────────────
  // Must be checked BEFORE [data-action] because the header is a <button>
  // with no data-action, and its children (pill, chevron, title divs) have
  // no data-action either.
  const hdr = e.target.closest('.day-card__header');
  if (hdr) {
    // If the click landed on an interactive child (input, button with
    // data-action) that is INSIDE the header, let that propagate instead.
    // In practice the header has no inputs, but be defensive.
    if (e.target.closest('[data-action]') && !e.target.closest('[data-action]').isSameNode(hdr)) {
      // fall through to data-action handling below
    } else {
      const di = hdr.dataset.dayHdr;
      if (di !== undefined) _toggleAccordion(+di);
      return;
    }
  }

  // ── 2. Elements with [data-action] ──────────────────────────────────────
  const el = e.target.closest('[data-action]');
  if (!el) {
    // ── 3. Template editor actions ─────────────────────────────────────────
    const tplEl = e.target.closest('[data-tpl-action]');
    if (tplEl) _handleTplAction(tplEl);
    return;
  }

  const action             = el.dataset.action;
  const { di, ei, si, field, key, val, sec } = el.dataset;

  switch (action) {

    // ── Week navigation ────────────────────────────────────────────────────
    case 'nav-prev':
      dispatch(A.WEEK_NAVIGATE, { delta: -1 }); break;

    case 'nav-next':
      dispatch(A.WEEK_NAVIGATE, { delta: 1 }); break;

    case 'mode-std':
      dispatch(A.WEEK_SET_MODE, { mode: 'standard' }); break;

    case 'mode-dl':
      dispatch(A.WEEK_SET_MODE, { mode: 'deload' }); break;

    case 'open-new-week':
      _prepNewWeekModal();
      openModal('modal-new-week'); break;

    case 'copy-prev':
      dispatch(A.WEEK_COPY_PREV, {});
      showToast('Vorwoche übernommen ✓', 'ok'); break;

    case 'open-export':
      openModal('modal-export'); break;

    case 'open-delete-week':
      openModal('modal-delete-week'); break;

    case 'create-week':
      _createWeek(); break;

    case 'confirm-delete-week':
      dispatch(A.WEEK_DELETE, {});
      closeModal('modal-delete-week');
      showToast('Woche gelöscht', 'info'); break;

    // ── Export options (previously role=button without data-action) ────────
    case 'export-current':
      exportCSV('current');
      closeModal('modal-export');
      showToast('CSV wird heruntergeladen …', 'ok'); break;

    case 'export-all':
      exportCSV('all');
      closeModal('modal-export');
      showToast('CSV wird heruntergeladen …', 'ok'); break;

    // ── Day ────────────────────────────────────────────────────────────────
    case 'toggle-complete': {
      dispatch(A.DAY_TOGGLE_COMPLETE, { di: +di });
      // Read updated state to get new locked value
      const day = getState().weeks[getState().curIdx]?.days[+di];
      showToast(day?.markedDone ? 'Tag gesperrt 🔒' : 'Tag entsperrt 🔓', 'info');
      break;
    }

    case 'add-ex': {
      const inp  = document.getElementById(`add-ex-input-${di}`);
      const name = inp?.value.trim();
      if (!name) { inp?.focus(); break; }
      dispatch(A.EX_ADD, { di: +di, name });
      if (inp) inp.value = '';
      showToast(`"${name}" hinzugefügt`, 'ok');
      break;
    }

    // ── Exercise ───────────────────────────────────────────────────────────
    case 'toggle-cfg':
      dispatch(A.EX_TOGGLE_CFG, { di: +di, ei: +ei }); break;

    case 'set-pause':
      dispatch(A.EX_UPDATE, { di: +di, ei: +ei, field: 'pauseSec', value: +sec }); break;

    case 'remove-ex':
      if (confirm('Übung entfernen?')) {
        dispatch(A.EX_REMOVE, { di: +di, ei: +ei });
      }
      break;

        case 'move-ex-up': {
      const toEi = +ei - 1;
      if (toEi >= 0) {
        dispatch(A.EX_MOVE, { di: +di, fromEi: +ei, toEi });
        // Wartet kurz das Neuladen ab und scrollt den Pfeil dann in die Mitte
        setTimeout(() => {
          const newBtn = document.querySelector(`[data-action="move-ex-up"][data-di="${di}"][data-ei="${toEi}"]`);
          if (newBtn) newBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
      break;
    }
      
    case 'inc-weight': {
      dispatch(A.EX_INC_WEIGHT, { di: +di, ei: +ei });
      const ex = getState().weeks[getState().curIdx].days[di].exercises[ei];
      
      if (ex.nextWeekPlan === 0) {
        showToast(`Planung für nächste Woche zurückgesetzt`, 'ok');
      } else {
        showToast(`+${ex.nextWeekPlan} kg für nächste Woche geplant!`, 'ok');
      }
      break;
    }

    case 'set-step': {
      const step = parseFloat(el.dataset.step);
      dispatch(A.EX_SET_STEP, { di: +di, ei: +ei, step });
      break;
    }
      
    case 'move-ex-down': {
      const maxEi = getState().weeks[getState().curIdx].days[+di].exercises.length - 1;
      const toEi = +ei + 1;
      if (toEi <= maxEi) {
        dispatch(A.EX_MOVE, { di: +di, fromEi: +ei, toEi });
        // Wartet kurz das Neuladen ab und scrollt den Pfeil dann in die Mitte
        setTimeout(() => {
          const newBtn = document.querySelector(`[data-action="move-ex-down"][data-di="${di}"][data-ei="${toEi}"]`);
          if (newBtn) newBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
      break;
    }
      
      

    // ── Set ────────────────────────────────────────────────────────────────
    case 'toggle-done':
      dispatch(A.SET_TOGGLE_DONE, { di: +di, ei: +ei, si: +si }); break;

    case 'remove-set':
      dispatch(A.SET_REMOVE, { di: +di, ei: +ei, si: +si }); break;

    case 'add-set':
      dispatch(A.SET_ADD, { di: +di, ei: +ei }); break;

    // ── Body scale buttons ─────────────────────────────────────────────────
    case 'body-scale':
      dispatch(A.BODY_SET_FIELD, { field, value: +val }); break;

    // ── Settings rows (previously role=button, now data-action on the div) ─
    case 'toggle-setting':
      dispatch(A.SETTING_TOGGLE, { key }); break;

    case 'open-tpl':
      renderTemplateEditor(getState());
      openModal('modal-template'); break;

    case 'reset-to-tpl':
      if (confirm('Aktuelle Woche mit Custom-Template überschreiben?')) {
        dispatch(A.WEEK_RESET_TO_TPL, {});
        showToast('Woche zurückgesetzt ✓', 'ok');
      }
      break;

    case 'reset-factory':
      if (confirm('Custom-Template auf Werkseinstellung zurücksetzen?')) {
        dispatch(A.TPL_RESET_TO_FACTORY, {});
        showToast('Original-Template wiederhergestellt ✓', 'ok');
      }
      break;

    case 'export-json':
      exportJSON();
      showToast('JSON-Backup wird heruntergeladen …', 'ok'); break;

    case 'save-tpl':
      _saveTemplate(); break;

    // ── Modal close ────────────────────────────────────────────────────────
    case 'close-modal': {
      const modalId = el.closest('.modal-overlay')?.id;
      if (modalId) closeModal(modalId);
      break;
    }

    // ── Import JSON (file input change bubbles as click on label) ──────────
    // Handled in _handleChange; nothing to do on click.
    case 'import-json': break;

    default:
      // Unknown action – ignore silently
      break;
  }

  // Template editor actions (can coexist with data-action on same element)
  const tplEl = e.target.closest('[data-tpl-action]');
  if (tplEl) _handleTplAction(tplEl);
}

function _handleChange(e) {
  const el     = e.target;
  const action = el.dataset.action;
  const { di, ei, si, field } = el.dataset;

  // Hier wird jetzt ALLES gespeichert, aber erst wenn das Tippen beendet ist ("change")
  switch (action) {
    case 'ex-name':
      dispatch(A.EX_UPDATE, { di: +di, ei: +ei, field: 'name', value: el.value }); break;
    case 'ex-note':
      dispatch(A.EX_UPDATE, { di: +di, ei: +ei, field: 'note', value: el.value }); break;
    case 'day-field':
      dispatch(A.DAY_SET_FIELD, { di: +di, field, value: el.value }); break;
    case 'set-weight':
      dispatch(A.SET_UPDATE, { di: +di, ei: +ei, si: +si, field: 'weight', value: el.value }); break;
    case 'set-reps':
      dispatch(A.SET_UPDATE, { di: +di, ei: +ei, si: +si, field: 'reps',   value: el.value }); break;
    case 'set-rpe':
      dispatch(A.SET_UPDATE, { di: +di, ei: +ei, si: +si, field: 'rpe',    value: el.value }); break;
    case 'body-field':
      dispatch(A.BODY_SET_FIELD, {
        field,
        value: el.type === 'text' || isNaN(+el.value) ? el.value : +el.value,
      }); break;
    case 'import-json': {
      const file = el.files?.[0];
      if (!file) break;
      importJSON(file)
        .then(() => showToast('Backup importiert ✓', 'ok'))
        .catch(err => showToast(`Fehler: ${err.message}`, 'warn'));
      el.value = '';
      break;
    }
  }
}

function _handleInput(e) {
  // Absichtlich komplett leer gelassen! 
  // Das verhindert, dass bei jedem einzelnen Tastendruck das Layout neu lädt 
  // und dir die Tastatur vor der Nase zuschlägt.
}


function _handleKeydown(e) {
  if (e.key === 'Enter') {
    const inp = e.target;
    if (inp.classList.contains('add-exercise-input')) {
      const diVal = inp.closest('[data-di]')?.dataset.di;
      const name  = inp.value.trim();
      if (diVal !== undefined && name) {
        dispatch(A.EX_ADD, { di: +diVal, name });
        inp.value = '';
        showToast(`"${name}" hinzugefügt`, 'ok');
      }
    }
  }
  // Keyboard activation for elements with role="button" that aren't <button>
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute('role') === 'button') {
    e.preventDefault();
    e.target.click();
  }
}

// ─── Accordion toggle ─────────────────────────────────────────────────────────
function _toggleAccordion(di) {
  const body = document.querySelector(`[data-day-body="${di}"]`);
  const hdr  = document.querySelector(`[data-day-hdr="${di}"]`);
  if (!body || !hdr) return;
  const isOpen = body.classList.toggle('is-open');
  hdr.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) _openDays.add(di);
  else _openDays.delete(di);
}

// ─── New week modal ───────────────────────────────────────────────────────────
function _prepNewWeekModal() {
  const dateInput = document.getElementById('new-week-date');
  if (dateInput) dateInput.value = nextMonday();
  const noteInput = document.getElementById('new-week-note');
  if (noteInput) noteInput.value = '';
}

function _createWeek() {
  const date = document.getElementById('new-week-date')?.value;
  const note = document.getElementById('new-week-note')?.value ?? '';
  if (!date) { showToast('Bitte Datum wählen', 'warn'); return; }
  dispatch(A.WEEK_CREATE, { startDate: date, note });
  closeModal('modal-new-week');
  showToast('Neue Woche erstellt ✓', 'ok');
}

// ─── Template save ────────────────────────────────────────────────────────────
function _saveTemplate() {
  const tpl = JSON.parse(JSON.stringify(getState().customTemplate));

  document.querySelectorAll('[data-tpl-di][data-tpl-field]').forEach(inp => {
    const di    = +inp.dataset.tplDi;
    const ei    = +inp.dataset.tplEi;
    const field = inp.dataset.tplField;
    const ex    = tpl[di]?.exercises[ei];
    if (!ex) return;

    if      (field === 'name')      ex.name = inp.value;
    else if (field === 'note')      ex.note = inp.value;
    else if (field === 'setsCount') {
      const n = Math.max(1, Math.min(8, +inp.value || 1));
      while (ex.sets.length < n)
        ex.sets.push({ weight: ex.sets[0]?.weight ?? 0, reps: ex.sets[0]?.reps ?? 10, rpe: null, done: false });
      if (ex.sets.length > n) ex.sets = ex.sets.slice(0, n);
    }
    else if (field === 'reps')   ex.sets.forEach(s => s.reps   = +inp.value || 10);
    else if (field === 'weight') ex.sets.forEach(s => s.weight = +inp.value || 0);
  });

  dispatch(A.TPL_SAVE, { template: tpl });
  closeModal('modal-template');
  showToast('Template gespeichert ✓', 'ok');
}

function _handleTplAction(el) {
  const action = el.dataset.tplAction;
  const di     = +el.dataset.tplDi;
  const ei     = el.dataset.tplEi !== undefined ? +el.dataset.tplEi : null;
  const tpl    = JSON.parse(JSON.stringify(getState().customTemplate));

  if (action === 'rm-ex' && ei !== null) {
    tpl[di].exercises.splice(ei, 1);
    dispatch(A.TPL_SAVE, { template: tpl });
    renderTemplateEditor(getState());
  } else if (action === 'add-ex') {
    tpl[di].exercises.push({
      name: 'Neue Übung', note: '', pauseSec: 90,
      sets: [{ weight: 0, reps: 10, rpe: null, done: false }],
    });
    dispatch(A.TPL_SAVE, { template: tpl });
    renderTemplateEditor(getState());
  }
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function _bindTabSwitcher() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      _activeTab = tab;

      document.querySelectorAll('[data-tab]').forEach(b =>
        b.classList.toggle('is-active', b.dataset.tab === tab)
      );
      document.querySelectorAll('[data-tab]').forEach(b =>
        b.setAttribute('aria-selected', b.dataset.tab === tab)
      );
      document.querySelectorAll('.page').forEach(p =>
        p.classList.toggle('is-active', p.id === `page-${tab}`)
      );

      const state = getState();
      if (tab === 'body')     renderBodyTab(state);
      if (tab === 'analysis') renderAnalysisTab(state);
      if (tab === 'settings') renderSettingsTab(state);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FULL RENDER (called by subscriber on every state change)
// ════════════════════════════════════════════════════════════════════════════

let _renderScheduled = false;

function scheduleRender() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    const state = getState();
    renderWeekHeader(state);
    renderDayList(state);
    if (_activeTab === 'body')     renderBodyTab(state);
    if (_activeTab === 'analysis') renderAnalysisTab(state);
    if (_activeTab === 'settings') renderSettingsTab(state);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// DOM SCAFFOLD (built once in mountApp)
// ════════════════════════════════════════════════════════════════════════════

function _buildScaffold(root) {
  root.innerHTML = `
<nav class="nav" role="navigation" aria-label="Hauptnavigation">
  <span class="nav__logo" aria-hidden="true">TRAIN</span>
  <div class="nav__tabs" role="tablist" aria-label="App-Bereiche">
    <button class="nav__tab is-active" role="tab" data-tab="workout"
      aria-selected="true" aria-controls="page-workout">
      ${ic.dumbbell()}<span class="sr-only">Training</span><span aria-hidden="true">Training</span>
    </button>
    <button class="nav__tab" role="tab" data-tab="body"
      aria-selected="false" aria-controls="page-body">
      ${ic.person()}<span class="sr-only">Körper</span><span aria-hidden="true">Körper</span>
    </button>
    <button class="nav__tab" role="tab" data-tab="analysis"
      aria-selected="false" aria-controls="page-analysis">
      ${ic.barChart()}<span class="sr-only">Analyse</span><span aria-hidden="true">Analyse</span>
    </button>
    <button class="nav__tab" role="tab" data-tab="settings"
      aria-selected="false" aria-controls="page-settings">
      ${ic.settings()}<span class="sr-only">Einstellungen</span>
    </button>
  </div>
</nav>

<main id="page-workout" class="page is-active" role="tabpanel" aria-label="Training">
  <div class="week-nav" aria-label="Wochennavigation">
    <button class="week-nav__btn" id="btn-prev-wk" data-action="nav-prev"
      aria-label="Vorherige Woche">${ic.chevronLeft()}</button>
    <div class="week-nav__info" aria-live="polite">
      <div id="wk-label" class="week-nav__label">–</div>
      <div id="wk-range" class="week-nav__range"></div>
    </div>
    <button class="week-nav__btn" id="btn-next-wk" data-action="nav-next"
      aria-label="Nächste Woche">${ic.chevronRight()}</button>
  </div>

  <div class="toolbar" role="toolbar" aria-label="Wochenaktionen">
    <div class="mode-pill" role="group" aria-label="Trainingsmodus">
      <button class="mode-pill__btn mode-pill__btn--std is-active"
        id="mode-std" data-action="mode-std" aria-pressed="true">Standard</button>
      <button class="mode-pill__btn mode-pill__btn--dl"
        id="mode-dl" data-action="mode-dl" aria-pressed="false">
        ${ic.zap()}&thinsp;Deload</button>
    </div>
    <span class="toolbar__spacer"></span>
    <button class="toolbar__btn toolbar__btn--accent" data-action="open-new-week"
      aria-label="Neue Trainingswoche erstellen">${ic.plus()}</button>
    <button class="toolbar__btn" data-action="copy-prev"
      aria-label="Vorwoche als Vorlage kopieren">${ic.copy()}</button>
    <button class="toolbar__btn" data-action="open-export"
      aria-label="Trainingsdaten exportieren">${ic.download()}</button>
    <button class="toolbar__btn toolbar__btn--danger" data-action="open-delete-week"
      aria-label="Aktuelle Woche löschen">${ic.trash()}</button>
  </div>

  <div id="days-container" aria-label="Trainingstage"></div>
</main>

<section id="page-body" class="page" role="tabpanel" aria-label="Körper und Wohlbefinden">
  <h1 class="page-title">Körper</h1>
  <p class="page-subtitle">Optional · Fließt in CSV-Analyse ein</p>
  <div id="body-tab-content"></div>
</section>

<section id="page-analysis" class="page" role="tabpanel" aria-label="Fortschrittsanalyse">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4)">
    <div>
      <h1 class="page-title">Analyse</h1>
      <p class="page-subtitle">Fortschritt & Statistiken</p>
    </div>
    <button class="btn btn--accent btn--sm" data-action="open-export"
      aria-label="Daten exportieren">${ic.download()} Export</button>
  </div>
  <div id="analysis-tab-content"></div>
</section>

<section id="page-settings" class="page" role="tabpanel" aria-label="Einstellungen">
  <h1 class="page-title">Einstellungen</h1>
  <div id="settings-tab-content"></div>
</section>

<!-- Modal: Neue Woche -->
<div class="modal-overlay" id="modal-new-week" role="dialog"
  aria-modal="true" aria-labelledby="modal-nw-title">
  <div class="modal">
    <h2 class="modal__title" id="modal-nw-title">Neue Woche</h2>
    <div class="form-group">
      <label class="form-label" for="new-week-date">Wochenstart (Montag)</label>
      <input type="date" class="form-input" id="new-week-date" aria-required="true"/>
    </div>
    <div class="form-group">
      <label class="form-label" for="new-week-note">Notiz</label>
      <input type="text" class="form-input" id="new-week-note"
        placeholder="z. B. Deload, Urlaub …" maxlength="80"/>
    </div>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-action="close-modal">Abbrechen</button>
      <button class="btn btn--accent" data-action="create-week">
        ${ic.plus()} Erstellen</button>
    </div>
  </div>
</div>

<!-- Modal: Woche löschen -->
<div class="modal-overlay" id="modal-delete-week" role="dialog"
  aria-modal="true" aria-labelledby="modal-dw-title">
  <div class="modal">
    <h2 class="modal__title" id="modal-dw-title">Woche löschen?</h2>
    <p style="color:var(--c-text-2);font-size:14px;margin-bottom:var(--sp-2)">
      Alle Trainingsdaten dieser Woche werden unwiderruflich gelöscht.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-action="close-modal">Abbrechen</button>
      <button class="btn btn--danger" data-action="confirm-delete-week">
        ${ic.trash()} Löschen</button>
    </div>
  </div>
</div>

<!-- Modal: Export -->
<div class="modal-overlay" id="modal-export" role="dialog"
  aria-modal="true" aria-labelledby="modal-exp-title">
  <div class="modal">
    <h2 class="modal__title" id="modal-exp-title">Daten exportieren</h2>
    <p style="color:var(--c-text-2);font-size:13px;margin-bottom:var(--sp-3)">
      CSV-Format · 3 Sektionen: Detail, Wochenübersicht, Progressive Overload</p>
    <div class="export-option" data-action="export-current" role="button" tabindex="0"
      aria-label="Nur aktuelle Woche exportieren">
      ${ic.download()}
      <div>
        <div class="export-option__title">Aktuelle Woche</div>
        <div class="export-option__desc">Nur die aktuell angezeigte Woche</div>
      </div>
    </div>
    <div class="export-option" data-action="export-all" role="button" tabindex="0"
      aria-label="Alle Wochen exportieren">
      ${ic.barChart()}
      <div>
        <div class="export-option__title">Alle Wochen</div>
        <div class="export-option__desc">Komplette Trainingshistorie</div>
      </div>
    </div>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-action="close-modal">Schließen</button>
    </div>
  </div>
</div>

<!-- Modal: Template -->
<div class="modal-overlay" id="modal-template" role="dialog"
  aria-modal="true" aria-labelledby="modal-tpl-title">
  <div class="modal">
    <h2 class="modal__title" id="modal-tpl-title">Template bearbeiten</h2>
    <p style="color:var(--c-text-2);font-size:12px;margin-bottom:var(--sp-3)">
      Vorlage für neue Wochen. Bestehende Wochen bleiben unverändert.</p>
    <div id="tpl-editor-body"></div>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-action="close-modal">Schließen</button>
      <button class="btn btn--accent" data-action="save-tpl">
        ${ic.save()} Speichern</button>
    </div>
  </div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>

<div class="storage-warning" id="storage-warning" role="alert">
  <span>⚠ Speicher voll! Bitte Backup herunterladen.</span>
  <button class="btn" id="storage-warn-btn">
    ${ic.download()} JSON-Backup</button>
</div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// MOUNT – public entry point
// ════════════════════════════════════════════════════════════════════════════

export function mountApp(root) {
  _root = root;

  _buildScaffold(root);

  _toast       = document.getElementById('toast');
  _storageWarn = document.getElementById('storage-warning');

  document.getElementById('storage-warn-btn')?.addEventListener('click', () => {
    exportJSON();
    showToast('JSON-Backup wird heruntergeladen …', 'ok');
  });

  _bindEvents(root);
  _bindTabSwitcher();
  _initSwipe(root);

  subscribe(scheduleRender);

  window.addEventListener('train:storage-error', () => {
    _storageWarn?.classList.add('is-visible');
  });

  scheduleRender();
}
