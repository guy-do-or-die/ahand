/**
 * A gate over a plan of shell lines, ended the way infra/gate/gate.ts ends: the tests run it as a
 * program to see what a reader of its output and a sender of signals see.
 *
 *   bun infra/gate/tests/plan.ts '{"first":[["a","true"]],"lanes":[[["b","sleep 1"]]],"last":[]}'
 */
import { exitCodeOf, runPlan, stopOnSignals, type Step } from "../gate.ts";

type Line = [name: string, line: string];
const plan = JSON.parse(process.argv[2]) as { first: Line[]; lanes: Line[][]; last: Line[] };
const step = ([name, line]: Line): Step => ({ name, command: "bash", args: ["-c", line] });

stopOnSignals();
process.exitCode = exitCodeOf(await runPlan({ first: plan.first.map(step), lanes: plan.lanes.map((lane) => lane.map(step)), last: plan.last.map(step) }));
