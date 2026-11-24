import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { createPhoneController } from "./controller";
import { PhoneApp } from "./PhoneApp";

// 제어는 한 번만 만든다(StrictMode가 효과를 두 번 돌려도 연결은 하나)
const controller = createPhoneController({ location });
const android = new URLSearchParams(location.search).get("launch") === "android";
function returnToApp() {
  controller.stopAr();
  location.assign("intent://camera/close#Intent;scheme=noonchi;package=app.noonchi.android;end");
}
if (android) window.addEventListener("pagehide", () => controller.stopAr());
createRoot(document.getElementById("root")!).render(<StrictMode><MotionConfig reducedMotion="user">
  <PhoneApp controller={controller} onExit={android ? returnToApp : undefined} embedded={false} />
</MotionConfig></StrictMode>);
