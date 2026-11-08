import { execSync } from "child_process";
import os from "os";

function isAppInstalled(appName: string): boolean {
  const isWin = os.platform() === "win32";
  const command = isWin ? `where ${appName}` : `which ${appName}`;
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export { isAppInstalled };
