/* ==========================================================
 * register.js — 내 차 등록 (차량 번호 ↔ 주차칸)
 * - 주차칸 QR(index.html?reg=P1-O-069)로 들어오면 칸이 자동 입력됨
 * - 칸 번호 직접 입력 또는 지도에서 칸을 눌러 고르기
 * - 프로토타입: 이 기기(localStorage)에만 저장. 상용 버전은 서버 저장 + 본인 확인
 * ========================================================== */

const Register = (() => {
  const KEY = 'smartcar-registered';
  const PLATE_RE = /^(\d{2,3})([가-힣])(\d{4})$/;
  let root, db, opts, form;

  /* ---------- 저장소 (실패해도 동작) ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function remove(id) {
    save(load().filter((v) => v.id !== id));
  }

  // 가상 차량 + 이 기기에 등록한 차량 (등록 차량이 같은 번호면 우선)
  function merged(baseVehicles) {
    const mine = load();
    const plates = new Set(mine.map((v) => v.plateFull));
    return [...mine, ...baseVehicles.filter((v) => !plates.has(v.plateFull))];
  }

  // '12 가 3456' → '12가3456'
  const normalize = (s) => String(s || '').replace(/\s/g, '');

  /* ---------- 화면 ---------- */
  /**
   * @param container 그릴 요소
   * @param vehiclesData vehicles.json (색상·차 크기 목록)
   * @param o { stallId, onDone(vehicle), onCancel() }
   */
  function render(container, vehiclesData, o = {}) {
    root = container;
    db = vehiclesData;
    opts = o;
    form = { stallId: o.stallId || '', plate: '', color: null, size: null };
    const fromQr = !!o.stallId;
    root.innerHTML = `
      <h2 class="title-lg" id="reg-title" tabindex="-1">내 차 등록</h2>
      ${fromQr ? `<p class="notice">${icon('check')}<span>주차칸 QR코드를 읽었어요. <strong>차량 번호</strong>만 입력하면 등록돼요.</span></p>` : ''}

      <details class="howto" ${fromQr ? '' : 'open'}>
        <summary>등록 방법 안내</summary>
        <ol class="howto-list">
          <li><strong>주차한 칸 찾기</strong> — 주차칸 바닥이나 기둥의 <strong>QR코드를 찍으면</strong> 칸 번호가 자동으로 들어가요. QR이 없으면 칸 표지판의 번호(예: P1-O-069)를 입력하거나 지도에서 칸을 눌러 고르세요.</li>
          <li><strong>차량 번호 입력</strong> — 번호판 전체를 입력하세요 (예: 12가3456).</li>
          <li><strong>색상·차 크기 고르기 (선택)</strong> — 같은 뒷번호 차가 있을 때 더 빨리 찾을 수 있어요.</li>
          <li><strong>「등록하기」</strong> — 돌아와서 <strong>뒷 4자리</strong>만 입력하면 바로 길을 안내해요.</li>
        </ol>
      </details>

      <form id="reg-form" class="reg-form" novalidate>
        <div class="field">
          <label for="reg-stall" class="field-label">주차칸 번호</label>
          <div class="field-row">
            <input id="reg-stall" class="input-lg" type="text" autocomplete="off" placeholder="예: P1-O-069" value="${escapeHtml(form.stallId)}" aria-describedby="reg-stall-msg">
            <button type="button" class="btn btn-outline" id="reg-pick">${icon('pin')}<span>지도에서 고르기</span></button>
          </div>
          <p id="reg-stall-msg" class="field-msg" aria-live="polite"></p>
        </div>

        <div class="field">
          <label for="reg-plate" class="field-label">차량 번호 (전체)</label>
          <input id="reg-plate" class="input-xl input-plate" type="text" autocomplete="off" placeholder="12가3456" aria-describedby="reg-plate-msg">
          <p id="reg-plate-msg" class="field-msg" aria-live="polite"></p>
        </div>

        <fieldset class="filter-group">
          <legend>차량 색상 <small>(선택)</small></legend>
          <div class="choice-grid">${Object.keys(db.colors).map((c) => `
            <button type="button" class="choice" data-reg="color" data-value="${escapeHtml(c)}" aria-pressed="false">
              <span class="swatch" style="background:${db.colors[c]}" aria-hidden="true"></span><span>${escapeHtml(c)}</span></button>`).join('')}
          </div>
        </fieldset>
        <fieldset class="filter-group">
          <legend>차 크기 <small>(선택)</small></legend>
          <div class="choice-grid">${db.sizeClasses.map((s) => `
            <button type="button" class="choice" data-reg="size" data-value="${escapeHtml(s)}" aria-pressed="false"><span>${escapeHtml(s)}</span></button>`).join('')}
          </div>
        </fieldset>

        <div class="consent">
          <p id="reg-consent-text">차량 번호와 주차 위치는 <strong>이 기기에만</strong> 저장돼요. 언제든 아래 목록에서 삭제할 수 있어요.</p>
          <button type="button" class="choice consent-btn" id="reg-consent" aria-pressed="false" aria-describedby="reg-consent-text">${icon('check')}<span>저장에 동의해요</span></button>
        </div>
        <p id="reg-msg" class="form-msg" role="alert"></p>

        <button type="submit" class="btn btn-primary btn-block btn-xl">${icon('check')}<span>등록하기</span></button>
        <button type="button" class="btn btn-secondary btn-block" id="reg-cancel">${icon('arrowLeft')}<span>돌아가기</span></button>
      </form>
      <p class="muted">등록한 차는 화면 위 「내 등록 차량」에서 언제든 삭제할 수 있어요.</p>`;

    const stallInput = root.querySelector('#reg-stall');
    stallInput.addEventListener('input', () => { form.stallId = stallInput.value; checkStall(false); });
    root.querySelector('#reg-plate').addEventListener('input', (e) => { form.plate = e.target.value; });
    root.querySelector('#reg-pick').addEventListener('click', pickOnMap);
    root.querySelector('#reg-cancel').addEventListener('click', () => { MapView.endPick(); opts.onCancel && opts.onCancel(); });
    root.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.reg;
      form[k] = form[k] === b.dataset.value ? null : b.dataset.value;
      root.querySelectorAll(`[data-reg="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.value === form[k])));
    }));
    const consent = root.querySelector('#reg-consent');
    consent.addEventListener('click', () => consent.setAttribute('aria-pressed', String(consent.getAttribute('aria-pressed') !== 'true')));
    root.querySelector('#reg-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    if (form.stallId) checkStall(true);
    // 화면 이동(부드러운 스크롤)은 app.js 가 맡음 → 포커스만 옮기고 화면은 튀지 않게
    (fromQr ? root.querySelector('#reg-plate') : root.querySelector('#reg-title')).focus({ preventScroll: true });
  }

  // 칸 번호 확인 + 지도에 표시
  function checkStall(focusMap) {
    const msg = root.querySelector('#reg-stall-msg');
    const id = Router.parseStallId(form.stallId);
    if (!form.stallId) { msg.textContent = ''; msg.className = 'field-msg'; return null; }
    if (!id) {
      msg.textContent = '없는 주차칸 번호예요. 예: P1-O-069 (P1~P4, 구역 알파벳, 칸 번호)';
      msg.className = 'field-msg is-error';
      return null;
    }
    msg.textContent = `✓ ${Router.stallLabel(id)}`;
    msg.className = 'field-msg is-ok';
    MapView.showPicked(id, focusMap);
    return id;
  }

  // 지도에서 칸 눌러 고르기
  function pickOnMap() {
    const msg = root.querySelector('#reg-stall-msg');
    msg.textContent = '지도에서 주차칸을 눌러 주세요. (크게 확대하면 칸이 보여요)';
    msg.className = 'field-msg';
    // 모바일에서는 지도가 아래에 있으므로 지도까지 화면을 내려 줌
    if (document.documentElement.dataset.device === 'mobile') {
      document.querySelector('.map-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    MapView.pickStall((id) => {
      form.stallId = id;
      root.querySelector('#reg-stall').value = id;
      checkStall(false);
    }, Router.parseStallId(form.stallId));
  }

  function submit() {
    const err = root.querySelector('#reg-msg');
    const stallId = checkStall(false);
    const plate = normalize(form.plate);
    const m = plate.match(PLATE_RE);
    root.querySelector('#reg-plate-msg').textContent = m ? '' : '번호판 전체를 입력해 주세요. 예: 12가3456 또는 123가4567';
    root.querySelector('#reg-plate-msg').className = 'field-msg' + (m ? '' : ' is-error');
    if (!stallId) { err.textContent = '주차칸 번호를 확인해 주세요.'; root.querySelector('#reg-stall').focus(); return; }
    if (!m) { err.textContent = '차량 번호를 확인해 주세요.'; root.querySelector('#reg-plate').focus(); return; }
    if (root.querySelector('#reg-consent').getAttribute('aria-pressed') !== 'true') { err.textContent = '저장 동의에 체크해 주세요.'; root.querySelector('#reg-consent').focus(); return; }

    const vehicle = {
      id: 'reg-' + Date.now(),
      plateFull: plate, plateFront: m[1] + m[2], plateLast4: m[3],
      color: form.color || '정보 없음', sizeClass: form.size || '정보 없음',
      entryTime: new Date().toISOString(),
      location: { lot: Router.stalls[stallId].lot, stallId },
      registered: true,
    };
    const list = load().filter((v) => v.plateFull !== plate);   // 같은 번호는 새 위치로 바꿈
    list.unshift(vehicle);
    if (!save(list)) { err.textContent = '이 브라우저에서는 저장할 수 없어요 (사생활 보호 모드 등). 칸 번호를 메모해 두세요.'; return; }
    MapView.endPick();
    opts.onChange && opts.onChange();   // 「내 등록 차량」 표시 갱신
    renderDone(vehicle);
  }

  // 등록 완료 화면
  function renderDone(v) {
    root.innerHTML = `
      <div class="arrive-hero">
        <span class="arrive-icon">${icon('check', 48)}</span>
        <h2 class="title-lg" id="reg-done" tabindex="-1">등록했어요</h2>
      </div>
      <div class="card-inner">
        <p class="plate-big">${escapeHtml(formatPlate(v.plateFull))}</p>
        <p class="lead">${escapeHtml(Router.stallLabel(v.location.stallId))}</p>
        <p class="muted">돌아와서 「차량 번호로 찾기」에 <strong>${escapeHtml(v.plateLast4)}</strong>를 입력하면 이 칸으로 안내해요.</p>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="reg-route">${icon('arrowRight')}<span>지금 이 칸까지 길 보기</span></button>
      <button type="button" class="btn btn-secondary btn-block" id="reg-home">${icon('home')}<span>처음으로</span></button>`;
    root.querySelector('#reg-route').addEventListener('click', () => opts.onDone && opts.onDone(v, true));
    root.querySelector('#reg-home').addEventListener('click', () => opts.onDone && opts.onDone(v, false));
    root.querySelector('#reg-done').focus();
  }

  return { render, load, merged, remove };
})();
