"use client";

import { useCallback } from "react";
import { useChat } from "ai/react";
import styles from "./page.module.css";

const SUGGESTIONS = [
  "Curate an \"Intro to Python\" playlist with 5 tutorials",
  "Summarize my \"Intro to Python\" playlist",
  "Search for Python tutorials videos",
];

const HERO_MESSAGE = "Your YouTube AI Agent helping you to create the best playlists";

export default function Page(): JSX.Element {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    append,
    setInput,
    error,
  } = useChat({ api: "/api/chat" });

  const handleSuggestion = useCallback(
    (prompt: string) => {
      setInput("");
      void append({
        role: "user",
        content: prompt,
      });
    },
    [append, setInput],
  );

  return (
    <main className={styles.main}>
      <div className={styles.logo} aria-hidden>
        <svg
          className={styles.logoIcon}
          viewBox="0 0 24 24"
          role="img"
          aria-label="Play icon"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <h1 className={styles.title}>YouTube AI Agent</h1>
        <p className={styles.subtitle}>{HERO_MESSAGE}</p>
      </div>

      <section style={{ width: "100%" }}>
        <h2 style={{ textAlign: "center", color: "#777", fontSize: "0.95rem", fontWeight: 500, marginBottom: 18 }}>
          Try asking:
        </h2>
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestionButton}
              onClick={() => handleSuggestion(suggestion)}
              disabled={isLoading}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.chatWrapper}>
        <div className={styles.messages}>
          {messages
            .filter((message) => {
              if (typeof message.content === "string") {
                return message.content.trim().length > 0;
              }
              return message.content != null;
            })
            .map((message) => (
              <div
                key={message.id}
                className={`${styles.message} ${
                  message.role === "user" ? styles.userMessage : styles.assistantMessage
                }`}
              >
                {typeof message.content === "string" ? message.content : message.content.toString()}
              </div>
            ))}
          {isLoading && (
            <div className={styles.loadingMessage}>
              <span className={styles.loadingDot} aria-hidden />
            </div>
          )}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <textarea
            className={styles.textarea}
            placeholder="Ask me to curate or manage your YouTube playlists..."
            value={input}
            onChange={handleInputChange}
            disabled={isLoading}
          />
          <button className={styles.sendButton} type="submit" aria-label="Send message" disabled={isLoading || input.trim().length === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M3.40005 20.4L20.5 12L3.40005 3.59998L3.40005 10.2L15.2 12L3.40005 13.8L3.40005 20.4Z"
                fill="white"
              />
            </svg>
          </button>
        </form>
        <div className={styles.status}>
          {isLoading ? "Thinking..." : error ? `Error: ${error.message ?? "Something went wrong."}` : ""}
        </div>
      </section>
    </main>
  );
}
