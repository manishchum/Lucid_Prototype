// "use client"

// import React, { useState, useRef } from 'react'

// type Message = { from: 'user' | 'bot'; text: string }

// export default function AssistantTabs({ userId, onBack }: { userId?: string | null, onBack?: () => void }) {
//   const [tab, setTab] = useState<'summarize'|'doubt'|'practice'|'explain'|'flashcards'>('summarize')
//   const [input, setInput] = useState('')
//   const [feedback, setFeedback] = useState<string | null>(null)
//   const [loading, setLoading] = useState(false)
//   const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
//   // messages only used for 'doubt' chat view to preserve previous behavior
//   const [messages, setMessages] = useState<Array<{ from: 'user'|'bot'; text: string }>>([])
//   const [doubtSessionStarted, setDoubtSessionStarted] = useState(false)

//   const send = async () => {
//     if (!input.trim()) return
//     const q = input.trim()
//     setInput('')
//     setLoading(true)
//     setFeedback(null)
//     try {
//       if (tab === 'doubt') {
//         // Ensure session row exists (mimic previous behavior when user selected Ask Doubt)
//         if (!doubtSessionStarted && userId) {
//           try {
//             await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'doubt', action: 'start', user_id: userId }) })
//             setDoubtSessionStarted(true)
//           } catch (e) {
//             // ignore start failures
//           }
//         }
//         // send to legacy assistant route for doubt so it uses the same storage and behavior
//         const res = await fetch('/api/assistant', {
//           method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, mode: 'doubt', user_id: userId })
//         })
//         if (!res.ok) {
//           const err = await res.json().catch(() => null)
//           setMessages(m => [...m, { from: 'bot', text: `Sorry — assistant error: ${err?.error || res.status}` }])
//         } else {
//           const data = await res.json()
//           const answer = data?.answer || 'No response'
//           setMessages(m => [...m, { from: 'user', text: q }, { from: 'bot', text: answer }])
//         }
//       } else {
//         // Other tabs use the Gemini assistant route
//         const res = await fetch('/api/gemini-assistant', {
//           method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, user_id: userId, mode: undefined })
//         })
//         const data = await res.json()
//         const answer = data?.answer || 'No response'
//         setFeedback(answer)
//       }
//     } catch (e) {
//       if (tab === 'doubt') setMessages(m => [...m, { from: 'bot', text: 'An error occurred while contacting the assistant.' }])
//       else setFeedback('Assistant error. Try again.')
//       console.error('assistant send error', e)
//     } finally {
//       setLoading(false)
//     }
//   }

//   return (
//     <div style={{ width: 560, border: '1px solid #e6edf3', borderRadius: 12, padding: 0, background: 'white', display: 'flex', overflow: 'hidden' }}>
//       {/* Left: vertical tab column */}
//       <div style={{ width: 120, background: '#fbfdff', borderRight: '1px solid #eef2f6', display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
//         <button onClick={() => setTab('summarize')} style={{ padding: 10, textAlign: 'left', borderRadius: 8, background: tab==='summarize' ? '#2563eb' : 'transparent', color: tab==='summarize' ? 'white' : '#111' }}>Summarize</button>
//         <button onClick={() => setTab('doubt')} style={{ padding: 10, textAlign: 'left', borderRadius: 8, background: tab==='doubt' ? '#2563eb' : 'transparent', color: tab==='doubt' ? 'white' : '#111' }}>Ask Queries</button>
//         <button onClick={() => setTab('practice')} style={{ padding: 10, textAlign: 'left', borderRadius: 8, background: tab==='practice' ? '#2563eb' : 'transparent', color: tab==='practice' ? 'white' : '#111' }}>Practice questions</button>
//         <button onClick={() => setTab('explain')} style={{ padding: 10, textAlign: 'left', borderRadius: 8, background: tab==='explain' ? '#2563eb' : 'transparent', color: tab==='explain' ? 'white' : '#111' }}>Explain</button>
//         <button onClick={() => setTab('flashcards')} style={{ padding: 10, textAlign: 'left', borderRadius: 8, background: tab==='flashcards' ? '#2563eb' : 'transparent', color: tab==='flashcards' ? 'white' : '#111' }}>Flashcards</button>
//       </div>

//       {/* Right: content area */}
//       <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
//           <div style={{ padding: 8 }}>
//             {tab !== 'doubt' && !feedback && <div style={{ color: '#6b7280' }}>Choose a tab on the left, type your request below, then press Send.</div>}
//             {tab !== 'doubt' && feedback && (
//               <div style={{ padding: 10, background: '#f3f4f6', borderRadius: 8, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{feedback}</div>
//             )}

//             {tab === 'doubt' && (
//               <div style={{ minHeight: 160, maxHeight: 280, overflow: 'auto', padding: 8, border: '1px solid #eef2f6', borderRadius: 8, marginBottom: 8 }}>
//                 {messages.length === 0 && <div style={{ color: '#6b7280' }}>You selected: Ask queries. Please type your question and I will search your content.</div>}
//                 {messages.map((m, i) => (
//                   <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
//                     <div style={{ maxWidth: '80%', padding: 10, borderRadius: 8, background: m.from === 'user' ? '#2563eb' : '#f3f4f6', color: m.from === 'user' ? 'white' : '#111' }}>{m.text}</div>
//                   </div>
//                 ))}
//               </div>
//             )}

//             {tab === 'doubt' ? (
//               <div style={{ display: 'flex', gap: 8 }}>
//                 <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} placeholder={'Ask your doubt about the content...'} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e6edf3' }} />
//                 <button onClick={send} disabled={loading} style={{ padding: '10px 14px', borderRadius: 8, background: '#2563eb', color: 'white', border: 'none' }}>{loading ? '...' : 'Send'}</button>
//               </div>
//             ) : (
//               <>
//                 <textarea ref={inputRef as any} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }} placeholder={'Type your request...'} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #e6edf3', resize: 'vertical', minHeight: 140 }} />
//                 <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
//                   <button onClick={() => { setInput(''); setFeedback(null) }} style={{ padding: '8px 12px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #e6edf3' }}>Clear</button>
//                   <button onClick={async () => { await send(); }} disabled={loading} style={{ padding: '10px 16px', borderRadius: 8, background: '#2563eb', color: 'white', border: 'none' }}>{loading ? '...' : 'Send'}</button>
//                 </div>
//               </>
//             )}
//       </div>
//     </div>
//   )
// }
