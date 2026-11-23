import { reserve } from "../../state.mjs";

const args = JSON.parse(process.argv[2]);
try {
  const result = reserve(args);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  process.exitCode = 1;
}
