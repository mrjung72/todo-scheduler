import { useRef, useState } from 'react'
import api, { mdHtml } from './api'

// 작업이력 내용 편집기 — 마크다운 지원 (이미지 첨부·표 삽입·미리보기)
// 이미지는 /attach-files에 업로드 후 본문에 마크다운으로 삽입된다.
// onUploaded(file): 업로드된 첨부 객체 통지 — 신규 이력은 저장 후 workschid 재연결용
export default function WorkLogEditor({ value, onChange, taskid, workschid,
  onUploaded, rows = 8 }) {
  const [preview, setPreview] = useState(false)
  const taRef = useRef(null)
  // 업로드 등 비동기 작업 후에도 최신 본문을 읽도록 ref로 동기화
  const valRef = useRef(value)
  valRef.current = value
  const setVal = v => { valRef.current = v; onChange(v) }

  // 커서 위치에 텍스트 삽입 후 커서를 삽입 끝으로.
  // 커서가 표 블록 안이면 표가 깨지지 않도록 표 끝 다음으로 삽입 위치를 옮긴다
  const insert = text => {
    const v = valRef.current || ''
    const ta = taRef.current
    let s = ta?.selectionStart ?? v.length
    let e = ta?.selectionEnd ?? s
    const lines = v.split('\n')
    const isTableLine = l => /^\s*\|.*\|/.test(l)
    let pos = 0, li = 0
    while (li < lines.length && pos + lines[li].length < s) {
      pos += lines[li].length + 1; li++
    }
    if (isTableLine(lines[li] || '')) {
      while (li + 1 < lines.length && isTableLine(lines[li + 1])) li++
      s = e = lines.slice(0, li + 1).join('\n').length
    }
    setVal(v.slice(0, s) + text + v.slice(e))
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(s + text.length, s + text.length)
    })
  }

  // 엑셀 셀 복사를 붙여넣으면 표로 변환 — HTML이 있으면 병합(colspan/rowspan)
  // 까지 유지한 HTML 표로, 없으면 TSV를 마크다운 표로 변환 (첫 행은 헤더)
  const escH = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const cellText = c => {
    const html = (c.innerHTML || '').replace(/<br[^>]*>/gi, '\n')
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return (tmp.textContent || '').replace(/ /g, ' ').split('\n')
      .map(s => escH(s.trim())).join('<br>')
  }
  const onPaste = e => {
    // 1) HTML 클립보드 — 병합 셀(colspan/rowspan)까지 유지
    const html = e.clipboardData?.getData('text/html')
    if (html) {
      const tbl = new DOMParser().parseFromString(html, 'text/html')
        .querySelector('table')
      if (tbl && tbl.rows.length) {
        e.preventDefault()
        const rows = [...tbl.rows].map(r =>
          '<tr>' + [...r.cells].map(c => {
            const tag = c.tagName === 'TH' ? 'th' : 'td'
            const a = (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '')
              + (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '')
            return `<${tag}${a}>${cellText(c)}</${tag}>`
          }).join('') + '</tr>').join('\n')
        insert(`\n\n<table>\n${rows}\n</table>\n\n`)
        return
      }
    }
    // 2) TSV 클립보드 — 마크다운 표로 변환
    const text = e.clipboardData?.getData('text/plain')
    if (!text || !text.includes('\t')) return   // 일반 텍스트는 기본 붙여넣기
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
      .split('\n').map(r => r.split('\t'))
    if (rows[0].length < 2) return   // 단일 셀은 기본 붙여넣기
    e.preventDefault()
    const cols = Math.max(...rows.map(r => r.length))
    const esc = c => (c || '')
      .replace(/^"|"$/g, '').replace(/""/g, '"')   // 엑셀 따옴표 해제
      .replace(/\|/g, '\\|').trim()
    const pad = rows.map(r =>
      [...Array(cols)].map((_, i) => esc(r[i])))
    const md = '\n\n'
      + '| ' + pad[0].join(' | ') + ' |\n'
      + '| ' + pad[0].map(() => '---').join(' | ') + ' |\n'
      + pad.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n')
      + '\n\n'
    insert(md)
  }

  const addImage = async ev => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { alert('이미지 파일만 삽입할 수 있습니다'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', taskid)
    if (workschid) fd.append('workschid', workschid)
    try {
      const { data } = await api.post('/attach-files', fd)
      onUploaded?.(data)
      insert(`\n\n![${data.file_name}](/api/attach-files/${data.fileid}/download)\n\n`)
    } catch (e) {
      alert(e.response?.data?.detail || '이미지 업로드에 실패했습니다')
    }
  }

  return (
    <div className="log-editor">
      <div className="log-ed-bar">
        <label className="btn-file" title="이미지를 첨부하고 본문에 삽입">🖼 이미지
          <input type="file" accept="image/*" hidden onChange={addImage} />
        </label>
        <button type="button" title="표 삽입"
          onClick={() => insert('\n| 항목 | 내용 |\n| --- | --- |\n|  |  |\n')}>
          ▦ 표</button>
        <button type="button" className={preview ? 'on' : ''}
          title={preview ? '편집으로 돌아가기' : '렌더링 결과 미리보기'}
          onClick={() => setPreview(v => !v)}>{preview ? '편집' : '미리보기'}</button>
      </div>
      {preview
        ? <div className="log-detail md md-preview"
            dangerouslySetInnerHTML={mdHtml(value)} />
        : <textarea ref={taRef} className="req-edit" rows={rows} value={value}
            placeholder="작업 내용을 입력하세요 (이미지·표·엑셀 붙여넣기 지원)"
            onChange={e => setVal(e.target.value)} onPaste={onPaste} />}
    </div>
  )
}
