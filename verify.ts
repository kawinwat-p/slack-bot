import { validateIdeas } from "./src/services/ideas/ideas.service.js";
import { checkInput } from "./src/shared/input.js";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const okText = (r: ReturnType<typeof checkInput>) => r.ok ? r.text : null;
ok(okText(checkInput("  add a deploy alert  ")) === "add a deploy alert", "clean input trimmed + allowed");
ok(okText(checkInput(undefined)) === "" && okText(checkInput("")) === "", "empty allowed (text='')");
ok(!checkInput("x".repeat(1001)).ok, "over 1000 blocked");
ok(!checkInput("the api_key=ABC123secret").ok, "credentials blocked");
ok(!checkInput("my id is 1234567890123").ok, "PII (national id) blocked");
ok(!checkInput("email me at a@b.com").ok, "PII (email) blocked");
ok(!checkInput("this is shit").ok, "abuse blocked");
ok(checkInput("deploys announced by hand, painful").ok, "normal pain text passes");

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
