/* ==========================================================
 * app.js — 화면 전체 흐름 관리
 * 데이터 불러오기 → ① 차량 검색 → ② 차량 확인 → ③ 경로 안내 → ④ 도착
 * 헤더(시각·글씨 크기), 진행 단계 표시, 사용자/관리자 탭도 여기서 관리
 * ========================================================== */

/* ---------- 공통 UI 도우미 ---------- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5v5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  speaker: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>',
  door: '<path d="M4 21h16M6 21V3h12v18"/><circle cx="14.5" cy="12" r="1"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9 20l3-6 3 3v5M7 12l3-4 4 1 2 4"/>',
  crosswalk: '<path d="M4 4v16M20 4v16M8 6h8M8 10h8M8 14h8M8 18h8"/>',
  elevator: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 9l3-3 3 3M9 15l3 3 3-3"/>',
  escalator: '<path d="M3 19h5l8-12h5"/><path d="M3 15h3M16 19h5"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  pin: '<path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/>',
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  location: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  accessible: '<circle cx="12" cy="4" r="2"/><path d="M9 8h6M12 8v6h5l2 5"/><path d="M8.5 12.5A5 5 0 1015 19"/>',
  play: '<path d="M7 4l13 8-13 8V4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
};

// 아이콘 SVG 문자열 (항상 텍스트와 함께 쓰므로 스크린리더에서는 숨김)
function icon(name, size = 24) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// '2026-10-13T07:42' → '10월 13일 (월) 오전 7:42'
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
}

// '12가1234' → '12가 1234'
function formatPlate(p) {
  return p.replace(/^(\d{2,3}[가-힣])(\d{4})$/, '$1 $2');
}

/* ---------- 앱 ---------- */
const App = (() => {
  const FONT_KEY = 'smartcar-font-size';
  const FONT_SIZES = ['base', 'large', 'xlarge'];
  const $ = (sel) => document.querySelector(sel);

  const state = {
    parking: null,
    vehicles: null,
    vehicle: null,
    preset: 'safest',      // 기본값: 「가장 안전한 길」 (서비스 핵심 가치)
    currentDoorId: null,
    route: null,
    manual: null,          // 수동 위치 공급자
    live: null,            // 실시간 안내 방식: 'gps' | 'sim' | null
    lastReroute: 0,
    qrDoorId: null,        // 출입문 QR로 들어온 경우 그 출입문
  };

  // 주소 파라미터 (?reg=칸번호 : 주차칸 QR, ?from=출입문 : 출입문 QR, ?v=mobile|pc : 화면 강제)
  // window.__testParams 는 자동 점검용
  const params = () => new URLSearchParams(window.__testParams || location.search);

  /* ---------- PC / 모바일 화면 자동 전환 ---------- */
  // 터치 화면이거나 폭이 좁으면 모바일 화면: 경로 안내 때 지도를 위에 고정하고 내비게이션처럼 표시
  function setupDevice() {
    const forced = params().get('v');
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const device = forced === 'mobile' || forced === 'pc' ? forced : (coarse || window.innerWidth < 768 ? 'mobile' : 'pc');
    document.documentElement.dataset.device = device;
    const t = $('#device-toggle');
    if (t) {
      t.textContent = device === 'mobile' ? 'PC 화면으로 보기' : '모바일 화면으로 보기';
      t.addEventListener('click', () => {
        const q = params();
        q.set('v', device === 'mobile' ? 'pc' : 'mobile');
        location.search = q.toString();
      });
    }
  }

  /* ---------- 시작 ---------- */
  async function init() {
    setupDevice();
    setupFontSize();
    setupClock();
    setupTabs();
    setupMapTools();

    try {
      const [parking, vehicles] = await Promise.all([loadJson('data/parking.json'), loadJson('data/vehicles.json')]);
      state.parking = parking;
      state.vehicles = vehicles;
    } catch (e) {
      renderLoadError(e);
      return;
    }

    $('#data-note').textContent = `※ ${state.parking._note} · ${state.vehicles._note}`;
    Router.build(state.parking);
    MapView.init($('#map'), state.parking);
    refreshOccupied();
    state.manual = ManualLocationProvider(Router.nodes);
    LocationService.subscribe(onLocation);

    Verify.init($('#stage-content'), state.vehicles, state.parking, {
      onStage: setStage,
      onConfirmed: onVehicleConfirmed,
      onStallChosen,
      onRegister: () => showRegister(null),
      getVehicles: () => Register.merged(state.vehicles.vehicles),
    });

    // QR코드로 들어온 경우
    const q = params();
    const door = q.get('from') && Router.nodes[q.get('from')];
    if (door && door.type === 'door') {
      state.qrDoorId = door.id;
      Verify.setBanner(`${Router.floorArea(door.floor)} ${door.doorNumber}번 출입문에서 출발해요. 차량 번호나 주차칸 번호로 찾으면 이 출입문부터 안내해요.`);
    }
    const regStall = q.get('reg') && Router.parseStallId(q.get('reg'));
    // ?find=칸번호 : 그 칸까지 바로 경로 안내 (&preset=길 옵션, &gps=1 이면 GPS 안내 바로 시작)
    const findStall = q.get('find') && Router.parseStallId(q.get('find'));
    if (ROUTE_CONFIG.presets[q.get('preset')]) state.preset = q.get('preset');
    if (regStall) showRegister(regStall);
    else if (findStall) {
      onStallChosen(findStall);
      if (q.get('gps') === '1') setTimeout(() => toggleLive('gps'), 300);
    } else Verify.renderSearch();
  }

  // 지도에 "다른 차가 있는 칸" 표시 (가상 차량 + 이 기기에 등록한 차량) + 「내 등록 차량」 갱신
  function refreshOccupied() {
    MapView.setOccupied(Register.merged(state.vehicles.vehicles).map((v) => v.location.stallId));
    renderMyCarsBar();
  }

  /* ---------- 내 등록 차량 (항상 표시, 바로 삭제) ---------- */
  function renderMyCarsBar(confirmId = null) {
    const bar = $('#my-cars-bar');
    if (!bar) return;
    const list = Register.load();
    bar.innerHTML = `
      <div class="my-cars-head">
        <h2 class="my-cars-title">${icon('car')}<span>내 등록 차량 <small>${list.length}대 · 이 기기에만 저장</small></span></h2>
        <button type="button" class="btn btn-outline" id="bar-register">${icon('plus')}<span>내 차 등록</span></button>
      </div>
      ${list.length ? `<ul class="my-car-list">${list.map((v) => `
        <li>
          <span class="my-car-info"><strong>${escapeHtml(formatPlate(v.plateFull))}</strong><small>${escapeHtml(Router.stallLabel(v.location.stallId))}</small></span>
          ${confirmId === v.id ? `
            <span class="my-car-actions confirm" role="group" aria-label="삭제 확인">
              <span class="confirm-text">정말 삭제할까요?</span>
              <button type="button" class="btn btn-danger" data-del-yes="${escapeHtml(v.id)}">${icon('trash')}<span>삭제하기</span></button>
              <button type="button" class="btn btn-secondary" data-del-no>${icon('arrowLeft')}<span>취소</span></button>
            </span>` : `
            <span class="my-car-actions">
              <button type="button" class="btn btn-secondary" data-go="${escapeHtml(v.id)}">${icon('arrowRight')}<span>길 찾기</span></button>
              <button type="button" class="btn btn-danger-outline" data-del="${escapeHtml(v.id)}" aria-label="${escapeHtml(formatPlate(v.plateFull))} 삭제">${icon('trash')}<span>삭제</span></button>
            </span>`}
        </li>`).join('')}</ul>` : '<p class="muted">아직 등록한 차가 없어요. 주차한 뒤 등록해 두면 돌아올 때 바로 찾을 수 있어요.</p>'}`;

    bar.querySelector('#bar-register').addEventListener('click', () => showRegister(null));
    bar.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const v = list.find((x) => x.id === b.dataset.go);
      if (v) onVehicleConfirmed(v);
    }));
    bar.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      renderMyCarsBar(b.dataset.del);
      const yes = bar.querySelector('[data-del-yes]');
      if (yes) yes.focus();
    }));
    bar.querySelectorAll('[data-del-no]').forEach((b) => b.addEventListener('click', () => renderMyCarsBar()));
    bar.querySelectorAll('[data-del-yes]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.delYes;
      Register.remove(id);
      const wasCurrent = state.vehicle && state.vehicle.id === id;
      refreshOccupied();
      if (wasCurrent) restart();
      const title = bar.querySelector('#bar-register');
      if (title) title.focus();
    }));
  }

  /* ---------- 경로를 찾는 시각 (셔틀·열차 운행 판단) ---------- */
  // ?t=14:00 처럼 시각을 정하면 그 시각 기준 (발표 시연용). 없으면 지금
  function routeNow() {
    const t = params().get('t');
    if (t && /^\d{1,2}:\d{2}$/.test(t)) {
      const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      return new Date(`${ymd}T${t.padStart(5, '0')}:00+09:00`);
    }
    return new Date();
  }

  // 셔틀·열차 운행 상태 안내
  function transitStatusHtml() {
    const now = routeNow();
    const dayText = (days) => (days.length === 7 ? '매일' : days.length === 6 && !days.includes(1) ? '화~일 (월요일 휴무)' : days.map((d) => '일월화수목금토'[d]).join('·'));
    return Object.values(Router.transit).map((T) => {
      const on = Router.running(T.id, now);
      const hw = T.headwayMin[0] === T.headwayMin[1] ? `${T.headwayMin[0]}분` : `${T.headwayMin[0]}~${T.headwayMin[1]}분`;
      return `<li class="${on ? 'on' : 'off'}">${icon('bus')}<span><strong>${escapeHtml(T.name)}</strong> — ${on ? '지금 운행 중' : '지금은 운행하지 않아요 (경로에서 제외)'}<br>
        <small>${dayText(T.service.days)} ${T.service.start}~${T.service.end} · ${hw} 간격 · ${escapeHtml(T.fare)}</small></span></li>`;
    }).join('');
  }

  /* ---------- 내 차 등록 ---------- */
  function showRegister(stallId) {
    stopLive();
    setStage(1);
    Register.render($('#stage-content'), state.vehicles, {
      stallId,
      onCancel: () => Verify.renderSearch(),
      onChange: refreshOccupied,
      onDone: (v, routeNow) => {
        refreshOccupied();
        if (routeNow) onVehicleConfirmed(v);
        else Verify.renderSearch();
      },
    });
  }

  // 주차칸 번호로 바로 찾기 (차량 번호 없이)
  function onStallChosen(stallId) {
    onVehicleConfirmed({ id: 'stall-' + stallId, plateFull: null, entryTime: null, location: { lot: Router.stalls[stallId].lot, stallId } });
  }

  async function loadJson(url) {
    // 한 파일로 묶은 공유용 페이지(claude.ai 링크)는 데이터를 페이지 안에 담고 있음
    if (window.__DATA && window.__DATA[url]) return window.__DATA[url];
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url} (${res.status})`);
    return res.json();
  }

  // 파일을 더블클릭(file://)으로 열면 브라우저 보안상 JSON 을 읽을 수 없음 → 안내
  function renderLoadError(err) {
    console.info('[app] 데이터 불러오기 실패:', err.message);
    $('#stage-content').innerHTML = `
      <h2 class="title-lg">데이터를 불러오지 못했어요</h2>
      <p class="lead">이 화면은 웹 서버 주소(http://…)로 열어야 합니다.</p>
      <ol class="plain-list">
        <li>폴더 안의 <strong>start.bat</strong> 파일을 더블클릭하세요. 브라우저가 자동으로 열립니다.</li>
        <li>또는 VS Code의 <strong>Live Server</strong>로 index.html 을 여세요.</li>
      </ol>
      <p class="muted">오류 내용: ${escapeHtml(err.message)}</p>`;
  }

  /* ---------- 헤더: 글씨 크기 ---------- */
  function setupFontSize() {
    let saved = 'base';
    try { saved = localStorage.getItem(FONT_KEY) || 'base'; } catch (e) { /* 저장소 사용 불가 */ }
    applyFont(FONT_SIZES.includes(saved) ? saved : 'base');
    document.querySelectorAll('[data-font-size]').forEach((b) => b.addEventListener('click', () => {
      applyFont(b.dataset.fontSize);
      setTimeout(() => MapView.invalidate(), 0);   // 글씨 크기에 따라 지도 영역 크기가 바뀜
      try { localStorage.setItem(FONT_KEY, b.dataset.fontSize); } catch (e) { /* 무시 */ }
    }));
  }

  function applyFont(size) {
    document.documentElement.dataset.font = size;
    document.querySelectorAll('[data-font-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fontSize === size)));
  }

  /* ---------- 헤더: 현재 시각 ---------- */
  function setupClock() {
    const el = $('#clock');
    const tick = () => {
      const d = new Date();
      el.dateTime = d.toISOString();
      el.textContent = d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
    };
    tick();
    setInterval(tick, 15000);
  }

  /* ---------- 사용자 / 관리자 탭 ---------- */
  function setupTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        if (on && t.id === 'tab-user') setTimeout(() => MapView.invalidate(), 0);   // 숨겨졌던 지도 크기 다시 계산
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(next);
        next.focus();
      });
    });
  }

  /* ---------- 지도 도구 버튼 ---------- */
  function setupMapTools() {
    $('#zoom-in').addEventListener('click', () => MapView.zoomBy(1 / 1.25));
    $('#zoom-out').addEventListener('click', () => MapView.zoomBy(1.25));
    $('#fit-all').addEventListener('click', () => MapView.fitAll());
    $('#focus-car').addEventListener('click', () => MapView.focusCar());
  }

  /* ---------- 진행 단계 표시 ---------- */
  function setStage(n) {
    document.body.dataset.stage = n;   // 모바일 화면에서 단계별 배치(경로 안내 때 지도 위 고정)에 사용
    setTimeout(() => MapView.invalidate(), 0);
    document.querySelectorAll('.stepper li').forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('is-done', s < n);
      li.classList.toggle('is-current', s === n);
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('#focus-car').disabled = n < 3;
  }

  /* ---------- ③ 경로 안내 ---------- */
  function onVehicleConfirmed(v) {
    state.vehicle = v;
    state.currentDoorId = state.qrDoorId;   // 출입문 QR로 들어왔으면 그 출입문에서 출발
    LocationService.use(state.manual);
    renderRouteScreen();
  }

  function renderRouteScreen() {
    setStage(3);
    const v = state.vehicle;
    const presets = ROUTE_CONFIG.presets;
    const presetIcon = { fastest: 'bolt', safest: 'shield', accessible: 'accessible' };
    $('#stage-content').innerHTML = `
      <h2 class="title-lg" id="route-title" tabindex="-1">경로 안내</h2>
      <div class="vehicle-summary">
        <p class="eyebrow">${v.plateFull ? '확인된 내 차' : '주차칸 번호로 찾기'}</p>
        ${v.plateFull ? `<p class="plate-big">${escapeHtml(formatPlate(v.plateFull))}</p>` : ''}
        <p>${icon('pin')}<span>${escapeHtml(Router.stallPlace(v.location.stallId))}</span></p>
      </div>

      <fieldset class="filter-group">
        <legend>어떤 길로 갈까요?</legend>
        <div class="preset-grid">
          ${Object.keys(presets).map((k) => `
            <button type="button" class="preset" data-preset="${k}" aria-pressed="${state.preset === k}">
              ${icon(presetIcon[k], 32)}<span class="preset-label">${presets[k].label}</span>
              <small>${presets[k].description}</small>
            </button>`).join('')}
        </div>
      </fieldset>

      <fieldset class="filter-group">
        <legend>지금 계신 곳 <small>(선택하면 실내 이동도 안내해요)</small></legend>
        <div id="loc-picker"></div>
      </fieldset>

      <details class="transit-box" open>
        <summary>${icon('bus')}<span>셔틀버스·자기부상열차 운행 정보</span></summary>
        <ul class="transit-status" id="transit-status"></ul>
        <p class="muted">운행 중인 노선만 경로에 넣어요. 기다리는 시간은 배차 간격의 절반으로 계산해요.</p>
      </details>

      <section id="recommend" aria-live="polite" aria-label="추천 출입문"></section>
      <section id="guide" aria-label="단계별 안내"></section>

      <p id="live-status" class="notice" hidden aria-live="polite"></p>
      <div class="btn-row">
        ${window.__ARTIFACT
          ? (window.__GPS_URL ? `<a class="btn btn-primary" id="gps-link" target="_blank" rel="noopener" href="${escapeHtml(window.__GPS_URL)}">${icon('location')}<span>내 위치(GPS)로 안내</span></a>` : '')
          : `<button type="button" class="btn btn-primary" id="gps-btn" aria-pressed="false">${icon('location')}<span>내 위치(GPS)로 안내</span></button>`}
        <button type="button" class="btn btn-outline" id="live-btn" aria-pressed="false">${icon('play')}<span>실시간 이동 시연</span></button>
      </div>
      <button type="button" class="btn btn-secondary btn-block" id="other-car">${icon('search')}<span>다른 차 찾기</span></button>`;

    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      state.preset = b.dataset.preset;
      document.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      updateRoute();
    }));
    LocationPicker.render($('#loc-picker'), state.parking, state.currentDoorId, (doorId) => {
      state.currentDoorId = doorId;
      updateRoute();
      if (doorId) state.manual.select(doorId);
    });
    $('#live-btn').addEventListener('click', () => toggleLive('sim'));
    if ($('#gps-btn')) $('#gps-btn').addEventListener('click', () => toggleLive('gps'));
    $('#other-car').addEventListener('click', restart);

    updateRoute();
    $('#route-title').focus();
  }

  // 옵션·현재 위치가 바뀔 때마다 경로 다시 계산
  function updateRoute() {
    stopLive();
    const r = Router.recommend({
      targetStallId: state.vehicle.location.stallId,
      preset: state.preset,
      currentDoorId: state.currentDoorId,
      now: routeNow(),
    });
    // 공유 링크(claude.ai)에서는 GPS 가 막혀 있어, 같은 칸·출발 출입문·옵션으로 GPS 버전을 열어 줌
    const gl = $('#gps-link');
    if (gl) {
      const p = new URLSearchParams({ find: state.vehicle.location.stallId, preset: state.preset, gps: '1' });
      if (state.currentDoorId) p.set('from', state.currentDoorId);
      gl.href = `${window.__GPS_URL}index.html?${p}`;
    }
    const ts = $('#transit-status');
    if (ts) ts.innerHTML = transitStatusHtml();
    renderRoute(r);
  }

  // 경로 결과를 추천 카드·지도·단계 카드에 표시 (fromPosition: GPS 위치에서 다시 찾은 경로)
  function renderRoute(r, fromPosition = false) {
    state.route = r;
    if (!r) {
      $('#recommend').innerHTML = `<p class="notice notice-warn">${icon('alert')}<span>경로를 찾지 못했어요. 고객센터에 문의해 주세요.</span></p>`;
      return;
    }
    state.segToStep = [];
    // 지도 좌표 구간 → 단계 번호 (셔틀 구간은 실제 도로 모양이라 좌표가 많음)
    r.steps.forEach((s, i) => { for (let k = 1; k < s.points.length; k++) state.segToStep.push(i); });

    if (fromPosition) {
      $('#recommend').innerHTML = `
        <div class="recommend-card">
          <p class="eyebrow">현재 위치에서 다시 찾은 길 · ${escapeHtml(ROUTE_CONFIG.presets[r.preset].label)}</p>
          <ul class="stat-row">
            <li><span>남은 거리</span><strong>약 ${r.totalDistance}m</strong></li>
            <li><span>예상 시간</span><strong>약 ${r.estimatedMinutes}분</strong></li>
          </ul>
          <p class="safety ${r.safety.ok ? 'ok' : 'bad'}">${icon(r.safety.ok ? 'check' : 'alert')}<span>${r.safety.ok ? '인도·횡단보도·주차장 통로로만 가고, 다른 주차칸을 가로지르지 않아요' : '안전 점검 필요: ' + escapeHtml(r.safety.problems.join(', '))}</span></p>
        </div>`;
      MapView.showRoute(r);
      StepGuide.render($('#guide'), r, { onArrive: showArrival });
      return;
    }
    const alt = r.alternatives.map((a) => `${escapeHtml(a.label)} (약 ${a.distance}m)`).join(', ');

    // 세 가지 옵션 비교 (같은 길이면 "빠르면서 안전한 길"임을 알려줌)
    const rows = Router.compareOptions({ targetStallId: state.vehicle.location.stallId, currentDoorId: state.currentDoorId, now: routeNow() });
    const label = (k) => ROUTE_CONFIG.presets[k].label;
    const me = rows.find((x) => x.preset === r.preset);
    const twins = rows.filter((x) => x.preset !== r.preset && x.path === me.path).map((x) => label(x.preset));
    const compareHtml = `
      <div class="compare">
        <p class="compare-title">길 옵션 비교</p>
        <ul class="compare-list">
          ${rows.map((x) => `
            <li class="${x.preset === r.preset ? 'is-current' : ''}" ${x.preset === r.preset ? 'aria-current="true"' : ''}>
              <span class="compare-name">${escapeHtml(x.label)}${x.preset === r.preset ? ' <small>(선택)</small>' : ''}</span>
              <span class="compare-detail">${escapeHtml(x.door)} · 걷기 약 ${x.distance}m · ${x.minutes}분${x.transit.length ? ` · ${escapeHtml(x.transit.join('+'))} 이용` : ''} · 차도·통로 ${x.laneMeters}m${x.stairs ? ' · 계단 있음' : ''}</span>
            </li>`).join('')}
        </ul>
        ${twins.length ? `<p class="compare-note">${icon('check')}<span>이 차량은 「${escapeHtml(twins.join('」·「'))}」과 같은 길이에요. 빠르면서 안전한 길입니다.</span></p>` : ''}
      </div>`;
    $('#recommend').innerHTML = `
      <div class="recommend-card">
        <p class="eyebrow">추천 출입문 · ${escapeHtml(ROUTE_CONFIG.presets[r.preset].label)}</p>
        <p class="door-big">${escapeHtml(r.exitDoorLabel)}</p>
        <p class="reason">${icon('shield')}<span>${escapeHtml(r.reason)}</span></p>
        <ul class="stat-row">
          <li><span>걷는 거리</span><strong>약 ${r.totalDistance}m</strong></li>
          <li><span>예상 시간</span><strong>약 ${r.estimatedMinutes}분</strong></li>
          <li><span>횡단보도</span><strong>${r.stats.crosswalks}번</strong></li>
          ${r.transitUsed.length ? `<li><span>${escapeHtml(r.transitUsed.map((T) => T.shortName).join('·'))}</span><strong>약 ${Math.ceil(r.stats.transitSeconds / 60)}분</strong></li>` : ''}
        </ul>
        ${r.warnings.map((w) => `<p class="notice notice-warn">${icon('alert')}<span>${escapeHtml(w)}</span></p>`).join('')}
        <p class="safety ${r.safety.ok ? 'ok' : 'bad'}">${icon(r.safety.ok ? 'check' : 'alert')}<span>${r.safety.ok ? '인도·횡단보도·주차장 통로로만 가고, 다른 주차칸을 가로지르지 않아요' : '안전 점검 필요: ' + escapeHtml(r.safety.problems.join(', '))}</span></p>
        ${compareHtml}
        ${alt ? `<p class="muted">다른 출입문: ${alt}</p>` : ''}
      </div>`;

    MapView.showRoute(r);
    StepGuide.render($('#guide'), r, { onArrive: showArrival });
  }

  /* ---------- 실시간 안내(내비게이션): GPS / 이동 시연 (LocationProvider 사용) ---------- */
  const LIVE = {
    gps: { btn: '#gps-btn', on: '안내 멈추기', off: '내 위치(GPS)로 안내', icon: 'location' },
    sim: { btn: '#live-btn', on: '시연 멈추기', off: '실시간 이동 시연', icon: 'play' },
  };
  const OFF_ROUTE_M = 30;          // 경로에서 이만큼 벗어나면 다시 찾기
  const REROUTE_COOLDOWN_MS = 10000;

  function liveStatus(text, warn = false) {
    const el = $('#live-status');
    if (!el) return;
    el.hidden = !text;
    el.className = 'notice' + (warn ? ' notice-warn' : '');
    el.textContent = text || '';
  }

  function toggleLive(mode) {
    if (state.live === mode) { stopLive(); return; }
    stopLive();
    state.lastPos = null;
    if (mode === 'gps') {
      const gps = GpsLocationProvider((err) => {
        liveStatus(err.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 위치 사용을 허용해 주세요.' : '위치를 찾지 못했어요. 하늘이 보이는 곳에서 다시 시도해 주세요.', true);
        stopLive(false);
      });
      if (!gps.isAvailable()) { liveStatus('이 브라우저는 위치 기능을 지원하지 않아요. 「실시간 이동 시연」을 이용해 주세요.', true); return; }
      liveStatus('내 위치를 찾고 있어요… (https 주소에서만 동작해요)');
      state.lastReroute = 0;
      LocationService.use(gps);
    } else {
      liveStatus('경로를 따라 이동하는 모습을 보여드려요 (시연).');
      // 실제 거리(수백 m)를 40초 정도에 보여주도록 배속 조절
      LocationService.use(SimulatedLocationProvider(state.route.points, { speedup: Math.max(6, state.route.totalDistance / 45) }));
    }
    state.live = mode;
    MapView.setLive(true);
    navHud(true);
    const b = $(LIVE[mode].btn);
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `${icon('stop')}<span>${LIVE[mode].on}</span>`;
  }

  function stopLive(clearStatus = true) {
    if (!state.live) return;
    const mode = state.live;
    state.live = null;
    LocationService.use(state.manual);
    MapView.setLive(false);
    navHud(false);
    const b = $(LIVE[mode].btn);
    if (b) {
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `${icon(LIVE[mode].icon)}<span>${LIVE[mode].off}</span>`;
    }
    if (clearStatus) liveStatus('');
  }

  // 위치를 경로 위에 투영: 가장 가까운 구간 번호, 구간 안 비율(t), 벗어난 거리(m)
  function projectOnRoute(p) {
    const pts = state.route.points;
    let best = { seg: 0, off: Infinity, t: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2));
      const off = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
      if (off < best.off) best = { seg: i, off, t };
    }
    // 경로 시작부터 이 지점까지 지도상 거리
    const pts2 = state.route.points;
    let along = 0;
    for (let i = 0; i < best.seg; i++) along += Math.hypot(pts2[i + 1].x - pts2[i].x, pts2[i + 1].y - pts2[i].y);
    along += best.t * Math.hypot(pts2[best.seg + 1].x - pts2[best.seg].x, pts2[best.seg + 1].y - pts2[best.seg].y);
    best.along = along;
    return best;
  }

  /* ---------- 내비게이션 상단 표시 (얼마나 왔고, 얼마나 남았는지) ---------- */
  function navHud(show) {
    const el = $('#nav-hud');
    if (!el) return;
    el.hidden = !show;
    if (show) updateNav(0);
  }
  function updateNav(along) {
    const el = $('#nav-hud');
    if (!el || el.hidden || !state.route) return;
    const geomTotal = MapView.routeLength || 1;
    const frac = Math.max(0, Math.min(1, along / geomTotal));
    const walked = Math.round(state.route.totalDistance * frac);
    const left = Math.max(0, state.route.totalDistance - walked);
    const secLeft = Math.max(0, state.route.estimatedSeconds * (1 - frac));
    const step = state.route.steps[StepGuide.index] || state.route.steps[0];
    el.innerHTML = `
      <p class="nav-step">${icon('arrowRight')}<span>${escapeHtml(step.text)}</span></p>
      <div class="nav-progress" role="progressbar" aria-label="이동 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(frac * 100)}">
        <span style="width:${(frac * 100).toFixed(1)}%"></span>
      </div>
      <p class="nav-meta"><span>지금까지 <strong>${walked}m</strong></span><span>남은 거리 <strong>${left}m</strong> · 약 ${Math.max(left > 0 ? 1 : 0, Math.ceil(secLeft / 60))}분</span></p>`;
  }

  // 위치 공급자에서 위치가 올 때마다
  function onLocation(pos) {
    if (!state.route) { MapView.setPosition(pos); return; }
    // 진행 방향 (직전 위치 → 지금 위치)
    let heading = null;
    if (state.lastPos && Math.hypot(pos.x - state.lastPos.x, pos.y - state.lastPos.y) > 0.5) {
      heading = (Math.atan2(pos.y - state.lastPos.y, pos.x - state.lastPos.x) * 180) / Math.PI;
      state.heading = heading;
    } else heading = state.heading ?? null;
    state.lastPos = { x: pos.x, y: pos.y };

    if (pos.source === 'simulated') {
      const pr = projectOnRoute(pos);
      const stepIdx = pos.done ? state.route.steps.length - 1 : state.segToStep[pos.segment];
      if (stepIdx !== undefined && stepIdx !== StepGuide.index) StepGuide.go(stepIdx, false);
      MapView.setPosition(pos, null, heading);
      MapView.setProgress(pos.done ? MapView.routeLength : pr.along);
      updateNav(pos.done ? MapView.routeLength : pr.along);
      if (pos.done) liveStatus('시연이 끝났어요. 「도착했어요」를 눌러 주세요.');
      return;
    }
    if (pos.source === 'gps') {
      MapView.setPosition(pos, pos.accuracyM, heading);
      const fromOrigin = Math.hypot(pos.x, pos.y);
      if (fromOrigin > 3000) {
        liveStatus(`지금 공항에서 약 ${(fromOrigin / 1000).toFixed(1)}km 떨어져 있어요. 공항 주차장에 도착하면 위치를 따라 안내해요. 지금은 「실시간 이동 시연」으로 미리 볼 수 있어요.`, true);
        return;
      }
      const pr = projectOnRoute(pos);
      const tolerance = OFF_ROUTE_M + Math.min(pos.accuracyM || 0, 30);
      if (pr.off > tolerance) {
        if (Date.now() - state.lastReroute < REROUTE_COOLDOWN_MS) return;
        state.lastReroute = Date.now();
        const r2 = Router.recommendFromPoint({ targetStallId: state.vehicle.location.stallId, preset: state.preset, point: pos, now: routeNow() });
        if (r2) {
          renderRoute(r2, true);
          MapView.setLive(true);
          updateNav(0);
          liveStatus(`경로에서 약 ${Math.round(pr.off)}m 벗어나 현재 위치에서 길을 다시 찾았어요.`);
        }
        return;
      }
      const stepIdx = state.segToStep[pr.seg];
      if (stepIdx !== undefined && stepIdx !== StepGuide.index) StepGuide.go(stepIdx, false);
      MapView.setProgress(pr.along);
      updateNav(pr.along);
      const end = state.route.points[state.route.points.length - 1];
      const toCar = Math.round(Math.hypot(pos.x - end.x, pos.y - end.y));
      liveStatus(toCar <= 10 ? '거의 다 왔어요. 주변의 내 차를 확인해 주세요.' : `위치를 따라 안내 중이에요 (정확도 약 ${Math.round(pos.accuracyM || 0)}m).`);
      return;
    }
    MapView.setPosition(pos);
  }

  /* ---------- ④ 도착 ---------- */
  function showArrival() {
    stopLive();
    setStage(4);
    StepGuide.renderArrival($('#stage-content'), state.vehicle, state.route, state.parking.fee, Verify.now, restart);
  }

  function restart() {
    stopLive();
    StepGuide.stop();
    state.vehicle = null;
    state.route = null;
    state.currentDoorId = null;
    MapView.clearRoute();
    Verify.renderSearch();
  }

  return { init, state };
})();

App.init();
