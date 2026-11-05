// 모의 PAM 서버: docs/pam-interface.md 계약대로 요청을 검사하고 PAM parse_prediction 모양으로 답한다(시험·연동 확인용).
// 진짜 PAM이 아니다. 판단은 정해진 규칙이다: 근거(evidence)의 컵 안이 빈 컵이면 "컵 치우기", 음료가 남았으면 대기(-1),
// 근거가 없으면 "사용자에게 물어보기"(목록에 없으면 대기).
//
//   npx tsx scripts/pam-mock-server.ts --port 8300      # → PAM_URL=http://127.0.0.1:8300/predict

import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { ContractError, validateMemory, validateDecisionFrames, validateTasks } from "../src/brain/decision.js";
import { PAM_CONTRACT, type PamRequest, type PamResponse } from "../src/brain/pam.js";

export interface MockPamOptions {
  /** 원문(raw_response)을 직접 정한다(시험용: 틀린 답·대기). */
  answer?: (req: PamRequest) => string;
}

export function mockPamAnswer(req: PamRequest): string {
  const inside = req.evidence.find((e) => e.kind === "cup_contents" && e.certain);
  let index: number;
  let reasoning: string;
  if (inside?.value === "empty") {
    index = req.tasks.indexOf("컵 치우기");
    reasoning = "사용자가 자리를 비웠고 컵이 비어 있음";
  } else if (inside?.value === "not_empty") {
    index = -1;
    reasoning = "컵에 음료가 남아 있어 기다림";
  } else {
    index = req.tasks.indexOf("사용자에게 물어보기");
    reasoning = "컵 안을 확인할 수 없음";
  }
  return JSON.stringify({ observation: `모의 PAM: 사진 ${req.frames.length}장, 근거 ${req.evidence.length}개`, reasoning, task_index: index });
}

function check(body: unknown): PamRequest {
  const req = body as PamRequest;
  if (req?.contract !== PAM_CONTRACT) throw new ContractError(`contract: '${PAM_CONTRACT}'이어야 합니다`);
  if (req.camera !== "single") throw new ContractError("camera: 'single'이어야 합니다");
  validateTasks(req.tasks);
  validateMemory(req.memory, req.memory_kind);
  if (!Array.isArray(req.frames)) throw new ContractError("frames: 배열이어야 합니다");
  validateDecisionFrames(req.frames.map((f) => ({ timestamp: f.timestamp })));
  req.frames.forEach((f, i) => {
    if (f.image?.mime_type !== "image/jpeg" || !f.image.base64) throw new ContractError(`frames[${i}].image: JPEG base64가 필요합니다`);
  });
  if (req.final_frame_time !== req.frames.at(-1)!.timestamp) throw new ContractError("final_frame_time: 마지막 사진 시각과 같아야 합니다");
  if (!Array.isArray(req.evidence)) throw new ContractError("evidence: 배열이어야 합니다");
  return req;
}

export function createMockPamServer(opts: MockPamOptions = {}): Server {
  return createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/predict")) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let reply: PamResponse;
      try {
        const body = check(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        const raw = (opts.answer ?? mockPamAnswer)(body);
        // 진짜 PAM처럼 원문을 그대로 두고 해석 결과를 붙인다(틀린 원문은 invalid)
        let prediction: PamResponse["prediction"] = null;
        let errors: string[] = [];
        try {
          const p = JSON.parse(raw) as { observation: string; reasoning: string; task_index: number };
          if (!Number.isInteger(p.task_index) || p.task_index < -1 || p.task_index >= body.tasks.length) throw new Error("prediction.task_index out of range");
          prediction = p;
        } catch (e) {
          errors = [(e as Error).message];
        }
        reply = {
          status: prediction ? "valid" : "invalid", raw_response: raw, prediction,
          selected_action: prediction && prediction.task_index >= 0 ? body.tasks[prediction.task_index]! : null, errors,
        };
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: (e as Error).message }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(reply));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--port");
  const port = i >= 0 ? Number(process.argv[i + 1]) : 8300;
  createMockPamServer().listen(port, "127.0.0.1", () => console.log(`모의 PAM: http://127.0.0.1:${port}/predict`));
}
