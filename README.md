# 인천공항 T1 차자주께! (캡스톤 디자인)

## 실행
`start.bat` 더블클릭 → 서버가 켜지고 **다른 PC·휴대폰에서도 들어올 수 있는 공개 주소**(https://….trycloudflare.com)가 만들어집니다.
- 접속 안내 페이지(share.html)가 열려요: 휴대폰용 QR + 시연용 QR
- 같은 와이파이가 아니어도 접속 가능, https 라서 휴대폰 GPS 안내도 동작
- 주소는 실행할 때마다 바뀌고, `qr\시연용 QR` 도 그 주소로 자동으로 다시 만들어집니다
- 검은 창을 닫으면 서버·외부 접속이 함께 꺼져요
- 외부 접속은 Cloudflare 무료 터널(`tools\cloudflared.exe`, 처음 실행 때 자동 다운로드)을 사용합니다. 인터넷이 없으면 이 컴퓨터(http://localhost:8080)에서만 열려요
- 늘 같은 주소가 필요하면(인쇄해서 붙여 두는 QR 등) GitHub Pages 같은 곳에 올린 뒤 `tools\make-qr.ps1 -Base "배포주소/index.html"` 로 QR 을 만드세요
(index.html 을 직접 더블클릭하면 브라우저 보안 정책 때문에 data/*.json 을 읽지 못합니다. GitHub Pages 등에 올리면 그대로 동작합니다.)

시연용 번호: `1234`(3대), `5678`(2대), `0427`(2대), `2981`(1대), `0000`(없음) · 주차칸 번호로 찾기 예: `P1-O-069`

주소 파라미터: `?reg=P1-O-069` 주차칸 QR(내 차 등록) · `?from=D1F-03` 출입문 QR(그 출입문에서 출발) · `?v=mobile` / `?v=pc` 화면 강제 (기본은 기기에 따라 자동)

## 지도·데이터
- 지도: Leaflet + OpenStreetMap (실제 지도)
- **실제 좌표(OSM)**: 터미널 출입문 1~14, 연결통로 A~E, P1~P4 장기주차장 외곽선, 차도 중심선 (`data/osm/` 원자료)
- **가정**: 교통센터 내부 동선, 장기주차장 보행로, 횡단보도 위치, 실내 엘리베이터·에스컬레이터 위치, 차량 입·출구, 주차칸 배치(외곽선 안에 5m-6m-5m 규칙으로 생성), 차량·혼잡도·요금
- **실제 셔틀·대중교통**: 장기주차장 셔틀버스(공항 01번, OSM 노선 relation 5846413 — 실제 정류장 7곳·실제 운행 도로), 인천공항 자기부상철도(OSM relation 7701183 — 인천공항1터미널역·장기주차장역)
  - 운행 정보: 셔틀 매일 04:30~24:00, 8~16분 간격 (airport.kr 셔틀버스 노선도) / 자기부상철도 화~일 10:00~17:00, 35분 간격, 무료 (2025-10-17 운행 재개 보도)
  - 운행 시간에만 경로에 넣음. 발표 시연용으로 `?t=14:00` 처럼 기준 시각을 정할 수 있음
  - 가정: 정류장 번호(장기탑승장 1~7번)와의 대응, 셔틀 운행 방향(OSM 노선 순서), 평균 속도(셔틀 20km/h·열차 30km/h), 기다리는 시간(배차 간격의 절반)
- 데이터 다시 만들기: 서버 실행 후 `/tools/build-data.html` 결과를 `data/parking.json`, `data/vehicles.json` 으로 저장

## 파일 역할
| 파일 | 역할 |
|---|---|
| index.html | 화면 뼈대: 헤더·진행 단계·안내 카드·지도·관리자 탭 자리 |
| css/style.css | 밝은 공공 서비스 테마, 모든 색·간격·글씨 크기 변수, 접근성 |
| js/app.js | 전체 흐름(검색→확인→안내→도착), GPS·시연 실시간 안내, 글씨 크기·시계·탭 |
| js/map.js | 실제 지도(MapView: 주차장·주차칸·보행로·경로·화살표) + 단계별 안내 카드(StepGuide) |
| js/router.js | 위경도→미터 변환, 주차칸 생성, 다익스트라로 "안전하고 빠른" 출입문 추천, 안전 점검(실제 차도·주차칸) |
| js/verify.js | 뒷 4자리 검색, 중복 차량 2단계 검증, 마스킹, 5회 실패 30초 제한 |
| js/location.js | LocationProvider: 직접 선택·실시간 이동 시연·실제 GPS·비콘 자리 |
| js/register.js | 내 차 등록 (차량 번호 ↔ 주차칸, 이 기기에 저장), 등록 방법 안내 |
| qr.html | QR코드 만들기·인쇄: ① 주차칸 QR(?reg=칸 → 내 차 등록) ② 출입문 QR(?from=출입문 → 내 차 찾기) |
| data/parking.json | 출입문·보행 네트워크·주차장 외곽선·차도 (생성 결과) |
| data/vehicles.json | 가상 차량 33대 (주차칸 번호 예: P1-O-069) |
| data/osm/ | OpenStreetMap 원자료 (© OpenStreetMap contributors, ODbL) |
| docs/business-plan.md | 사업계획서 1~7장 |
| start.bat, server.ps1 | 설치 없이 쓰는 로컬 웹 서버 |
| tools/build-data.html | OSM 원자료 → parking.json·vehicles.json 생성기 |
| tools/network-view.html | 보행 네트워크를 지도 위에 겹쳐 보기 (개발용) |
| tests/selftest.html | 기준표 자동 점검 |
| tests/tune.html | 길 옵션 가중치 점검 (경로 안전·옵션별 차이) |
| tests/shot.html | 화면 캡처용 자동 진행 (?stage=verify·route·aisle·last·arrive, &w=360) |
| _legacy/ | 이전 버전 보관 (첫 Leaflet 버전, v2-svg 평면도 버전) |
