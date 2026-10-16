/* ==========================================================
 * router.js — 경로 탐색 엔진
 * parking.json(실제 위경도)의 노드·엣지로 그래프를 만들고, 다익스트라로
 * "가장 가까운" 출입문이 아니라 "안전하고 빠른" 출입문을 추천한다.
 * - 좌표: 위경도 → 기준점(meta.origin)에서의 미터 좌표(x 동쪽+, y 남쪽+)로 변환해 계산
 * - 주차칸: 실제 주차장 외곽선(OpenStreetMap) 안에 배치 규칙으로 생성
 * ========================================================== */

/* ---------- 조정 가능한 가중치 (단위: 미터로 환산한 비용) ---------- */
const ROUTE_CONFIG = {
  // 걷는 속도 (m/초) — 예상 시간 계산용
  walkSpeed: { fastest: 1.2, safest: 1.1, accessible: 0.8 },
  // 횡단보도 신호 대기 평균 (초) — 예상 시간 계산용 (가정값)
  crosswalkWaitSec: 30,

  presets: {
    // 빠른 길: "걸리는 시간"만 본다 (신호·엘리베이터 대기는 시간으로 환산)
    fastest: {
      label: '가장 빠른 길',
      description: '시간이 가장 짧은 길',
      distance: 1.0,          // 보행거리 1m = 비용 1
      crosswalk: 36,          // 횡단보도 신호 대기 ≈ 30초 × 1.2m/s
      vehicleLane: 0,         // 차도 옆 1m 마다 (빠른 길은 고려 안 함)
      aisle: 0,               // 주차장 통로(차가 다니는 곳) 안 1m 마다
      stairs: 0,              // 계단 1번 (오히려 빠름)
      escalator: 0,           // 에스컬레이터 1번
      elevatorWaitPerSec: 1.2,// 엘리베이터 대기 1초 = 1.2m
      congestion: 0,          // 출발 출입문 혼잡도(0~1) × 이 값 (빠른 길은 순수 이동 시간만)
      transitPerSec: 1.2,     // 셔틀·열차: (기다림 + 탑승) 1초 = 1.2m (걷는 시간과 같은 기준)
    },
    // 안전한 길: 차와 마주칠 수 있는 구간을 최대한 줄인다
    safest: {
      label: '가장 안전한 길',
      description: '차도 옆·주차장 통로를 덜 걷는 길',
      distance: 1.0,
      crosswalk: 150,
      vehicleLane: 2.5,
      aisle: 5.0,
      stairs: 20,
      escalator: 5,
      elevatorWaitPerSec: 1,
      congestion: 60,
      transitPerSec: 0.6,     // 셔틀을 타면 차도 옆·주차장 안을 덜 걸으므로 기다리더라도 선호
    },
    // 무장애: 계단·에스컬레이터 없이, 덜 붐비는 길
    accessible: {
      label: '무장애 경로',
      description: '유모차·휠체어·큰 짐 — 계단 없는 길',
      distance: 1.0,
      crosswalk: 60,
      vehicleLane: 0.5,
      aisle: 1.0,
      stairs: 100000,         // 사실상 이용 불가
      escalator: 100000,      // 휠체어·유모차는 에스컬레이터도 불가
      elevatorWaitPerSec: 0.5,// 엘리베이터는 꼭 필요하므로 대기 부담을 낮게
      congestion: 200,        // 붐비는 출입문은 휠체어·유모차에 특히 불편
      transitPerSec: 0.5,     // 오래 걷기 어려운 경우 타는 편을 선호
    },
  },
};

const Router = (() => {
  let data = null;   // parking.json 전체
  let nodes = {};    // id → 노드 (x, y 미터 좌표 포함)
  let adj = {};      // id → [{ to, edge }]
  let stalls = {};   // 주차칸 id('P2-B-015') → 주차칸
  let lotIndex = {}; // 주차장 id → 주차칸 격자 색인 (안전 점검용)
  let roadSegs = []; // 지상 차도 선분 [{a, b, name}]
  let origin = null; // 좌표 변환 기준점 [lat, lng]
  let kx = 1;        // 경도 1도 = kx 미터
  const KY = 111320; // 위도 1도 = KY 미터

  /* ---------- 좌표 변환 ---------- */
  // 위경도 → 미터 좌표 (x 동쪽+, y 남쪽+)
  function toXY(lat, lng) {
    return { x: (lng - origin[1]) * kx, y: (origin[0] - lat) * KY };
  }
  // 미터 좌표 → [lat, lng] (지도 표시용)
  function toLatLng(p) {
    return [origin[0] - p.y / KY, origin[1] + p.x / kx];
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const meters = (a, b) => Math.max(1, Math.round(dist(a, b)));

  /* ---------- 혼잡도 공급 함수 (나중에 실제 API로 교체) ---------- */
  // 기본 공급자: parking.json 의 congestion 값을 그대로 사용
  let congestionProvider = (doorId) => (nodes[doorId] && nodes[doorId].congestion) || 0;

  // 출입문 혼잡도(0~1)를 돌려준다
  function getCongestion(doorId) {
    const v = Number(congestionProvider(doorId));
    return Math.min(1, Math.max(0, isNaN(v) ? 0 : v));
  }

  // 실제 API 연동 시: Router.setCongestionProvider(id => apiCache[id])
  function setCongestionProvider(fn) {
    congestionProvider = fn;
  }

  /* ---------- 그래프 만들기 ---------- */
  let radj = {};     // 거꾸로 탐색용 (도착지에서 출발지 쪽으로) — 한 방향 엣지(셔틀) 때문에 따로 둠
  function addNode(n) { nodes[n.id] = n; adj[n.id] = []; radj[n.id] = []; }
  // directed: true 면 from → to 한 방향만 (셔틀버스·열차 승차)
  function addEdge(e) {
    adj[e.from].push({ to: e.to, edge: e });
    radj[e.to].push({ to: e.from, edge: e });
    if (!e.directed) {
      adj[e.to].push({ to: e.from, edge: e });
      radj[e.from].push({ to: e.to, edge: e });
    }
  }
  function removeNode(id) {
    [adj, radj].forEach((A) => {
      [...(adj[id] || []), ...(radj[id] || [])].forEach(({ to }) => { if (A[to]) A[to] = A[to].filter((x) => x.to !== id); });
    });
    delete adj[id];
    delete radj[id];
    delete nodes[id];
  }

  // parking.json 을 받아 그래프를 만들고, 주차장마다 주차칸·통로를 생성한다
  function build(parking) {
    data = parking;
    nodes = {};
    adj = {};
    radj = {};
    transitById = Object.fromEntries((parking.transit || []).map((T) => [T.id, T]));
    origin = parking.meta.origin;
    kx = KY * Math.cos((origin[0] * Math.PI) / 180);

    parking.nodes.forEach((n) => addNode({ ...n, ...toXY(n.lat, n.lng) }));
    parking.edges.forEach((e) => {
      if (!nodes[e.from] || !nodes[e.to]) {
        console.warn('[router] 존재하지 않는 노드를 잇는 엣지:', e.id);
        return;
      }
      addEdge({
        ...e, distance: e.distance || meters(nodes[e.from], nodes[e.to]),
        geomXY: e.geometry ? e.geometry.map(([lat, lng]) => toXY(lat, lng)) : null,   // 셔틀이 실제로 달리는 길
      });
    });

    // 지상 차도 (안전 점검용). 고가도로(bridge)는 아래로 걸어갈 수 있으므로 제외되어 있음
    roadSegs = [];
    (parking.roads || []).forEach((r) => {
      const pts = r.line.map(([lat, lng]) => toXY(lat, lng));
      for (let i = 1; i < pts.length; i++) roadSegs.push({ a: pts[i - 1], b: pts[i], name: r.name });
    });

    expandLots(parking);
  }

  /* ---------- 주차칸 생성 ---------- */
  // 점이 다각형 안에 있는지 (ray casting)
  function inPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.v > pt.v) !== (b.v > pt.v) && pt.u < ((b.u - a.u) * (pt.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
    }
    return inside;
  }

  /**
   * 각 주차장 외곽선 안에 "주차 줄 - 통로 - 주차 줄" 묶음(구역)을 반복 배치한다.
   * 주차장 좌표계: u = 줄 방향, v = 줄에 수직 방향 (rowAngleDeg 로 회전)
   * 구역(bay) 하나 = 위 줄(depth) + 통로(aisle) + 아래 줄(depth)
   */
  function expandLots(parking) {
    stalls = {};
    lotIndex = {};
    const L = parking.stallLayout;
    const bay = L.stallDepth * 2 + L.aisleWidth;

    (parking.lots || []).forEach((lot) => {
      const th = (lot.rowAngleDeg * Math.PI) / 180;
      const c = Math.cos(th), s = Math.sin(th);
      const toUV = (p) => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c });
      const toXYf = (u, v) => ({ x: u * c - v * s, y: u * s + v * c });
      const poly = lot.polygon.map(([lat, lng]) => toUV(toXY(lat, lng)));
      const us = poly.map((p) => p.u), vs = poly.map((p) => p.v);
      const uMin = Math.min(...us) + L.margin, uMax = Math.max(...us) - L.margin;
      const vStart = Math.min(...vs) + L.margin, vMax = Math.max(...vs) - L.margin;
      const floor = lot.floor;
      const cells = new Map();   // '구역번호|줄|열' → 주차칸 id
      lotIndex[lot.id] = { toUV, vStart, uStart: uMin, bay, cells };

      // 칸이 외곽선 안에 완전히 들어가는지 (모서리 + 여유 1m)
      const fits = (u0, v0) => [[u0 - 1, v0 - 1], [u0 + L.stallWidth + 1, v0 - 1], [u0 - 1, v0 + L.stallDepth + 1], [u0 + L.stallWidth + 1, v0 + L.stallDepth + 1]]
        .every(([u, v]) => inPoly({ u, v }, poly));

      const runEnds = [];   // { node, side:'W'|'E', v, u }
      let b = 0;
      for (let v0 = vStart; v0 + bay <= vMax; v0 += bay, b++) {
        const section = sectionName(b);
        const aisleV = v0 + L.stallDepth + L.aisleWidth / 2;
        const rows = [v0, v0 + L.stallDepth + L.aisleWidth];   // 위 줄, 아래 줄 시작 v
        const nCols = Math.floor((uMax - uMin) / L.stallWidth);
        // 1) 칸이 들어가는 열 찾기
        const present = rows.map((rv) => Array.from({ length: nCols }, (_, col) => fits(uMin + col * L.stallWidth, rv)));
        // 2) 열이 이어지는 구간(run)마다 통로 하나
        const runs = [];
        let start = -1;
        for (let col = 0; col <= nCols; col++) {
          const has = col < nCols && (present[0][col] || present[1][col]);
          if (has && start < 0) start = col;
          if (!has && start >= 0) { if (col - start >= 2) runs.push([start, col - 1]); start = -1; }
        }
        let number = 0;
        runs.forEach(([c0, c1], ri) => {
          const uW = uMin + c0 * L.stallWidth - 2, uE = uMin + (c1 + 1) * L.stallWidth + 2;
          const W = { id: `AI-${lot.id}-${section}-${ri}-W`, type: 'aisle_end', name: `${lot.name} ${section}구역 통로 입구`, floor, ...toXYf(uW, aisleV), lot: lot.id };
          const E = { id: `AI-${lot.id}-${section}-${ri}-E`, type: 'aisle_end', name: `${lot.name} ${section}구역 통로 입구`, floor, ...toXYf(uE, aisleV), lot: lot.id };
          addNode(W);
          addNode(E);
          addEdge({ id: `AE-${lot.id}-${section}-${ri}`, from: W.id, to: E.id, distance: meters(W, E), type: 'aisle', nearVehicleLane: true, generated: true });
          runEnds.push({ node: W, side: 'W', v: aisleV, u: uW }, { node: E, side: 'E', v: aisleV, u: uE });

          // 3) 칸 만들기 (위 줄 → 아래 줄 순서로 번호)
          rows.forEach((rv, r) => {
            for (let col = c0; col <= c1; col++) {
              if (!present[r][col]) continue;
              number++;
              const u0 = uMin + col * L.stallWidth;
              const id = `${lot.id}-${section}-${String(number).padStart(3, '0')}`;
              const corners = [[u0, rv], [u0 + L.stallWidth, rv], [u0 + L.stallWidth, rv + L.stallDepth], [u0, rv + L.stallDepth]].map(([u, v]) => toXYf(u, v));
              stalls[id] = {
                id, lot: lot.id, lotName: lot.name, section, number, floor,
                corners, center: toXYf(u0 + L.stallWidth / 2, rv + L.stallDepth / 2),
                front: toXYf(u0 + L.stallWidth / 2, aisleV),   // 칸 앞 통로 위 지점
                aisleW: W.id, aisleE: E.id,
              };
              cells.set(`${b}|${r}|${col}`, id);
            }
          });
        });
      }

      // 칸을 하나도 지나지 않는 선인지 (1m 간격 점검)
      const clear = (a, b2) => {
        const len = dist(a, b2);
        for (let t = 0; t <= len; t += 1) {
          if (stallAt({ x: a.x + ((b2.x - a.x) * t) / (len || 1), y: a.y + ((b2.y - a.y) * t) / (len || 1) })) return false;
        }
        return true;
      };
      // a → b 를 직선 또는 ㄱ자(두 방향)로 잇되, 칸을 지나지 않는 첫 번째 모양을 쓴다
      let kcount = 0;
      const link = (a, b2, extra) => {
        const ua = toUV(a), ub = toUV(b2);
        const shapes = [[], [toXYf(ub.u, ua.v)], [toXYf(ua.u, ub.v)]];
        const ok = shapes.find((mid) => { const pts = [a, ...mid, b2]; return pts.slice(1).every((p, i) => clear(pts[i], p)); });
        if (!ok) return false;
        let prev = a;
        ok.forEach((m) => {
          const k = { id: `AK-${lot.id}-${++kcount}`, type: 'aisle_end', name: `${lot.name} 가장자리 통로`, floor, ...m, lot: lot.id };
          addNode(k);
          addEdge({ id: `AR-${k.id}`, from: prev.id, to: k.id, distance: meters(prev, k), type: 'aisle', nearVehicleLane: true, generated: true, ...extra });
          prev = k;
        });
        addEdge({ id: `AR-${lot.id}-${++kcount}`, from: prev.id, to: b2.id, distance: meters(prev, b2), type: 'aisle', nearVehicleLane: true, generated: true, ...extra });
        return true;
      };

      // 4) 통로 끝끼리 연결 (주차장 가장자리 순환로). 칸을 가로지르지 않는 모양으로
      ['W', 'E'].forEach((side) => {
        const ends = runEnds.filter((e) => e.side === side).sort((a, b2) => a.v - b2.v);
        for (let i = 1; i < ends.length; i++) link(ends[i - 1].node, ends[i].node, { ring: true, lot: lot.id });
      });

      // 5) 보행로 → 주차장: 칸을 지나지 않고 갈 수 있는 가장 가까운 통로 끝에 연결
      (lot.access || []).forEach((walkId) => {
        const walk = nodes[walkId];
        if (!walk) { console.warn('[router] 주차장과 연결할 보행로 노드가 없음:', walkId); return; }
        const sorted = runEnds.slice().sort((a, b2) => dist(walk, a.node) - dist(walk, b2.node));
        const okEnd = sorted.slice(0, 12).find((e) => link(walk, e.node, { lotEntry: true, ring: true, lot: lot.id }));
        if (!okEnd) console.warn('[router] 주차장 입구 연결 실패:', lot.id, walkId);
      });
    });
  }

  // 구역 이름: 0 → A, 25 → Z, 26 → AA
  function sectionName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  /* ---------- 셔틀·대중교통 운행 여부 ---------- */
  let transitById = {};
  let serviceNow = null;   // 경로를 찾는 시각 (없으면 지금)
  // 한국 시간 기준 요일(0=일)·분
  function seoulClock(d) {
    const s = d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s.slice(0, 3));
    const [h, m] = s.slice(-5).split(':').map(Number);
    return { day, min: (h % 24) * 60 + m };
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  // 지금(또는 when) 운행 중인지
  function running(transitId, when = serviceNow || new Date()) {
    const T = transitById[transitId];
    if (!T) return false;
    const { day, min } = seoulClock(when);
    return T.service.days.includes(day) && min >= toMin(T.service.start) && min < toMin(T.service.end);
  }
  const usable = (e) => e.type !== 'transit' || running(e.transit);

  /* ---------- 엣지 비용 ---------- */
  // 엣지 하나를 지날 때의 비용 (보행거리 + 각종 페널티)
  function edgeCost(e, w) {
    let cost = e.distance * w.distance;
    if (e.type === 'crosswalk') cost += w.crosswalk;
    if (e.nearVehicleLane && e.type !== 'aisle') cost += e.distance * w.vehicleLane;
    if (e.type === 'aisle' && !e.final) cost += e.distance * (w.aisle || 0);   // 차가 다니는 통로 "안"
    if (e.type === 'stairs') cost += w.stairs;
    if (e.type === 'escalator') cost += w.escalator;
    if (e.type === 'elevator') cost += (e.waitSec || 0) * w.elevatorWaitPerSec;
    // 셔틀·열차: 걷는 거리 대신 (기다리는 시간 + 타는 시간)을 비용으로
    if (e.type === 'transit') cost = ((e.waitSec || 0) + (e.rideSec || 0)) * (w.transitPerSec === undefined ? 1.2 : w.transitPerSec);
    return cost;
  }

  /* ---------- 다익스트라 (이진 힙) ---------- */
  // source 에서 모든 노드까지 최소 비용. filter(edge) 가 false 인 엣지는 사용하지 않는다.
  // reverse: true 면 엣지 방향을 거꾸로 따라 탐색 (도착지에서 출발해 모든 출입문까지 비용을 구할 때)
  function dijkstra(source, w, filter, reverse = false) {
    const A = reverse ? radj : adj;
    const cost = { [source]: 0 };
    const prev = {};
    const heap = [[0, source]];
    const push = (item) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c0, u] = pop();
      if (c0 > cost[u]) continue;
      for (const { to, edge } of A[u]) {
        if (filter && !filter(edge)) continue;
        const c = c0 + edgeCost(edge, w);
        if (c < (cost[to] === undefined ? Infinity : cost[to])) { cost[to] = c; prev[to] = { node: u, edge }; push([c, to]); }
      }
    }
    return { cost: new Proxy(cost, { get: (t, k) => (k in t ? t[k] : Infinity) }), prev };
  }

  /* ---------- 경로 통계 ---------- */
  function statsOf(hops) {
    const s = { distance: 0, crosswalks: 0, stairs: 0, escalators: 0, laneMeters: 0, aisleMeters: 0, elevatorWait: 0, transitSeconds: 0, transitMeters: 0, transitLines: [] };
    hops.forEach(({ edge }) => {
      if (edge.type === 'transit') {   // 타고 가는 거리는 걷는 거리에 넣지 않음
        s.transitSeconds += (edge.waitSec || 0) + (edge.rideSec || 0);
        s.transitMeters += edge.distance;
        if (!s.transitLines.includes(edge.transit)) s.transitLines.push(edge.transit);
        return;
      }
      s.distance += edge.distance;
      if (edge.type === 'crosswalk') s.crosswalks++;
      if (edge.type === 'stairs') s.stairs++;
      if (edge.type === 'escalator') s.escalators++;
      if (edge.nearVehicleLane && edge.type !== 'aisle') s.laneMeters += edge.distance;
      if (edge.type === 'aisle' && !edge.final) s.aisleMeters += edge.distance;
      if (edge.type === 'elevator') s.elevatorWait += edge.waitSec || 0;
    });
    return s;
  }

  /* ---------- 표시용 이름 ---------- */
  // 층 표시 이름·높이는 parking.json meta.floors 에서 읽는다
  const floorInfo = (f) => (data && data.meta.floors && data.meta.floors[f]) || null;
  const floorWord = (f) => (floorInfo(f) ? floorInfo(f).label : f);
  const floorArea = (f) => (floorInfo(f) ? `${floorInfo(f).label} ${floorInfo(f).area}` : f);

  // '1층 6번 출입문' 처럼 짧은 출입문 이름
  function doorLabel(id) {
    const n = nodes[id];
    return `${floorWord(n.floor)} ${n.doorNumber}번 출입문`;
  }

  // 이전 버전 호환용 (기둥은 더 이상 쓰지 않음)
  function pillarLabel() { return ''; }

  // 주차칸 이름: 'P2 장기주차장 B구역 15번 칸'
  function stallLabel(stallId) {
    const s = stalls[stallId];
    return s ? `${s.lotName} ${s.section}구역 ${s.number}번 칸` : stallId;
  }
  const stallPlace = stallLabel;

  /* ---------- 경로 좌표 ---------- */
  // 구간 하나의 지도 좌표 (출발점 제외). 셔틀은 실제로 달리는 도로를 따라
  function hopPoints(h) {
    if (h.edge.geomXY) return h.edge.geomXY.slice(1);
    return [{ x: nodes[h.to].x, y: nodes[h.to].y }];
  }
  function hopsPoints(hops) {
    if (!hops.length) return [];
    return [{ x: nodes[hops[0].from].x, y: nodes[hops[0].from].y }, ...hops.flatMap(hopPoints)];
  }
  // 받침 유무에 따라 을/를
  function eulReul(word) {
    const c = String(word).replace(/\s*\(.*\)$/, '').slice(-1).charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를';
  }

  /* ---------- 단계별 안내 만들기 ---------- */
  // hops: [{ from, to, edge }] (출발 → 도착 순서), stall: 도착 주차칸
  function buildSteps(hops, exitDoorId, currentDoorId, stall) {
    const steps = [];
    // points: 지도에 그릴 좌표 (임시 노드가 지워진 뒤에도 쓸 수 있게 미리 복사)
    const push = (kind, text, distance, nodeIds, extra = {}, pts = null) =>
      steps.push({ kind, text, distance: Math.round(distance), nodeIds, points: pts || nodeIds.map((id) => ({ x: nodes[id].x, y: nodes[id].y })), ...extra });

    // 같은 종류의 연속 구간을 하나로 묶는다 (연결통로는 이름별로)
    const groups = [];
    hops.forEach((h) => {
      // 주차장 가장자리 통로(ring)와 구역 안 통로(aisle)는 따로 안내
      const t = h.edge.type === 'aisle' && h.edge.ring ? 'ring' : h.edge.type;
      const key = t === 'passage' ? 'passage:' + h.edge.name : t === 'transit' ? 'transit:' + h.edge.id : ['sidewalk', 'indoor', 'aisle', 'ring'].includes(t) ? t : t + ':' + h.edge.id;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.hops.push(h);
      else groups.push({ key, type: t, indoor: !!h.edge.indoor, hops: [h] });
    });

    // 수직 이동 방향 판단용: 지금까지 지나온 마지막 "층이 확실한" 노드의 층
    let lastFloor = hops.length ? nodes[hops[0].from].floor : null;
    let exitAnnounced = !exitDoorId;   // 현재 위치(GPS)에서 출발하면 출입문 안내 없음
    const announceExit = () => {
      if (exitAnnounced) return;
      exitAnnounced = true;
      const text = currentDoorId === exitDoorId
        ? `지금 계신 ${doorLabel(exitDoorId)}으로 나가세요`
        : `${doorLabel(exitDoorId)}으로 나가세요`;
      push('exit', text, 0, [exitDoorId]);
    };

    groups.forEach((g) => {
      if (!g.indoor) announceExit();
      const first = g.hops[0];
      const last = g.hops[g.hops.length - 1];
      const d = g.hops.reduce((a, h) => a + h.edge.distance, 0);
      const ids = [first.from, ...g.hops.map((h) => h.to)];
      const toNode = nodes[last.to];
      // 이 구간이 끝나는 층 (층이 확실한 마지막 노드 기준)
      const known = ids.map((id) => nodes[id].floor).filter((f) => floorInfo(f));
      const endFloor = known.length ? known[known.length - 1] : lastFloor;
      const goingUp = floorInfo(endFloor) && floorInfo(lastFloor) && floorInfo(endFloor).level > floorInfo(lastFloor).level;
      const updown = goingUp ? '올라가세요' : '내려가세요';
      const targetFloor = floorWord(endFloor);
      lastFloor = endFloor;
      const near = g.hops.some((h) => h.edge.nearVehicleLane);
      const m = Math.round(d);

      switch (g.type) {
        case 'indoor':
          push('indoor', `실내 통로를 따라 ${doorLabel(last.to)} 쪽으로 약 ${m}m 이동하세요`, d, ids);
          break;
        case 'elevator':
          push('elevator', `엘리베이터를 타고 ${targetFloor}로 ${updown}`, d, ids,
            { waitSec: g.hops.reduce((a, h) => a + (h.edge.waitSec || 0), 0) });
          break;
        case 'escalator':
          push('escalator', `에스컬레이터를 타고 ${targetFloor}로 ${updown}`, d, ids);
          break;
        case 'stairs':
          push('stairs', `계단으로 ${targetFloor}까지 ${updown}`, d, ids);
          break;
        case 'transit': {
          // 셔틀버스·자기부상열차 타기
          const e = first.edge;
          const T = transitById[e.transit];
          const hw = T.headwayMin[0] === T.headwayMin[1] ? `${T.headwayMin[0]}분` : `${T.headwayMin[0]}~${T.headwayMin[1]}분`;
          push('transit', `${nodes[first.from].name}에서 ${T.shortName}${eulReul(T.shortName)} 타고 ${toNode.name}에서 내리세요`, d, ids, {
            transit: T.id, waitSec: e.waitSec || 0, rideSec: e.rideSec || 0,
            caution: true, cautionText: `${T.name} · ${hw} 간격 · ${T.service.start}~${T.service.end} 운행 · ${T.fare} (기다리는 시간 포함 예상)`,
          }, hopsPoints(g.hops));
          break;
        }
        case 'crosswalk':
          push('crosswalk', '앞 횡단보도를 건너세요. 신호를 꼭 확인하세요', d, ids, { caution: true });
          break;
        case 'passage':
          push('sidewalk', `${first.edge.name}를 따라 ${toNode.name}까지 약 ${m}m 걸어가세요`, d, ids);
          break;
        case 'ring': {
          const lot = (data.lots || []).find((l) => l.id === first.edge.lot);
          push('aisle', `${lot ? lot.name : '주차장'} 가장자리 통로를 따라 ${stall.section}구역 쪽으로 약 ${m}m 걸어가세요`, d, ids,
            { caution: true, cautionText: '주차장 안은 차가 다닙니다. 가장자리로 걸어가세요' });
          break;
        }
        case 'aisle':
          if (g.hops.some((h) => h.edge.final)) {
            // 마지막: 주차장 통로 → 내 차 칸
            push('aisle', `${stall.lotName} ${stall.section}구역 통로를 따라 ${stall.number}번 칸 앞까지 약 ${m}m 걸어가세요`, d, ids,
              { caution: true, cautionText: '차가 다니는 통로입니다. 차량을 조심하세요' });
          } else {
            push('aisle', `${toNode.name}을 따라 약 ${m}m 걸어가세요`, d, ids,
              { caution: true, cautionText: '차가 다니는 통로입니다. 차량을 조심하세요' });
          }
          break;
        default:
          push('sidewalk', `인도를 따라 ${toNode.name}까지 약 ${m}m 걸어가세요`, d, ids, near ? { caution: true, cautionText: '차가 다니는 길 옆입니다. 조심하세요' } : {});
      }
    });
    announceExit();

    const lastId = hops.length ? hops[hops.length - 1].to : exitDoorId;
    push('arrive', `${stallLabel(stall.id)}에 차량이 있습니다`, 0, [lastId]);
    return steps;
  }

  /* ---------- 추천 사유 한 줄 ---------- */
  function buildReason(best, second) {
    if (!second) return '이용할 수 있는 출입문이 이곳뿐입니다.';
    const a = best.stats, b = second.stats;
    const name2 = doorLabel(second.doorId);
    const adv = [];
    if (a.crosswalks < b.crosswalks) adv.push(`횡단보도를 ${b.crosswalks - a.crosswalks}번 덜 건넙니다`);
    if (a.stairs + a.escalators < b.stairs + b.escalators) adv.push('계단을 피할 수 있습니다');
    if (a.transitLines.length && b.distance - a.distance >= 100) adv.push(`${a.transitLines.map((id) => transitById[id].shortName).join('·')}를 타서 ${Math.round(b.distance - a.distance)}m 덜 걷습니다`);
    if (b.laneMeters - a.laneMeters >= 10) adv.push(`차도 옆을 ${Math.round(b.laneMeters - a.laneMeters)}m 덜 걷습니다`);
    if (b.aisleMeters - a.aisleMeters >= 8) adv.push(`차가 다니는 주차장 통로를 ${Math.round(b.aisleMeters - a.aisleMeters)}m 덜 걷습니다`);
    if (b.congestion - a.congestion >= 0.2) adv.push('사람이 덜 붐빕니다');
    if (b.elevatorWait - a.elevatorWait >= 20) adv.push('엘리베이터를 기다리지 않아도 됩니다');

    const diff = Math.round(a.distance - b.distance);
    if (diff > 0) return `${name2}보다 ${diff}m 멀지만 ${adv[0] || '더 안전합니다'}.`;
    if (diff < 0) return adv.length ? `${name2}보다 ${-diff}m 가깝고 ${adv[0]}.` : `${name2}보다 ${-diff}m 가깝습니다.`;
    return adv.length ? `${name2}과 거리는 같지만 ${adv[0]}.` : `${name2}과 비슷하지만 조금 더 유리합니다.`;
  }

  /* ---------- 경로 안전 점검 ---------- */
  // 두 선분이 교차하는지
  function segsCross(p1, p2, p3, p4) {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  // 점이 어떤 주차칸 안에 있으면 그 칸이 속한 주차장 id
  function stallAt(p) {
    const s = stallIdAt(p, 0.3);
    return s ? stalls[s].lot : null;
  }

  // 점이 들어 있는 주차칸 id (지도에서 칸을 눌러 고를 때). edge: 칸 가장자리 여유(m)
  function stallIdAt(p, edge = 0) {
    for (const id in lotIndex) {
      const ix = lotIndex[id];
      const { u, v } = ix.toUV(p);
      const b = Math.floor((v - ix.vStart) / ix.bay);
      if (b < 0) continue;
      const off = v - ix.vStart - b * ix.bay;
      const L = data.stallLayout;
      const r = off < L.stallDepth ? 0 : off >= L.stallDepth + L.aisleWidth ? 1 : -1;
      if (r < 0) continue;
      const col = Math.floor((u - ix.uStart) / L.stallWidth);
      // 칸 경계선 위(통로 끝 등)는 제외하기 위해 칸 안쪽 edge(m) 이상일 때만
      const du = u - ix.uStart - col * L.stallWidth;
      const dv = r === 0 ? off : off - L.stallDepth - L.aisleWidth;
      if (du < edge || du > L.stallWidth - edge || dv < edge || dv > L.stallDepth - edge) continue;
      const hit = ix.cells.get(`${b}|${r}|${col}`);
      if (hit) return hit;
    }
    return null;
  }

  // 'p1 o 69', 'P1-O-069' → 'P1-O-069' (없는 칸이면 null)
  function parseStallId(text) {
    const m = String(text || '').trim().toUpperCase().match(/^(P\d)\s*-?\s*([A-Z]{1,2})\s*-?\s*(\d{1,3})$/);
    if (!m) return null;
    const id = `${m[1]}-${m[2]}-${m[3].padStart(3, '0')}`;
    return stalls[id] ? id : null;
  }

  // 경로 안전 점검
  // 1) 인도·횡단보도·연결통로·주차장 통로(및 실내·수직 이동)만 지나는지
  // 2) 횡단보도·연결통로(입체) 외에는 실제 차도를 가로지르지 않는지
  // 3) 마지막 "내 차 칸으로 들어가는" 구간 외에는 주차칸을 가로지르지 않는지
  function validateRoute(route) {
    const allowed = ['sidewalk', 'crosswalk', 'passage', 'indoor', 'elevator', 'escalator', 'stairs', 'aisle', 'transit'];
    const problems = [];
    route.hops.forEach(({ from, to, edge }) => {
      const a = nodes[from], b = nodes[to];
      if (edge.type === 'transit') {   // 셔틀·열차 탑승 구간은 걷는 길이 아니므로 차도·주차칸 점검 제외
        if (!running(edge.transit)) problems.push(`${edge.id}: 지금 운행하지 않는 노선`);
        return;
      }
      if (!allowed.includes(edge.type)) problems.push(`${edge.id}: 보행로가 아닌 구간(${edge.type})`);
      if (edge.type !== 'crosswalk' && !edge.gradeSeparated && !edge.indoor) {
        roadSegs.forEach((r) => {
          if (segsCross(a, b, r.a, r.b)) problems.push(`${edge.id}: 횡단보도가 아닌 곳에서 차도(${r.name || '도로'})를 가로지름`);
        });
      }
      if (!edge.final) {
        const len = dist(a, b);
        for (let t = 0; t <= len; t += 1) {
          const p = { x: a.x + ((b.x - a.x) * t) / (len || 1), y: a.y + ((b.y - a.y) * t) / (len || 1) };
          if (stallAt(p)) { problems.push(`${edge.id}: 주차칸을 가로지름`); break; }
        }
      }
    });
    return { ok: problems.length === 0, problems: [...new Set(problems)] };
  }

  /* ---------- 임시 노드: 내 차 칸 ---------- */
  // 칸 앞 통로 위 지점(__front) → 칸 안(__stall) 을 그래프에 잠시 추가
  function withStallNodes(stall, fn) {
    const FRONT = '__front', SPOT = '__stall';
    addNode({ id: FRONT, type: 'stall_front', name: `${stallLabel(stall.id)} 앞 통로`, floor: stall.floor, ...stall.front });
    addNode({ id: SPOT, type: 'stall', name: stallLabel(stall.id), floor: stall.floor, ...stall.center });
    [stall.aisleW, stall.aisleE].forEach((endId) => {
      addEdge({ id: `__${endId}`, from: endId, to: FRONT, distance: meters(nodes[endId], nodes[FRONT]), type: 'aisle', nearVehicleLane: true });
    });
    addEdge({ id: '__into', from: FRONT, to: SPOT, distance: meters(nodes[FRONT], nodes[SPOT]), type: 'aisle', nearVehicleLane: false, final: true });
    try {
      return fn(SPOT);
    } finally {
      removeNode(SPOT);
      removeNode(FRONT);
    }
  }

  /* ---------- 메인: 출입문 추천 + 경로 ---------- */
  /**
   * @param {object} opt
   *   targetStallId 도착지(확정된 차량의 주차칸, 예: 'P2-B-015')
   *   preset        'fastest' | 'safest' | 'accessible'
   *   currentDoorId (선택) 사용자가 지금 있는 출입문 — 있으면 실내 이동 비용까지 포함해 추천
   * @returns { steps, totalDistance, estimatedMinutes, reason, ... }
   */
  function recommend({ targetStallId, preset = 'safest', currentDoorId = null, now = null }) {
    const stall = stalls[targetStallId];
    if (!stall) { console.warn('[router] 없는 주차칸:', targetStallId); return null; }
    serviceNow = now;   // 셔틀·열차 운행 시간 판단 기준
    return withStallNodes(stall, (spot) => recommendTo(spot, stall, preset, currentDoorId));
  }

  function recommendTo(targetNodeId, stall, preset, currentDoorId) {
    const w = ROUTE_CONFIG.presets[preset];
    // 1) 도착지(차량)에서 거꾸로 실외 보행망을 탐색 → 모든 출입문까지의 비용을 한 번에 구함
    const outdoor = dijkstra(targetNodeId, w, (e) => !e.indoor && usable(e), true);
    // 2) 현재 위치가 있으면 실내 통로만으로 각 출입문까지의 비용
    const indoor = currentDoorId ? dijkstra(currentDoorId, w, (e) => !!e.indoor) : null;

    const candidates = Object.values(nodes)
      .filter((n) => n.type === 'door')
      .map((door) => {
        const outCost = outdoor.cost[door.id];
        const inCost = indoor ? indoor.cost[door.id] : 0;
        if (!isFinite(outCost) || !isFinite(inCost)) return null;

        // 현재 위치 → 출입문 (실내)
        const inHops = [];
        if (indoor) {
          for (let x = door.id; x !== currentDoorId; x = indoor.prev[x].node) {
            inHops.unshift({ from: indoor.prev[x].node, to: x, edge: indoor.prev[x].edge });
          }
        }
        // 출입문 → 차량 (실외). 도착지에서 탐색했으므로 prev 를 따라가면 차량 쪽으로 간다
        const outHops = [];
        for (let x = door.id; x !== targetNodeId; x = outdoor.prev[x].node) {
          outHops.push({ from: x, to: outdoor.prev[x].node, edge: outdoor.prev[x].edge });
        }

        const congestion = getCongestion(door.id);
        const hops = [...inHops, ...outHops];
        const stats = { ...statsOf(hops), congestion };
        return { doorId: door.id, cost: inCost + outCost + congestion * w.congestion, hops, stats };
      })
      .filter(Boolean)
      .sort((a, b) => a.cost - b.cost);

    if (!candidates.length) return null;
    const best = candidates[0];
    const route = finishRoute(best.hops, best.stats, stall, preset, {
      exitDoorId: best.doorId,
      exitDoorLabel: doorLabel(best.doorId),
      currentDoorId,
      reason: buildReason(best, candidates[1]),
      alternatives: candidates.slice(1, 3).map((c) => ({ doorId: c.doorId, label: doorLabel(c.doorId), distance: Math.round(c.stats.distance) })),
    });
    route.steps = buildSteps(best.hops, best.doorId, currentDoorId, stall);
    return route;
  }

  // 공통 마무리: 시간·경고·좌표·안전 점검
  function finishRoute(hops, s, stall, preset, extra) {
    const seconds = s.distance / ROUTE_CONFIG.walkSpeed[preset] + s.elevatorWait + s.crosswalks * ROUTE_CONFIG.crosswalkWaitSec + s.transitSeconds;
    const warnings = [];
    if (preset === 'accessible' && s.stairs + s.escalators > 0) {
      warnings.push('계단 없는 경로를 찾지 못했습니다. 고객센터에 도움을 요청하세요.');
    }
    if (preset === 'accessible' && s.transitLines.includes('shuttle01')) {
      warnings.push('셔틀버스의 저상버스(휠체어 탑승) 여부는 확인이 필요해요. 셔틀운영 고객센터에 미리 문의하세요.');
    }
    const pathNodeIds = hops.length ? [hops[0].from, ...hops.map((h) => h.to)] : [];
    const route = {
      totalDistance: Math.round(s.distance),
      estimatedMinutes: Math.max(1, Math.ceil(seconds / 60)),
      estimatedSeconds: Math.round(seconds),
      preset,
      targetStallId: stall.id,
      targetLabel: stallLabel(stall.id),
      hops,
      pathNodeIds,
      stats: s,
      warnings,
      alternatives: [],
      ...extra,
    };
    // 지도용 좌표 (임시 노드가 지워지기 전에 복사). 셔틀 구간은 실제 도로를 따라
    route.points = hopsPoints(hops);
    route.transitUsed = s.transitLines.map((id) => transitById[id]);
    route.safety = validateRoute(route);
    if (!route.safety.ok) console.warn('[router] 경로 안전 점검 실패:', route.safety.problems);
    return route;
  }

  /**
   * 현재 위치(GPS 등, 미터 좌표)에서 내 차까지 — 실시간 안내 중 경로를 벗어났을 때 다시 찾기
   * 가까운 실외 보행망 노드 몇 개와 임시로 연결해 탐색한다.
   */
  function recommendFromPoint({ targetStallId, preset = 'safest', point, now = null }) {
    const stall = stalls[targetStallId];
    if (!stall) return null;
    serviceNow = now;
    return withStallNodes(stall, (spot) => {
      const START = '__start';
      const near = Object.values(nodes)
        .filter((n) => n.type !== 'door' && !String(n.id).startsWith('__') && (n.floor === stall.floor))
        .map((n) => ({ n, d: dist(n, point) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      addNode({ id: START, type: 'position', name: '현재 위치', floor: stall.floor, x: point.x, y: point.y });
      near.forEach(({ n, d }) => addEdge({ id: `__s-${n.id}`, from: START, to: n.id, distance: Math.max(1, Math.round(d)), type: 'sidewalk', nearVehicleLane: false }));
      try {
        const w = ROUTE_CONFIG.presets[preset];
        const res = dijkstra(spot, w, (e) => !e.indoor && usable(e), true);
        if (!isFinite(res.cost[START])) return null;
        const hops = [];
        for (let x = START; x !== spot; x = res.prev[x].node) hops.push({ from: x, to: res.prev[x].node, edge: res.prev[x].edge });
        const route = finishRoute(hops, { ...statsOf(hops), congestion: 0 }, stall, preset, {
          exitDoorId: null, exitDoorLabel: '현재 위치', currentDoorId: null, reason: '현재 위치에서 다시 찾은 길입니다.',
        });
        route.steps = buildSteps(hops, null, null, stall);
        return route;
      } finally {
        removeNode(START);
      }
    });
  }

  /**
   * 세 가지 길 옵션을 한 번에 계산해 비교표용 요약을 돌려준다.
   * sameAs: 다른 옵션과 경로가 완전히 같으면 그 옵션 키 (예: safest 가 fastest 와 같음)
   */
  function compareOptions({ targetStallId, currentDoorId = null, now = null }) {
    const keys = Object.keys(ROUTE_CONFIG.presets);
    const rows = keys.map((preset) => {
      const r = recommend({ targetStallId, preset, currentDoorId, now });
      return r && {
        preset, label: ROUTE_CONFIG.presets[preset].label,
        door: r.exitDoorLabel, distance: r.totalDistance, minutes: r.estimatedMinutes,
        crosswalks: r.stats.crosswalks, laneMeters: Math.round(r.stats.laneMeters + r.stats.aisleMeters),
        transit: r.transitUsed.map((T) => T.shortName),
        stairs: r.stats.stairs + r.stats.escalators, path: r.pathNodeIds.join('>'),
      };
    }).filter(Boolean);
    rows.forEach((row, i) => {
      const twin = rows.slice(0, i).find((o) => o.path === row.path);
      row.sameAs = twin ? twin.preset : null;
    });
    return rows;
  }

  // 예상 시간(초) — 단계 카드 표시용
  function stepSeconds(step, preset) {
    let sec = step.distance / ROUTE_CONFIG.walkSpeed[preset];
    sec += step.waitSec || 0;
    if (step.kind === 'crosswalk') sec += ROUTE_CONFIG.crosswalkWaitSec;
    if (step.kind === 'transit') sec = (step.waitSec || 0) + (step.rideSec || 0);   // 타는 구간은 기다림 + 탑승 시간
    return sec;
  }

  return {
    build, recommend, recommendFromPoint, compareOptions, getCongestion, setCongestionProvider, validateRoute,
    doorLabel, pillarLabel, stallLabel, stallPlace, floorWord, floorArea, stepSeconds,
    toXY, toLatLng, stallAt, stallIdAt, parseStallId, running,
    get transit() { return transitById; },
    get stalls() { return stalls; },
    get nodes() { return nodes; },
    get data() { return data; },
  };
})();
