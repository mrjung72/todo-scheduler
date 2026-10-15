import { useCallback, useEffect, useState } from 'react'
import api, { STAT_LABEL, TASK_TYPE_LABEL, NEXT_STAT, taskColor, isDevWorker,
  resolveUserid, loadFilter, saveFilter } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'
import ReqUserInput from '../ReqUserInput'

// 3열 배치: 좌 = 대기·검토·요청, 중 = 작업중·중단·단순업무중, 우 = 완료·최종완료·반려
const LAYOUT = [
  ['W', 'C', 'R'],
  ['P', 'H', 'O'],
  ['F', 'Z', 'X'],
]

export default function Kanban() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  const [users, setUsers] = useState([])
  // 사이트 기본값 = 로그인 사용자의 기본사이트(default_siteid)
  const [savedF] = useState(() => loadFilter('kanban'))
  const [siteFilter, setSiteFilter] = useState(() =>
    savedF.site ?? me?.default_siteid ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [typeFilter, setTypeFilter] = useState(savedF.type || '')
  const [reqFilter, setReqFilter] = useState(savedF.req || '')
  const [workerFilter, setWorkerFilter] = useState(savedF.worker || '')
  // 요청일시 기간 필터: 구분(최근/지난) + 기간
  const [reqDir, setReqDir] = useState(savedF.rdir || '')
  const [reqPeriod, setReqPeriod] = useState(savedF.rperiod || '')
  // 상태영역별 상태변경일자 필터: { [stat]: { dir, period } }
  const [statF, setStatF] = useState({})
  const [dropTarget, setDropTarget] = useState(null)  // 드롭 대상 영역의 상태값
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)   // 상세 팝업 대상 작업
  const [selId, setSelId] = useState(null) // 선택한 카드 (배경 강조, 드래그 후에도 유지)
  const [flowOpen, setFlowOpen] = useState(false) // 작업 처리 프로세스 팝업

  // 카드 이동 권한: 관리자(0) 전부, 개발자(1)는 본인 작업만
  const canMove = t => me && ([0, 1].includes(me.user_grade) ||
    t.work_userid === me.userid ||
    (me.user_grade === 4 && me.default_siteid && t.siteid === me.default_siteid))

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (siteFilter) params.siteid = siteFilter
    if (typeFilter) params.task_type = typeFilter
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
  }, [q, siteFilter, typeFilter, reqFilter, workerFilter, reqDir, reqPeriod, users])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => {
    api.get('/sites').then(r => setSites(r.data))
    api.get('/users').then(r => setUsers(r.data))
  }, [])
  // 에러 메시지는 3초 후 자동 제거
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(''), 3000)
    return () => clearTimeout(t)
  }, [err])

  const onDrop = async (e, st) => {
    e.preventDefault()
    setDropTarget(null)
    const taskid = +e.dataTransfer.getData('text/taskid')
    const t = tasks.find(x => x.taskid === taskid)
    if (!t || t.task_stat === st || !canMove(t)) return
    const normalOk = t.holiday_work || (NEXT_STAT[t.task_stat] || []).includes(st)
    // 직전 상태 칸으로 드롭 → 되돌리기 (F/X는 예상 미경과, 모든 상태는 변경 후 1시간 이내)
    // 되돌리기 불가여도 정상 전이가 아니면 서버에 보내 불가 사유를 그대로 표시
    if (t.prev_stat && st === t.prev_stat && (t.can_revert || !normalOk)) {
      try {
        await api.post(`/tasks/${taskid}/revert`)
        load()
      } catch (ex) {
        setErr(ex.response?.data?.detail || '되돌리기에 실패했습니다')
      }
      return
    }
    // 허용 전이 외 이동은 서버와 동일 규칙으로 차단 (휴일작업은 제약 없음)
    if (!normalOk) {
      // 이동 가능한 상태 + 되돌리기 가능 여부를 안내에 포함
      const allowed = (NEXT_STAT[t.task_stat] || [])
        .filter(s => s !== t.task_stat).map(s => STAT_LABEL[s])
      const hint = allowed.length ? ` (가능: ${allowed.join(', ')})` : ''
      const rev = t.can_revert && t.prev_stat
        ? ` '${STAT_LABEL[t.prev_stat]}'(으)로는 되돌릴 수 있습니다` : ''
      setErr(`${STAT_LABEL[t.task_stat]} 상태에서는 ${STAT_LABEL[st]}(으)로 변경할 수 없습니다.${hint}${rev}`)
      return
    }
    try {
      await api.put(`/tasks/${taskid}`, { task_stat: st })
      load()
    } catch (ex) {
      setErr(ex.response?.data?.detail || '상태 변경에 실패했습니다')
    }
  }

  const byStat = {}
  for (const t of tasks) (byStat[t.task_stat] ??= []).push(t)

  // 상태변경일자 필터 판정: 최근=기준시각 이후 / 지난=기준시각 이전
  const matchStatF = (t, f) => {
    if (!f?.dir || !f?.period) return true
    if (!t.stat_chg_date) return false
    const b = new Date()
    const v = parseInt(f.period, 10)
    if (f.period.endsWith('m')) b.setMonth(b.getMonth() - v)
    else b.setDate(b.getDate() - v)
    const d = new Date(t.stat_chg_date)
    return f.dir === 'recent' ? d >= b : d <= b
  }

  return (
    <div className="kanban-wrap">
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">유형(전체)</option>
          {Object.entries(TASK_TYPE_LABEL).map(([k, v]) =>
            <option key={k} value={k}>{v}({k})</option>)}
        </select>
        <ReqUserInput users={users} value={reqFilter} onChange={setReqFilter} />
        <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
          <option value="">작업자(전체)</option>
          {users.filter(isDevWorker)
            .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/CSR/담당자명 또는 ID)"
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
          saveFilter('kanban', { site: siteFilter, q, type: typeFilter, req: reqFilter,
            worker: workerFilter, rdir: reqDir, rperiod: reqPeriod })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        <span className="kb-total">총 {tasks.length}건</span>
        <button className="flow-btn" title="작업 처리 프로세스 보기"
          onClick={() => setFlowOpen(true)}>처리 프로세스</button>
        {err && <span className="err">{err}</span>}
      </div>

      <div className="kanban">
        {LAYOUT.map((stats, i) => (
          <div className="kb-col" key={i}>
            {stats.map(st => {
              const f = statF[st] || {}
              const items = (byStat[st] || []).filter(t => matchStatF(t, f))
              return (
              <section
                className={`kb-area st-${st}` + (dropTarget === st ? ' drop-over' : '')}
                key={st}
                onDragOver={e => { e.preventDefault(); setDropTarget(st) }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null)
                }}
                onDrop={e => onDrop(e, st)}
              >
                <h4 className="kb-head">
                  {STAT_LABEL[st] || st}
                  <span className="kb-count">{items.length}</span>
                  <select className="kb-sf" value={f.dir || ''}
                    title={`${STAT_LABEL[st] || st} 변경일 구분`}
                    onChange={e => setStatF(p => ({
                      ...p, [st]: { dir: e.target.value, period: '' } }))}>
                    <option value="">전체</option>
                    <option value="recent">최근</option>
                    <option value="past">지난</option>
                  </select>
                  <select className="kb-sf" value={f.period || ''}
                    title={`${STAT_LABEL[st] || st} 변경일 기간`}
                    disabled={!f.dir}
                    onChange={e => setStatF(p => ({
                      ...p, [st]: { ...p[st], period: e.target.value } }))}>
                    <option value="">기간</option>
                    {f.dir === 'recent' && (<>
                      <option value="1">1일</option>
                      <option value="3">3일</option>
                      <option value="7">1주일</option>
                      <option value="1m">1달</option>
                      <option value="3m">3달</option>
                    </>)}
                    {f.dir === 'past' && (<>
                      <option value="7">1주일</option>
                      <option value="1m">1달</option>
                      <option value="3m">3달</option>
                    </>)}
                  </select>
                </h4>
                <div className="kb-cards">
                  {items.map(t => (
                    <div className={'kb-card' + (t.taskid === selId ? ' sel' : '')}
                      key={t.taskid}
                      draggable={canMove(t)}
                      onClick={() => setSelId(t.taskid)}
                      onDragStart={e =>
                        e.dataTransfer.setData('text/taskid', String(t.taskid))}
                      style={{ borderLeft: `5px solid ${taskColor(t.taskid)}` }}>
                      <div className="kb-row1">
                        <span className="kb-no">#{t.taskid}</span>
                        {t.priority === 0 &&
                          <span className="kb-prio urgent" title="우선순위">긴급</span>}
                        {['P', 'O'].includes(t.task_stat) && t.task_end_date_estimated &&
                          new Date(t.task_end_date_estimated) < new Date() &&
                          <span className="kb-overdue" title="종료예상일시 경과">💣</span>}
                        {t.site_name && <span className="kb-site">{t.site_name}</span>}
                        {t.task_type &&
                          <span className="kb-type">{TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>}
                        {!!t.holiday_work && <span className="badge hol-badge">휴일</span>}
                        {t.task_csrid && <span className="kb-csr">{t.task_csrid}</span>}
                      </div>
                      <div className="kb-title">
                        {!!t.weekday_included &&
                          <span className="badge warn-badge" title="휴일작업 기간에 평일이 포함되어 있습니다">평일</span>}
                        <span className="kb-name" title={t.task_name}>{t.task_name}</span>
                      </div>
                      <div className="kb-meta">
                        <span>{t.req_user_name || t.req_userid || '-'}</span>
                        {t.req_date &&
                          <span>{(t.req_date || '').slice(0, 19).replace('T', ' ')}</span>}
                      </div>
                      <button className="kb-detail" title="작업 상세"
                        onClick={e => { e.stopPropagation(); setSel(t) }}>상세</button>
                    </div>
                  ))}
                  {!items.length && <div className="kb-empty">없음</div>}
                </div>
              </section>
              )
            })}
          </div>
        ))}
      </div>
      {sel && <TaskDetailPopup task={sel} onClose={() => setSel(null)} onChanged={load} />}
      {flowOpen && (
        <div className="popup" onClick={() => setFlowOpen(false)}>
          <div className="popup-body flow-popup" onClick={e => e.stopPropagation()}>
            <h3 className="popup-title">작업 처리 프로세스</h3>
            <div className="flow-row">
              <span className="flow-cap">스케쥴링 작업</span>
              <div className="flow-line">
                <span className="home-stat st-R">작업요청</span><i>→</i>
                <span className="home-stat st-C">검토중</span><i>→</i>
                <span className="home-stat st-W">대기중</span><i>→</i>
                <span className="home-stat st-P">작업중</span><i>→</i>
                <span className="home-stat st-F">작업완료</span><i>→</i>
                <span className="home-stat st-Z">최종완료</span>
              </div>
            </div>
            <div className="flow-row">
              <span className="flow-cap">비스케쥴링 작업</span>
              <div className="flow-line">
                <span className="home-stat st-R">작업요청</span><i>→</i>
                <span className="home-stat st-C">검토중</span><i>→</i>
                <span className="home-stat st-O">단순업무중</span><i>→</i>
                <span className="home-stat st-F">작업완료</span><i>→</i>
                <span className="home-stat st-Z">최종완료</span>
              </div>
            </div>
            <div className="flow-note">
              <span><span className="home-stat st-H">작업중단</span> 작업중 일시 중단 — 작업중으로 복귀 가능</span>
              <span><span className="home-stat st-X">작업반려</span> 검토중·대기중·작업중·단순업무중에서 반려 가능</span>
              <span>검토중까지는 <b>스케쥴적용 여부</b>로 처리 경로(스케쥴링/비스케쥴링)를 전환할 수 있으며,
                변경 시 상태변경이력이 초기화됩니다.</span>
              <span>최종완료된 작업은 더 이상 상태를 변경할 수 없습니다.</span>
            </div>
            <div className="popup-btns">
              <button onClick={() => setFlowOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
