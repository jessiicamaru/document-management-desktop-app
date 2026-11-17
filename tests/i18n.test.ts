import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import { setLanguage, t } from '../src/shared/i18n'
import { EN } from '../src/shared/locales/en'

/** Every t('...') text in the app's code. */
function textsInCode(): Map<string, string> {
  const found = new Map<string, string>()
  const walkDir = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'vendor') walkDir(p)
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
        const ast = parse(readFileSync(p, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
        const visit = (node: unknown): void => {
          if (!node || typeof node !== 'object') return
          const n = node as { type?: string; callee?: { type: string; name?: string }; arguments?: { type: string; value?: string }[] }
          if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 't' && n.arguments?.[0]?.type === 'StringLiteral') {
            found.set(n.arguments[0].value!, path.relative('.', p))
          }
          for (const [k, v] of Object.entries(node)) {
            if (k === 'loc' || k.endsWith('Comments')) continue
            if (Array.isArray(v)) v.forEach(visit)
            else if (v && typeof v === 'object' && 'type' in v) visit(v)
          }
        }
        visit(ast.program)
      }
    }
  }
  walkDir('src')
  return found
}

afterEach(() => setLanguage('vi'))

describe('interface language', () => {
  it('every text in the code has an English translation', () => {
    const missing = [...textsInCode()].filter(([text]) => !(text in EN)).map(([text, file]) => `${file}: ${text}`)
    expect(missing).toEqual([])
  })

  it('translations keep their {placeholders}', () => {
    const broken = Object.entries(EN).filter(([vi, en]) => {
      const holes = (s: string): string[] => (s.match(/\{\d+\}/g) ?? []).sort()
      return holes(vi).join() !== holes(en).join()
    })
    expect(broken).toEqual([])
  })

  it('fills in values and falls back to Vietnamese', () => {
    expect(t('Đã đổi tag ở {0} bài', { 0: 3 })).toBe('Đã đổi tag ở 3 bài')
    setLanguage('en')
    expect(t('Đã đổi tag ở {0} bài', { 0: 3 })).toBe('Tag renamed in 3 documents')
    expect(t('Câu chưa có bản dịch')).toBe('Câu chưa có bản dịch')
  })
})
