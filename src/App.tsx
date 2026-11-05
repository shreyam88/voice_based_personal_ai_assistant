import { AnimatePresence, motion } from 'framer-motion'
import { AudioLines, Check, ChevronDown, CircleStop, Command, Headphones, History, LogIn, Menu, Mic, Moon, Plus, Send, Settings2, Sparkles, Sun, Volume2, VolumeX, WandSparkles, X } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import './App.css'
import './voxai.css'

type Role = 'user' | 'assistant'
type Language = 'en' | 'hi'
type Persona = 'assistant' | 'teacher' | 'coach'
type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
type Message = { role: Role; content: string }
type Chat = { id: string; title: string; updatedAt: string; messages: Message[] }
type Recognition = EventTarget & {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

const personas: Record<Persona, string> = { assistant: 'Assistant', teacher: 'Teacher', coach: 'Interview coach' }

async function api<T>(path: string, token?: string | null, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.')
  return data as T
}

function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [persona, setPersona] = useState<Persona>('assistant')
  const [mode, setMode] = useState<Mode>('idle')
  const [dark, setDark] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [apiOnline, setApiOnline] = useState(false)
  const [mongoOnline, setMongoOnline] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [chatId, setChatId] = useState<string | null>(null)
  const [history, setHistory] = useState<Chat[]>(() => {
    try { return JSON.parse(localStorage.getItem('voxai_chats') || '[]') as Chat[] }
    catch { localStorage.removeItem('voxai_chats'); return [] }
  })
  const [token, setToken] = useState(() => localStorage.getItem('voxai_token'))
  const [userName, setUserName] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<'persona' | 'language' | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const recognitionRef = useRef<Recognition | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const updateHealth = useEffectEvent((health: { ollama: boolean; mongodb: boolean }) => {
    setApiOnline(health.ollama)
    setMongoOnline(health.mongodb)
  })
  useEffect(() => {
    api<{ ollama: boolean; mongodb: boolean }>('/health')
      .then(updateHealth)
      .catch(() => updateHealth({ ollama: false, mongodb: false }))
  }, [])
  useEffect(() => {
    if (!token) return
    api<{ name: string }>('/auth/me', token).then(async (user) => {
      setUserName(user.name)
      const saved = await api<Chat[]>('/conversations', token)
      setHistory((local) => {
        const merged = [...saved, ...local.filter((chat) => !saved.some((item) => item.id === chat.id))]
        localStorage.setItem('voxai_chats', JSON.stringify(merged))
        return merged
      })
    }).catch(() => { localStorage.removeItem('voxai_token'); setToken(null) })
  }, [token])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, mode])
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMessages([]); setChatId(null); setMode('idle'); setNotice('')
        window.speechSynthesis?.cancel(); recognitionRef.current?.stop()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])
  useEffect(() => () => { recognitionRef.current?.stop(); window.speechSynthesis?.cancel() }, [])

  function saveChat(next: Message[], id: string, updatedAt: string) {
    if (!next.length) return
    const first = next.find((message) => message.role === 'user')?.content || 'New conversation'
    const chat: Chat = { id, title: first.length > 42 ? `${first.slice(0, 42)}…` : first, updatedAt, messages: next }
    setHistory((current) => {
      const updated = [chat, ...current.filter((item) => item.id !== id)].slice(0, 30)
      localStorage.setItem('voxai_chats', JSON.stringify(updated))
      return updated
    })
  }

  async function sendMessage(value = text) {
    const content = value.trim()
    if (!content || mode === 'thinking') return
    window.speechSynthesis?.cancel()
    setMode('thinking'); setNotice(''); setText('')
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    try {
      const result = await api<{ reply: string; conversationId: string; updatedAt: string }>('/chat', token, {
        method: 'POST', body: JSON.stringify({ messages: next, conversationId: chatId, language, persona }),
      })
      const completed = [...next, { role: 'assistant' as const, content: result.reply }]
      setMessages(completed); setChatId(result.conversationId); saveChat(completed, result.conversationId, result.updatedAt); setMode('idle')
      if (soundOn) speak(result.reply)
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: `I couldn’t reach the local AI service. ${error instanceof Error ? error.message : 'Check that VoxAI and Ollama are running.'}` }])
      setMode('idle'); setNotice('Local AI is unavailable')
    }
  }

  function speak(content: string) {
    if (!('speechSynthesis' in window)) { setNotice('Speech output is not available in this browser'); return }
    const utterance = new SpeechSynthesisUtterance(content)
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-US'
    utterance.onstart = () => setMode('speaking')
    utterance.onend = () => setMode('idle')
    utterance.onerror = () => setMode('idle')
    window.speechSynthesis.speak(utterance)
  }

  function stopSpeaking() { window.speechSynthesis?.cancel(); setMode('idle') }
  function newChat() { stopSpeaking(); recognitionRef.current?.stop(); setMessages([]); setChatId(null); setMode('idle'); setNotice(''); inputRef.current?.focus() }

  function listen() {
    if (mode === 'listening') { recognitionRef.current?.stop(); setMode('idle'); return }
    const speechWindow = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Speech = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Speech) { setNotice('Voice input needs Chrome or Edge. You can type your message instead.'); return }
    const recognition = new Speech()
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-US'
    recognition.continuous = false; recognition.interimResults = false
    recognition.onresult = (event) => {
      const phrase = event.results[0]?.[0]?.transcript?.trim()
      if (!phrase) return
      const command = phrase.toLowerCase()
      if (command.includes('new chat') || command.includes('nayi chat') || command.includes('नई चैट')) newChat()
      else if (command.includes('dark mode')) setDark(true)
      else if (command.includes('light mode')) setDark(false)
      else if (command.includes('stop speaking') || command.includes('रुको')) stopSpeaking()
      else void sendMessage(phrase)
    }
    recognition.onerror = () => { setMode('idle'); setNotice('Microphone input ended. Try again when ready.') }
    recognition.onend = () => setMode((current) => current === 'listening' ? 'idle' : current)
    recognitionRef.current = recognition
    try { recognition.start(); setMode('listening'); setNotice('') }
    catch { setMode('idle'); setNotice('Could not start voice input. Check microphone permissions.') }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError('')
    try {
      const result = await api<{ token: string; user: { name: string } }>(`/auth/${registering ? 'register' : 'login'}`, null, {
        method: 'POST', body: JSON.stringify({ name, email, password }),
      })
      localStorage.setItem('voxai_token', result.token); setToken(result.token); setUserName(result.user.name); setPassword(''); setAuthOpen(false)
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Sign in failed.') }
  }

  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() }
  }

  const status = mode === 'listening' ? 'Listening' : mode === 'thinking' ? 'Thinking' : mode === 'speaking' ? 'Speaking' : 'Ready when you are'

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileHistoryOpen ? ' sidebar-open' : ''}`}>
        <div className="brand-row"><div className="brand-mark"><AudioLines size={18} /></div><span className="brand-name">vox<span>ai</span></span><button className="icon-button mobile-close" aria-label="Close history" onClick={() => setMobileHistoryOpen(false)}><X size={18} /></button></div>
        <button className="new-chat-button" onClick={newChat}><Plus size={17} /> New conversation <span>Ctrl K</span></button>
        <div className="sidebar-label"><span>YOUR SPACE</span><History size={15} /></div>
        <div className="history-list">{history.length ? history.slice(0, 12).map((chat) => <div className={`history-item${chat.id === chatId ? ' history-active' : ''}`} key={chat.id}><button onClick={() => { setMessages(chat.messages); setChatId(chat.id); stopSpeaking(); setMobileHistoryOpen(false) }} title={chat.title}><span className="history-dot" />{chat.title}</button><button className="history-delete" aria-label={`Delete ${chat.title}`} onClick={() => { const updated = history.filter((item) => item.id !== chat.id); setHistory(updated); localStorage.setItem('voxai_chats', JSON.stringify(updated)); if (chat.id === chatId) newChat(); if (token) void api(`/conversations/${chat.id}`, token, { method: 'DELETE' }).catch(() => {}) }}><X size={13} /></button></div>) : <p className="history-empty">Your conversations will appear here.</p>}</div>
        <div className="sidebar-bottom"><div className="connection-card"><div className="connection-title"><span className={`connection-indicator${apiOnline ? ' online' : ''}`} /> Local AI <span>{apiOnline ? 'Connected' : 'Offline'}</span></div><p>{mongoOnline ? 'History syncs to MongoDB' : 'Chats stay on this device'}</p></div><div className="profile-row"><div className="avatar">{userName?.slice(0, 1).toUpperCase() || 'V'}</div><div className="profile-info"><strong>{userName || 'Guest session'}</strong><span>{userName ? 'Personal workspace' : 'Stored on this device'}</span></div>{userName ? <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => { localStorage.removeItem('voxai_token'); localStorage.removeItem('voxai_chats'); setToken(null); setUserName(null); setHistory([]); setMessages([]); setChatId(null) }}><LogIn size={16} /></button> : <button className="icon-button" title="Sign in" aria-label="Sign in" onClick={() => setAuthOpen(true)}><LogIn size={16} /></button>}</div></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open conversation history" onClick={() => setMobileHistoryOpen(true)}><Menu size={19} /></button><div className="topbar-left"><span className="workspace-label">PERSONAL WORKSPACE</span><span className="topbar-divider">/</span><span className="topbar-current">Voice assistant</span></div><div className="topbar-actions">
          <div className="select-wrap"><button className="top-select" onClick={() => setMenu(menu === 'persona' ? null : 'persona')}><WandSparkles size={15} /><span>{personas[persona]}</span><ChevronDown size={14} /></button>{menu === 'persona' && <div className="select-menu">{(['assistant', 'teacher', 'coach'] as Persona[]).map((item) => <button key={item} onClick={() => { setPersona(item); setMenu(null) }}>{personas[item]}{persona === item && <Check size={14} />}</button>)}</div>}</div>
          <div className="select-wrap"><button className="top-select language-select" onClick={() => setMenu(menu === 'language' ? null : 'language')}><span className="language-code">{language.toUpperCase()}</span><span>{language === 'en' ? 'English' : 'Hindi'}</span><ChevronDown size={14} /></button>{menu === 'language' && <div className="select-menu">{(['en', 'hi'] as Language[]).map((item) => <button key={item} onClick={() => { setLanguage(item); setMenu(null) }}>{item === 'en' ? 'English' : 'Hindi'}{language === item && <Check size={14} />}</button>)}</div>}</div>
          <span className="topbar-divider-line" /><button className="icon-button theme-toggle" aria-label={dark ? 'Light mode' : 'Dark mode'} title={dark ? 'Light mode' : 'Dark mode'} onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>{!userName && <button className="signin-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </div></header>

        <section className="conversation-view" ref={scrollRef}>
          {messages.length === 0 ? <motion.div className="welcome-view" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="welcome-orbit"><div className="orbit-ring orbit-ring-one" /><div className="orbit-ring orbit-ring-two" /><div className={`voice-core${mode === 'listening' ? ' core-listening' : ''}`}><AudioLines size={30} /></div><i className="orbit-spark spark-one" /><i className="orbit-spark spark-two" /><i className="orbit-spark spark-three" /></div>
            <div className="welcome-copy"><span className="eyebrow"><Sparkles size={13} /> YOUR LOCAL AI COMPANION</span><h1>A little more <em>human</em><br />in every conversation.</h1><p>Think out loud, ask the small questions, or untangle the big ones.<br className="desktop-break" /> Vox is here, in English or Hindi.</p></div>
            <div className="suggestion-grid"><button className="suggestion-card" onClick={() => void sendMessage('Help me plan my day with focus and breaks.')}><span className="suggestion-icon mint"><Command size={17} /></span><span><strong>Find my focus</strong><small>Help me plan a better day</small></span><ChevronDown size={15} /></button><button className="suggestion-card" onClick={() => void sendMessage('Teach me one useful idea in a simple way.')}><span className="suggestion-icon coral"><Sparkles size={17} /></span><span><strong>Learn something</strong><small>Make a tricky idea simple</small></span><ChevronDown size={15} /></button><button className="suggestion-card" onClick={() => { setPersona('coach'); void sendMessage('Help me prepare for an interview.') }}><span className="suggestion-icon yellow"><Headphones size={17} /></span><span><strong>Practice together</strong><small>Get ready for an interview</small></span><ChevronDown size={15} /></button><button className="suggestion-card" onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}><span className="suggestion-icon blue"><span className="devanagari">अ</span></span><span><strong>Switch languages</strong><small>English ↔ Hindi, any time</small></span><ChevronDown size={15} /></button></div>
            <div className="local-note"><span className="local-note-dot" /> LOCAL AI INFERENCE <span className="note-separator">·</span> Voice processing depends on your browser</div>
          </motion.div> : <motion.div className="message-thread" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div className="thread-date"><span /> TODAY <span /></div>{messages.map((message, index) => <motion.article className={`message-row message-${message.role}`} key={`${chatId}-${index}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><div className={message.role === 'assistant' ? 'message-avatar' : 'user-message-mark'}>{message.role === 'assistant' ? <AudioLines size={15} /> : userName?.slice(0, 1).toUpperCase() || 'Y'}</div><div className="message-content"><span className="message-author">{message.role === 'user' ? 'You' : 'Vox'} <time>{message.role === 'assistant' ? 'VoxAI · local' : 'Just now'}</time></span><p>{message.content}</p>{message.role === 'assistant' && <div className="message-tools"><button onClick={() => speak(message.content)}><Volume2 size={14} /> Listen</button><button onClick={() => void navigator.clipboard?.writeText(message.content)}><Check size={14} /> Copy</button></div>}</div></motion.article>)}{mode === 'thinking' && <div className="thinking-row"><div className="message-avatar"><AudioLines size={15} /></div><div><span className="thinking-dots"><i /><i /><i /></span><span className="thinking-label">Vox is thinking</span></div></div>}</motion.div>}
        </section>

        <footer className="composer-area">{notice && <motion.div className="notice-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} /></button></motion.div>}<div className={`composer${mode === 'listening' ? ' composer-listening' : ''}`}><textarea ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={composerKey} placeholder={language === 'hi' ? 'कुछ भी पूछें, हिंदी या अंग्रेज़ी में...' : 'Ask Vox anything, or think out loud...'} rows={1} aria-label="Message Vox" /><div className="composer-controls"><div className="composer-hints"><button className="hint-button" onClick={() => setMenu(menu === 'persona' ? null : 'persona')}><Settings2 size={15} /><span>{personas[persona]}</span></button><span className="hint-separator" /><span className="keyboard-hint">↵ send</span></div><div className="composer-actions">{mode === 'speaking' && <button className="stop-speech-button" onClick={stopSpeaking} aria-label="Interrupt speech" title="Stop speaking"><CircleStop size={17} /></button>}<button className={`mic-button${mode === 'listening' ? ' mic-active' : ''}`} onClick={listen} aria-label={mode === 'listening' ? 'Stop listening' : 'Speak to Vox'} title={mode === 'listening' ? 'Stop listening' : 'Speak to Vox'}><span className="mic-button-pulse" /><Mic size={17} /></button><button className="send-button" disabled={!text.trim() || mode === 'thinking'} onClick={() => void sendMessage()} aria-label="Send message" title="Send"><Send size={16} /></button></div></div></div><div className="composer-footer"><span><span className={`status-dot ${mode}`} /> {status}</span><span>{apiOnline ? 'Powered by Ollama · llama3.2' : 'Start local server to connect Ollama'} <span className="note-separator">·</span><button className="sound-toggle" onClick={() => { if (soundOn) stopSpeaking(); setSoundOn(!soundOn) }}>{soundOn ? <><Volume2 size={12} /> Voice on</> : <><VolumeX size={12} /> Voice off</>}</button></span></div></footer>
      </main>

      <AnimatePresence>{mobileHistoryOpen && <motion.button className="mobile-scrim" aria-label="Close conversation history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileHistoryOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{authOpen && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false) }}><motion.div className="auth-modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><button className="icon-button auth-close" aria-label="Close" onClick={() => setAuthOpen(false)}><X size={18} /></button><div className="auth-mark"><AudioLines size={20} /></div><span className="eyebrow">YOUR PRIVATE WORKSPACE</span><h2>{registering ? 'Create your account' : 'Welcome back'}</h2><p>{mongoOnline ? 'Sign in to sync your conversations.' : 'Account storage needs MongoDB. Local chat still works without sign-in.'}</p><form onSubmit={(event) => void submitAuth(event)}>{registering && <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} placeholder="What should Vox call you?" /></label>}<label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete={registering ? 'new-password' : 'current-password'} /></label>{authError && <p className="auth-error">{authError}</p>}<button className="auth-submit" disabled={!mongoOnline}>{registering ? 'Create account' : 'Sign in'}<Send size={15} /></button></form><div className="auth-switch">{registering ? 'Already have an account?' : 'New to VoxAI?'} <button onClick={() => { setRegistering(!registering); setAuthError('') }}>{registering ? 'Sign in' : 'Create an account'}</button></div>{!mongoOnline && <div className="auth-local-note"><span className="connection-indicator" /> Configure MONGODB_URI to enable accounts.</div>}</motion.div></motion.div>}</AnimatePresence>
    </div>
  )
}

export default App
