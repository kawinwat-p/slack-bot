import { validateIdeas } from "./src/services/ideas/ideas.service.js";
import { clampInput, MAX_INPUT } from "./src/shared/input.js";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

ok(clampInput("  hi  ") === "hi", "trims whitespace");
ok(clampInput("x".repeat(5000)).length === MAX_INPUT, "caps length");
ok(clampInput(undefined) === "" && clampInput(42) === "", "non-string -> empty");

const good = [{ title:"t", problem:"p", triggeringEvidence:"saw 15 msgs", trigger:"tr", steps:["s"], effort:"S" }];
ok(validateIdeas(good).valid.length === 1, "complete idea passes");

const noEvidence = [{ title:"t", problem:"p", triggeringEvidence:"", trigger:"tr", steps:["s"], effort:"S" }];
ok(validateIdeas(noEvidence).valid.length === 0, "empty evidence rejected");

const noSteps = [{ title:"t", problem:"p", triggeringEvidence:"x", trigger:"tr", steps:[], effort:"S" }];
ok(validateIdeas(noSteps).valid.length === 0, "no steps rejected");

const missing = [{ title:"t", steps:["s"], effort:"S" }];
ok(validateIdeas(missing).valid.length === 0, "missing fields rejected");

console.log(`PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
