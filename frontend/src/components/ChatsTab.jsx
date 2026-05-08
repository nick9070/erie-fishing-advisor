import { useState, useRef } from 'react'

function formatHour(h) {
  if (h === 0)  return '12am'
  if (h < 12)  return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

function getScoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#84cc16'
  if (score >= 50) return '#eab308'
  if (score >= 35) return '#f97316'
  return '#ef4444'
}

function formatThreadDate(thread) {
  const d     = new Date(thread.created_at)
  const today = new Date(); today.setHours(0,0,0,0)
  const diff  = Math.round((d - today) / 86400000)
  const dateStr = diff === 0  ? 'Today'
    : diff === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timeStr = thread.hour != null ? formatHour(thread.hour) : 'Live'
  return `${dateStr} · ${timeStr}`
}

function ThreadRow({ thread, onOpen, onDelete }) {
  const [offset,     setOffset]     = useState(0)
  const [swiped,     setSwiped]     = useState(false)
  const startX      = useRef(null)
  const color       = getScoreColor(thread.score)
  const lastMsg     = thread.messages.length > 0
    ? thread.messages[thread.messages.length - 1] : null
  const preview     = lastMsg
    ? (lastMsg.role === 'user' ? 'You: ' : '') + lastMsg.content.slice(0, 65) + (lastMsg.content.length > 65 ? '…' : '')
    : 'No messages yet — tap to open'

  const handleTouchStart = e => { startX.current = e.touches[0].clientX }
  const handleTouchMove  = e => {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) setOffset(Math.max(dx, -80))
  }
  const handleTouchEnd = () => {
    startX.current = null
    if (offset < -40) { setOffset(-80); setSwiped(true) }
    else              { setOffset(0);   setSwiped(false) }
  }
  const handleClick = () => {
    if (swiped) { setOffset(0); setSwiped(false) }
    else onOpen(thread)
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #142030' }}>
      {/* Delete button revealed by swipe */}
      <div
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 1 }}
        onClick={() => onDelete(thread.id)}
      >
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>Delete</span>
      </div>

      {/* Main row */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: startX.current === null ? 'transform 0.2s ease' : 'none',
          background: '#0d1f2d', cursor: 'pointer',
          padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 12,
          position: 'relative', zIndex: 2,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        {/* Score */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 34, flexShrink: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{thread.score}</span>
          <span style={{ fontSize: 8, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 1 }}>
            {thread.rating?.slice(0, 4)}
          </span>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {thread.spot_name}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {formatThreadDate(thread)}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview}
          </div>
        </div>

        {/* Right side: message count + desktop delete */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {thread.messages.length > 0 && (
            <div style={{ background: '#1e3a4a', color: '#38bdf8', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
              {thread.messages.length}
            </div>
          )}
          <button
            className="thread-delete-desktop"
            onClick={e => { e.stopPropagation(); onDelete(thread.id) }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatsTab({ chats, onOpenChat, onDeleteChat }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: '#0d1f2d' }}>
      <div style={{ padding: '10px 16px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #1e3a4a', position: 'sticky', top: 0, background: '#0d1f2d', zIndex: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Chat History</span>
        <span style={{ fontWeight: 400, color: '#475569' }}>{chats.length} thread{chats.length !== 1 ? 's' : ''}</span>
      </div>

      {chats.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, gap: 12, textAlign: 'center' }}>
          <span style={{ fontSize: 36 }}>💬</span>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No chats yet</div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, maxWidth: 260 }}>
            Expand a spot and tap "Chat with AI Guide" to start a conversation about current conditions.
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: '#475569', padding: '5px 16px', borderBottom: '1px solid #142030' }}>
            Swipe left to delete
          </div>
          {chats.map(thread => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              onOpen={onOpenChat}
              onDelete={onDeleteChat}
            />
          ))}
        </>
      )}

      <style>{`
        .thread-delete-desktop {
          display: none;
          background: none;
          border: 1px solid #374151;
          color: #64748b;
          border-radius: 5px;
          padding: 2px 6px;
          cursor: pointer;
          font-size: 10px;
        }
        @media (hover: hover) {
          .thread-delete-desktop { display: block; }
          .thread-delete-desktop:hover { border-color: #dc2626; color: #dc2626; }
        }
      `}</style>
    </div>
  )
}
