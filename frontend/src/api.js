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

export const STAT_LABEL = {
  R: '작업요청',
  C: '검토중',
  W: '대기중',
  P: '작업중',
  H: '작업중단',
  F: '작업완료',
  X: '작업반려',
}

// 화면별 검색조건 저장/복원 (localStorage)
export const loadFilter = key => {
  try { return JSON.parse(localStorage.getItem(`filter:${key}`) || '{}') }
  catch { return {} }
}
export const saveFilter = (key, obj) =>
  localStorage.setItem(`filter:${key}`, JSON.stringify(obj))

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
export const NEXT_STAT = {
  R: ['R', 'C', 'X'],
  C: ['C', 'X', 'W', 'F'],
  W: ['W', 'C', 'X', 'P', 'F'],
  P: ['P', 'X', 'H', 'F'],
  H: ['H', 'P', 'X', 'F'],
  F: ['F'],
  X: ['X'],
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
  7: '현업담당자',
  9: '기타사용자',
}

// 담당분류코드: A-어드민(0~1), D-개발담당(2~4), B-업무담당(5~7), G-기타(8~9)
export const DUTY_LABEL = {
  A: '어드민',
  D: '개발담당',
  B: '업무담당',
  G: '기타',
}
export const dutyOfGrade = g =>
  g == null ? null : g <= 1 ? 'A' : g <= 4 ? 'D' : g <= 7 ? 'B' : 'G'

// 작업자(개발자) 대상 판별: 개발담당(D) + 수석개발자(등급1)
export const isDevGrade = g => g === 1 || dutyOfGrade(g) === 'D'
export const isDevWorker = u => isDevGrade(u.user_grade)

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
export function taskColor(taskid) {
  const s = String(taskid ?? 'none')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const n = Number(taskid)
  const base = Number.isFinite(n) ? n : h
  const hue = Math.round((base * 137.508) % 360)
  return `hsl(${hue}, 65%, 45%)`
}
