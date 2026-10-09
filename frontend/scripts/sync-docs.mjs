// 빌드 시 루트의 문서 파일을 public/docs 로 복사 (canonical: 프로젝트 루트)
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dest = resolve(root, 'frontend/public/docs')
mkdirSync(dest, { recursive: true })
for (const f of ['사용자매뉴얼.md', '버전변경이력.md']) {
  copyFileSync(resolve(root, f), resolve(dest, f))
  console.log(`[sync-docs] ${f} -> public/docs/`)
}
