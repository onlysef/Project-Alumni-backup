import React from "react";
import AppRoutes from "./routes/AppRoutes";
import { ErrorBoundary } from "./components/common/ErrorBoundary.jsx";
import { useViewportHeight } from "./hooks/useViewportHeight.js";

export default function App() {
  useViewportHeight();
  return (
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  );
}
