import './style.css'
import { marked } from 'marked'
import hljs from 'highlight.js'

// ============================================================
// CONFIGURATION — Hierarchical docs structure
// ============================================================

const docs = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    subtitle: 'Install, configure, and ship your first agent in seconds',
    file: 'getting-started.md',
    icon: 'zap',
    color: 'primary',
    category: 'Fundamentals',
    children: [
      { id: 'getting-started/installation', title: 'Installation', file: 'getting-started/installation.md', icon: 'package' },
      { id: 'getting-started/quick-start', title: 'Quick Start', file: 'getting-started/quick-start.md', icon: 'play' },
      { id: 'getting-started/core-concepts', title: 'Core Concepts', file: 'getting-started/core-concepts.md', icon: 'book-open' },
      { id: 'getting-started/session-config', title: 'SessionConfig Reference', file: 'getting-started/session-config.md', icon: 'settings' },
      { id: 'getting-started/error-handling', title: 'Error Handling', file: 'getting-started/error-handling.md', icon: 'alert-triangle' },
    ],
  },
  {
    id: 'adapters',
    title: 'Provider Adapters',
    subtitle: 'Connect to OpenAI, Anthropic, Groq, or any custom provider',
    file: 'adapters.md',
    icon: 'cpu',
    color: 'purple',
    category: 'Fundamentals',
    children: [
      { id: 'adapters/openai-compatible', title: 'OpenAI & Compatible', file: 'adapters/openai-compatible.md', icon: 'link' },
      { id: 'adapters/custom-adapter', title: 'Writing a Custom Adapter', file: 'adapters/custom-adapter.md', icon: 'code' },
      { id: 'adapters/streaming-multimodal', title: 'Streaming & Multimodal', file: 'adapters/streaming-multimodal.md', icon: 'radio' },
      { id: 'adapters/retry-rate-limits', title: 'Retry & Rate Limits', file: 'adapters/retry-rate-limits.md', icon: 'refresh-cw' },
      { id: 'adapters/finish-reason', title: 'Finish Reason Normalization', file: 'adapters/finish-reason.md', icon: 'check-circle' },
    ],
  },
  {
    id: 'context-management',
    title: 'Context Management',
    subtitle: 'Intelligent memory management and compression strategies',
    file: 'context-management.md',
    icon: 'layers',
    color: 'cyan',
    category: 'Fundamentals',
    children: [
      { id: 'context-management/sandwich-compression', title: 'Sandwich Compression', file: 'context-management/sandwich-compression.md', icon: 'align-justify' },
      { id: 'context-management/token-counting', title: 'Token Counting & Budgets', file: 'context-management/token-counting.md', icon: 'hash' },
      { id: 'context-management/custom-strategies', title: 'Custom Strategies', file: 'context-management/custom-strategies.md', icon: 'sliders' },
      { id: 'context-management/observability', title: 'Observability & Events', file: 'context-management/observability.md', icon: 'bar-chart-2' },
      { id: 'context-management/scratchpad', title: 'Scratchpad & Working Memory', file: 'context-management/scratchpad.md', icon: 'edit-3' },
    ],
  },
  {
    id: 'tools-and-skills',
    title: 'Tools & Skills',
    subtitle: 'Give your agent superpowers and a distinct personality',
    file: 'tools-and-skills.md',
    icon: 'tool',
    color: 'amber',
    category: 'Fundamentals',
    children: [
      { id: 'tools-and-skills/defining-tools', title: 'Defining Tools', file: 'tools-and-skills/defining-tools.md', icon: 'terminal' },
      { id: 'tools-and-skills/skills-system', title: 'The Skills System', file: 'tools-and-skills/skills-system.md', icon: 'star' },
      { id: 'tools-and-skills/tool-discovery', title: 'Tool Auto-Discovery', file: 'tools-and-skills/tool-discovery.md', icon: 'search' },
      { id: 'tools-and-skills/tool-validation', title: 'Validation & Timeouts', file: 'tools-and-skills/tool-validation.md', icon: 'shield' },
      { id: 'tools-and-skills/tool-examples', title: 'Real-World Examples', file: 'tools-and-skills/tool-examples.md', icon: 'box' },
    ],
  },
  {
    id: 'rag-integration',
    title: 'RAG Integration',
    subtitle: 'Seamlessly query and ingest your private knowledge base',
    file: 'rag-integration.md',
    icon: 'database',
    color: 'emerald',
    category: 'Fundamentals',
    children: [
      { id: 'rag-integration/vector-stores', title: 'Vector Store Adapters', file: 'rag-integration/vector-stores.md', icon: 'server' },
      { id: 'rag-integration/document-ingestion', title: 'Document Ingestion', file: 'rag-integration/document-ingestion.md', icon: 'upload' },
      { id: 'rag-integration/query-optimization', title: 'Query Optimization', file: 'rag-integration/query-optimization.md', icon: 'target' },
    ],
  },
  {
    id: 'advanced-execution',
    title: 'Advanced Runtime',
    subtitle: 'Goal planning, continuation, and execution discipline',
    file: 'advanced-execution.md',
    icon: 'activity',
    color: 'rose',
    category: 'Advanced',
    children: [
      { id: 'advanced-execution/goal-planning', title: 'Goal Planning & Injection', file: 'advanced-execution/goal-planning.md', icon: 'target' },
      { id: 'advanced-execution/continuation-planning', title: 'Continuation Planning', file: 'advanced-execution/continuation-planning.md', icon: 'git-branch' },
      { id: 'advanced-execution/max-steps', title: 'maxSteps & Loop Control', file: 'advanced-execution/max-steps.md', icon: 'repeat' },
      { id: 'advanced-execution/tool-response-compression', title: 'Tool Response Compression', file: 'advanced-execution/tool-response-compression.md', icon: 'minimize-2' },
    ],
  },
]

// Flat lookup of all pages (parent + children)
const allPages = []
for (const doc of docs) {
  allPages.push(doc)
  if (doc.children) allPages.push(...doc.children)
}

const categories = [...new Set(docs.map(d => d.category))]

// ============================================================
// MARKED SETUP
// ============================================================

const renderer = new marked.Renderer()

renderer.code = function ({ text, lang }) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = language !== 'plaintext'
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value

  const displayLang = lang || 'code'

  return `
    <div class="code-block-wrapper">
      <div class="flex items-center justify-between px-6 py-3 border-b border-black/5 bg-black/[0.02]">
        <span class="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">${displayLang}</span>
        <button class="copy-button" data-code="${encodeURIComponent(text)}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Copy
        </button>
      </div>
      <pre><code class="hljs language-${language}">${highlighted}</code></pre>
    </div>
  `
}

renderer.table = function (token) {
  let header = ''
  let body = ''

  header += '<thead><tr>'
  token.header.forEach(cell => {
    header += `<th>${this.parser.parseInline(cell.tokens)}</th>`
  })
  header += '</tr></thead>'

  body += '<tbody>'
  token.rows.forEach(row => {
    body += '<tr>'
    row.forEach(cell => {
      body += `<td>${this.parser.parseInline(cell.tokens)}</td>`
    })
    body += '</tr>'
  })
  body += '</tbody>'

  return `
    <div class="overflow-x-auto my-10 border border-slate-100 rounded-3xl">
      <table class="doc-table w-full text-left border-collapse">
        ${header}
        ${body}
      </table>
    </div>
  `
}

renderer.blockquote = function ({ tokens }) {
  return `<blockquote>${this.parser.parse(tokens)}</blockquote>`
}

marked.use({
  renderer,
  gfm: true,
  breaks: false,
})

// ============================================================
// ICONS
// ============================================================

const icons = {
  zap: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>`,
  layers: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.1 6.27a2 2 0 0 0 0 3.46l9.07 4.09a2 2 0 0 0 1.66 0l9.07-4.09a2 2 0 0 0 0-3.46z"/><path d="m2.1 14.27 9.07 4.09a2 2 0 0 0 1.66 0l9.07-4.09"/><path d="m2.1 10.27 9.07 4.09a2 2 0 0 0 1.66 0l9.07-4.09"/></svg>`,
  tool: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a2 2 0 0 1-2.83-2.83l-3.94 3.6z"/><path d="m11.1 12.9 8 8M2 22l1-1M7 15l1.6 1.6a1 1 0 0 1 0 1.4l-1.6 1.6a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l1.6-1.6a1 1 0 0 1 1.4 0z"/><path d="m14 10-6 6"/></svg>`,
  database: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12"/></svg>`,
  activity: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  arrowLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  github: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
  // Child page icons
  package: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>`,
  play: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  'book-open': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  'alert-triangle': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  radio: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>`,
  'refresh-cw': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  'check-circle': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`,
  'align-justify': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg>`,
  hash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>`,
  sliders: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="6" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="4" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="8" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="12" y2="12"/><line x1="17" x2="23" y1="16" y2="16"/></svg>`,
  'bar-chart-2': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`,
  'edit-3': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  terminal: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  box: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  server: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`,
  upload: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
  target: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  'git-branch': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  repeat: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  'minimize-2': `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" x2="3" y1="14" y2="21"/><line x1="21" x2="14" y1="3" y2="10"/></svg>`,
}

const colorMap = {
  primary: 'text-primary-600 bg-primary-500/10 border-primary-500/20',
  purple: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  cyan: 'text-cyan-600 bg-cyan-500/10 border-cyan-500/20',
  amber: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  emerald: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
  rose: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
}

// State: which sidebar sections are expanded
const expandedSections = new Set()

function getIconHtml(name, size = 18) {
  const svg = icons[name]
  if (!svg) return ''
  return svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`)
}

// ============================================================
// HOME PAGE
// ============================================================

function renderHome() {
  document.title = 'lemura — Premium Agentic AI Runtime'
  document.querySelector('#app').innerHTML = `
    <div class="min-h-screen bg-surface-950 flex flex-col items-center">
      
      <!-- NAV -->
      <nav class="nav-blur h-20 px-6 lg:px-12 flex items-center justify-between w-full max-w-7xl mx-auto">
        <a href="#/" class="flex items-center gap-3">
          <div class="glass-border rounded-xl p-1.5 bg-black/5">
            <img src="/lemura-logo.png" class="w-6 h-6 rounded-lg" />
          </div>
          <span class="font-display font-black text-xl text-slate-900 tracking-tighter">lemura</span>
        </a>

        <div class="hidden md:flex items-center gap-8 text-[11px] font-black uppercase tracking-widest text-slate-400">
          <a href="#/docs/getting-started" class="hover:text-slate-900 transition-colors">Documentation</a>
          <a href="#/docs/adapters" class="hover:text-slate-900 transition-colors">Adapters</a>
          <button class="flex items-center gap-2 hover:text-slate-900 transition-colors" onclick="openSearch()">
            ${icons.search} Search
            <span class="search-kbd">⌘K</span>
          </button>
          <a href="https://github.com/rzafiamy/lemura" target="_blank" class="flex items-center gap-2 hover:text-slate-900 transition-colors">${icons.github} GitHub</a>
        </div>

        <a href="#/docs/getting-started" class="btn-primary">
          Explore Docs ${icons.chevronRight}
        </a>
      </nav>

      <!-- HERO -->
      <main class="w-full max-w-6xl px-6 py-32 flex flex-col items-center text-center">
        
        <div class="badge mb-8 animate-fade-up">
          <span class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
          Now supporting Llama 3.3 & Claude 3.5
        </div>

        <h1 class="text-gradient-primary text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.95] tracking-tighter mb-8 animate-fade-up" style="animation-delay: 100ms">
          Autonomous Agents.<br/>
          Simplified.
        </h1>

        <p class="text-slate-500 text-lg lg:text-xl leading-relaxed max-w-2xl mb-12 animate-fade-up" style="animation-delay: 200ms">
          lemura is the provider-agnostic runtime that bundles memory, tools, and RAG into a single, high-performance package for TypeScript.
        </p>

        <div class="flex flex-wrap items-center justify-center gap-4 mb-20 animate-fade-up" style="animation-delay: 300ms">
          <a href="#/docs/getting-started" class="btn-primary px-10 py-4 text-base">
            Build your first agent ${icons.chevronRight}
          </a>
          <div class="flex items-center gap-3 px-6 py-4 rounded-full bg-white/5 border border-white/10 font-mono text-sm text-white/50 group hover:border-white/20 transition-all cursor-pointer" onclick="navigator.clipboard.writeText('npm install lemura')">
            <span class="text-white/20">$</span>
            <span class="text-white/80">npm install lemura</span>
            <span class="group-hover:text-emerald-400 transition-colors">${icons.check}</span>
          </div>
        </div>

        <!-- TERMINAL PREVIEW -->
        <div class="w-full max-w-4xl animate-fade-up" style="animation-delay: 400ms">
           <div class="code-block-wrapper">
            <div class="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-black/[0.02]">
              <div class="flex gap-2">
                <div class="w-3 h-3 rounded-full bg-black/10"></div>
                <div class="w-3 h-3 rounded-full bg-black/10"></div>
                <div class="w-3 h-3 rounded-full bg-black/10"></div>
              </div>
              <span class="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">example.ts</span>
            </div>
            <div class="p-8 text-left font-mono text-[13px] leading-relaxed">
              <div><span class="text-purple-600">import</span> { <span class="text-blue-600">SessionManager</span>, <span class="text-blue-600">OpenAIAdapter</span> } <span class="text-purple-600">from</span> <span class="text-emerald-600">'lemura'</span>;</div>
              <div class="mt-4"><span class="text-purple-600">const</span> agent <span class="text-purple-600">=</span> <span class="text-purple-600">new</span> <span class="text-blue-600">SessionManager</span>({</div>
              <div class="pl-6"><span class="text-blue-500">adapter</span>: <span class="text-purple-600">new</span> <span class="text-blue-600">OpenAIAdapter</span>({ <span class="text-blue-500">apiKey</span>: <span class="text-blue-500">process</span>.env.<span class="text-blue-500">OPENAI_KEY</span> }),</div>
              <div class="pl-6"><span class="text-blue-500">tools</span>: [<span class="text-blue-500">search</span>, <span class="text-blue-500">coding_env</span>, <span class="text-blue-500">git</span>],</div>
              <div class="pl-6"><span class="text-blue-500">enableGoalPlanning</span>: <span class="text-orange-600">true</span></div>
              <div>});</div>
              <div class="mt-4"><span class="text-purple-600">await</span> agent.<span class="text-yellow-600">run</span>(<span class="text-emerald-600">"Optimize the database schema for the order system"</span>);</div>
            </div>
           </div>
        </div>

        <!-- FEATURE TILES -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-32 text-left">
           ${docs.slice(0, 6).map((doc, idx) => `
              <a href="#/docs/${doc.id}" class="feature-card animate-fade-up" style="animation-delay: ${500 + (idx * 100)}ms">
                <div class="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 border ${colorMap[doc.color]}">
                  ${icons[doc.icon]}
                </div>
                <h3 class="text-slate-900 font-bold text-lg mb-2">${doc.title}</h3>
                <p class="text-slate-500 text-sm leading-relaxed">${doc.subtitle}</p>
              </a>
           `).join('')}
        </div>

        <!-- CALL TO ACTION -->
        <div class="mt-40 p-20 rounded-[3rem] w-full glass-card flex flex-col items-center animate-fade-up">
           <h2 class="text-4xl lg:text-5xl font-black text-slate-900 tracking-tighter mb-6">Built for scale.</h2>
           <p class="text-slate-500 max-w-lg mb-10">Production-ready agent orchestration without the vendor lock-in.</p>
           <a href="#/docs/getting-started" class="btn-primary text-lg px-12 py-4 shadow-xl shadow-black/10">Get Started</a>
        </div>

      </main>

      <!-- FOOTER -->
      <footer class="w-full border-t border-white/5 py-12 px-6">
        <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div class="flex items-center gap-3 opacity-30">
            <img src="/lemura-logo.png" class="w-5 h-5 grayscale" />
            <span class="font-display font-black text-sm tracking-tighter">LEMURA</span>
          </div>
          <div class="flex gap-8 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <a href="https://github.com/rzafiamy/lemura" class="hover:text-slate-900 transition-colors">GitHub</a>
            <a href="https://www.npmjs.com/package/lemura" class="hover:text-slate-900 transition-colors">NPM</a>
            <span class="text-slate-200">MIT LICENSE</span>
          </div>
        </div>
      </footer>

    </div>
  `
}

// ============================================================
// SIDEBAR BUILDER
// ============================================================

function buildSidebar(activeDocId) {
  // Determine which parent section to auto-expand
  const activePage = allPages.find(p => p.id === activeDocId)
  const activeParentId = activePage?.id?.split('/')[0] ?? activeDocId

  // Auto-expand the section containing the active page
  if (activeParentId) expandedSections.add(activeParentId)

  return categories.map(cat => `
    <div>
      <div class="sidebar-category">${cat}</div>
      <div class="space-y-0.5">
        ${docs.filter(d => d.category === cat).map(d => {
    const isExpanded = expandedSections.has(d.id)
    const hasChildren = d.children && d.children.length > 0
    const isParentActive = activeDocId === d.id
    const isChildActive = d.children?.some(c => c.id === activeDocId)

    return `
            <div class="sidebar-section">
              <!-- Parent row -->
              <div class="sidebar-parent-row ${isParentActive ? 'active' : ''} ${isChildActive ? 'child-active' : ''}">
                <a href="#/docs/${d.id}" class="sidebar-parent-link">
                  <span class="w-4 h-4 flex items-center justify-center opacity-60">${icons[d.icon]}</span>
                  <span>${d.title}</span>
                </a>
                ${hasChildren ? `
                  <button class="sidebar-expand-btn" data-section="${d.id}" aria-label="Toggle ${d.title}">
                    <span class="expand-icon ${isExpanded ? 'expanded' : ''}">${icons.chevronDown}</span>
                  </button>
                ` : ''}
              </div>

              ${hasChildren ? `
                <div class="sidebar-children ${isExpanded ? 'expanded' : ''}" id="children-${d.id}">
                  ${d.children.map(child => `
                    <a href="#/docs/${child.id}" class="sidebar-child-link ${child.id === activeDocId ? 'active' : ''}">
                      <span class="sidebar-child-icon">${getIconHtml(child.icon, 13)}</span>
                      <span>${child.title}</span>
                    </a>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `
  }).join('')}
      </div>
    </div>
  `).join('')
}

// ============================================================
// DOCS PAGE
// ============================================================

async function renderDocs(docId) {
  const doc = allPages.find(d => d.id === docId) || docs[0]
  const parentDoc = docs.find(d => d.id === docId || d.children?.some(c => c.id === docId))

  // For navigation: use flat allPages list
  const currentIndex = allPages.indexOf(doc)
  const prevDoc = currentIndex > 0 ? allPages[currentIndex - 1] : null
  const nextDoc = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null

  // For color/icon: use parent doc's color scheme
  const colorDoc = parentDoc || doc
  const docColor = colorDoc.color || 'primary'
  const docIcon = colorDoc.icon || 'zap'

  document.title = `${doc.title} — lemura`

  document.querySelector('#app').innerHTML = `
    <div class="reading-progress" id="reading-progress" style="width:0%"></div>

    <div class="flex min-h-screen bg-surface-950">

      <!-- SIDEBAR -->
      <aside id="sidebar" class="sidebar-desktop w-[300px] fixed inset-y-0 left-0 z-40 flex flex-col">
        <div class="px-8 flex items-center h-20 border-b border-black/5">
          <a href="#/" class="flex items-center gap-3">
             <div class="glass-border rounded-lg p-1 bg-black/5">
                <img src="/lemura-logo.png" class="w-5 h-5" />
             </div>
             <span class="font-display font-black text-slate-900 tracking-tighter text-lg">lemura</span>
          </a>
        </div>

        <nav class="flex-1 overflow-y-auto p-5 space-y-6">
          ${buildSidebar(docId)}
          
          <div class="pt-6 border-t border-black/5">
            <div class="sidebar-category">Resources</div>
            <a href="https://github.com/rzafiamy/lemura" target="_blank" class="sidebar-child-link gap-2">
              ${getIconHtml('github', 14)} GitHub ${icons.externalLink}
            </a>
          </div>
        </nav>

        <div class="p-6 border-t border-black/5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Version v0.1.x</span>
            <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
          </div>
        </div>
      </aside>

      <!-- MAIN CONTENT -->
      <main class="flex-1 pl-[300px]">
        
        <!-- HEADER -->
        <header class="sticky top-0 z-30 h-20 bg-white/80 backdrop-blur-3xl border-b border-black/5 px-12 flex items-center justify-between">
           <div class="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
             <a href="#/" class="hover:text-slate-900 transition-colors">Lemura</a>
             <span class="opacity-20">/</span>
             ${parentDoc && parentDoc.id !== doc.id ? `
               <a href="#/docs/${parentDoc.id}" class="hover:text-slate-900 transition-colors">${parentDoc.title}</a>
               <span class="opacity-20">/</span>
             ` : ''}
             <span class="text-slate-900/40">${doc.title}</span>
           </div>
           
           <div class="flex items-center gap-4">
              <button class="btn-ghost flex items-center gap-2" onclick="openSearch()" title="Search (Cmd+K)">
                ${icons.search} 
                <span class="search-kbd bg-transparent shadow-none border-none opacity-60">⌘K</span>
              </button>
              <a href="https://github.com/rzafiamy/lemura" target="_blank" class="btn-ghost" title="Star on GitHub">${icons.github}</a>
           </div>
        </header>

        <div class="max-w-4xl mx-auto px-12 py-20">
          
          <!-- BREADCRUMB ICON -->
          <div class="w-10 h-10 rounded-xl flex items-center justify-center mb-8 border ${colorMap[docColor]} animate-fade-up">
            ${icons[docIcon]}
          </div>

          <article id="doc-content" class="markdown-content animate-fade-up" style="animation-delay: 100ms">
             <div class="flex items-center gap-4 py-20">
                <div class="w-4 h-4 rounded-full border-2 border-slate-200 border-t-primary-500 animate-spin"></div>
                <span class="text-xs font-black uppercase tracking-widest text-slate-400">Hydrating Documentation...</span>
             </div>
          </article>

          <!-- NAVIGATION -->
          ${(prevDoc || nextDoc) ? `
            <nav class="page-nav animate-fade-up" style="animation-delay: 200ms">
               ${prevDoc ? `
                <a href="#/docs/${prevDoc.id}" class="page-nav-card p-8">
                  <span class="page-nav-label">Previous</span>
                  <span class="page-nav-title">${prevDoc.title}</span>
                </a>
               ` : '<div />'}
               ${nextDoc ? `
                <a href="#/docs/${nextDoc.id}" class="page-nav-card p-8 items-end text-right">
                  <span class="page-nav-label">Next</span>
                  <span class="page-nav-title">${nextDoc.title}</span>
                </a>
               ` : ''}
            </nav>
          ` : ''}

        </div>

      </main>

    </div>
  `

  // Wire sidebar expand/collapse toggles
  document.querySelectorAll('.sidebar-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const sectionId = btn.dataset.section
      const childrenEl = document.getElementById(`children-${sectionId}`)
      const iconEl = btn.querySelector('.expand-icon')

      if (expandedSections.has(sectionId)) {
        expandedSections.delete(sectionId)
        childrenEl?.classList.remove('expanded')
        iconEl?.classList.remove('expanded')
      } else {
        expandedSections.add(sectionId)
        childrenEl?.classList.add('expanded')
        iconEl?.classList.add('expanded')
      }
    })
  })

  // Fetch and Parse Markdown
  try {
    const response = await fetch(`/docs/${doc.file}`)
    if (!response.ok) throw new Error('Document not found')
    const markdown = await response.text()
    const content = document.getElementById('doc-content')
    content.innerHTML = marked.parse(markdown)

    // Setup behavior
    setupCopyButtons()
    setupReadingProgress()
    window.scrollTo({ top: 0, behavior: 'instant' })

  } catch (err) {
    document.getElementById('doc-content').innerHTML = `
      <div class="py-20 text-center">
        <h2 class="text-slate-900 text-2xl font-black mb-4">Error Loading Page</h2>
        <p class="text-slate-500">${err.message}</p>
      </div>
    `
  }
}

// ============================================================
// UTILITIES
// ============================================================

function setupCopyButtons() {
  document.querySelectorAll('.copy-button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = decodeURIComponent(btn.dataset.code || '')
      try {
        await navigator.clipboard.writeText(code)
        const originalHtml = btn.innerHTML
        btn.classList.add('copied')
        btn.innerHTML = `${icons.check} Copied`
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = originalHtml
        }, 2000)
      } catch (err) {
        console.error('Failed to copy text: ', err)
      }
    })
  })
}

function setupReadingProgress() {
  const progressBar = document.getElementById('reading-progress')
  if (!progressBar) return
  const update = () => {
    const h = document.documentElement
    const b = document.body
    const st = h.scrollTop || b.scrollTop
    const sh = h.scrollHeight || b.scrollHeight
    const scrollPercent = (st / (sh - h.clientHeight)) * 100
    progressBar.style.width = scrollPercent + '%'
  }
  window.addEventListener('scroll', update)
}

function handleRoute() {
  const hash = window.location.hash
  if (hash.startsWith('#/docs/')) {
    renderDocs(hash.replace('#/docs/', ''))
  } else {
    renderHome()
  }
}

// ============================================================
// SEARCH ENGINE
// ============================================================

let searchModalInitialized = false;

function setupSearch() {
  if (searchModalInitialized) return;
  searchModalInitialized = true;

  const container = document.createElement('div');
  container.innerHTML = `
    <div id="search-backdrop" class="search-modal-backdrop" onclick="if(event.target===this) closeSearch()">
      <div class="search-modal">
        <div class="search-input-wrapper">
          ${icons.search}
          <input type="text" id="search-input" class="search-input" placeholder="Search documentation..." autocomplete="off" spellcheck="false" />
          <div class="search-shortcut-hint">
            <span class="search-kbd">ESC</span>
          </div>
        </div>
        <div id="search-results" class="search-results"></div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const input = document.getElementById('search-input');

  input.addEventListener('input', (e) => {
    executeSearch(e.target.value);
  });

  input.addEventListener('keydown', (e) => {
    const results = document.querySelectorAll('.search-result-item');
    if (!results.length) return;

    let activeIdx = Array.from(results).findIndex(r => r.getAttribute('aria-selected') === 'true');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIdx >= 0) results[activeIdx].setAttribute('aria-selected', 'false');
      activeIdx = (activeIdx + 1) % results.length;
      results[activeIdx].setAttribute('aria-selected', 'true');
      results[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIdx >= 0) results[activeIdx].setAttribute('aria-selected', 'false');
      activeIdx = (activeIdx - 1 + results.length) % results.length;
      results[activeIdx].setAttribute('aria-selected', 'true');
      results[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0) {
        results[activeIdx].click();
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') {
      closeSearch();
    }
  });

  window.openSearch = function () {
    const backdrop = document.getElementById('search-backdrop');
    backdrop.classList.add('open');
    const input = document.getElementById('search-input');
    input.value = '';
    executeSearch('');
    setTimeout(() => input.focus(), 50);
  };

  window.closeSearch = function () {
    document.getElementById('search-backdrop').classList.remove('open');
  };
}

function executeSearch(query) {
  const container = document.getElementById('search-results');
  const q = query.toLowerCase().trim();

  // Create a mapping of docId to parent doc to easily get coloring and categories
  const getParentDoc = (pageId) => docs.find(d => d.id === pageId || d.children?.some(c => c.id === pageId));

  if (!q) {
    container.innerHTML = '<div class="search-empty">Type to start searching "' + allPages.length + '" documents...</div>';
    // Show some default results when empty - maybe top categories
    return;
  }

  const results = allPages.map(page => {
    let score = 0;
    const parentDoc = getParentDoc(page.id);
    const category = page.category || parentDoc?.category || 'Doc';
    const sub = page.subtitle || parentDoc?.subtitle || '';

    // Fuzzy matching points
    const titleMatch = page.title.toLowerCase().includes(q);
    const subMatch = sub.toLowerCase().includes(q);
    const catMatch = category.toLowerCase().includes(q);

    if (titleMatch) score += 10;
    if (subMatch) score += 5;
    if (catMatch) score += 1;

    // Boost exact starts
    if (page.title.toLowerCase().startsWith(q)) score += 5;

    return { page, parentDoc, category, sub, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    container.innerHTML = '<div class="search-empty">No results found for "' + query + '"</div>';
    return;
  }

  container.innerHTML = results.slice(0, 10).map((r, i) => {
    const { page, parentDoc, category, sub } = r;
    const isSelected = i === 0 ? 'true' : 'false';
    const docColor = parentDoc?.color || 'primary';
    const cColor = colorMap[docColor];
    const docIcon = page.icon || parentDoc?.icon || 'zap';
    const iIcon = getIconHtml(docIcon, 16);

    return `
      <a href="#/docs/${page.id}" class="search-result-item" aria-selected="${isSelected}" onclick="closeSearch()">
        <div class="search-result-icon border ${cColor}">${iIcon}</div>
        <div class="search-result-content">
          <div class="search-result-title">
            ${page.title}
            <span class="search-result-badge">${category}</span>
          </div>
          <div class="search-result-subtitle">${sub}</div>
        </div>
      </a>
    `;
  }).join('');
}

// Init search
setupSearch();

window.addEventListener('hashchange', handleRoute)
handleRoute()
