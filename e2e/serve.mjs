// npm run e2e:serve
// Starts the stack and leaves it running, so tests (or you, in a browser at the printed address)
// can be run against it again and again:   node --test e2e/vouchers.test.mjs
// Ctrl-C stops it. Each test file reseeds the database itself.
import { BASE_URL, startStack } from "./stack.mjs";

const stack = await startStack();
console.log(`Ready at ${BASE_URL} — sign in as owner@e2e.test / e2e-Password-1. Ctrl-C to stop.`);
const bye = () => { stack.stop(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
setInterval(() => {}, 1 << 30);
