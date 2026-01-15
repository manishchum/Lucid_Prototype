"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, Mic, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import VoiceInput from '@/components/VoiceInput';
import VoiceOutput from '@/components/VoiceOutput';
import { Scenario, Message } from '@/lib/roleplay/types';

interface RolePlayConversationProps {
  scenario: Scenario;
  onEndSession: (messages: Message[]) => void;
}

export default function RolePlayConversation({ scenario, onEndSession }: RolePlayConversationProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useVoice, setUseVoice] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send initial AI message
  useEffect(() => {
    const initialMessage: Message = {
      text: scenario.initialPrompt,
      sender: 'avatar',
      timestamp: new Date().toISOString()
    };
    setMessages([initialMessage]);
  }, [scenario]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Add user message
    const userMessage: Message = {
      text: text.trim(),
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      // Call API to get AI response
      const response = await fetch('/api/roleplay/conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text.trim(),
          conversationHistory: messages,
          scenarioTitle: scenario.title,
          scenarioRole: scenario.role,
          initialPrompt: scenario.initialPrompt
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get response');
      }

      const data = await response.json();

      // Add AI response
      const aiMessage: Message = {
        text: data.response,
        sender: 'avatar',
        timestamp: data.timestamp
      };

      setMessages(prev => [...prev, aiMessage]);

    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        text: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        sender: 'avatar',
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceTranscription = (text: string) => {
    sendMessage(text);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const handleEndSession = () => {
    if (messages.length > 1) { // More than just the initial message
      onEndSession(messages);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-300px)] bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 rounded-t-xl">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg">{scenario.title}</h3>
            <p className="text-sm text-purple-100">Speaking with: {scenario.role}</p>
          </div>
          <Button 
            onClick={handleEndSession}
            variant="outline"
            className="bg-white text-purple-600 hover:bg-purple-50"
            disabled={messages.length <= 1}
          >
            End Session
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.sender === 'avatar' && (
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                AI
              </div>
            )}
            
            <div className={`flex flex-col gap-1 max-w-[70%]`}>
              <div
                className={`rounded-2xl px-4 py-3 ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              </div>
              
              {msg.sender === 'avatar' && (
                <div className="flex items-center gap-2 ml-2">
                  <VoiceOutput text={msg.text} disabled={isLoading} />
                  <span className="text-xs text-slate-400">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              )}
              
              {msg.sender === 'user' && (
                <span className="text-xs text-slate-400 text-right mr-2">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>

            {msg.sender === 'user' && (
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold">
                You
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
              AI
            </div>
            <div className="bg-slate-100 rounded-2xl px-4 py-3">
              <div className="flex gap-2 items-center">
                <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                <span className="text-sm text-slate-600">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-200 p-4 bg-slate-50 rounded-b-xl">
        <div className="flex items-center gap-3">
          {/* Voice Input Toggle */}
          <button
            onClick={() => setUseVoice(!useVoice)}
            className={`p-2 rounded-full transition-all ${
              useVoice
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
            }`}
            title={useVoice ? 'Switch to text input' : 'Switch to voice input'}
          >
            <Mic className="w-5 h-5" />
          </button>

          {useVoice ? (
            <div className="flex-1 flex items-center justify-center gap-3">
              <VoiceInput
                onTranscription={handleVoiceTranscription}
                disabled={isLoading}
              />
              <span className="text-sm text-slate-600">Click microphone to speak</span>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your response..."
                className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <Button
                onClick={() => sendMessage(inputText)}
                disabled={!inputText.trim() || isLoading}
                className="px-6"
              >
                <Send className="w-5 h-5" />
              </Button>
            </>
          )}
        </div>

        <p className="text-xs text-slate-500 mt-2 text-center">
          {useVoice ? 'Voice mode active' : 'Press Enter to send • Shift+Enter for new line'}
        </p>
      </div>
    </div>
  );
}
