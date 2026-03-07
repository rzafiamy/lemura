import './style.css'
import { marked } from 'marked'
import hljs from 'highlight.js'

// ============================================================
// CONFIGURATION
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
  },
  {
    id: 'adapters',
    title: 'Provider Adapters',
    subtitle: 'Connect to OpenAI, Anthropic, Groq, or any custom provider',
    file: 'adapters.md',
    icon: 'cpu',
    color: 'purple',
    category: 'Fundamentals',
  },
  {
    id: 'context-management',
    title: 'Context Management',
    subtitle: 'Intelligent memory management and compression strategies',
    file: 'context-management.md',
    icon: 'layers',
    color: 'cyan',
    category: 'Fundamentals',
  },
  {
    id: 'tools-and-skills',
    title: 'Tools & Skills',
    subtitle: 'Give your agent superpowers and a distinct personality',
    file: 'tools-and-skills.md',
    icon: 'tool',
    color: 'amber',
    category: 'Fundamentals',
  },
  {
    id: 'rag-integration',
    title: 'RAG Integration',
    subtitle: 'Seamlessly query and ingest your private knowledge base',
    file: 'rag-integration.md',
    icon: 'database',
    color: 'emerald',
    category: 'Fundamentals',
  },
  {
    id: 'advanced-execution',
    title: 'Advanced Runtime',
    subtitle: 'Goal planning, continuation, and execution discipline',
    file: 'advanced-execution.md',
    icon: 'activity',
    color: 'rose',
    category: 'Advanced',
  },
]

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

  // Build header
  header += '<thead><tr>'
  token.header.forEach(cell => {
    header += `<th>${this.parser.parseInline(cell.tokens)}</th>`
  })
  header += '</tr></thead>'

  // Build body
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
  arrowLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  github: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
}

const colorMap = {
  primary: 'text-primary-600 bg-primary-500/10 border-primary-500/20',
  purple: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  cyan: 'text-cyan-600 bg-cyan-500/10 border-cyan-500/20',
  amber: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  emerald: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
  rose: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
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
          <a href="https://github.com/lemura-ai/lemura" target="_blank" class="flex items-center gap-2 hover:text-slate-900 transition-colors">${icons.github} GitHub</a>
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
            <a href="https://github.com/lemura-ai/lemura" class="hover:text-slate-900 transition-colors">GitHub</a>
            <a href="https://www.npmjs.com/package/lemura" class="hover:text-slate-900 transition-colors">NPM</a>
            <span class="text-slate-200">MIT LICENSE</span>
          </div>
        </div>
      </footer>

    </div>
  `
}

// ============================================================
// DOCS PAGE
// ============================================================

async function renderDocs(docId) {
  const doc = docs.find(d => d.id === docId) || docs[0]
  const docIndex = docs.indexOf(doc)
  const prevDoc = docIndex > 0 ? docs[docIndex - 1] : null
  const nextDoc = docIndex < docs.length - 1 ? docs[docIndex + 1] : null

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

        <nav class="flex-1 overflow-y-auto p-6 space-y-8">
          ${categories.map(cat => `
            <div>
              <div class="sidebar-category">${cat}</div>
              <div class="space-y-1">
                ${docs.filter(d => d.category === cat).map(d => `
                  <a href="#/docs/${d.id}" class="sidebar-link ${d.id === docId ? 'active' : ''}">
                    <span class="w-4 h-4 flex items-center justify-center opacity-50">${icons[d.icon]}</span>
                    ${d.title}
                  </a>
                `).join('')}
              </div>
            </div>
          `).join('')}
          
          <div class="pt-8 border-t border-black/5">
            <div class="sidebar-category">Resources</div>
            <a href="https://github.com/lemura-ai/lemura" target="_blank" class="sidebar-link">
              ${icons.github} GitHub ${icons.externalLink}
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
             <span class="text-slate-900/40">${doc.title}</span>
           </div>
           
           <div class="flex items-center gap-4">
              <a href="https://github.com/lemura-ai/lemura" target="_blank" class="btn-ghost" title="Star on GitHub">${icons.github}</a>
           </div>
        </header>

        <div class="max-w-4xl mx-auto px-12 py-20">
          
          <!-- BREADCRUMB ICON -->
          <div class="w-10 h-10 rounded-xl flex items-center justify-center mb-8 border ${colorMap[doc.color]} animate-fade-up">
            ${icons[doc.icon]}
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
                  <span class="page-nav-label">Previous Step</span>
                  <span class="page-nav-title">${prevDoc.title}</span>
                </a>
               ` : '<div />'}
               ${nextDoc ? `
                <a href="#/docs/${nextDoc.id}" class="page-nav-card p-8 items-end text-right">
                  <span class="page-nav-label">Continue To</span>
                  <span class="page-nav-title">${nextDoc.title}</span>
                </a>
               ` : ''}
            </nav>
          ` : ''}

        </div>

      </main>

    </div>
  `

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

window.addEventListener('hashchange', handleRoute)
handleRoute()
