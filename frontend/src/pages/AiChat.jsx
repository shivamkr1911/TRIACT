// frontend/src/pages/AiChat.jsx

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useAuth } from "../hooks/useAuth";
import shopService from "../services/shopService";
import { Send, Sparkles, Trash2, Brain, RotateCcw } from "lucide-react";

// Normalize text so inline bullets or unicode bullets break into clean markdown list items
const formatMarkdownText = (text) => {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/([^\n])\s*[•●]\s+/g, "$1\n- ")
    .replace(/^[ \t]*[•●]\s+/gm, "- ");
};

const CHAT_STORAGE_PREFIX = "triactAiChatHistory";

const QUICK_PROMPTS = [
  "Which product has the least stock?",
  "Today's sales & profit",
  "Top 5 best selling products",
  "Low stock alerts",
  "Who is our top employee?",
];

const INITIAL_GREETING =
  "Hi! I'm your TRIACT AI assistant. Ask me questions about your inventory, sales, or employees.";

const AiChat = () => {
  const { user } = useAuth();
  const messagesContainerRef = useRef(null);

  const storageKey = user?.shopId
    ? `${CHAT_STORAGE_PREFIX}_${user.shopId}`
    : CHAT_STORAGE_PREFIX;

  const [messages, setMessages] = useState(() => {
    if (typeof window !== "undefined") {
      const savedMessages = localStorage.getItem(storageKey);
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        } catch (e) {
          console.error("Failed to parse chat history from localStorage:", e);
        }
      }
    }
    return [{ sender: "ai", text: INITIAL_GREETING }];
  });

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Sync state when shopId or storageKey changes
  useEffect(() => {
    const savedMessages = localStorage.getItem(storageKey);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (e) {
        console.error("Failed to load shop chat history:", e);
      }
    }
    setMessages([{ sender: "ai", text: INITIAL_GREETING }]);
  }, [storageKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Persist messages to localStorage
  useEffect(() => {
    if (
      messages.length > 1 ||
      messages[0]?.sender !== "ai" ||
      messages[0]?.text !== INITIAL_GREETING
    ) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  const sendMessage = async (textToSend) => {
    const query = textToSend.trim();
    if (!query || isLoading) return;

    const userMessage = { sender: "user", text: query };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Multi-turn context memory: extract last 6 turns (ignoring error bubbles)
    const historyPayload = messages
      .filter((m) => !m.isError)
      .slice(-6)
      .map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

    let hasStartedStreaming = false;

    try {
      await shopService.streamAiChatResponse(
        user.shopId,
        query,
        historyPayload,
        (currentText) => {
          if (!hasStartedStreaming) {
            hasStartedStreaming = true;
            setIsLoading(false);
            setMessages((prev) => [
              ...prev,
              { sender: "ai", text: currentText, isStreaming: true },
            ]);
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                sender: "ai",
                text: currentText,
                isStreaming: true,
              };
              return updated;
            });
          }
        }
      );

      // Finalize the message: clear isStreaming
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].sender === "ai") {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            isStreaming: false,
          };
        }
        return updated;
      });
    } catch (streamError) {
      console.warn("AI Streaming failed, falling back to standard request:", streamError);

      // Fallback: Use standard non-streaming API (via axios with full baseURL)
      try {
        const response = await shopService.getAiChatResponse(
          user.shopId,
          query,
          historyPayload
        );

        const replyText =
          response.reply || response.answer || "No response received.";

        setMessages((prev) => {
          if (hasStartedStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              sender: "ai",
              text: replyText,
              isStreaming: false,
            };
            return updated;
          }
          return [...prev, { sender: "ai", text: replyText }];
        });
      } catch (error) {
        console.error("AI Chat Error (after fallback):", error);

        const userFriendlyMessage =
          error.response?.data?.message ||
          error.message ||
          "I'm having trouble analyzing the store data right now. Please try again in a moment.";

        const errorMessage = {
          sender: "ai",
          text: userFriendlyMessage,
          isError: true,
          failedPrompt: query,
        };

        setMessages((prev) => {
          if (hasStartedStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = errorMessage;
            return updated;
          }
          return [...prev, errorMessage];
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleRetry = (failedPrompt) => {
    if (failedPrompt && !isLoading) {
      sendMessage(failedPrompt);
    }
  };

  const clearChatHistory = () => {
    localStorage.removeItem(storageKey);
    setMessages([
      {
        sender: "ai",
        text: "Chat history cleared. How can I help you?",
      },
    ]);
  };

  return (
    <div className="flex justify-center h-[calc(100vh-112px)] pt-2">
      <div className="flex flex-col h-full max-h-[720px] w-full max-w-2xl bg-white shadow-xl rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 bg-white">
          <h1 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
            <Sparkles className="text-indigo-600" size={22} />
            <span>TRIACT AI Assistant</span>
          </h1>
          <button
            onClick={clearChatHistory}
            className="text-sm text-gray-600 hover:text-red-600 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors duration-200 hover:border-red-500 flex items-center gap-1.5"
            title="Clear chat history"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>

        {/* Chat Area */}
        <div
          ref={messagesContainerRef}
          className="flex-1 p-5 space-y-4 overflow-y-auto bg-gray-50"
        >
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 ${
                msg.sender === "ai" ? "justify-start" : "justify-end"
              }`}
            >
              {/* AI Avatar */}
              {msg.sender === "ai" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center mt-1">
                  <Brain size={18} />
                </div>
              )}

              {/* Message Bubble */}
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl shadow-sm text-sm break-words ${
                  msg.sender === "ai"
                    ? msg.isError
                      ? "bg-rose-50 text-rose-900 border border-rose-200 rounded-tl-none"
                      : "bg-white text-gray-800 border border-gray-200 rounded-tl-none"
                    : "bg-indigo-600 text-white rounded-tr-none"
                }`}
              >
                {msg.sender === "ai" ? (
                  <div>
                    <div className="leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          p: ({ node, ...props }) => (
                            <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
                          ),
                          ul: ({ node, ...props }) => (
                            <ul className="list-disc pl-5 my-1.5 space-y-1" {...props} />
                          ),
                          ol: ({ node, ...props }) => (
                            <ol className="list-decimal pl-5 my-1.5 space-y-1" {...props} />
                          ),
                          li: ({ node, ...props }) => (
                            <li className="leading-relaxed" {...props} />
                          ),
                          strong: ({ node, ...props }) => (
                            <strong className="font-semibold text-gray-900" {...props} />
                          ),
                          h1: ({ node, ...props }) => (
                            <h1 className="text-base font-bold my-2 text-gray-900" {...props} />
                          ),
                          h2: ({ node, ...props }) => (
                            <h2 className="text-sm font-bold my-2 text-gray-900" {...props} />
                          ),
                          h3: ({ node, ...props }) => (
                            <h3 className="text-xs font-bold my-1 text-gray-900 uppercase tracking-wider" {...props} />
                          ),
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="min-w-full divide-y divide-gray-200 text-xs border border-gray-200 rounded" {...props} />
                            </div>
                          ),
                          th: ({ node, ...props }) => (
                            <th className="px-2 py-1.5 bg-gray-100 font-semibold text-left border-b border-gray-200" {...props} />
                          ),
                          td: ({ node, ...props }) => (
                            <td className="px-2 py-1.5 border-b border-gray-100" {...props} />
                          ),
                          code: ({ node, inline, ...props }) =>
                            inline ? (
                              <code className="bg-gray-100 text-indigo-700 px-1 py-0.5 rounded text-xs font-mono" {...props} />
                            ) : (
                              <code className="block bg-gray-100 text-gray-800 p-2 rounded text-xs font-mono overflow-x-auto my-1" {...props} />
                            ),
                        }}
                      >
                        {formatMarkdownText(msg.text)}
                      </ReactMarkdown>
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-600 animate-pulse rounded-xs align-middle" />
                      )}
                    </div>

                    {msg.isError && msg.failedPrompt && (
                      <button
                        onClick={() => handleRetry(msg.failedPrompt)}
                        disabled={isLoading}
                        className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shadow-sm"
                      >
                        <RotateCcw size={13} />
                        Retry
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start gap-3 justify-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center mt-1">
                <Brain size={18} />
              </div>
              <div className="max-w-[70%] px-4 py-3 rounded-2xl bg-white border border-gray-200 text-gray-800 shadow-sm rounded-tl-none flex items-center gap-2">
                <div className="flex space-x-1">
                  <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></span>
                </div>
                <p className="text-xs text-gray-500 font-medium">
                  TRIACT AI is analyzing store data...
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2 bg-white border-t border-gray-100 flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-gray-400 font-medium whitespace-nowrap flex items-center gap-1">
            <Sparkles size={12} className="text-indigo-500" />
            Suggestions:
          </span>
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => sendMessage(prompt)}
              disabled={isLoading}
              className="text-xs px-2.5 py-1 bg-gray-50 hover:bg-indigo-50 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 rounded-full border border-gray-200 transition-colors whitespace-nowrap disabled:opacity-50 flex-shrink-0"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Area */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center p-3.5 border-t border-gray-200 bg-white space-x-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about inventory, sales, or employees..."
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder-gray-400 disabled:bg-gray-100 transition-all duration-150"
            disabled={isLoading}
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors duration-200 disabled:bg-gray-400 flex items-center justify-center"
            disabled={isLoading || !input.trim()}
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AiChat;
