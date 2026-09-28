import { Component, type ReactNode } from "react";
import { mockupComponents } from "./.generated/mockup-components";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error;
      return (
        <div style={{ padding: 32, fontFamily: "monospace", color: "#dc2626", background: "#fff5f5", borderLeft: "4px solid #dc2626" }}>
          <strong>Component error:</strong>
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 12 }}>{e.message}{"\n\n"}{e.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function Landing() {
  const routes = Object.keys(mockupComponents);
  return (
    <div style={{ padding: 32, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Mockup Sandbox</h1>
      <ul>
        {routes.map((r) => (
          <li key={r} style={{ marginBottom: 8 }}>
            <a href={`/__mockup/preview/${r}`} style={{ color: "#2563eb" }}>
              /preview/{r}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewRoute({ route }: { route: string }) {
  const Comp = mockupComponents[route];
  if (!Comp) {
    return (
      <div style={{ padding: 32, color: "#dc2626", fontFamily: "monospace" }}>
        Component not found: <code>{route}</code><br />
        Available: {Object.keys(mockupComponents).join(", ")}
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <Comp />
    </ErrorBoundary>
  );
}

declare global {
  interface Window { __MOCKUP_ROUTE__?: string; }
}

export function App() {
  // window.__MOCKUP_ROUTE__ is set by inline <script> injected by the preview plugin
  const globalRoute = window.__MOCKUP_ROUTE__;
  if (globalRoute) {
    return <PreviewRoute route={globalRoute} />;
  }

  // Fallback: pathname-based routing
  const path = window.location.pathname;
  const base = "/__mockup/preview/";
  if (path.startsWith(base)) {
    const route = path.slice(base.length).replace(/\/$/, "");
    return <PreviewRoute route={route} />;
  }

  return <Landing />;
}
