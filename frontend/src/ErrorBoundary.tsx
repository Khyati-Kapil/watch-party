import { Component } from "react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Keep the app from going blank and log details for debugging.
    console.error("UI runtime error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 780, margin: "40px auto", padding: 16 }}>
          <h1>Something went wrong</h1>
          <p>Please refresh the page. If this keeps happening, restart the frontend.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
