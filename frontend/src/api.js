import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// 요청에 로그인 토큰 첨부
api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

// 401 -> 세션 제거 후 리로드 (로그인 상태였을 때만)
api.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401 && err.config?.url !== '/auth/login'
      && localStorage.getItem('token')) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    location.reload()
  }
  return Promise.reject(err)
})

// 업로드 차단 확장자 — 실행파일·스크립트·설치파일 등 (백엔드와 동일 목록)
export const BLOCKED_FILE_EXT = new Set([
  'exe', 'msi', 'msix', 'msp', 'mst', 'com', 'scr', 'pif', 'cpl', 'gadget',
  'dll', 'sys', 'drv', 'ocx', 'bat', 'cmd', 'vbs', 'vbe', 'jse', 'wsf',
  'wsc', 'wsh', 'ps1', 'ps2', 'psm1', 'reg', 'lnk', 'hta', 'msc', 'inf',
  'sct', 'jar', 'apk', 'ipa', 'app', 'deb', 'rpm', 'run', 'sh', 'bash',
])
export const fileExt = name => (name || '').split('.').pop().toLowerCase()

// 파일 업로드 + 진행률 콜백 (0~100). 차단 확장자는 요청 전 거부
export const uploadWithProgress = (url, fd, onProgress) => {
  const f = fd.get('file')
  const ext = fileExt(f?.name)
  if (f && BLOCKED_FILE_EXT.has(ext)) {
    return Promise.reject({ response: { data: {
      detail: `'.${ext}' 형식의 파일은 보안상 업로드할 수 없습니다` } } })
  }
  return api.post(url, fd, {
    onUploadProgress: e =>
      onProgress?.(e.total ? Math.round(e.loaded * 100 / e.total) : 0),
  })
}

// 첨부파일 네이티브 다운로드 — 브라우저가 스트리밍 저장 + 자체 진행률 표시.
// 대용량 파일을 메모리(blob)에 버퍼링하지 않아 큰 파일에 적합.
// 헤더를 못 붙이는 대신 ?token= 쿼리로 인증 (다운로드 엔드포인트만 허용됨)
export const downloadFile = path => {
  const t = localStorage.getItem('token')
  const sep = path.includes('?') ? '&' : '?'
  const a = document.createElement('a')
  a.href = `/api${path}${sep}token=${encodeURIComponent(t || '')}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Blob 응답을 파일로 저장 — 다운로드 시작 후 URL 해제 (즉시 해제 시 실패 가능)
export const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// 파일 크기 표시 (B/KB/MB/GB)
export const fmtSize = n => {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export default api

export const fmtDT = (iso) => {
  if (!iso) return ''
  return iso.slice(0, 16).replace('T', ' ')
}

// 초단위까지 출력하는 일시 포맷 (상태변경이력 등)
export const fmtDTS = (iso) => {
  if (!iso) return ''
  return iso.slice(0, 19).replace('T', ' ')
}

export const STAT_LABEL = {
  R: '작업요청',
  C: '검토중',
  W: '대기중',
  P: '작업중',
  H: '작업중단',
  F: '작업완료',
  X: '작업반려',
  Z: '최종완료',
  O: '단순업무중',
}

// 화면별 검색조건 저장/복원 (localStorage)
export const loadFilter = key => {
  try { return JSON.parse(localStorage.getItem(`filter:${key}`) || '{}') }
  catch { return {} }
}
export const saveFilter = (key, obj) =>
  localStorage.setItem(`filter:${key}`, JSON.stringify(obj))
export const clearFilter = key => localStorage.removeItem(`filter:${key}`)

// 작업유형
export const TASK_TYPE_LABEL = {
  SQ: '단순문의',
  FI: '기능개선',
  BF: '오류수정',
  DE: '데이터추출',
  DM: '데이터변경',
  SC: '시스템점검',
  RS: '연관시스템지원',
  FW: '장애대응',
  ET: '기타',
}

// 작업상태 허용 전이 (백엔드 statusflow.ALLOWED_STAT과 동일, 자기 상태 포함)
// C의 W/O 분기는 스케쥴적용 여부(schedule_apply)에 따라 서버에서 검증
export const NEXT_STAT = {
  R: ['R', 'C', 'X'],
  C: ['C', 'X', 'W', 'O'],
  W: ['W', 'C', 'X', 'P'],
  P: ['P', 'X', 'H', 'F'],
  H: ['H', 'P', 'X'],
  O: ['O', 'F', 'X'],
  F: ['F', 'Z'],
  X: ['X'],
  Z: ['Z'],
}

export const DAY_STAT_LABEL = {
  W: '근무일',
  H: '휴일',
}

export const USER_STAT_LABEL = {
  Y: '활성',
  A: '승인대기',
  R: '승인불가',
  N: '비활성',
}

export const GRADE_LABEL = {
  0: '관리자',
  1: '수석개발자',
  3: '개발매니저',
  4: '일반개발자',
  5: 'IT업무담당자',
  6: '현업담당자',
  7: '협력업체',
  8: '거래처',
  9: '기타사용자',
}

// 담당분류코드: A-어드민(0~1), D-개발담당(2~4), B-업무담당(5~8), G-기타(9)
export const DUTY_LABEL = {
  A: '어드민',
  D: '개발담당',
  B: '업무담당',
  G: '기타',
}
export const dutyOfGrade = g =>
  g == null ? null : g <= 1 ? 'A' : g <= 4 ? 'D' : g <= 8 ? 'B' : 'G'

// 작업자(개발자) 대상 판별: 개발담당(D) + 수석개발자(등급1)
export const isDevGrade = g => g === 1 || dutyOfGrade(g) === 'D'
export const isDevWorker = u => isDevGrade(u.user_grade)
// 요청자 후보: 업무담당(B)
export const isReqUser = u => u.duty_class === 'B'

// "이름 (ID)" | 이름 | ID 입력값 → userid 변환. 못 찾으면 입력값 그대로
export const resolveUserid = (text, users) => {
  const t = (text || '').trim()
  if (!t) return ''
  const m = t.match(/\(([^()]*)\)\s*$/)
  if (m) return m[1].trim()
  const u = (users || []).find(u => u.user_name === t) ||
    (users || []).find(u => u.userid === t)
  return u ? u.userid : t
}

const PALETTE = [
  '#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa',
  '#00acc1', '#3949ab', '#c0ca33', '#f4511e', '#6d4c41',
]

export function colorOf(key) {
  const s = String(key ?? 'none')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// 작업별 색상: 황금각(137.5°) 분포로 연속 taskid도 대비되는 색이 나오게 함
function taskHue(taskid) {
  const s = String(taskid ?? 'none')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const n = Number(taskid)
  const base = Number.isFinite(n) ? n : h
  return Math.round((base * 137.508) % 360)
}
export function taskColor(taskid) {
  return `hsl(${taskHue(taskid)}, 65%, 45%)`
}
// 작업색의 보색 — 컬러 타이틀 위에서 눈에 띄어야 할 요소(복사 버튼 등)용
export function taskColorComp(taskid) {
  return `hsl(${(taskHue(taskid) + 180) % 360}, 75%, 42%)`
}

// 작업 스티커 이모지 프리셋 — 상세 팝업 스티커 탭의 선택 목록
export const STICKER_EMOJIS = [
  '⭐', '🔥', '💥', '🚨', '⚠️', '🐛', '✅', '📌', '💡', '❗',
  '❓', '⏳', '🔍', '🛠️', '🚀', '📞', '🤝', '💤', '♻️', '🧪',
]

// 스티커 툴팁: "이모지 메모"를 줄바꿈으로 나열
export const stickerTip = stickers =>
  (stickers || []).map(s => (s.memo ? `${s.emoji} ${s.memo}` : s.emoji)).join('\n')
