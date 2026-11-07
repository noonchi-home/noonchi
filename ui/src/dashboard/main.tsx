import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { Dashboard } from "./Dashboard";

createRoot(document.getElementById("root")!).render(<StrictMode><MotionConfig reducedMotion="user"><Dashboard /></MotionConfig></StrictMode>);
