import { isAppInstalled } from "./utils.js";

const chafaName = "chafa";
const chafaInstalled = isAppInstalled(chafaName);

if (!chafaInstalled) {
  console.log(
    `${chafaName} is not installed. Check README.md for installation instructions.`,
  );

  process.exit(1);
}

export async function displayImageFromUrl(url: string) {
  const { execSync } = await import("child_process");
  execSync(`curl -s ${url} | ${chafaName} -`, {
    stdio: "inherit",
  });
}
