import { execFileSync } from "node:child_process";
import { platform } from "node:os";

function isAppInstalled(appName: string): boolean {
  const command = platform() === "win32" ? "where" : "which";
  try {
    execFileSync(command, [appName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Compares dotted version numbers part by part, so "1.18.3" is newer than "1.9.9".
function isVersionAtLeast(version: string, minimum: string): boolean {
  const actual = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  for (let i = 0; i < required.length; i++) {
    const a = actual[i] ?? 0;
    const r = required[i] ?? 0;
    if (a !== r) return a > r;
  }
  return true;
}

export { isAppInstalled, isVersionAtLeast };
