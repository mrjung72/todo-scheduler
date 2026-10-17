import { useRef, useState } from 'react'
import api, { mdHtml, cleanHtml } from './api'

// 작업이력·요청내용·게시글 본문 편집기 — 마크다운 지원 (이미지 첨부·표 삽입·미리보기)
// 이미지는 /attach-files에 업로드 후 본문에 마크다운으로 삽입된다.
// onUploaded(file): 업로드된 첨부 객체 통지 — 신규 이력은 저장 후 workschid 재연결용
// boardid: 게시판 모드 — 첨부를 board_attach_files에 기록하고 board/ 다운로드 URL 삽입.
// pendingImage(file): 게시글 ID가 없는 신규 작성 시 호출 — {fileid: 'pending-*'} 를
// 반환하면 그 자리에 임시 URL을 삽입하고, 호출측이 저장 후 실제 fileid로 치환한다.
export default function WorkLogEditor({ value, onChange, taskid, workschid,
  onUploaded, rows = 8, boardid, pendingImage }) {
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

  const escH = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 엑셀 표 DOM → 병합(colspan/rowspan) 유지 HTML 표
  const cellText = c => {
    const html = (c.innerHTML || '').replace(/<br[^>]*>/gi, '\n')
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return (tmp.textContent || '').replace(/ /g, ' ').split('\n')
      .map(s => escH(s.trim())).join('<br>')
  }
  const tableHtml = tbl => {
    const rows = [...tbl.rows].map(r =>
      '<tr>' + [...r.cells].map(c => {
        const tag = c.tagName === 'TH' ? 'th' : 'td'
        const a = (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '')
          + (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '')
        return `<${tag}${a}>${cellText(c)}</${tag}>`
      }).join('') + '</tr>').join('\n')
    return `<table>\n${rows}\n</table>`
  }
  // TSV(탭 구분) 텍스트 → 마크다운 표 (첫 행 헤더)
  const tsvToMd = text => {
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
      .split('\n').map(r => r.split('\t'))
    const cols = Math.max(...rows.map(r => r.length))
    const esc = c => (c || '')
      .replace(/^"|"$/g, '').replace(/""/g, '"')   // 엑셀 따옴표 해제
      .replace(/\|/g, '\\|').trim()
    const pad = rows.map(r =>
      [...Array(cols)].map((_, i) => esc(r[i])))
    return '| ' + pad[0].join(' | ') + ' |\n'
      + '| ' + pad[0].map(() => '---').join(' | ') + ' |\n'
      + pad.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n')
  }

  const uploadImage = async f => {
    try {
      // 게시판 신규 작성 — 게시글 ID가 없으므로 임시 첨부로 두고 본문에 임시 URL 삽입
      if (boardid === null && pendingImage) {
        const data = await pendingImage(f)
        insert(`\n\n![${data.file_name}](/api/attach-files/board/${data.fileid}/download)\n\n`)
        return
      }
      const fd = new FormData()
      fd.append('file', f, f.name || `paste_${Date.now()}.png`)
      if (boardid) fd.append('boardid', boardid)
      else {
        fd.append('taskid', taskid)
        if (workschid) fd.append('workschid', workschid)
      }
      const { data } = await api.post('/attach-files', fd)
      onUploaded?.(data)
      insert(`\n\n![${data.file_name}](/api/attach-files/` +
        `${boardid ? 'board/' : ''}${data.fileid}/download)\n\n`)
    } catch (e) {
      alert(e.response?.data?.detail || '이미지 업로드에 실패했습니다')
    }
  }

  // 붙여넣기: ① 엑셀(TSV) 표 — 탭 구분이 있으면 표로 (엑셀은 표의 이미지도
  //           클립보드에 함께 넣으므로 이미지보다 표를 우선 검사)
  //           ② 이미지 파일 → 첨부 업로드 후 삽입 (스크린샷·이미지 복사)
  //           ③ 기타 HTML(웹·문서 등 서식 복사) → 정제된 HTML 그대로
  const onPaste = async e => {
    const cd = e.clipboardData
    const text = cd?.getData('text/plain') || ''
    const html = cd?.getData('text/html') || ''
    // 1) 엑셀 표 — 병합 유지 HTML 표 우선, 없으면 마크다운 표
    if (text.includes('\t')) {
      const rows0 = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
        .split('\n').map(r => r.split('\t'))
      if (rows0[0].length < 2) return   // 단일 셀은 기본 붙여넣기
      e.preventDefault()
      const tbl = html && new DOMParser()
        .parseFromString(html, 'text/html').querySelector('table')
      insert(tbl && tbl.rows.length
        ? `\n\n${tableHtml(tbl)}\n\n` : `\n\n${tsvToMd(text)}\n\n`)
      return
    }
    // 2) 이미지 파일 붙여넣기 (스크린샷·이미지 복사)
    const img = [...(cd?.files || [])].find(f => f.type.startsWith('image/'))
    if (img) {
      e.preventDefault()
      await uploadImage(img)
      return
    }
    // 3) 다른 화면에서 긁어온 서식 콘텐츠 — 허용 태그만 남긴 HTML로 삽입
    if (html && /<(table|img|ul|ol|li|h[1-6]|p|br|strong|em|del|s|b|i|pre|blockquote|a|code|hr)[\s/>]/i
        .test(html)) {
      const rich = cleanHtml(new DOMParser()
        .parseFromString(html, 'text/html').body.innerHTML).trim()
      if (rich) {
        e.preventDefault()
        insert(`\n\n${rich}\n\n`)
      }
    }
    // 그 외 일반 텍스트는 기본 붙여넣기
  }

  const addImage = async ev => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { alert('이미지 파일만 삽입할 수 있습니다'); return }
    await uploadImage(f)
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
            placeholder="작업 내용을 입력하세요 (이미지·표·서식 복사 붙여넣기 지원)"
            onChange={e => setVal(e.target.value)} onPaste={onPaste} />}
    </div>
  )
}
