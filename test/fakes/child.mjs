// A serve entry a test can script: FAKE_LINES printed on start, a drain line on SIGTERM or stdin's end.

const lines = JSON.parse(process.env.FAKE_LINES ?? "[]");
for (const line of lines) process.stdout.write(`${typeof line === "string" ? line : JSON.stringify(line)}\n`);

const deaf = process.env.FAKE_IGNORES_SIGTERM === "1";
const leave = (why) => {
  process.stderr.write(`draining · ${why}\n`);
  process.exit(0);
};

if (process.env.FAKE_EXITS !== undefined) process.exit(Number(process.env.FAKE_EXITS));
process.on("SIGTERM", () => (deaf ? undefined : leave("signalled")));
process.stdin.on("end", () => (deaf ? undefined : leave("ended")));
process.stdin.resume();
setInterval(() => undefined, 1000);
