"use client"

import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send } from "lucide-react";

export default function LucidAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Array<{ from: "user" | "bot"; text: string }>>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
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
        body: JSON.stringify({ query: txt }),
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

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6, paddingTop: 6 }}>
              {messages.length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>Try: "ask your question related to modules"</div>
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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                placeholder="Ask about a module..."
                style={{ width: '100%', padding: '10px 48px 10px 12px', borderRadius: 999, border: '1px solid #e6edf3', outline: 'none', boxSizing: 'border-box' }}
              />
              <button onClick={send} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 999, background: '#2563eb', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Send">
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
