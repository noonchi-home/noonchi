import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { MobileApp } from "./index";

createRoot(document.getElementById("root")!).render(
  <StrictMode><MotionConfig reducedMotion="user"><MobileApp /></MotionConfig></StrictMode>,
);
