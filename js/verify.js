/* ==========================================================
 * verify.js — 차량 검색·검증 흐름
 * 1단계: 뒷 4자리 검색  →  2단계: 조건으로 후보 좁히기  →  최종 확인
 * - 확정 전에는 번호 일부 마스킹 (예: 12가 ●●34)
 * - 연속 실패 5회 → 30초 입력 제한
 * ========================================================== */

const Verify = (() => {
  const LOCK = { maxFails: 5, seconds: 30, key: 'smartcar-verify-lock' };
  const PERIODS = [
    { id: 'today', label: '오늘' },
    { id: 'yesterday', label: '어제' },
    { id: 'days2to3', label: '2~3일 전' },
    { id: 'older', label: '그 이상' },
  ];

  let root, db, support, now, callbacks;
  let candidates = [];   // 뒷 4자리로 찾은 차량
  let filters = {};      // { front, period, color, size }
  let lockTimer = null;

  /* ---------- 준비 ---------- */
  /**
   * @param container  화면을 그릴 요소
   * @param vehiclesData vehicles.json
   * @param parkingData  parking.json (고객센터 정보)
   * @param cb { onConfirmed(vehicle), onStage(n) }
   */
  function init(container, vehiclesData, parkingData, cb) {
    root = container;
    db = vehiclesData;
    support = parkingData.support || {};
    now = vehiclesData.mockNow ? new Date(vehiclesData.mockNow) : new Date();
    callbacks = cb;
  }

  /* ---------- 마스킹 ---------- */
  // '12가1234' → '12가 ●●34' (확정 전 표시용)
  function mask(v) {
    return `${v.plateFront} ●●${v.plateLast4.slice(2)}`;
  }

  /* ---------- 입차 시점 구분 ---------- */
  // 한국 시간 기준 날짜 차이로 오늘/어제/2~3일 전/그 이상
  function periodOf(v) {
    const day = (d) => {
      const s = new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    };
    const diff = Math.round((day(now) - day(v.entryTime)) / 86400000);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'yesterday';
    if (diff <= 3) return 'days2to3';
    return 'older';
  }

  /* ---------- 입력 제한 (localStorage, 실패해도 동작) ---------- */
  function readLock() {
    try { return JSON.parse(localStorage.getItem(LOCK.key)) || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; }
  }
  function writeLock(v) {
    try { localStorage.setItem(LOCK.key, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ }
  }
  const lockRemaining = () => Math.max(0, Math.ceil((readLock().until - Date.now()) / 1000));

  function recordFail() {
    const l = readLock();
    l.fails += 1;
    if (l.fails >= LOCK.maxFails) { l.until = Date.now() + LOCK.seconds * 1000; l.fails = 0; }
    writeLock(l);
    return l;
  }
  const resetFails = () => writeLock({ fails: 0, until: 0 });

  /* ==========================================================
   * 1단계: 검색 화면
   * ========================================================== */
  let searchMode = 'plate';   // 'plate' 차량 번호로 / 'stall' 주차칸 번호로
  let banner = '';            // 출입문 QR로 들어왔을 때 안내 문구

  // 출입문 QR 등으로 들어왔을 때 검색 화면 위에 보여줄 문구
  function setBanner(text) { banner = text || ''; }

  // 검색 대상 차량 (가상 차량 + 이 기기에 등록한 차량)
  const allVehicles = () => (callbacks.getVehicles ? callbacks.getVehicles() : db.vehicles);

  function renderSearch(message = '', mode = searchMode) {
    callbacks.onStage(1);
    searchMode = mode;
    const plateMode = mode === 'plate';
    root.innerHTML = `
      <h2 class="title-lg" id="search-title" tabindex="-1">내 차 찾기</h2>
      ${banner ? `<p class="notice">${icon('location')}<span>${escapeHtml(banner)}</span></p>` : ''}
      <div class="seg" role="group" aria-label="찾는 방법">
        <button type="button" class="seg-btn" data-mode="plate" aria-pressed="${plateMode}">${icon('car')}<span>차량 번호로</span></button>
        <button type="button" class="seg-btn" data-mode="stall" aria-pressed="${!plateMode}">${icon('pin')}<span>주차칸 번호로</span></button>
      </div>
      ${plateMode ? `
      <p class="lead">차량 번호 <strong>뒷 4자리</strong>를 입력해 주세요.</p>
      <form id="search-form" class="search-form" novalidate>
        <label for="plate-input" class="field-label">차량 번호 뒷 4자리</label>
        <input id="plate-input" class="input-xl" type="text" inputmode="numeric" pattern="[0-9]*"
          maxlength="4" autocomplete="off" placeholder="예: 1234" aria-describedby="search-msg lock-msg">
        <button type="submit" class="btn btn-primary btn-block btn-xl" id="search-btn">${icon('search')}<span>찾기</span></button>
      </form>` : `
      <p class="lead">주차한 칸의 <strong>번호</strong>를 입력해 주세요. 칸 표지판·주차권 메모에 있어요.</p>
      <form id="stall-form" class="search-form" novalidate>
        <label for="stall-input" class="field-label">주차칸 번호</label>
        <input id="stall-input" class="input-xl input-plate" type="text" autocomplete="off" placeholder="예: P1-O-069" aria-describedby="search-msg">
        <button type="submit" class="btn btn-primary btn-block btn-xl" id="stall-btn">${icon('search')}<span>이 칸으로 길 찾기</span></button>
      </form>`}
      <p id="search-msg" class="form-msg" role="alert">${escapeHtml(message)}</p>
      <p id="lock-msg" class="notice notice-warn" hidden></p>
      <p class="muted">${plateMode ? '예시: 1234 · 5678 · 0427 (같은 뒷번호 차량이 여러 대인 시연용 번호)' : '예시: P1-O-069 · P2-O-158 (P1~P4 · 구역 · 칸 번호)'}</p>
      <div class="register-cta">
        <p><strong>주차하셨나요?</strong> 지금 등록해 두면 돌아올 때 바로 찾을 수 있어요.</p>
        <button type="button" class="btn btn-outline btn-block" id="go-register">${icon('car')}<span>내 차 등록하기</span></button>
      </div>`;

    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      renderSearch('', b.dataset.mode);
      root.querySelector(`[data-mode="${b.dataset.mode}"]`).focus();
    }));
    root.querySelector('#go-register').addEventListener('click', () => callbacks.onRegister && callbacks.onRegister());
    if (plateMode) {
      const input = root.querySelector('#plate-input');
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
      root.querySelector('#search-form').addEventListener('submit', (e) => {
        e.preventDefault();
        search(input.value);
      });
      updateLockUi();
    } else {
      root.querySelector('#stall-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = Router.parseStallId(root.querySelector('#stall-input').value);
        if (!id) { renderSearch('없는 주차칸 번호예요. 예: P1-O-069 (P1~P4, 구역 알파벳, 칸 번호)', 'stall'); return; }
        callbacks.onStallChosen && callbacks.onStallChosen(id);
      });
    }
    (message ? root.querySelector('#search-msg') : root.querySelector('#search-title')).focus();
  }

  // 입력 제한 남은 시간 표시
  function updateLockUi() {
    clearInterval(lockTimer);
    const input = root.querySelector('#plate-input');
    const btn = root.querySelector('#search-btn');
    const msg = root.querySelector('#lock-msg');
    if (!input) return;
    const tick = () => {
      const left = lockRemaining();
      input.disabled = btn.disabled = left > 0;
      msg.hidden = left === 0;
      msg.textContent = left > 0 ? `여러 번 찾지 못해 잠시 입력이 제한됩니다. ${left}초 후 다시 시도해 주세요.` : '';
      if (left === 0) {
        clearInterval(lockTimer);
        if (document.activeElement === document.body) input.focus();
      }
    };
    tick();
    if (lockRemaining() > 0) lockTimer = setInterval(tick, 1000);
  }

  // 뒷 4자리로 검색
  function search(value) {
    if (lockRemaining() > 0) return updateLockUi();
    if (!/^\d{4}$/.test(value)) {
      renderSearch('숫자 4자리를 입력해 주세요.');
      return;
    }
    candidates = allVehicles().filter((v) => v.plateLast4 === value);
    if (candidates.length === 0) {
      const l = recordFail();
      renderNoResult(value, l);
      return;
    }
    resetFails();
    filters = { front: '', period: null, color: null, size: null };
    if (candidates.length === 1) renderConfirm(candidates, true);
    else renderVerify();
  }

  /* ---------- 0대일 때 ---------- */
  function renderNoResult(value, lockState) {
    callbacks.onStage(1);
    const locked = lockRemaining() > 0;
    const tel = (support.customerCenterPhone || '').replace(/\D/g, '');
    root.innerHTML = `
      <h2 class="title-lg" id="none-title" tabindex="-1">차량을 찾지 못했어요</h2>
      <p class="lead">입력하신 <strong>${escapeHtml(value)}</strong> 번호의 차량이 제1여객터미널 주차장에 없습니다.</p>
      <ul class="notice-list">
        <li class="notice">${icon('alert')}<span>번호를 잘못 입력하셨을 수 있어요. 숫자를 다시 확인해 주세요.</span></li>
        <li class="notice">${icon('pin')}<span><strong>제2여객터미널 주차장</strong>일 수 있어요. 주차하신 터미널을 확인해 주세요.</span></li>
      </ul>
      ${locked ? '' : `<p class="muted">연속 ${LOCK.maxFails}번 찾지 못하면 ${LOCK.seconds}초 동안 입력이 제한됩니다. (현재 ${lockState.fails}번)</p>`}
      <button type="button" class="btn btn-primary btn-block" id="retry-btn">${icon('refresh')}<span>번호 다시 입력</span></button>
      <a class="btn btn-outline btn-block" href="tel:${tel}" id="call-btn">${icon('phone')}<span>고객센터 연결 ${escapeHtml(support.customerCenterPhone || '')}</span></a>
      <p class="muted">${escapeHtml(support.customerCenterName || '')}</p>`;
    root.querySelector('#retry-btn').addEventListener('click', () => renderSearch());
    root.querySelector('#none-title').focus();
  }

  /* ==========================================================
   * 2단계: 검증 화면 (조건으로 후보 좁히기)
   * ========================================================== */
  // 현재 조건에 맞는 후보 (except 로 특정 조건 하나는 빼고 계산 가능)
  function filtered(except) {
    const front = filters.front.replace(/\s/g, '');
    return candidates.filter((v) =>
      (except === 'front' || !front || v.plateFront.startsWith(front)) &&
      (except === 'period' || !filters.period || periodOf(v) === filters.period) &&
      (except === 'color' || !filters.color || v.color === filters.color) &&
      (except === 'size' || !filters.size || v.sizeClass === filters.size));
  }

  function renderVerify() {
    callbacks.onStage(2);
    root.innerHTML = `
      <h2 class="title-lg" id="verify-title" tabindex="-1">내 차가 맞는지 확인해 주세요</h2>
      <p class="lead">같은 뒷번호 차량이 <strong>${candidates.length}대</strong> 있어요. 아는 정보를 골라 주세요.</p>
      <p class="count-box" aria-live="polite" id="remain">남은 후보 <strong>${candidates.length}대</strong></p>

      <fieldset class="filter-group">
        <legend>차량 번호 앞자리</legend>
        <label for="front-input" class="sr-only">차량 번호 앞자리 입력</label>
        <input id="front-input" class="input-lg" type="text" autocomplete="off" placeholder="예: 12가">
        <div class="choice-grid" id="opt-front"></div>
      </fieldset>
      <fieldset class="filter-group"><legend>언제 주차하셨나요?</legend><div class="choice-grid" id="opt-period"></div></fieldset>
      <fieldset class="filter-group"><legend>차량 색상</legend><div class="choice-grid" id="opt-color"></div></fieldset>
      <fieldset class="filter-group"><legend>차 크기</legend><div class="choice-grid" id="opt-size"></div></fieldset>

      <div id="verify-cards"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="reset-filter">${icon('refresh')}<span>조건 초기화</span></button>
        <button type="button" class="btn btn-secondary" id="back-search">${icon('arrowLeft')}<span>번호 다시 입력</span></button>
      </div>`;

    const front = root.querySelector('#front-input');
    front.addEventListener('input', () => { filters.front = front.value; updateVerify(); });
    root.querySelector('#reset-filter').addEventListener('click', () => {
      filters = { front: '', period: null, color: null, size: null };
      front.value = '';
      updateVerify();
    });
    root.querySelector('#back-search').addEventListener('click', () => renderSearch());
    // 선택 버튼 클릭 (한 번 더 누르면 선택 해제)
    root.addEventListener('click', onChoice);
    updateVerify();
    root.querySelector('#verify-title').focus();
  }

  function onChoice(e) {
    const b = e.target.closest('[data-filter]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const { filter, value } = b.dataset;
    if (filter === 'front') {
      filters.front = filters.front === value ? '' : value;
      root.querySelector('#front-input').value = filters.front;
    } else {
      filters[filter] = filters[filter] === value ? null : value;
    }
    updateVerify(`${filter}:${value}`);
  }

  // 선택 버튼 HTML (선택 시 남을 후보 수 표시)
  function choiceButtons(filter, options) {
    const pool = filtered(filter);
    return options.map((o) => {
      const n = pool.filter(o.test).length;
      const selected = filter === 'front' ? filters.front === o.value : filters[filter] === o.value;
      return `<button type="button" class="choice" data-filter="${filter}" data-value="${escapeHtml(o.value)}"
        data-key="${filter}:${escapeHtml(o.value)}" aria-pressed="${selected}" aria-disabled="${n === 0 && !selected}">
        ${o.swatch ? `<span class="swatch" style="background:${o.swatch}" aria-hidden="true"></span>` : ''}
        <span>${escapeHtml(o.label)}</span><small>${n}대</small></button>`;
    }).join('');
  }

  // 조건이 바뀔 때마다 후보 수·버튼·카드 갱신
  function updateVerify(focusKey) {
    const left = filtered();
    root.querySelector('#remain').innerHTML = `남은 후보 <strong>${left.length}대</strong>`;

    const fronts = [...new Set(candidates.map((v) => v.plateFront))];
    root.querySelector('#opt-front').innerHTML = choiceButtons('front', fronts.map((f) => ({ value: f, label: f, test: (v) => v.plateFront === f })));
    root.querySelector('#opt-period').innerHTML = choiceButtons('period', PERIODS.map((p) => ({ value: p.id, label: p.label, test: (v) => periodOf(v) === p.id })));
    const colors = [...new Set(candidates.map((v) => v.color))];
    root.querySelector('#opt-color').innerHTML = choiceButtons('color', colors.map((c) => ({ value: c, label: c, swatch: db.colors[c], test: (v) => v.color === c })));
    root.querySelector('#opt-size').innerHTML = choiceButtons('size', db.sizeClasses.map((s) => ({ value: s, label: s, test: (v) => v.sizeClass === s })));

    const cards = root.querySelector('#verify-cards');
    if (left.length === 0) {
      cards.innerHTML = `<p class="notice notice-warn">${icon('alert')}<span>조건에 맞는 차량이 없어요. 조건을 다시 골라 주세요.</span></p>`;
    } else if (left.length <= 3) {
      cards.innerHTML = `<h3 class="title-md">이 중에 내 차가 있나요?</h3>` + left.map(cardHtml).join('');
      bindConfirmButtons(cards);
    } else {
      cards.innerHTML = `<p class="muted">후보가 3대 이하가 되면 차량 정보가 보입니다.</p>`;
    }

    if (focusKey) {
      const again = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (again) again.focus();
    }
  }

  /* ==========================================================
   * 최종 확인
   * ========================================================== */
  function cardHtml(v) {
    return `
      <article class="vehicle-card" aria-label="후보 차량 ${escapeHtml(mask(v))}">
        <!-- 썸네일: 실제 LPR 사진이 생기면 data-src(${escapeHtml(v.thumbnail)})를 img 로 교체.
             지금은 파일이 없어 404 콘솔 에러가 나지 않도록 플레이스홀더만 표시 -->
        <div class="thumb" style="--car-color:${db.colors[v.color] || '#ccc'}" data-src="${escapeHtml(v.thumbnail)}">
          ${icon('car', 56)}
          <span class="thumb-label">사진 준비 중</span>
        </div>
        <div class="vehicle-info">
          <p class="plate-masked">${escapeHtml(mask(v))}</p>
          <dl class="info-list">
            <div><dt>입차 시각</dt><dd>${formatDateTime(v.entryTime)}</dd></div>
            <div><dt>색상 · 차종</dt><dd>${escapeHtml(v.color)} · ${escapeHtml(v.sizeClass)}</dd></div>
          </dl>
          <button type="button" class="btn btn-primary btn-block" data-confirm="${v.id}">${icon('check')}<span>이 차가 맞습니다</span></button>
        </div>
      </article>`;
  }

  function bindConfirmButtons(scope) {
    scope.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => {
      const v = allVehicles().find((x) => x.id === b.dataset.confirm);
      root.removeEventListener('click', onChoice);
      callbacks.onConfirmed(v);
    }));
  }

  // 후보가 1대일 때 바로 확인 화면
  function renderConfirm(list) {
    callbacks.onStage(2);
    root.innerHTML = `
      <h2 class="title-lg" id="confirm-title" tabindex="-1">이 차가 맞나요?</h2>
      <p class="lead">차량 정보를 확인하고 아래 버튼을 눌러 주세요.</p>
      ${list.map(cardHtml).join('')}
      <button type="button" class="btn btn-secondary btn-block" id="back-search">${icon('arrowLeft')}<span>아니에요, 다시 입력</span></button>`;
    bindConfirmButtons(root);
    root.querySelector('#back-search').addEventListener('click', () => renderSearch());
    root.querySelector('#confirm-title').focus();
  }

  return { init, renderSearch, setBanner, search, mask, periodOf, get now() { return now; } };
})();
