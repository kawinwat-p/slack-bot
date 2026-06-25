import { allowedBlocksFor, CATALOG } from "./src/services/catalog/catalog.js";
import { validateIdeas } from "./src/services/ideas/ideas.service.js";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const a1 = allowedBlocksFor("just chatting about lunch");
ok(a1.includes("slack_canvas") && a1.includes("slack_scheduled_message"), "natives always allowed");
ok(!a1.includes("github_action"), "github filtered without evidence");

const a2 = allowedBlocksFor("our github actions pipeline failed on deploy");
ok(a2.includes("github_action"), "github allowed with evidence");

const good = [{ title:"t", problem:"p", triggeringEvidence:"saw 15 msgs", trigger:"tr", steps:["s"], blocks:["slack_canvas"], effort:"S" }];
ok(validateIdeas(good, ["slack_canvas"]).valid.length === 1, "valid idea passes");

const e = [{ title:"t", problem:"p", triggeringEvidence:"", trigger:"tr", steps:["s"], blocks:["slack_canvas"], effort:"S" }];
ok(validateIdeas(e, ["slack_canvas"]).valid.length === 0, "empty evidence rejected");

const h = [{ title:"t", problem:"p", triggeringEvidence:"x", trigger:"tr", steps:["s"], blocks:["github_action"], effort:"S" }];
ok(validateIdeas(h, ["slack_canvas"]).valid.length === 0, "disallowed block rejected");

console.log(`catalog blocks: ${CATALOG.length} | PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
