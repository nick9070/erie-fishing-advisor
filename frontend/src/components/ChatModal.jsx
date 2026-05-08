import { useState, useEffect, useRef } from 'react'

function formatDateTime(date, hour) {
  if (!date) return 'Live conditions'
  const d      = new Date(date + 'T00:00:00')
  const today  = new Date(); today.setHours(0,0,0,0)
  const diff   = Math.round((d - today) / 86400000)
  const dayStr = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow'
    : diff === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  if (hour == null) return `${dayStr} — Live`
  const h = parseInt(hour)
  const timeStr = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`
  return `${dayStr} · ${timeStr}`
}

function getScoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#84cc16'
  if (score >= 50) return '#eab308'
  if (score >= 35) return '#f97316'
  return '#ef4444'
}

export default function ChatModal({ thread, onUpdate, onClose }) {
  const [minimized, setMinimized] = useState(false)
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const messages   = thread.messages ?? []
  const scoreColor = getScoreColor(thread.score)

  // Reset minimized when a new thread is loaded
  useEffect(() => { setMinimized(false) }, [thread.id])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Focus input when expanded
  useEffect(() => {
    if (!minimized) inputRef.current?.focus()
  }, [minimized, thread.id])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const newMessages = [...messages, { role: 'user', content: text }]
    const updated = { ...thread, messages: newMessages, last_message_at: new Date().toISOString() }
    onUpdate(updated)
    setLoading(true)

    try {
      const res = await fetch(`${thread.apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, context: thread }),
      })
      const data = await res.json()
      const withReply = {
        ...updated,
        messages: [...newMessages, { role: 'assistant', content: data.reply }],
        last_message_at: new Date().toISOString(),
      }
      onUpdate(withReply)
    } catch {
      const withErr = {
        ...updated,
        messages: [...newMessages, { role: 'assistant', content: 'Sorry, something went wrong. Try again.' }],
      }
      onUpdate(withErr)
    } finally {
      setLoading(false)
    }
  }

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // ── Minimized bar ──────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div style={S.minimizedBar} onClick={() => setMinimized(false)}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>💬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.minimizedSpot}>{thread.spot_name}</div>
          {messages.length > 0 && (
            <div style={S.minimizedCount}>{messages.length} message{messages.length !== 1 ? 's' : ''}</div>
          )}
        </div>
        <span style={{ fontSize: 12, color: '#38bdf8', flexShrink: 0 }}>▲</span>
        <button style={S.minimizedClose} onClick={e => { e.stopPropagation(); onClose() }}>✕</button>
      </div>
    )
  }

  // ── Full modal ─────────────────────────────────────────────────────────────
  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setMinimized(true) }}>
      <div style={S.modal}>

        {/* Header */}
        <div style={S.header}>
          <div style={S.headerTop}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.spotName}>{thread.spot_name}</div>
              <div style={S.dateTime}>{formatDateTime(thread.date, thread.hour)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ ...S.scoreBadge, color: scoreColor, borderColor: scoreColor }}>
                <span style={S.scoreNum}>{thread.score}</span>
                <span style={S.scoreRating}>{thread.rating}</span>
              </div>
              <button style={S.headerBtn} onClick={() => setMinimized(true)} title="Minimise">─</button>
              <button style={S.headerBtn} onClick={onClose} title="Close">✕</button>
            </div>
          </div>

          {/* Guide brief recap */}
          {thread.sections?.length > 0 && (
            <div style={S.recap}>
              <div style={S.recapLabel}>📋 Guide brief</div>
              {thread.sections.map((sec, i) => (
                <div key={i} style={{ marginBottom: i < thread.sections.length - 1 ? 8 : 0 }}>
                  <div style={S.recapTitle}>{sec.title}</div>
                  <div style={S.recapBody}>{sec.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={S.messages}>
          {messages.length === 0 && (
            <div style={S.emptyState}>
              <div style={{ fontSize: 32 }}>🎣</div>
              <div style={S.emptyText}>
                Ask me anything about fishing {thread.spot_name} — I've already analyzed the conditions, depth targets, and presentation. What do you want to dig into?
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <div style={msg.role === 'user' ? S.userBubble : S.aiBubble}>
                {msg.role === 'assistant' && <div style={S.aiTag}>🤖 Guide</div>}
                <div style={S.bubbleText}>{msg.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
              <div style={S.aiBubble}>
                <div style={S.aiTag}>🤖 Guide</div>
                <div style={{ ...S.bubbleText, color: '#64748b' }}>⟳ Thinking...</div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={S.inputRow}>
          <textarea
            ref={inputRef}
            style={S.input}
            placeholder="Ask a follow-up question..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            disabled={loading}
          />
          <button
            style={{ ...S.sendBtn, opacity: (!input.trim() || loading) ? 0.4 : 1 }}
            onClick={send}
            disabled={!input.trim() || loading}
          >↑</button>
        </div>

      </div>
    </div>
  )
}

const S = {
  minimizedBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9000,
    background: '#0a1f2e', borderTop: '2px solid #38bdf8',
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
    cursor: 'pointer',
  },
  minimizedSpot:  { fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  minimizedCount: { fontSize: 10, color: '#64748b', marginTop: 1 },
  minimizedClose: { background: 'none', border: '1px solid #1e3a4a', color: '#64748b', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, flexShrink: 0 },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9000,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  modal: {
    width: '100%', maxWidth: 560, height: '85vh',
    background: '#0d1f2d', borderRadius: '16px 16px 0 0',
    border: '1px solid #1e3a4a',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    background: '#0a1f2e', borderBottom: '1px solid #1e3a4a',
    flexShrink: 0, maxHeight: '45%', overflowY: 'auto',
  },
  headerTop: {
    display: 'flex', alignItems: 'flex-start',
    padding: '16px 16px 12px', gap: 12,
  },
  spotName: { fontSize: 16, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.2 },
  dateTime: { fontSize: 11, color: '#64748b', marginTop: 3 },
  scoreBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    border: '1px solid', borderRadius: 8, padding: '4px 10px',
  },
  scoreNum:    { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  scoreRating: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 1 },
  headerBtn: {
    background: 'none', border: '1px solid #1e3a4a', color: '#64748b',
    borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12,
  },
  recap:      { padding: '0 16px 14px', borderTop: '1px solid #142030', marginTop: 2 },
  recapLabel: { fontSize: 10, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 0 8px' },
  recapTitle: { fontSize: 10, fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 },
  recapBody:  { fontSize: 11, color: '#94a3b8', lineHeight: 1.5 },
  messages:   { flex: 1, overflowY: 'auto', padding: '14px 14px 0' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '30px 20px', textAlign: 'center' },
  emptyText:  { fontSize: 13, color: '#64748b', lineHeight: 1.6, maxWidth: 320 },
  userBubble: { background: '#1e3a4a', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', maxWidth: '80%' },
  aiBubble:   { background: '#071520', border: '1px solid #1e3a4a', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', maxWidth: '85%' },
  aiTag:      { fontSize: 9, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 },
  bubbleText: { fontSize: 13, color: '#e2e8f0', lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  inputRow: {
    display: 'flex', gap: 8, padding: '12px 14px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
    borderTop: '1px solid #1e3a4a', background: '#0a1f2e', flexShrink: 0,
  },
  input: {
    flex: 1, background: '#0d1f2d', border: '1px solid #1e3a4a',
    borderRadius: 10, color: '#e2e8f0', fontSize: 13, padding: '10px 12px',
    resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4,
  },
  sendBtn: {
    background: '#38bdf8', border: 'none', borderRadius: 10,
    color: '#0a1628', fontWeight: 800, fontSize: 16,
    width: 40, cursor: 'pointer', flexShrink: 0,
  },
}
