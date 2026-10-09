import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { marked } from 'marked'

// 루트 문서를 마크다운 렌더링해 보여주는 페이지 (/docs/manual | /docs/history)
// fetch().text()는 UTF-8로 디코딩하므로 .md 직접 링크 시의 한글깨짐이 없음
const DOCS = {
  manual: { file: '사용자매뉴얼.md', title: '사용자 매뉴얼' },
  history: { file: '버전변경이력.md', title: '버전 변경 이력' },
}

export default function DocView() {
  const { name } = useParams()
  const doc = DOCS[name]
  const [html, setHtml] = useState(null)

  useEffect(() => {
    if (!doc) return
    fetch(`/docs/${doc.file}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then(md => setHtml(marked.parse(md)))
      .catch(() => setHtml('<p class="err">문서를 불러오지 못했습니다</p>'))
  }, [name])

  if (!doc) return <p className="err">알 수 없는 문서입니다</p>
  return (
    <div className="doc-wrap">
      {html === null
        ? <p className="hint">문서를 불러오는 중…</p>
        : <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
