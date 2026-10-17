import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { marked } from 'marked'
import api from '../api'

// 루트 문서를 마크다운 렌더링해 보여주는 페이지 (/docs/manual | /docs/history)
// fetch().text()는 UTF-8로 디코딩하므로 .md 직접 링크 시의 한글깨짐이 없음
const DOCS = {
  manual: { file: '사용자매뉴얼.md', title: '사용자 매뉴얼' },
  history: { file: '버전변경이력.md', title: '버전 변경 이력' },
  history0: { file: '버전변경이력-0.x.md', title: '버전 변경 이력 (0.x)' },
  license: { file: '라이선스정책.md', title: '라이선스 정책' },
}

export default function DocView() {
  const { name } = useParams()
  const doc = DOCS[name]
  const [html, setHtml] = useState(null)
  const [lic, setLic] = useState(null)

  useEffect(() => {
    if (!doc) return
    fetch(`/${encodeURIComponent(doc.file)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then(md => setHtml(marked.parse(md)))
      .catch(() => setHtml('<p class="err">문서를 불러오지 못했습니다</p>'))
  }, [name])

  useEffect(() => {
    if (name === 'license')
      api.get('/license').then(r => setLic(r.data)).catch(() => {})
  }, [name])

  if (!doc) return <p className="err">알 수 없는 문서입니다</p>
  return (
    <div className="doc-wrap">
      {name === 'license' && lic && (
        <div className={`doc-lic ${lic.valid ? '' : 'err'}`}>
          <b>현재 라이선스</b>
          <span>
            {lic.installed
              ? `${lic.type === 'ent' ? '기업용' : '무료'}${lic.name ? ` (${lic.name})` : ''}`
              : '키 없음'}
            {' · 사용자 '}{lic.seats ? `${lic.seats}명` : '무제한'}
            {lic.expires
              ? ` · 만료일 ${lic.expires} (D-${lic.days_left})`
              : ' · 무기한'}
            {!lic.valid && lic.msg ? ` — ${lic.msg}` : ''}
          </span>
        </div>
      )}
      {html === null
        ? <p className="hint">문서를 불러오는 중…</p>
        : <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
