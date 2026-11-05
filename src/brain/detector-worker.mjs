// YOLO 워커 시동: 워커 스레드는 tsx 로더를 물려받지 않아 .ts를 못 읽는다. tsx를 이 스레드에 등록하고 진짜 워커(.ts)를 불러온다.
import { workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();
await import(workerData.entry);
