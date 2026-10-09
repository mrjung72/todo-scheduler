import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, TASK_TYPE_LABEL, taskColor, loadFilter, saveFilter } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'

const PAGE_SIZE = 20

export default function TaskList() {
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  const [users, setUsers] = useState([])
  // 초기값 = 저장된 검색조건, 없으면 사용자 기본사이트
  const [savedF] = useState(() => loadFilter('tasks'))
  const [siteFilter, setSiteFilter] = useState(() =>
    savedF.site ?? JSON.parse(localStorage.getItem('user') || 'null')?.default_siteid ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [statFilter, setStatFilter] = useState(savedF.stat || '')
  const [typeFilter, setTypeFilter] = useState(savedF.type || '')
  const [workerFilter, setWorkerFilter] = useState(savedF.worker || '')
  const [cfg, setCfg] = useState(null)
  const [sel, setSel] = useState(null)   // 상세 팝업 대상 작업
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (statFilter) params.task_stat = statFilter
    if (siteFilter) params.siteid = siteFilter
    if (typeFilter) params.task_type = typeFilter
    if (workerFilter) params.work_userid = workerFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, statFilter, siteFilter, typeFilter, workerFilter])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => setPage(0), [q, statFilter, siteFilter, typeFilter, workerFilter])   // 검색조건 변경 시 1페이지로
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data))
    api.get('/sites').then(r => setSites(r.data))
    api.get('/users').then(r => setUsers(r.data))
  }, [])

  // 현재 조회 결과를 CSV(BOM 포함, 엑셀에서 바로 열림)로 다운로드
  const downloadCsv = () => {
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const header = ['사이트', '우선순위', 'CSR번호', '유형', '작업명', '예상 작업시간(Hour)',
      '현업담당자', 'IT담당자', '작업자', '시작일시', '종료일시(예상)', '상태']
    const lines = tasks.map(t => [
      t.site_name || t.siteid || '', t.priority, t.task_csrid || '',
      TASK_TYPE_LABEL[t.task_type] || '', t.task_name, t.work_hours_estimated,
      t.req_user_name || t.req_userid || '',
      t.itos_user_name || t.itos_userid || '',
      t.work_user_name || t.work_userid || '',
      fmtDT(t.task_start_date), fmtDT(t.task_end_date_estimated),
      STAT_LABEL[t.task_stat] || t.task_stat,
    ].map(esc).join(','))
    const fields = ['site_name', 'priority', 'task_csrid', 'task_type', 'task_name',
      'work_hours_estimated', 'req_userid', 'itos_userid', 'work_userid',
      'task_start_date', 'task_end_date_estimated', 'task_stat']
    const csv = '\uFEFF' + [header.map(esc).join(','),
      fields.map(esc).join(','),   // 테이블 컬럼명 라인
      ...lines].join('\r\n')
    const now = new Date()
    const p2 = n => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
      `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
    const conds = [
      siteFilter &&
        (sites.find(s => s.siteid === siteFilter)?.site_name || siteFilter),
      q.trim(),
      statFilter && (STAT_LABEL[statFilter] || statFilter),
      typeFilter && (TASK_TYPE_LABEL[typeFilter] || typeFilter),
      workerFilter &&
        (users.find(u => u.userid === workerFilter)?.user_name || workerFilter),
    ].filter(Boolean).join('_')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `작업목록${conds ? `_${conds}` : ''}_${stamp}.csv`
      .replace(/[\\/:*?"<>|]/g, '_')
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  const cur = Math.min(page, pages - 1)
  const paged = tasks.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  return (
    <div>
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={statFilter} onChange={e => setStatFilter(e.target.value)}>
          <option value="">상태(전체)</option>
          {Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">유형(전체)</option>
          {Object.entries(TASK_TYPE_LABEL).map(([k, v]) =>
            <option key={k} value={k}>{v}({k})</option>)}
        </select>
        <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
          <option value="">작업자(전체)</option>
          {users.filter(u => [1, 2].includes(u.user_grade))
            .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/담당자명 또는 ID)"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <button onClick={() => {
          saveFilter('tasks', { site: siteFilter, q, stat: statFilter, type: typeFilter, worker: workerFilter })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        <button className="excel" onClick={downloadCsv} disabled={!tasks.length}>엑셀 다운로드</button>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>사이트</th><th className="fit">우선<br/>순위</th><th className="csr-col">CSR번호</th><th className="fit">유형</th><th>작업명</th><th className="fit">예상 작업<br/>시간(Hour)</th>
            <th>현업담당자</th><th>IT담당자</th><th>작업자</th>
            <th>시작일시</th><th>종료일시(예상)</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {paged.map(t => (
            <tr key={t.taskid} style={{ borderLeft: `6px solid ${taskColor(t.taskid)}` }}>
              <td className="c">{t.site_name || t.siteid}</td>
              <td className="r fit">{t.priority}</td>
              <td className="csr-col">{t.task_csrid || '-'}</td>
              <td className="c fit">{TASK_TYPE_LABEL[t.task_type] || '-'}</td>
              <td>{!!t.holiday_work && <span className="badge hol-badge">휴일</span>}
                {!!t.weekday_included &&
                  <span className="badge warn-badge" title="휴일작업 기간에 평일이 포함되어 있습니다">평일</span>}
                <button className="link" onClick={() => setSel(t)}>{t.task_name}</button></td>
              <td className="r fit">{t.work_hours_estimated}</td>
              <td className="c">{t.req_user_name || t.req_userid}</td>
              <td className="c">{t.itos_user_name || t.itos_userid}</td>
              <td className="c">{t.work_user_name || t.work_userid || '-'}</td>
              <td className="c">
                {fmtDT(t.task_start_date)}
                {t.start_fixed ? <span className="badge">고정</span> : null}
              </td>
              <td className="c">{fmtDT(t.task_end_date_estimated)}</td>
              <td className="c">{STAT_LABEL[t.task_stat] || t.task_stat}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan="12" className="empty">작업이 없습니다</td></tr>
          )}
        </tbody>
      </table>
      <div className="pager">
        <span className="pager-count">총 {tasks.length}건</span>
        <button disabled={cur <= 0} onClick={() => setPage(cur - 1)}>이전</button>
        <span>{cur + 1} / {pages} 페이지</span>
        <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>다음</button>
      </div>
      {sel && <TaskDetailPopup task={sel} onClose={() => setSel(null)} onChanged={load} />}
      <p className="hint">
        우선순위 순 정렬. 작업 수정·삭제·일정 재적용은 [관리자 → 작업스케줄] 화면에서 합니다.
        {cfg
          ? ` (근무 ${cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')} = 하루 ${cfg.work_hours_per_day}시간, 토·일·휴일·휴가 제외)`
          : ''}
      </p>
    </div>
  )
}
