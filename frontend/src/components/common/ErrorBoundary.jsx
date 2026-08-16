import React from "react";

// Catches any render-time crash anywhere below it in the tree — without
// this, an unhandled exception (a null field from an unusual API response,
// a stale module reference, etc.) white-screens the entire app instead of
// showing a recoverable fallback. Must be a class component; there is no
// hook equivalent for componentDidCatch/getDerivedStateFromError.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "inherit",
          background: "#f7f2f3",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #ead7da",
            borderRadius: 12,
            padding: "36px 32px",
            boxShadow: "0 8px 24px rgba(87, 0, 19, 0.08)",
          }}
        >
          <h2 style={{ margin: "0 0 10px", color: "#57001a", fontSize: 20 }}>
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 24px", color: "#6b5a5d", fontSize: 14, lineHeight: 1.5 }}>
            This page ran into an unexpected error. Reloading usually fixes it — if it keeps
            happening, please let the admin know what you were doing right before this appeared.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: "#70001d",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
