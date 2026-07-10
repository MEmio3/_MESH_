import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MessageContentProps {
  content: string
  className?: string
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string }

type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'type'
  | 'literal'
  | 'function'
  | 'operator'
  | 'annotation'

interface Token {
  kind: TokenKind
  value: string
}

const aliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  csharp: 'cs',
  'c++': 'cpp'
}

const keywordSets: Record<string, Set<string>> = {
  java: new Set([
    'abstract', 'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
    'do', 'else', 'enum', 'extends', 'final', 'finally', 'for', 'if', 'implements', 'import',
    'instanceof', 'interface', 'native', 'new', 'package', 'private', 'protected', 'public',
    'return', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while'
  ]),
  javascript: new Set([
    'await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from',
    'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'switch',
    'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'yield'
  ]),
  typescript: new Set([
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'declare', 'default', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from',
    'function', 'if', 'implements', 'import', 'in', 'interface', 'let', 'namespace', 'new',
    'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies', 'switch', 'this',
    'throw', 'try', 'type', 'typeof', 'var', 'void', 'while'
  ]),
  python: new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
  ]),
  bash: new Set([
    'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in',
    'select', 'then', 'until', 'while'
  ]),
  css: new Set(['important', 'media', 'supports', 'keyframes', 'from', 'to']),
}

const knownLanguages = new Set([
  ...Object.keys(keywordSets),
  ...Object.keys(aliases),
  'c',
  'cpp',
  'cs',
  'go',
  'html',
  'json',
  'jsx',
  'md',
  'rust',
  'scss',
  'sql',
  'text',
  'tsx',
  'txt',
  'xml',
  'yaml'
])

const typeWords = new Set([
  'boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'String',
  'Boolean', 'Byte', 'Character', 'Double', 'Float', 'Integer', 'Long', 'Short',
  'Object', 'System', 'Math', 'Array', 'List', 'Map', 'Set', 'Promise', 'Record',
  'number', 'string', 'symbol', 'bigint', 'unknown', 'never', 'any', 'void'
])

const literalWords = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False'])

const tokenClass: Record<TokenKind, string> = {
  plain: 'text-mesh-text-primary',
  comment: 'text-mesh-text-muted italic',
  string: 'text-[#9ece6a]',
  number: 'text-[#ff9e64]',
  keyword: 'text-[#f7768e]',
  type: 'text-[#7aa2f7]',
  literal: 'text-[#bb9af7]',
  function: 'text-[#7dcfff]',
  operator: 'text-[#89ddff]',
  annotation: 'text-[#e0af68]'
}

function normalizeLanguage(language: string): string {
  const clean = language.trim().toLowerCase()
  return aliases[clean] ?? clean
}

function parseFencedCode(content: string): Segment[] {
  const segments: Segment[] = []
  const fence = /```([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fence.exec(content))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }

    const { language, code } = parseFenceBody(match[1])
    segments.push({ type: 'code', language, code })
    lastIndex = fence.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }

  return segments.length ? segments : [{ type: 'text', text: content }]
}

function parseFenceBody(body: string): { language: string; code: string } {
  const startsWithLineBreak = /^\r?\n/.test(body)
  const cleanBody = body.replace(/^\r?\n/, '')
  const lineBreak = cleanBody.match(/\r?\n/)

  if (startsWithLineBreak) {
    return { language: '', code: trimCodeEdges(cleanBody) }
  }

  if (lineBreak?.index !== undefined) {
    const firstLine = cleanBody.slice(0, lineBreak.index).trim()
    const restStart = lineBreak.index + lineBreak[0].length
    const possibleLanguage = firstLine.split(/\s+/)[0] ?? ''

    if (possibleLanguage && (firstLine === possibleLanguage || knownLanguages.has(normalizeLanguage(possibleLanguage)))) {
      return {
        language: normalizeLanguage(possibleLanguage),
        code: trimCodeEdges(cleanBody.slice(restStart))
      }
    }

    return { language: '', code: trimCodeEdges(cleanBody) }
  }

  const inlineMatch = cleanBody.match(/^([A-Za-z][\w#+.-]*)(\s+)([\s\S]+)$/)
  if (inlineMatch && knownLanguages.has(normalizeLanguage(inlineMatch[1]))) {
    return {
      language: normalizeLanguage(inlineMatch[1]),
      code: trimCodeEdges(inlineMatch[3])
    }
  }

  return { language: '', code: trimCodeEdges(cleanBody) }
}

function trimCodeEdges(code: string): string {
  return code.replace(/^\n/, '').replace(/\n$/, '')
}

function highlight(code: string, language: string): Token[] {
  if (language === 'json') return highlightJson(code)

  const keywords = keywordSets[language] ?? keywordSets.javascript
  const tokens: Token[] = []
  const pattern =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|@\w+|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[+\-*/%=!<>|&?:.,;()[\]{}]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code))) {
    if (match.index > lastIndex) tokens.push({ kind: 'plain', value: code.slice(lastIndex, match.index) })
    const value = match[0]
    tokens.push({ kind: classifyToken(value, code, pattern.lastIndex, keywords), value })
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < code.length) tokens.push({ kind: 'plain', value: code.slice(lastIndex) })
  return tokens
}

function classifyToken(value: string, code: string, nextIndex: number, keywords: Set<string>): TokenKind {
  if (value.startsWith('//') || value.startsWith('/*') || value.startsWith('#')) return 'comment'
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) return 'string'
  if (value.startsWith('@')) return 'annotation'
  if (/^\d/.test(value)) return 'number'
  if (/^[+\-*/%=!<>|&?:.,;()[\]{}]+$/.test(value)) return 'operator'
  if (literalWords.has(value)) return 'literal'
  if (keywords.has(value)) return 'keyword'
  if (typeWords.has(value) || /^[A-Z][A-Za-z0-9_$]*$/.test(value)) return 'type'

  const rest = code.slice(nextIndex)
  if (/^\s*\(/.test(rest)) return 'function'
  return 'plain'
}

function highlightJson(code: string): Token[] {
  const tokens: Token[] = []
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b|[{}[\],:]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code))) {
    if (match.index > lastIndex) tokens.push({ kind: 'plain', value: code.slice(lastIndex, match.index) })
    const value = match[0]
    if (match[2]) tokens.push({ kind: 'type', value: match[1] }, { kind: 'operator', value: match[2] })
    else if (value.startsWith('"')) tokens.push({ kind: 'string', value })
    else if (/^-?\d/.test(value)) tokens.push({ kind: 'number', value })
    else if (/true|false|null/.test(value)) tokens.push({ kind: 'literal', value })
    else tokens.push({ kind: 'operator', value })
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < code.length) tokens.push({ kind: 'plain', value: code.slice(lastIndex) })
  return tokens
}

function CodeBlock({ code, language }: { code: string; language: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const label = language || 'text'

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="my-2 max-w-full overflow-hidden rounded-xl border border-mesh-border/70 bg-[#11131a]/95 shadow-[0_12px_32px_rgba(0,0,0,0.22)]">
      <div className="flex h-8 items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-mesh-text-muted">
          {label}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="mesh-pressable mesh-icon-button grid h-6 w-6 place-items-center rounded-md text-mesh-text-muted transition-colors hover:bg-white/[0.06] hover:text-mesh-text-primary"
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.55] text-mesh-text-primary">
        <code>
          {highlight(code, language).map((token, index) => (
            <span key={`${index}-${token.kind}`} className={tokenClass[token.kind]}>
              {token.value}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function TextSegment({ text }: { text: string }): JSX.Element | null {
  if (!text) return null
  return <span className="whitespace-pre-wrap break-words">{text}</span>
}

function MessageContent({ content, className }: MessageContentProps): JSX.Element {
  const segments = parseFencedCode(content)
  const hasCode = segments.some((segment) => segment.type === 'code')

  return (
    <div className={cn('max-w-3xl text-sm leading-relaxed text-mesh-text-primary', hasCode ? 'space-y-1' : 'break-words', className)}>
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <CodeBlock key={`code-${index}`} code={segment.code} language={segment.language} />
        ) : (
          <TextSegment key={`text-${index}`} text={segment.text} />
        )
      )}
    </div>
  )
}

export { MessageContent }
