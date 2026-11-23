import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite の最小構成。React プラグインだけで CSS Modules(*.module.css)は標準で使える。
export default defineConfig({
  plugins: [react()],
});
