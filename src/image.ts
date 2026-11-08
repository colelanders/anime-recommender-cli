import { execFileSync, spawn } from "node:child_process";
import { isAppInstalled, isVersionAtLeast } from "./utils.js";

const chafaName = "chafa";

export const MIN_CHAFA_VERSION = "1.18.3";

export class ImageError extends Error {
  override name = "ImageError";
}

export function checkChafa(): void {
  if (!isAppInstalled(chafaName)) {
    throw new ImageError(
      `${chafaName} is not installed. Check README.md for installation instructions.`,
    );
  }

  const output = execFileSync(chafaName, ["--version"], { encoding: "utf8" });
  const version = /\d+(?:\.\d+)+/.exec(output)?.[0];
  if (version === undefined) {
    throw new ImageError(
      `Couldn't read the ${chafaName} version. ${MIN_CHAFA_VERSION} or later is required.`,
    );
  }
  if (!isVersionAtLeast(version, MIN_CHAFA_VERSION)) {
    throw new ImageError(
      `${chafaName} ${version} is installed, but ${MIN_CHAFA_VERSION} or later is required.`,
    );
  }
}

export async function displayImageFromUrl(url: string): Promise<void> {
  checkChafa();

  const response = await fetch(url);
  if (!response.ok) {
    throw new ImageError(`Couldn't download ${url} (HTTP ${response.status}).`);
  }
  const image = Buffer.from(await response.arrayBuffer());

  // The image goes to chafa on stdin, so the URL never reaches a shell.
  await new Promise<void>((resolve, reject) => {
    const chafa = spawn(chafaName, ["-"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    chafa.on("error", reject);
    chafa.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new ImageError(`${chafaName} exited with code ${code}.`));
    });
    chafa.stdin.end(image);
  });
}
