import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const syncSystemTheme = () => {
  document.documentElement.classList.toggle("dark", darkMediaQuery.matches);
};
syncSystemTheme();
darkMediaQuery.addEventListener("change", syncSystemTheme);

createRoot(document.getElementById("root")!).render(<App />);
