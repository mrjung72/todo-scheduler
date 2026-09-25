# TODO 작업 스케줄러

우선순위 기반 작업목록 + 근무일 기준 자동 스케줄링 + FullCalendar 일정 시각화 앱.

## 구성

- **백엔드**: Python FastAPI + SQLite (`backend/todo.db` 자동 생성)
- **프론트엔드**: React + Vite + FullCalendar

## 실행

Windows bat 파일 사용 (프로젝트 루트):

```bat
start.bat    :: 백엔드(8000)+프론트엔드(5173) 시작
stop.bat     :: 두 서버 종료
restart.bat  :: 재기동 (.env 변경 후 사용)
```

수동 실행:

```bash
# 백엔드 (port 8000)
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload

# 프론트엔드 (port 5173, /api -> 127.0.0.1:8000 프록시)
cd frontend
npm install
npm run dev
```

브라우저: http://localhost:5173

## 화면

- **작업목록**: 우선순위 오름차순 정렬. 우선순위·예상시간 인라인 수정 후
  [재적용] 클릭 시 작업자별로 순차 재배치. 검색(작업명/현업담당자/IT담당자/작업자),
  행별 시작일시 수동 설정(고정/해제) 지원.
- **달력**: FullCalendar 월/주 뷰. 각 작업이 사이트별 색상의 화살표 바로 표시.
  휴일=빨간 배경, 휴가=주황 배경. 이벤트 클릭 시 상세 팝업.
- **관리자**: 사용자/사이트/작업/달력/작업스케줄 CRUD.
  달력 탭에서 연도별 날짜 일괄 생성, 일자별 W(근무일)/H(휴일)/V(휴가) 지정.

## 환경변수

`backend/.env` 파일(또는 OS 환경변수)로 하루 근무시간 구간 설정 — `backend/.env.example` 참고.

```env
# 콤마로 여러 구간 지정. 기본값은 점심 제외 8시간.
WORK_SEGMENTS=09:00-12:00,13:00-18:00
# 점심 구분 없이 8시간: WORK_SEGMENTS=09:00-17:00
# 하루 7시간:        WORK_SEGMENTS=09:00-12:00,13:00-17:00
```

변경 후 백엔드 재시작 필요. 현재 적용값은 `GET /api/config` 로 확인 가능.

## 스케줄링 규칙 (`backend/app/scheduler.py`)

- 근무시간: `WORK_SEGMENTS` 환경변수 (기본 09:00~12:00 + 13:00~18:00 = 하루 8시간)
- 비근무일: 토·일 + calendar_define 의 H(휴일)/V(휴가)
  - calendar_define 에 없는 날짜는 월~금=근무일로 간주
- 재계산: work_schedule 을 work_userid 별로 그룹화 → task.priority 순 정렬 →
  이전 작업 종료 시각부터 다음 근무시간에 이어서 배치
- `work_schedule.start_fixed=1` 이면 재계산 시 시작일시 유지(종료만 재계산)
- 계산 결과는 work_schedule 의 start/end 와 tasks 의 task_start_date/task_end_date 에 반영

## 스키마 노트

- 요청 DDL 그대로 사용 + `work_schedule.start_fixed`(수동 시작 고정 플래그) 1개 컬럼 추가
- calendar_define 은 전역 달력 (개인별 휴가가 필요하면 userid 컬럼 추가 고려)
