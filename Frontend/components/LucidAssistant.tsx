"use client"

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from 'next/navigation'
import { MessageSquare, X, Send } from "lucide-react";
// AssistantTabs removed - restore original inline chat UI

export default function LucidAssistant() {
  const router = useRouter()
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<string | null>(null) // 'doubt' when user selects Ask a doubt
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ from: "user" | "bot"; text: string }>>([]);
  const [assistantUserId, setAssistantUserId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const STORAGE_KEY = 'lucid_assistant_messages_v1'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll to bottom whenever messages change or panel opens
  useEffect(() => {
    try {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (e) {
      // ignore
    }
  }, [messages, open]);

  // Load persisted messages from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setMessages(parsed)
      }
    } catch (e) {
      // ignore parse errors
    }
    try {
      const existingId = localStorage.getItem('lucid_assistant_user_id')
      if (existingId) setAssistantUserId(existingId)
      else {
        const id = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `anon-${Date.now()}`
        localStorage.setItem('lucid_assistant_user_id', id)
        setAssistantUserId(id)
      }
    } catch (e) {
      // ignore
    }
  }, [])

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch (e) {
      // ignore storage errors
    }
  }, [messages])

  const send = async () => {
    if (!input.trim()) return;
    const txt = input.trim();
    setMessages(m => [...m, { from: "user", text: txt }]);
    setInput("");

    try {
      setLoading(true);
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: txt, mode, user_id: assistantUserId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setMessages(m => [...m, { from: 'bot', text: `Sorry — assistant error: ${err?.error || res.status}` }]);
        return;
      }

      const data = await res.json();
      const answer = data?.answer || 'No response';
      setMessages(m => [...m, { from: 'bot', text: answer }]);
    } catch (ex) {
      setMessages(m => [...m, { from: 'bot', text: 'An error occurred while contacting the assistant.' }]);
      console.error('assistant error', ex);
    } finally {
      setLoading(false);
    }
  };

  const goBackToMenu = () => {
    // Clear mode and messages so the main menu reappears immediately
    setMode(null)
    setMessages([])
  }


  const handleMenuChoice = async (choice: number) => {
    // Map choice to mode and optionally prefill prompt
    if (choice === 1) {
      // Summarize content: set mode so subsequent queries use summarization flow
      setMode('summarize')
      setMessages(m => [...m, { from: 'bot', text: 'You selected: Summarize content. Type what you want summarized (module name, topic, or paste text).' }])
      return
    }

    if (choice === 2) {
      // Practice: generate practice questions
      setMode('practice')
      setMessages(m => [...m, { from: 'bot', text: 'You selected: Practice. Tell me what topic or module you want practice questions for, and I will generate MCQs, short answers, and scenarios.' }])
      return
    }

    if (choice === 4) {
      // ensure server row exists for this user
      try {
        setLoading(true)
        await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'doubt', action: 'start', user_id: assistantUserId }) })
      } catch (e) {
        console.error('failed to start doubt session', e)
      } finally {
        setLoading(false)
      }

      setMode('doubt')
      setMessages(m => [...m, { from: 'bot', text: 'You selected: Ask doubt related to content. Please type your question and I will search your content.' }])
      return
    }

    // navigation option removed from UI; other choices handled above
  }

  return (
    <div>
      {/* Floating button */}
      <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 9999 }}>
        <button
          aria-label="Open Lucid Assistant"
          onClick={() => setOpen(o => !o)}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: '#2563eb',
            color: 'white',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(2,6,23,0.2)',
            cursor: 'pointer'
          }}
        >
          <MessageSquare size={22} />
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            right: 24,
            bottom: 90,
            width: 420,
            height: 540,
            background: 'white',
            borderRadius: 14,
            boxShadow: '0 18px 48px rgba(2,6,23,0.18)',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #eef2f6' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(90deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>
                L
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>Lucid Assistant</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Ask me anything related to Lucid</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => { setOpen(false); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          <div style={{ padding: '12px 14px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ color: '#6b7280', fontSize: 13 }}>Hi — How can I help you today?</div>

                  {/* Vertical menu tabs shown when no mode selected and no messages yet */}
                  {messages.length === 0 && !mode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
                      <button onClick={() => handleMenuChoice(1)} style={{ padding: '8px 12px', borderRadius: 999, fontSize: 14, minWidth: 160, textAlign: 'left', background: '#f3f4f6', border: '1px solid #e6edf3' }}>Summarize content</button>
                        <button onClick={() => handleMenuChoice(2)} style={{ padding: '8px 12px', borderRadius: 999, fontSize: 14, minWidth: 160, textAlign: 'left', background: '#f3f4f6', border: '1px solid #e6edf3' }}>Practice</button>
                        {/* Navigation help removed per request */}
                        <button onClick={() => handleMenuChoice(4)} style={{ padding: '8px 12px', borderRadius: 999, fontSize: 14, minWidth: 160, textAlign: 'left', background: '#2563eb', color: 'white', border: 'none' }}>Ask doubt related to content</button>
                    </div>
                  )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6, paddingTop: 6 }}>
              {messages.length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>Try: "ask anything"</div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '84%', padding: '10px 14px', borderRadius: 12, background: m.from === 'user' ? '#2563eb' : '#f3f4f6', color: m.from === 'user' ? 'white' : '#111827', fontSize: 14, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
              {loading && (
                <div style={{ color: '#6b7280', fontSize: 13 }}>[Assistant is typing...]</div>
              )}
            </div>

            <div style={{ position: 'relative', paddingTop: 6 }}>
              <input
                value={input}
                ref={inputRef}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                placeholder="Ask about a module..."
                style={{ width: '100%', padding: '10px 48px 10px 12px', borderRadius: 999, border: '1px solid #e6edf3', outline: 'none', boxSizing: 'border-box' }}
              />
              <button onClick={send} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 999, background: '#2563eb', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Send">
                <Send size={16} />
              </button>
            </div>
            {/* Mode controls: Back to menu or Continue */}
            {mode && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={goBackToMenu} style={{ padding: '6px 10px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #e6edf3' }}>Back to menu</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
