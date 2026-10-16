/* ==========================================================
 * location.js — 현재 위치 (LocationProvider 인터페이스)
 *
 * 모든 위치 공급자는 같은 모양을 가진다:
 *   {
 *     id, label,
 *     isAvailable(): boolean      이 기기·환경에서 쓸 수 있는지
 *     start(onUpdate): void       위치가 바뀔 때마다 onUpdate(position) 호출
 *     stop(): void
 *   }
 *   position = { x, y, floor, nodeId?, accuracyM, source, timestamp, progress? }
 *   (x, y 는 parking.json 의 SVG 좌표)
 *
 * 지금 있는 공급자
 *   - ManualLocationProvider    : 사용자가 층·출입문을 직접 선택
 *   - SimulatedLocationProvider : 경로를 따라 실시간으로 움직이는 시연용
 * 나중에 추가할 공급자 (같은 인터페이스로 끼우기만 하면 됨)
 *   - BLE 비콘 / UWB / Wi-Fi RTT → 실내 측위 결과를 SVG 좌표로 변환해 onUpdate 호출
 * ========================================================== */

const LocationService = (() => {
  let provider = null;
  let last = null;
  const listeners = new Set();

  // 사용할 공급자를 바꾼다 (이전 공급자는 정지)
  function use(p) {
    if (provider) provider.stop();
    provider = p;
    if (p && p.isAvailable()) p.start(emit);
  }

  function emit(pos) {
    last = pos;
    listeners.forEach((fn) => fn(pos));
  }

  // 위치 변화를 구독. 구독 해제 함수를 돌려준다
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function stop() {
    if (provider) provider.stop();
    provider = null;
  }

  return { use, subscribe, stop, get current() { return last; }, get provider() { return provider; } };
})();

/* ---------- 1) 수동 선택 공급자 ---------- */
// 사용자가 「3층 출국장 5번 출입문」처럼 고르면 그 위치를 알려준다
function ManualLocationProvider(nodes) {
  let cb = null;
  return {
    id: 'manual',
    label: '직접 선택',
    isAvailable: () => true,
    start(onUpdate) { cb = onUpdate; },
    stop() { cb = null; },
    // 출입문 선택
    select(doorId) {
      const n = nodes[doorId];
      if (!n || !cb) return;
      cb({ x: n.x, y: n.y, floor: n.floor, nodeId: n.id, accuracyM: 0, source: 'manual', timestamp: Date.now() });
    },
  };
}

/* ---------- 2) 모의 이동 공급자 (시연용 실시간 이동) ---------- */
// 경로 좌표 목록([{x,y}])을 따라 실제 걷는 속도 × 배속으로 위치를 계속 보낸다
function SimulatedLocationProvider(points, { metersPerUnit = 1, walkSpeed = 1.1, speedup = 6, tickMs = 100 } = {}) {
  let timer = null;
  const pts = points;
  const segLen = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = segLen.reduce((a, b) => a + b, 0);

  // 경로 시작점에서 d(SVG 단위)만큼 간 지점
  function at(d) {
    for (let i = 0; i < segLen.length; i++) {
      if (d <= segLen[i] || i === segLen.length - 1) {
        const t = segLen[i] ? Math.min(1, d / segLen[i]) : 1;
        const a = pts[i], b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, floor: b.floor, segment: i };
      }
      d -= segLen[i];
    }
    return { x: pts[0].x, y: pts[0].y, floor: pts[0].floor, segment: 0 };
  }

  return {
    id: 'simulated',
    label: '실시간 이동 시연',
    isAvailable: () => pts.length > 1,
    start(onUpdate) {
      let d = 0;
      const unitsPerTick = (walkSpeed * speedup * (tickMs / 1000)) / metersPerUnit;
      timer = setInterval(() => {
        d = Math.min(total, d + unitsPerTick);
        onUpdate({ ...at(d), accuracyM: 1, source: 'simulated', timestamp: Date.now(), progress: d / total, done: d >= total });
        if (d >= total) clearInterval(timer);
      }, tickMs);
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

/* ---------- 3) 실제 GPS 공급자 (야외 주차장에서 사용) ---------- */
// 브라우저 위치 기능(watchPosition)으로 실시간 위치를 받아 지도 좌표로 바꿔 보낸다.
// https 주소(또는 localhost)에서만 동작하며, 실내·지붕 아래에서는 오차가 커질 수 있다.
function GpsLocationProvider(onError) {
  let watchId = null;
  return {
    id: 'gps',
    label: '내 위치(GPS)',
    isAvailable: () => 'geolocation' in navigator,
    start(onUpdate) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          const { latitude: lat, longitude: lng, accuracy } = p.coords;
          onUpdate({ ...Router.toXY(lat, lng), lat, lng, accuracyM: accuracy, source: 'gps', timestamp: p.timestamp });
        },
        (err) => onError && onError(err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
      );
    },
    stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}

/* ---------- 4) 향후 확장 자리 (예시) ---------- */
// BLE 비콘 공급자: 현장에 비콘을 설치하고 비콘 id → SVG 좌표 표를 만든 뒤 구현
function BleBeaconLocationProvider() {
  return {
    id: 'ble',
    label: 'BLE 비콘 (준비 중)',
    isAvailable: () => false, // 현재 웹 브라우저에서 비콘 스캔은 제한적 → 네이티브 앱/현장 설치 필요
    start() {},
    stop() {},
  };
}

/* ---------- 현재 위치 선택 화면 ---------- */
const LocationPicker = (() => {
  /**
   * 층(1층 입국장 / 3층 출국장)과 출입문 번호를 고르는 버튼을 그린다.
   * @param container  그릴 요소
   * @param parking    parking.json (출입문 목록은 여기서만 읽음)
   * @param selectedId 현재 선택된 출입문 id (없으면 null)
   * @param onChange   (doorId | null) => void
   */
  function render(container, parking, selectedId, onChange) {
    const doors = parking.nodes.filter((n) => n.type === 'door');
    const floors = [...new Set(doors.map((d) => d.floor))].sort();
    let floor = selectedId ? doors.find((d) => d.id === selectedId).floor : null;

    const draw = (focusKey) => {
      container.innerHTML = `
        <div class="choice-grid" role="group" aria-label="지금 계신 층">
          ${floors.map((f) => `<button type="button" class="choice" data-floor="${f}" data-key="floor:${f}" aria-pressed="${floor === f}">
            ${icon('location')}<span>${Router.floorArea(f)}</span></button>`).join('')}
          <button type="button" class="choice" data-floor="" data-key="floor:none" aria-pressed="${!floor}">
            <span>잘 모르겠어요</span></button>
        </div>
        ${floor ? `
          <p class="field-label" id="door-pick-label">가까운 출입문 번호</p>
          <div class="choice-grid" role="group" aria-labelledby="door-pick-label">
            ${doors.filter((d) => d.floor === floor).map((d) => `<button type="button" class="choice" data-door="${d.id}" data-key="door:${d.id}" aria-pressed="${d.id === selectedId}">
              <span>${d.doorNumber}번</span></button>`).join('')}
          </div>` : ''}`;
      if (focusKey) {
        const el = container.querySelector(`[data-key="${focusKey}"]`);
        if (el) el.focus();
      }
    };

    container.onclick = (e) => {
      const fb = e.target.closest('[data-floor]');
      const db = e.target.closest('[data-door]');
      if (fb) {
        floor = fb.dataset.floor || null;
        const sel = doors.find((d) => d.id === selectedId);
        if (selectedId && (!floor || sel.floor !== floor)) { selectedId = null; onChange(null); }
        draw(fb.dataset.key);
      } else if (db) {
        selectedId = db.dataset.door;
        onChange(selectedId);
        draw(db.dataset.key);
      }
    };
    draw();
  }

  return { render };
})();
