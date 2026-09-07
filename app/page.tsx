"use client";

import { useState } from "react";

interface Citation {
  document: string;
  section: string;
}

interface QueryTurn {
  id: string;
  query: string;
  timestamp: string;
  status: "loading" | "answer" | "no_match" | "error";
  answer?: string;
  citations?: Citation[];
  errorCode?: string;
  errorMessage?: string;
}

export default function Home() {
  // Access code held strictly in React state only (never localStorage or sessionStorage per INV-3 / AGENTS.md)
  const [accessCode, setAccessCode] = useState<string>("");
  const [accessCodeInput, setAccessCodeInput] = useState<string>("");
  const [accessCodeError, setAccessCodeError] = useState<string>("");

  // Chat interaction state
  const [currentQuery, setCurrentQuery] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [turns, setTurns] = useState<QueryTurn[]>([]);

  // Handle access code unlock
  const handleAccessCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = accessCodeInput.trim();
    if (!trimmed) {
      setAccessCodeError("Please enter an access code.");
      return;
    }
    setAccessCodeError("");
    setAccessCode(trimmed);
  };

  // Handle resetting or changing access code
  const handleResetAccessCode = () => {
    setAccessCode("");
    setAccessCodeInput("");
    setAccessCodeError("");
  };

  // Handle asking a question
  const handleAsk = async (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed || isLoading) return;

    const turnId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newTurn: QueryTurn = {
      id: turnId,
      query: trimmed,
      timestamp: new Date().toLocaleTimeString(),
      status: "loading",
    };

    // Add new turn to top/bottom of turns list
    setTurns((prev) => [newTurn, ...prev]);
    setCurrentQuery("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-code": accessCode,
        },
        body: JSON.stringify({
          query: trimmed,
          accessCode: accessCode,
        }),
      });

      let data: Record<string, unknown> | null = null;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        // Response wasn't JSON
      }

      if (!response.ok) {
        // Distinct State 3: Real Error (401, 500, etc.)
        const code = typeof data?.code === "string" ? data.code : `HTTP_${response.status}`;
        const message =
          typeof data?.message === "string"
            ? data.message
            : `Request failed with HTTP status ${response.status}`;

        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: "error",
                  errorCode: code,
                  errorMessage: message,
                }
              : t
          )
        );
      } else if (data && data.code === "NO_MATCH") {
        // Distinct State 2: NO_MATCH ("not in my material" - INV-1 fallback)
        const message =
          typeof data.message === "string" ? data.message : "not in my material";
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: "no_match",
                  errorMessage: message,
                }
              : t
          )
        );
      } else if (data && typeof data.answer === "string") {
        // Distinct State 1: Grounded Answer with real citations
        const answer = data.answer;
        const rawCitations = Array.isArray(data.citations) ? data.citations : [];
        const citations: Citation[] = rawCitations.map((c) => ({
          document: typeof c?.document === "string" ? c.document : "Unknown",
          section: typeof c?.section === "string" ? c.section : "chunk",
        }));

        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: "answer",
                  answer,
                  citations,
                }
              : t
          )
        );
      } else {
        // Unexpected payload shape
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  status: "error",
                  errorCode: "UNEXPECTED_RESPONSE",
                  errorMessage: "Server returned an unrecognizable response format.",
                }
              : t
          )
        );
      }
    } catch (err: unknown) {
      // Network error or fetch failure
      const errorMsg =
        err instanceof Error ? err.message : "Network error connecting to /api/ask";
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "error",
                errorCode: "NETWORK_ERROR",
                errorMessage: errorMsg,
              }
            : t
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuerySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAsk(currentQuery);
  };

  return (
    <main className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-top">
          <div>
            <h1 className="app-title">Smriti</h1>
            <p className="app-subtitle">
              Exam preparation assistant for MIT-ADT — target subject: OS (test data currently loaded: DBMS sample fixture)
            </p>
          </div>
          {accessCode ? (
            <div className="auth-badge">
              <span>Access code active</span>
              <button
                type="button"
                className="auth-btn-reset"
                onClick={handleResetAccessCode}
                aria-label="Change access code"
              >
                Change
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* Part A: Access Code Gate (shown once when accessCode is empty) */}
      {!accessCode ? (
        <section className="gate-card" aria-labelledby="gate-heading">
          <h2 id="gate-heading">Access Verification</h2>
          <p>
            Please enter the shared access code to begin. This code is held in memory
            only for this session and is never persisted to browser storage.
          </p>
          <form className="gate-form" onSubmit={handleAccessCodeSubmit}>
            <div className="form-group">
              <label htmlFor="access-code-input" className="form-label">
                Access Code
              </label>
              <input
                id="access-code-input"
                type="password"
                className="form-input"
                value={accessCodeInput}
                onChange={(e) => setAccessCodeInput(e.target.value)}
                placeholder="Enter ACCESS_CODE"
                autoComplete="off"
                autoFocus
                required
              />
            </div>
            {accessCodeError ? (
              <p className="error-message" style={{ color: "var(--error-border)" }}>
                {accessCodeError}
              </p>
            ) : null}
            <div>
              <button type="submit" className="btn-primary">
                Unlock Assistant
              </button>
            </div>
          </form>
        </section>
      ) : (
        /* Part B: Main Chat Interface (shown once accessCode is active) */
        <>
          {/* Question Input Box */}
          <section className="ask-section" aria-labelledby="ask-heading">
            <h2 id="ask-heading" style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              Ask a question
            </h2>
            <form className="ask-form" onSubmit={handleQuerySubmit}>
              <div className="form-group">
                <label htmlFor="question-input" className="form-label" style={{ display: "none" }}>
                  Question
                </label>
                <textarea
                  id="question-input"
                  className="form-textarea"
                  value={currentQuery}
                  onChange={(e) => setCurrentQuery(e.target.value)}
                  placeholder="Ask a question from DBMS (e.g. Explain the ARIES recovery protocol)..."
                  disabled={isLoading}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk(currentQuery);
                    }
                  }}
                />
              </div>

              <div className="ask-actions">
                <div className="sample-queries-hint">
                  Press Enter to submit, Shift+Enter for newline
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isLoading || !currentQuery.trim()}
                >
                  {isLoading ? "Searching..." : "Ask Smriti"}
                </button>
              </div>
            </form>

            {/* Quick-test helpers for manual verification */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-text)" }}>Try sample:</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={isLoading}
                onClick={() =>
                  handleAsk("Explain the ARIES recovery protocol and its three distinct phases.")
                }
              >
                ARIES protocol (Match)
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={isLoading}
                onClick={() =>
                  handleAsk("Explain Write Skew anomaly under Snapshot Isolation with an example.")
                }
              >
                Write Skew (Match)
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={isLoading}
                onClick={() =>
                  handleAsk("How does cellular respiration and the Krebs cycle produce ATP in mitochondria?")
                }
              >
                Cellular respiration (Out of corpus)
              </button>
            </div>
          </section>

          {/* Results & History Feed */}
          {turns.length > 0 ? (
            <section className="feed-container" aria-label="Query results">
              <div className="feed-header">
                <h3>Session Responses ({turns.length})</h3>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setTurns([])}
                  style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                >
                  Clear Feed
                </button>
              </div>

              {turns.map((turn) => (
                <article key={turn.id} className="turn-card">
                  {/* User Query */}
                  <div className="turn-query">
                    <span className="turn-query-prefix">Question:</span>
                    <span>{turn.query}</span>
                  </div>

                  {/* Loading State in-flight */}
                  {turn.status === "loading" ? (
                    <div className="outcome-loading" role="status" aria-live="polite">
                      <div className="loading-spinner" />
                      <div className="loading-text">
                        <span className="loading-primary">Searching material and verifying sources...</span>
                        <span className="loading-secondary">
                          Embedding query and performing pgvector similarity search.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {/* Outcome State 1: Grounded Answer with Visible Citations */}
                  {turn.status === "answer" ? (
                    <div className="outcome-answer">
                      <div className="outcome-header">
                        <span className="badge badge-answer">[Grounded Answer]</span>
                        <span style={{ fontSize: "0.8rem", color: "var(--muted-text)" }}>
                          Backed by retrieved material
                        </span>
                      </div>

                      <div className="answer-body">{turn.answer}</div>

                      {/* Source Citations visibly displayed alongside the answer */}
                      {turn.citations && turn.citations.length > 0 ? (
                        <div className="citations-box" aria-label="Source citations">
                          <div className="citations-title">
                            <span>Source Citations ({turn.citations.length})</span>
                          </div>
                          <ul className="citations-list">
                            {turn.citations.map((c, i) => (
                              <li key={i} className="citation-item">
                                <span className="citation-doc">Doc: {c.document}</span>
                                <span className="citation-sep">·</span>
                                <span className="citation-sec">Section: {c.section}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Outcome State 2: NO_MATCH ("not in my material" - INV-1 Fallback) */}
                  {turn.status === "no_match" ? (
                    <div className="outcome-nomatch" role="status">
                      <div className="outcome-header">
                        <span className="badge badge-nomatch">[Not in My Material]</span>
                        <span className="nomatch-title">INV-1 Ground-Check Fallback</span>
                      </div>
                      <div className="nomatch-message">&ldquo;{turn.errorMessage}&rdquo;</div>
                      <p className="nomatch-explanation">
                        The retrieved content for this question did not meet the similarity threshold (0.65).
                        In accordance with INV-1, Smriti returns this fixed response rather than guessing.
                      </p>
                    </div>
                  ) : null}

                  {/* Outcome State 3: Real Error (401, 500, network error) */}
                  {turn.status === "error" ? (
                    <div className="outcome-error" role="alert">
                      <div className="outcome-header">
                        <span className="badge badge-error">[Error: {turn.errorCode}]</span>
                        <span className="error-title">Request Failure</span>
                      </div>
                      <div className="error-message">{turn.errorMessage}</div>
                      {turn.errorCode === "UNAUTHORIZED" || turn.errorCode === "HTTP_401" ? (
                        <div className="error-action">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleResetAccessCode}
                          >
                            Re-enter Access Code
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
