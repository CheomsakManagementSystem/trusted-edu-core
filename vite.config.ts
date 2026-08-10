import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const firebaseChunks = ["performance", "storage", "functions", "firestore", "auth"];

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: [
      {
        find: "@/lib/pdfProcessor",
        replacement: path.resolve(__dirname, "./src/lib/pdfProcessorStable.ts"),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          const feature = firebaseChunks.find(
            (name) =>
              normalizedId.includes(`/node_modules/@firebase/${name}`) ||
              normalizedId.includes(`/node_modules/firebase/${name}`),
          );
          return feature ? `firebase-${feature}` : undefined;
        },
      },
    },
  },
}));
