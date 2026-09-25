import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export default api

export const fmtDT = (iso) => {
  if (!iso) return ''
  return iso.slice(0, 16).replace('T', ' ')
}

export const STAT_LABEL = {
  W: '대기중',
  P: '작업중',
  F: '완료',
  C: '취소',
}

export const DAY_STAT_LABEL = {
  W: '근무일',
  H: '휴일',
  V: '휴가',
}

export const GRADE_LABEL = {
  0: '관리자',
  1: '개발자',
  2: 'IT업무담당자',
  3: '현업담당자',
  9: '기타사용자',
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
export function taskColor(taskid) {
  const s = String(taskid ?? 'none')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const n = Number(taskid)
  const base = Number.isFinite(n) ? n : h
  const hue = Math.round((base * 137.508) % 360)
  return `hsl(${hue}, 65%, 45%)`
}
