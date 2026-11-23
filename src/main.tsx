import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SunaPaintPage } from "./SunaPaintPage";
import "./index.css";

// アプリの入口。#root に砂ペイント本体(SunaPaintPage)を描画するだけ。
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root が見つかりません");

createRoot(rootElement).render(
  <StrictMode>
    <SunaPaintPage />
  </StrictMode>,
);
