import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { Dashboard } from "./Dashboard";
import { MinimapView, minimapOnly } from "./MinimapView";

// ?view=minimap: 비전 미니맵만(미니맵 녹화). 3D 트윈은 띄우지 않는다
const page = minimapOnly(location.search) ? <MinimapView /> : <Dashboard />;
createRoot(document.getElementById("root")!).render(<StrictMode><MotionConfig reducedMotion="user">{page}</MotionConfig></StrictMode>);
