import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { SetupApp } from "./SetupApp";

createRoot(document.getElementById("root")!).render(<StrictMode><SetupApp /></StrictMode>);
