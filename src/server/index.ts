// API 서버 런타임(구현명세서 6.11)
// 서버를 띄우는 입구. 다른 도메인은 서버를 가져오지 않는다.
export { startServer, type StartServerOptions, type RunningServer } from "./start.js";
export { bootServer } from "./boot.js";
