import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, TASK_TYPE_LABEL, taskColor, isDevWorker,
  resolveUserid, loadFilter, saveFilter, clearFilter, stickerTip } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'
import UserInfoPopup from '../UserInfoPopup'
import ReqUserInput from '../ReqUserInput'

const PAGE_SIZES = [10, 20, 50, 100]

export default function TaskList() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
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
  const [catFilter, setCatFilter] = useState(savedF.cat || '')
  const [cats, setCats] = useState([])   // 업무유형 목록 (사이트별)
  const [reqFilter, setReqFilter] = useState(savedF.req || '')
  const [workerFilter, setWorkerFilter] = useState(savedF.worker || '')
  // 요청일시 기간 필터: 구분(최근/지난) + 기간
  const [reqDir, setReqDir] = useState(savedF.rdir || '')
  const [reqPeriod, setReqPeriod] = useState(savedF.rperiod || '')
  const [cfg, setCfg] = useState(null)
  const [sel, setSel] = useState(null)   // 상세 팝업 대상 작업
  const [userSel, setUserSel] = useState(null)   // 사용자 정보 팝업 대상 userid
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(savedF.size || 20)

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (statFilter) params.task_stat = statFilter
    if (siteFilter) params.siteid = siteFilter
    if (typeFilter) params.task_type = typeFilter
    if (catFilter) params.task_category = catFilter
    const reqUid = resolveUserid(reqFilter, users)
    if (reqUid) params.req_userid = reqUid
    if (workerFilter) params.work_userid = workerFilter
    // 요청일시 기간: 최근=기준시각 이후 / 지난=기준시각 이전
    if (reqDir && reqPeriod) {
      const base = new Date()
      const v = parseInt(reqPeriod, 10)
      if (reqPeriod.endsWith('m')) base.setMonth(base.getMonth() - v)
      else base.setDate(base.getDate() - v)
      const iso = base.toISOString().slice(0, 19).replace('T', ' ')
      if (reqDir === 'recent') params.req_from = iso
      else params.req_to = iso
    }
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, statFilter, siteFilter, typeFilter, catFilter, reqFilter, workerFilter, reqDir, reqPeriod, users])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => setPage(0), [q, statFilter, siteFilter, typeFilter, catFilter, reqFilter, workerFilter, reqDir, reqPeriod])   // 검색조건 변경 시 1페이지로
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data))
    api.get('/sites').then(r => setSites(r.data))
    api.get('/users').then(r => setUsers(r.data))
    api.get('/task-categories').then(r => setCats(r.data))
  }, [])

  // 현재 조회 결과를 CSV(BOM 포함, 엑셀에서 바로 열림)로 다운로드
  const downloadCsv = () => {
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const header = ['ID', '사이트', '우선순위', 'CSR번호', '작업유형', '업무유형', '작업명', '예상 작업시간(Hour)',
      '현업담당자', 'IT담당자', '작업자', '요청일시', '시작일시', '종료일시(예상)', '작업상태']
    const lines = tasks.map(t => [
      t.taskid, t.site_name || t.siteid || '', t.priority, t.task_csrid || '',
      TASK_TYPE_LABEL[t.task_type] || '',
      t.task_category_nm || t.task_category_cd || '', t.task_name, t.work_hours_estimated,
      t.req_user_name || t.req_userid || '',
      t.itos_user_name || t.itos_userid || '',
      t.work_user_name || t.work_userid || '',
      fmtDT(t.req_date),
      fmtDT(t.task_start_date), fmtDT(t.task_end_date_estimated),
      STAT_LABEL[t.task_stat] || t.task_stat,
    ].map(esc).join(','))
    const fields = ['taskid', 'site_name', 'priority', 'task_csrid', 'task_type', 'task_category_nm', 'task_name',
      'work_hours_estimated', 'req_userid', 'itos_userid', 'work_userid',
      'req_date', 'task_start_date', 'task_end_date_estimated', 'task_stat']
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
      reqFilter,
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

  const pages = Math.max(1, Math.ceil(tasks.length / pageSize))
  const cur = Math.min(page, pages - 1)
  const paged = tasks.slice(cur * pageSize, (cur + 1) * pageSize)

  return (
    <div>
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={statFilter} onChange={e => setStatFilter(e.target.value)}>
          <option value="">작업상태(전체)</option>
          {Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">작업유형(전체)</option>
          {Object.entries(TASK_TYPE_LABEL).map(([k, v]) =>
            <option key={k} value={k}>{v}({k})</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">업무유형(전체)</option>
          {cats.filter(c => !siteFilter || c.siteid === siteFilter).map(c =>
            <option key={c.task_category_cd} value={c.task_category_cd}>
              {c.task_category_nm}({c.task_category_cd})</option>)}
        </select>
        <ReqUserInput users={users} value={reqFilter} onChange={setReqFilter} />
        <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
          <option value="">작업자(전체)</option>
          {users.filter(isDevWorker)
            .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/작업내용/CSR/담당자명 또는 ID)"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <select value={reqDir} title="요청일시 구분"
          onChange={e => { setReqDir(e.target.value); setReqPeriod('') }}>
          <option value="">요청일시(전체)</option>
          <option value="recent">최근</option>
          <option value="past">지난</option>
        </select>
        <select value={reqPeriod} title="요청일시 기간" disabled={!reqDir}
          onChange={e => setReqPeriod(e.target.value)}>
          <option value="">기간(선택)</option>
          {reqDir === 'recent' && (<>
            <option value="1">1일</option>
            <option value="3">3일</option>
            <option value="7">1주일</option>
            <option value="1m">1달</option>
            <option value="3m">3달</option>
          </>)}
          {reqDir === 'past' && (<>
            <option value="7">1주일</option>
            <option value="1m">1달</option>
            <option value="3m">3달</option>
          </>)}
        </select>
        <button onClick={() => {
          saveFilter('tasks', { site: siteFilter, q, stat: statFilter, type: typeFilter, cat: catFilter, req: reqFilter, worker: workerFilter, rdir: reqDir, rperiod: reqPeriod, size: pageSize })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        <button onClick={() => {
          clearFilter('tasks')
          setSiteFilter(me?.default_siteid ?? ''); setQ('')
          setStatFilter(''); setTypeFilter(''); setCatFilter(''); setReqFilter('')
          setWorkerFilter(''); setReqDir(''); setReqPeriod(''); setPage(0)
        }}>검색조건 초기화</button>
        <button className="excel" onClick={downloadCsv} disabled={!tasks.length}>엑셀 다운로드</button>
      </div>

      <div className="pager">
        <span className="pager-count">총 {tasks.length}건</span>
        <select className="pager-size" value={pageSize} title="페이지당 건수"
          onChange={e => { setPageSize(+e.target.value); setPage(0) }}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}건씩</option>)}
        </select>
        <button disabled={cur <= 0} onClick={() => setPage(cur - 1)}>이전</button>
        <span>{cur + 1} / {pages} 페이지</span>
        <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>다음</button>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th className="fit">ID</th><th>사이트</th><th className="fit">우선<br/>순위</th><th className="csr-col">CSR번호</th><th className="fit">작업유형</th><th className="fit">업무유형</th><th>작업명</th><th className="fit">예상 작업<br/>시간(Hour)</th>
            <th>현업담당자</th><th>IT담당자</th><th>작업자</th>
            <th>요청일시</th><th>시작일시</th><th>종료일시(예상)</th><th>작업상태</th>
          </tr>
        </thead>
        <tbody>
          {paged.map(t => (
            <tr key={t.taskid} style={{ borderLeft: `6px solid ${taskColor(t.taskid)}` }}>
              <td className="r fit">{t.taskid}</td>
              <td className="c">{t.site_name || t.siteid}</td>
              <td className="r fit">{t.priority}</td>
              <td className="csr-col">{t.task_csrid || '-'}</td>
              <td className="c fit">{TASK_TYPE_LABEL[t.task_type] || '-'}</td>
              <td className="c fit">{t.task_category_nm || '-'}</td>
              <td>{t.priority === 0 && <span className="badge urgent-badge" title="우선순위">긴급</span>}
                {!!t.holiday_work && <span className="badge hol-badge">휴일</span>}
                {!!t.weekday_included &&
                  <span className="badge warn-badge" title="휴일작업 기간에 평일이 포함되어 있습니다">평일</span>}
                <button className="link" title={t.task_name} onClick={() => setSel(t)}>
                  {t.task_name?.length > 30 ? t.task_name.slice(0, 30) + '…' : t.task_name}</button>
                {!!t.stickers?.length &&
                  <span className="kb-stickers" title={stickerTip(t.stickers)}>
                    {t.stickers.map(s => s.emoji).join(' ')}</span>}</td>
              <td className="r fit">{t.work_hours_estimated}</td>
              <td className="c">{t.req_userid
                ? <button className="link" onClick={() => setUserSel(t.req_userid)}>{t.req_user_name || t.req_userid}</button>
                : '-'}</td>
              <td className="c">{t.itos_userid
                ? <button className="link" onClick={() => setUserSel(t.itos_userid)}>{t.itos_user_name || t.itos_userid}</button>
                : '-'}</td>
              <td className="c">{t.work_userid
                ? <button className="link" onClick={() => setUserSel(t.work_userid)}>{t.work_user_name || t.work_userid}</button>
                : '-'}</td>
              <td className="c">{fmtDT(t.req_date)}</td>
              <td className="c">
                {fmtDT(t.task_start_date)}
                {t.start_fixed ? <span className="badge">고정</span> : null}
              </td>
              <td className="c">{fmtDT(t.task_end_date_estimated)}</td>
              <td className="c">{STAT_LABEL[t.task_stat] || t.task_stat}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan="15" className="empty">작업이 없습니다</td></tr>
          )}
        </tbody>
      </table>
      {sel && <TaskDetailPopup task={sel} onClose={() => setSel(null)} onChanged={load} />}
      {userSel && <UserInfoPopup userid={userSel} users={users} sites={sites}
        onClose={() => setUserSel(null)} />}
      <p className="hint">
        우선순위 순 정렬. 작업 수정·삭제·일정 재적용은 [관리자 → 작업스케줄] 화면에서 합니다.
        {cfg
          ? ` (근무 ${cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')} = 기본 하루 ${cfg.work_hours_per_day}시간(개발자별 설정 가능), 토·일·휴일·휴가 제외)`
          : ''}
      </p>
    </div>
  )
}
