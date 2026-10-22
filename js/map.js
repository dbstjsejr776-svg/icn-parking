/* ==========================================================
 * map.js — 실제 지도(Leaflet + OpenStreetMap) + 경로 표시 + 단계별 안내 카드
 * - MapView  : OSM 지도 위에 주차장 외곽선·주차칸·보행로·출입문·경로·내 차·현재 위치 표시
 *              실시간 안내(내비게이션): 지나온 길 회색, 남은 길 보라, 방향 화살표, 내 위치 따라가기
 * - StepGuide: router.js 결과(steps)를 카드로 한 단계씩 안내
 * ========================================================== */

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 경로 색상: 지도 배경의 파란 보행로와 겹치지 않도록 보라(남은 길)·주황(현재 단계)·회색(지나온 길) */
const ROUTE_COLORS = {
  remaining: '#6D28D9',   // 남은 경로 (보라)
  active: '#EA580C',      // 현재 단계 (주황)
  walked: '#6B7280',      // 지나온 길 (회색)
  casing: '#FFFFFF',      // 테두리
};

const MapView = (() => {
  let map, data;
  let stallRenderer;                 // 주차칸 전용 캔버스
  const layers = {};
  let route = null;
  let geom = null;                   // 경로 좌표·누적 거리
  let progress = 0;                  // 지나온 거리(m, 지도상)
  let carStallId = null;
  let taken = new Set();             // 다른 차량이 있는 칸
  let fullBounds = null;
  let arrowTimer = null;
  let activeLatLngs = [];            // 현재 단계 구간 (점검용)
  let live = false;                  // 실시간 안내 중
  let follow = true;                 // 내 위치 따라가기
  let picking = null;                // 칸 고르기 콜백
  let recenterBtn = null;
  let tileLayer = null;
  let tileProblem = null;            // (failed: boolean) => void  — 지도 이미지 로딩 결과 알림
  const STALL_ZOOM = 18;             // 이 확대 수준부터 주차칸 표시
  const LABEL_ZOOM = 20;             // 이 확대 수준부터 칸 번호 표시

  const LL = (p) => Router.toLatLng(p);
  const icon = (html, cls, size) => L.divIcon({ className: cls || '', html, iconSize: size || null });

  /* ---------- 초기화 ---------- */
  // 지도 컨테이너와 parking.json 을 받아 실제 지도를 만든다
  function init(container, parking) {
    data = parking;
    container.innerHTML = '';
    map = L.map(container, { zoomControl: false, maxZoom: 21, keyboard: true, attributionControl: true });
    const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    if (window.__TILES) {
      // 한 파일로 묶은 공유용 페이지: 공항 주변 지도 이미지를 페이지 안에 담아 둠 (외부 이미지 차단 환경용)
      const T = window.__TILES;
      const Packed = L.TileLayer.extend({
        getTileUrl: (c) => T.tiles[`${c.z}/${c.x}/${c.y}`] || T.blank,
      });
      tileLayer = new Packed('', { minZoom: T.minZoom, maxZoom: 21, maxNativeZoom: T.maxZoom, attribution }).addTo(map);
      map.setMinZoom(T.minZoom);
      map.setMaxBounds(L.latLngBounds(T.bounds).pad(0.15));
    } else {
      tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution }).addTo(map);
    }
    // 지도 이미지(타일) 로딩 실패 감지: 한 화면에서 여러 장이 실패하고 하나도 못 받으면 알림
    let tileOk = 0, tileFail = 0;
    tileLayer.on('loading', () => { tileOk = 0; tileFail = 0; });
    tileLayer.on('tileload', () => { tileOk++; });
    tileLayer.on('tileerror', () => { tileFail++; });
    tileLayer.on('load', () => { if (tileProblem) tileProblem(tileFail >= 3 && tileOk === 0); });
    // 지도 영역 크기가 바뀌면(안내 표시가 열리거나 화면 회전 등) 타일·경로선을 다시 맞춤
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(container);
    stallRenderer = L.canvas({ padding: 0.2 });

    ['lots', 'walk', 'stalls', 'labels', 'nodes', 'route', 'chev', 'active', 'marks'].forEach((k) => { layers[k] = L.layerGroup().addTo(map); });
    drawLots();
    drawWalkways();
    drawTransit();
    drawNodes();

    const pts = [];
    data.lots.forEach((l) => pts.push(...l.polygon));
    data.nodes.filter((n) => n.type === 'door').forEach((n) => pts.push([n.lat, n.lng]));
    fullBounds = L.latLngBounds(pts);
    map.fitBounds(fullBounds, { padding: [10, 10] });

    map.on('moveend zoomend', drawStalls);
    map.on('zoomend', drawChevrons);
    map.on('dragstart', () => { if (live && follow) { follow = false; showRecenter(true); } });
    map.on('click', onMapClick);
    addRecenterControl();
    drawStalls();
  }

  // 주차장 외곽선 + 이름
  function drawLots() {
    data.lots.forEach((l) => {
      L.polygon(l.polygon, { color: '#0B5CAD', weight: 2, dashArray: '6 4', fillColor: '#E8F1FB', fillOpacity: 0.15, interactive: false }).addTo(layers.lots);
      const c = L.polygon(l.polygon).getBounds().getCenter();
      L.marker(c, { icon: icon(`<span class="lot-label">${l.id}</span>`, 'lot-label-wrap'), interactive: false, keyboard: false }).addTo(layers.lots);
    });
  }

  // 보행로: 연한 하늘색 얇은 선 (경로 색과 겹치지 않게), 횡단보도 = 줄무늬
  function drawWalkways() {
    const N = Router.nodes;
    data.edges.forEach((e) => {
      const a = N[e.from], b = N[e.to];
      if (!a || !b || e.indoor) return;
      const line = [LL(a), LL(b)];
      if (e.type === 'crosswalk') {
        L.polyline(line, { color: '#FFFFFF', weight: 12, opacity: 1, interactive: false }).addTo(layers.walk);
        L.polyline(line, { color: '#1A2433', weight: 12, dashArray: '3 4', lineCap: 'butt', interactive: false }).addTo(layers.walk);
      } else {
        L.polyline(line, { color: '#60A5FA', weight: 3, opacity: 0.55, dashArray: e.type === 'passage' ? '6 5' : null, interactive: false }).addTo(layers.walk);
      }
    });
  }

  // 실제 셔틀버스 노선(청록 점선)·자기부상철도(노랑 점선) + 정류장·역 (OpenStreetMap)
  function drawTransit() {
    const color = { bus: '#0F766E', maglev: '#A16207' };
    (data.transit || []).forEach((T) => {
      L.polyline(T.line, { color: color[T.mode] || '#0F766E', weight: 4, opacity: 0.75, dashArray: '10 6', interactive: false }).addTo(layers.walk);
      T.stops.forEach((id) => {
        const n = data.nodes.find((x) => x.id === id);
        if (!n) return;
        L.marker([n.lat, n.lng], {
          icon: icon(`<span class="stop-mark ${T.mode}">${typeof window.icon === 'function' ? window.icon('bus', 16) : ''}</span>`, 'stop-wrap'),
          title: `${n.name} — ${T.name}`, keyboard: false,
        }).bindTooltip(n.name, { direction: 'top', offset: [0, -12] }).addTo(layers.nodes);
      });
    });
  }

  // 출입문 번호, 차량 입구·출구
  function drawNodes() {
    const seen = new Set();
    data.nodes.filter((n) => n.type === 'door').forEach((n) => {
      if (seen.has(n.doorNumber)) return;   // 1층·3층 출입문은 같은 위치 → 하나만 표시
      seen.add(n.doorNumber);
      L.marker([n.lat, n.lng], { icon: icon(`<span class="door-mark">${n.doorNumber}</span>`, 'door-mark-wrap'), title: `${n.doorNumber}번 출입문 (1층 입국장·3층 출국장)`, keyboard: false })
        .addTo(layers.nodes);
    });
    (data.vehicleGates || []).forEach((g) => {
      const isIn = g.type === 'in';
      L.marker([g.lat, g.lng], { icon: icon(`<span class="gate-mark ${isIn ? 'gate-in' : 'gate-out'}">${isIn ? 'IN' : 'OUT'}</span>`, 'gate-wrap'), title: g.name, keyboard: false }).addTo(layers.nodes);
    });
  }

  /* ---------- 주차칸 (확대했을 때, 화면에 보이는 부분만) ---------- */
  let pickedId = null;
  function drawStalls() {
    layers.stalls.clearLayers();
    layers.labels.clearLayers();
    const z = map.getZoom();
    if (z < STALL_ZOOM) return;
    const b = map.getBounds().pad(0.1);
    let labels = 0;
    Object.values(Router.stalls).forEach((s) => {
      const c = LL(s.center);
      if (!b.contains(c)) return;
      const mine = s.id === carStallId;
      const picked = s.id === pickedId;
      L.polygon(s.corners.map(LL), {
        renderer: stallRenderer, weight: mine || picked ? 3 : 0.8,
        color: picked ? '#1E7B3A' : mine ? '#B42318' : '#8A97A8',
        fillColor: picked ? '#E7F4EA' : mine ? '#FDECEA' : taken.has(s.id) ? '#C9D1DB' : '#FFFFFF', fillOpacity: 0.9, interactive: false,
      }).addTo(layers.stalls);
      if (z >= LABEL_ZOOM && labels < 400) {
        labels++;
        L.marker(c, { icon: icon(`<span class="stall-num">${s.number}</span>`, 'stall-num-wrap'), interactive: false, keyboard: false }).addTo(layers.labels);
      }
    });
  }

  function setOccupied(ids) {
    taken = new Set(ids);
    drawStalls();
  }

  /* ---------- 지도에서 주차칸 고르기 (내 차 등록) ---------- */
  function pickStall(cb, focusId) {
    picking = cb;
    map.getContainer().classList.add('is-picking');
    if (focusId) showPicked(focusId, true);
    else if (map.getZoom() < STALL_ZOOM) fitAll();
  }
  function endPick() {
    picking = null;
    pickedId = null;
    if (map) { map.getContainer().classList.remove('is-picking'); drawStalls(); }
  }
  // 고른 칸 강조 (focus: 그 칸으로 지도 이동)
  function showPicked(id, focus) {
    pickedId = id;
    if (focus) map.setView(LL(Router.stalls[id].center), 20);
    drawStalls();
  }
  function onMapClick(e) {
    if (!picking) return;
    if (map.getZoom() < STALL_ZOOM) { map.setView(e.latlng, 19); return; }   // 너무 멀면 먼저 확대
    const id = Router.stallIdAt(Router.toXY(e.latlng.lat, e.latlng.lng));
    if (!id) return;
    showPicked(id, false);
    picking(id);
  }

  /* ---------- 경로 ---------- */
  // 경로 좌표의 누적 거리 (지나온 길·화살표 계산용)
  function buildGeom(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return { pts: points, cum, total: cum[cum.length - 1] };
  }
  // 경로 시작에서 d(m) 지점의 좌표와 진행 방향(도)
  function pointAt(g, d) {
    d = Math.max(0, Math.min(g.total, d));
    let i = 1;
    while (i < g.pts.length - 1 && g.cum[i] < d) i++;
    const a = g.pts[i - 1], b = g.pts[i];
    const len = g.cum[i] - g.cum[i - 1];
    const t = len ? (d - g.cum[i - 1]) / len : 0;
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, i };
  }
  // d 지점에서 경로를 둘로 나눔 → [지나온 길, 남은 길]
  function splitAt(g, d) {
    const { p, i } = pointAt(g, d);
    return [[...g.pts.slice(0, i), p], [p, ...g.pts.slice(i)]];
  }

  // router.recommend() 결과를 지도에 그린다
  function showRoute(r) {
    route = r;
    geom = buildGeom(r.points);
    progress = 0;
    carStallId = r.targetStallId;
    layers.route.clearLayers();
    // 지나온 길(회색) + 남은 길(보라). 두 선 모두 흰 테두리로 지도 위에서 잘 보이게
    layers.walkedCase = L.polyline([], { color: ROUTE_COLORS.casing, weight: 12, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.route);
    layers.walked = L.polyline([], { color: ROUTE_COLORS.walked, weight: 7, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.route);
    layers.remainCase = L.polyline([], { color: ROUTE_COLORS.casing, weight: 12, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.route);
    layers.remain = L.polyline([], { color: ROUTE_COLORS.remaining, weight: 7, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.route);
    if (r.exitDoorId) {
      const d = Router.nodes[r.exitDoorId];
      L.circleMarker(LL(d), { radius: 18, color: ROUTE_COLORS.active, weight: 3, dashArray: '5 4', fill: false, interactive: false }).addTo(layers.route);
    }
    // 단계마다 경로상 시작·끝 거리 (실시간 안내 때 현재 단계 강조를 내 위치부터 그리기 위해)
    stepRanges = [];
    let idx = 0;
    r.steps.forEach((s) => {
      const n = Math.max(1, s.points.length);
      stepRanges.push([geom.cum[Math.min(idx, geom.cum.length - 1)], geom.cum[Math.min(idx + n - 1, geom.cum.length - 1)]]);
      idx += n - 1;
    });
    setProgress(0);
    drawCar();
    drawStalls();
    setActiveStep(0);
  }
  let stepRanges = [];
  let activeIndex = 0;

  // geom 에서 d0~d1 구간의 좌표
  function sliceGeom(g, d0, d1) {
    const a = pointAt(g, d0), b = pointAt(g, d1);
    const mid = g.pts.filter((_, k) => g.cum[k] > d0 && g.cum[k] < d1);
    return [a.p, ...mid, b.p];
  }

  // 실시간 안내 중: 현재 단계 중 아직 안 간 부분만 주황으로
  function drawActiveLive() {
    layers.active.clearLayers();
    const range = stepRanges[activeIndex];
    if (!range || !geom) return;
    const d0 = Math.max(progress, range[0]);
    if (range[1] - d0 < 1) return;
    const pts = sliceGeom(geom, d0, range[1]).map(LL);
    L.polyline(pts, { color: ROUTE_COLORS.casing, weight: 14, lineJoin: 'round', lineCap: 'round', opacity: 0.9, interactive: false }).addTo(layers.active);
    L.polyline(pts, { color: ROUTE_COLORS.active, weight: 9, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.active);
  }

  // 지나온 거리(m)를 반영: 지나온 길은 회색, 남은 길은 보라 + 방향 화살표
  function setProgress(d) {
    if (!geom) return;
    progress = Math.max(0, Math.min(geom.total, d));
    const [walked, remain] = splitAt(geom, progress);
    const w = progress > 0.5 ? walked.map(LL) : [];
    layers.walkedCase.setLatLngs(w);
    layers.walked.setLatLngs(w);
    layers.remainCase.setLatLngs(remain.map(LL));
    layers.remain.setLatLngs(remain.map(LL));
    drawChevrons();
    if (live) drawActiveLive();
  }

  // 남은 경로 선 안에 일정 간격(화면 약 70px)으로 진행 방향 화살표(›)
  function drawChevrons() {
    layers.chev.clearLayers();
    if (!geom || !map) return;
    const lat = map.getCenter().lat;
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
    const step = Math.max(4, 70 * mPerPx);
    let n = 0;
    for (let d = progress + step / 2; d < geom.total - step / 3 && n < 200; d += step, n++) {
      const { p, deg } = pointAt(geom, d);
      L.marker(LL(p), { icon: icon(`<span class="chev" style="transform:rotate(${deg}deg)"></span>`, 'chev-wrap'), interactive: false, keyboard: false }).addTo(layers.chev);
    }
  }

  // 현재 단계 구간만 주황으로 강조
  function setActiveStep(i) {
    if (!route) return;
    const step = route.steps[i];
    activeIndex = i;
    layers.active.clearLayers();
    stopArrows();
    const pts = step.points.map(LL);
    activeLatLngs = pts;
    const lenM = step.points.slice(1).reduce((a, p, k) => a + Math.hypot(p.x - step.points[k].x, p.y - step.points[k].y), 0);
    if (live && pts.length >= 2 && lenM >= 3) { drawActiveLive(); return; }   // 실시간 안내: 내 위치부터 강조, 지도는 내 위치를 따라감
    if (pts.length < 2 || lenM < 3) {   // 출입문·층 이동처럼 지도상 길이가 거의 없는 단계
      L.circleMarker(pts[0], { radius: 16, color: ROUTE_COLORS.active, weight: 4, fill: false, interactive: false }).addTo(layers.active);
      if (!live) {
        setPosition(step.points[0]);
        map.setView(pts[0], step.kind === 'arrive' ? 20 : 19);
      }
      return;
    }
    L.polyline(pts, { color: ROUTE_COLORS.casing, weight: 14, lineJoin: 'round', lineCap: 'round', opacity: 0.9, interactive: false }).addTo(layers.active);
    L.polyline(pts, { color: ROUTE_COLORS.active, weight: 9, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(layers.active);
    startArrows(step.points);
    if (!live) {
      setPosition(step.points[0]);
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: step.kind === 'aisle' ? 20 : 19 });
    }
  }

  /* ---------- 현재 단계 화살표 (경로를 따라 움직임) ---------- */
  function arrowIcon(deg) {
    return icon(`<span class="move-arrow" style="transform:rotate(${deg}deg)"></span>`, 'move-arrow-wrap');
  }
  function startArrows(points) {
    const g = buildGeom(points);
    // 끝 화살표는 항상 표시 (움직임 줄이기 설정에서도 방향을 알 수 있게)
    const end = pointAt(g, g.total);
    L.marker(LL(end.p), { icon: arrowIcon(end.deg), interactive: false, keyboard: false }).addTo(layers.active);
    if (reduceMotion() || g.total < 1) return;
    const arrows = [0, 1, 2].map(() => L.marker(LL(points[0]), { icon: arrowIcon(0), interactive: false, keyboard: false }).addTo(layers.active));
    const speed = Math.max(15, g.total / 4);   // m/초 (짧은 구간도 4초 안에 한 바퀴)
    const t0 = performance.now();
    const tick = (now) => {
      arrows.forEach((m, k) => {
        const d = (((now - t0) / 1000) * speed + (g.total * k) / 3) % g.total;
        const { p, deg } = pointAt(g, d);
        m.setLatLng(LL(p));
        const el = m.getElement() && m.getElement().firstChild;
        if (el) el.style.transform = `rotate(${deg}deg)`;
      });
      arrowTimer = requestAnimationFrame(tick);
    };
    arrowTimer = requestAnimationFrame(tick);
  }
  function stopArrows() {
    if (arrowTimer) cancelAnimationFrame(arrowTimer);
    arrowTimer = null;
  }

  /* ---------- 내 차 / 현재 위치 ---------- */
  function drawCar() {
    layers.marks.eachLayer((m) => { if (m.options.isCar) layers.marks.removeLayer(m); });
    if (!carStallId) return;
    const s = Router.stalls[carStallId];
    L.marker(LL(s.center), { icon: icon('<span class="car-pin"><span>내 차</span></span>', 'car-pin-wrap'), isCar: true, title: '내 차: ' + Router.stallLabel(carStallId), keyboard: false, zIndexOffset: 900 })
      .addTo(layers.marks);
  }

  let meMarker = null, meCircle = null;
  /**
   * 현재 위치 표시
   * @param pos {x,y} 미터 좌표
   * @param accuracyM 정확도(m) — 있으면 오차 범위 원 표시
   * @param headingDeg 진행 방향(도, 지도 좌표 기준) — 있으면 방향 표시
   */
  function setPosition(pos, accuracyM, headingDeg) {
    if (!pos) return;
    const p = LL(pos);
    if (!meMarker) {
      meMarker = L.marker(p, { icon: icon('<span class="me"><span class="me-pulse"></span><span class="me-heading"></span><span class="me-dot"></span></span>', 'me-wrap'), title: '현재 위치', keyboard: false, zIndexOffset: 1000 }).addTo(layers.marks);
    } else meMarker.setLatLng(p);
    const el = meMarker.getElement();
    if (el) {
      const h = el.querySelector('.me-heading');
      if (h) { h.style.display = headingDeg === undefined || headingDeg === null ? 'none' : 'block'; h.style.transform = `rotate(${headingDeg || 0}deg)`; }
    }
    if (accuracyM) {
      if (!meCircle) meCircle = L.circle(p, { radius: accuracyM, color: '#0B5CAD', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layers.marks);
      else meCircle.setLatLng(p).setRadius(accuracyM);
    }
    if (live && follow) map.panTo(p, { animate: !reduceMotion(), duration: 0.3 });
  }
  function followPosition(pos) {
    map.panTo(LL(pos), { animate: !reduceMotion() });
  }

  /* ---------- 실시간 안내 모드 (내비게이션) ---------- */
  function setLive(on) {
    live = on;
    follow = true;
    showRecenter(false);
    if (on && map.getZoom() < 19) map.setZoom(19);
    if (route) {
      if (!on) setProgress(0);
      setActiveStep(activeIndex);   // 실시간 ↔ 일반 표시 전환
    }
  }
  // 지도를 끌어 옮기면 따라가기를 멈추고 「내 위치로」 버튼 표시
  function addRecenterControl() {
    const Ctl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const b = L.DomUtil.create('button', 'btn btn-primary map-recenter');
        b.type = 'button';
        b.innerHTML = `${typeof window.icon === 'function' ? window.icon('location') : ''}<span>내 위치로</span>`;
        b.hidden = true;
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener('click', () => { follow = true; showRecenter(false); if (meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 19)); });
        recenterBtn = b;
        return b;
      },
    });
    map.addControl(new Ctl());
  }
  function showRecenter(show) { if (recenterBtn) recenterBtn.hidden = !show; }

  function clearRoute() {
    route = null;
    geom = null;
    carStallId = null;
    live = false;
    stopArrows();
    layers.route.clearLayers();
    layers.chev.clearLayers();
    layers.active.clearLayers();
    layers.marks.clearLayers();
    meMarker = meCircle = null;
    showRecenter(false);
    drawStalls();
    fitAll();
  }

  /* ---------- 확대·축소·이동 ---------- */
  function zoomBy(factor) { if (factor < 1) map.zoomIn(); else map.zoomOut(); }
  function fitAll() { map.fitBounds(fullBounds, { padding: [10, 10] }); }
  function focusCar() {
    if (!carStallId) return;
    map.setView(LL(Router.stalls[carStallId].center), 20);
  }
  function invalidate() { if (map) map.invalidateSize(); }
  function onTileProblem(cb) { tileProblem = cb; }
  function retryTiles() { if (tileLayer) tileLayer.redraw(); }
  // 지도를 이 위치로 바로 옮김 (실시간 안내 시작 때 첫 화면부터 움직임이 보이게)
  function jumpTo(pos, zoom = 19) { if (map && pos) map.setView(LL(pos), Math.max(map.getZoom(), zoom), { animate: false }); }

  return {
    init, showRoute, setActiveStep, setPosition, followPosition, setOccupied, clearRoute, zoomBy, fitAll, focusCar, invalidate,
    setProgress, setLive, pickStall, endPick, showPicked, onTileProblem, retryTiles, jumpTo,
    get routeLength() { return geom ? geom.total : 0; },
    debug: () => ({ activeLatLngs, zoom: map.getZoom(), progress, chevrons: layers.chev.getLayers().length, follow, live }),
  };
})();

/* ==========================================================
 * StepGuide — 단계별 안내 카드
 * ========================================================== */
const StepGuide = (() => {
  const KIND_ICON = {
    exit: 'door', indoor: 'walk', sidewalk: 'walk', crosswalk: 'crosswalk', transit: 'bus',
    elevator: 'elevator', escalator: 'escalator', stairs: 'stairs', arrive: 'pin',
  };
  let route, index, box, opts;
  const canSpeak = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

  /**
   * 안내 카드를 그린다.
   * @param container  카드가 들어갈 요소
   * @param r          router.recommend() 결과
   * @param options    { onArrive(), onStepChange(i) }
   */
  function render(container, r, options = {}) {
    box = container;
    route = r;
    opts = options;
    index = 0;
    box.innerHTML = `
      <div class="step-card" id="step-card" tabindex="-1" aria-live="polite"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="step-prev">${icon('arrowLeft')}<span>이전 단계</span></button>
        <button type="button" class="btn btn-primary" id="step-next"><span>다음 단계</span>${icon('arrowRight')}</button>
      </div>
      <button type="button" class="btn btn-outline btn-block" id="step-speak" ${canSpeak() ? '' : 'hidden'}>${icon('speaker')}<span>음성 안내 듣기</span></button>
      <details class="step-overview">
        <summary>전체 단계 보기 (${r.steps.length}단계)</summary>
        <ol class="step-list">${r.steps.map((s, i) => `<li><button type="button" class="step-jump" data-step="${i}">${i + 1}. ${escapeHtml(s.text)}</button></li>`).join('')}</ol>
      </details>`;
    box.querySelector('#step-prev').addEventListener('click', () => go(index - 1));
    box.querySelector('#step-next').addEventListener('click', () => {
      if (index === route.steps.length - 1) opts.onArrive && opts.onArrive();
      else go(index + 1);
    });
    box.querySelector('#step-speak').addEventListener('click', speakCurrent);
    box.querySelectorAll('.step-jump').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step))));
    go(0, false);
  }

  // i 번째 단계로 이동
  function go(i, moveFocus = true) {
    if (!route || i < 0 || i >= route.steps.length) return;
    index = i;
    const s = route.steps[i];
    const total = route.steps.length;
    const sec = Router.stepSeconds(s, route.preset);
    const meta = s.distance > 0 ? `약 ${s.distance}m · ${Math.max(1, Math.round(sec / 60))}분` : (s.kind === 'arrive' ? '목적지' : '지금 이곳');
    const card = box.querySelector('#step-card');
    card.className = 'step-card' + (s.caution ? ' is-caution' : '') + (s.kind === 'arrive' ? ' is-arrive' : '');
    card.innerHTML = `
      <div class="step-top">
        <span class="step-badge">단계 ${i + 1} / ${total}</span>
        <span class="step-meta">${meta}</span>
      </div>
      <div class="step-body">
        <span class="step-icon">${icon(KIND_ICON[s.kind] || 'walk', 44)}</span>
        <p class="step-text">${escapeHtml(s.text)}</p>
      </div>
      ${s.cautionText ? `<p class="step-caution">${icon('alert')}<span>${escapeHtml(s.cautionText)}</span></p>` : ''}`;

    box.querySelector('#step-prev').disabled = i === 0;
    const next = box.querySelector('#step-next');
    next.innerHTML = i === total - 1 ? `<span>도착했어요</span>${icon('check')}` : `<span>다음 단계</span>${icon('arrowRight')}`;
    box.querySelectorAll('.step-jump').forEach((b) => b.toggleAttribute('aria-current', Number(b.dataset.step) === i));

    MapView.setActiveStep(i);
    opts.onStepChange && opts.onStepChange(i);
    if (moveFocus) card.focus();
  }

  // Web Speech API 로 현재 카드 문장을 한국어로 읽기
  function speakCurrent() {
    if (!canSpeak() || !route) return;
    const s = route.steps[index];
    const u = new SpeechSynthesisUtterance(`${index + 1}단계. ${s.text}. ${s.cautionText || ''}`);
    u.lang = 'ko-KR';
    u.rate = 0.9; // 고령층을 위해 조금 천천히
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function stop() {
    if (canSpeak()) window.speechSynthesis.cancel();
  }

  // 마지막 단계 이후 「도착했어요」 화면
  function renderArrival(container, vehicle, r, fee, now, onRestart) {
    stop();
    // 주차칸 번호로만 찾은 경우에는 차량 번호·입차 시각이 없음
    const hasEntry = !!vehicle.entryTime;
    const minutes = hasEntry ? Math.max(0, Math.round((Math.max(now, new Date(vehicle.entryTime)) - new Date(vehicle.entryTime)) / 60000)) : 0;
    container.innerHTML = `
      <div class="arrive-hero">
        <span class="arrive-icon">${icon('check', 48)}</span>
        <h2 class="title-lg" tabindex="-1" id="arrive-title">도착했어요</h2>
      </div>
      <div class="card-inner">
        ${vehicle.plateFull ? `<p class="plate-big">${escapeHtml(formatPlate(vehicle.plateFull))}</p>` : ''}
        <dl class="info-list">
          <div><dt>주차 위치</dt><dd>${escapeHtml(Router.stallPlace(vehicle.location.stallId))}</dd></div>
          <div><dt>나온 출입문</dt><dd>${escapeHtml(r.exitDoorLabel)}</dd></div>
          <div><dt>걸은 거리</dt><dd>약 ${r.totalDistance}m</dd></div>
          ${hasEntry ? `<div><dt>입차 시각</dt><dd>${formatDateTime(vehicle.entryTime)}</dd></div>` : ''}
        </dl>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="fee-btn" aria-expanded="false" aria-controls="fee-box">${icon('receipt')}<span>주차요금 확인</span></button>
      <div id="fee-box" class="notice" hidden>
        ${hasEntry ? `
        <p class="fee-amount">예상 주차요금 <strong>${calcFee(minutes, fee).toLocaleString('ko-KR')}원</strong></p>
        <p>주차 시간 ${Math.floor(minutes / 60)}시간 ${minutes % 60}분 · ${fee.unitMinutes}분당 ${fee.unitFee.toLocaleString('ko-KR')}원, 하루 최대 ${fee.dailyMax.toLocaleString('ko-KR')}원</p>`
        : '<p>주차칸 번호로 찾아서 입차 시각을 알 수 없어요. 출차할 때 정산기에서 확인해 주세요.</p>'}
        <p class="muted">※ 목업 요금입니다. 실제 요금은 출차 시 정산기에서 확인하세요.</p>
      </div>
      <button type="button" class="btn btn-secondary btn-block" id="restart-btn">${icon('home')}<span>처음으로</span></button>`;
    const feeBtn = container.querySelector('#fee-btn');
    feeBtn.addEventListener('click', () => {
      const box2 = container.querySelector('#fee-box');
      box2.hidden = !box2.hidden;
      feeBtn.setAttribute('aria-expanded', String(!box2.hidden));
    });
    container.querySelector('#restart-btn').addEventListener('click', onRestart);
    container.querySelector('#arrive-title').focus();
  }

  // 요금 계산 (요금 체계는 parking.json 의 fee 값)
  function calcFee(minutes, fee) {
    const billable = Math.max(0, minutes - (fee.freeMinutes || 0));
    const days = Math.floor(billable / 1440);
    const rest = billable % 1440;
    return days * fee.dailyMax + Math.min(Math.ceil(rest / fee.unitMinutes) * fee.unitFee, fee.dailyMax);
  }

  return { render, go, stop, renderArrival, get index() { return index; } };
})();
