import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { EnhancedErrorBoundary as ErrorBoundary } from "@/components/enhanced-error-boundary";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
