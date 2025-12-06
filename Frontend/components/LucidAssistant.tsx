"use client"

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from 'next/navigation'
import { MessageSquare, X, Send, HelpCircle, FileText, ClipboardList, Upload } from "lucide-react";
// AssistantTabs removed - restore original inline chat UI

export default function LucidAssistant() {
  const router = useRouter()
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<string | null>(null) // 'doubt' when user selects Ask a doubt
  const [loading, setLoading] = useState(false);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null)
  const [pdfBase64, setPdfBase64] = useState<string | null>(null)
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
      const existingId2 = localStorage.getItem('lucid_assistant_user_id')
      if (existingId2) setAssistantUserId(existingId2)
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
        body: JSON.stringify({ query: txt, mode, user_id: assistantUserId, pdf_base64: pdfBase64, pdf_name: pdfFileName }),
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

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onPickPdf = () => {
    try {
      fileInputRef.current?.click()
    } catch (e) {}
  }

  const onPdfSelected = (file?: File | null) => {
    if (!file) return
    setPdfFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string | ArrayBuffer | null
      if (!result) return
      // convert to base64 string without metadata if present
      const base64 = typeof result === 'string' ? result.split(',')[1] || result : ''
      setPdfBase64(base64 || null)
    }
    reader.readAsDataURL(file)
  }

  const clearPdf = () => { setPdfFileName(null); setPdfBase64(null); if (fileInputRef.current) fileInputRef.current.value = '' }

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
      setMessages(m => [...m, { from: 'bot', text: 'Upload a document or paste text — I’ll simplify it.' }])
      return
    }

    if (choice === 2) {
      // Practice: generate practice questions
      setMode('practice')
      setMessages(m => [...m, { from: 'bot', text: 'Practice with AI-generated MCQs and quizzes.' }])
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
      setMessages(m => [...m, { from: 'bot', text: 'Ask doubts and get simple explanations.' }])
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
                      <button className="menuButton" onClick={() => handleMenuChoice(4)} aria-label="Ask queries">
                        <HelpCircle size={16} />
                        <span>Ask queries</span>
                      </button>

                      <button className="menuButton" onClick={() => handleMenuChoice(1)} aria-label="Summarize Content">
                        <FileText size={16} />
                        <span>Summarize content</span>
                      </button>

                      <button className="menuButton" onClick={() => handleMenuChoice(2)} aria-label="Practice Questions">
                        <ClipboardList size={16} />
                        <span>Practice questions</span>
                      </button>

                      <style jsx>{`
                        .menuButton {
                          display: inline-flex;
                          align-items: center;
                          gap: 8px;
                          padding: 8px 12px;
                          border-radius: 999px;
                          font-size: 14px;
                          min-width: 160px;
                          text-align: left;
                          background: #f3f4f6;
                          border: 1px solid #e6edf3;
                          color: #111827;
                          cursor: pointer;
                          transition: background 120ms ease, color 120ms ease, transform 120ms ease;
                        }
                        .menuButton:hover {
                          background: #2563eb;
                          color: white;
                          transform: translateY(-1px);
                          border: none;
                        }
                        .menuButton :global(svg) {
                          flex: none;
                        }
                        .menuButton span {
                          display: inline-block;
                        }
                      `}</style>
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
              <input
                value={input}
                ref={inputRef}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                placeholder={mode === 'summarize' ? "Paste text or upload a PDF to summarize..." : "Ask about a module..."}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 999, border: '1px solid #e6edf3', outline: 'none', boxSizing: 'border-box' }}
              />

              {/* Hidden file input used for PDF upload (visible only when summarizing) */}
              <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => onPdfSelected(e.target.files?.[0] || null)} />

              {/* Show upload button when in summarize mode */}
              {mode === 'summarize' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pdfFileName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f3f4f6', padding: '6px 8px', borderRadius: 999, border: '1px solid #e6edf3' }}>
                      <Upload size={16} />
                      <span style={{ fontSize: 13, color: '#111827', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pdfFileName}</span>
                      <button onClick={clearPdf} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }} aria-label="Remove PDF">✕</button>
                    </div>
                  ) : (
                    <button onClick={onPickPdf} style={{ width: 40, height: 40, borderRadius: 12, background: '#f8fafc', border: '1px solid #e6edf3', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Upload PDF">
                      <Upload size={18} />
                    </button>
                  )}
                </div>
              )}

              <button onClick={send} style={{ width: 40, height: 40, borderRadius: 999, background: '#2563eb', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Send">
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
