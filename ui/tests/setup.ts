import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest globals를 쓰지 않으므로 Testing Library가 스스로 지우지 못한다. 시험마다 그린 화면을 내린다.
afterEach(() => { cleanup(); });
