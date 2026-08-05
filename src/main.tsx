import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializePerformanceMonitoring } from "@/lib/performanceMonitoring";

createRoot(document.getElementById("root")!).render(<App />);
initializePerformanceMonitoring();
