import { MemoryBus } from "../src/bus/memory.js";
import { busContract } from "./helpers/bus-contract.js";

busContract("MemoryBus", async () => new MemoryBus(() => {}), { length: async (b, t) => (b as MemoryBus).length(t) });
