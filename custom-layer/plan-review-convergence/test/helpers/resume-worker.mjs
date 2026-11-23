import { reserveManual } from "../../owner-resume.mjs";

const args = JSON.parse(process.argv[2]);
try {
  const result = reserveManual(args);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  process.exitCode = 1;
}
