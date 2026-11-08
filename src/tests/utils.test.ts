import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { isAppInstalled, isVersionAtLeast } from "../utils.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn<typeof import("node:child_process").execFileSync>(),
}));
vi.mock("node:os", () => ({
  platform: vi.fn<typeof import("node:os").platform>(() => "darwin"),
}));

beforeEach(() => {
  vi.mocked(execFileSync).mockReset();
  vi.mocked(platform).mockReturnValue("darwin");
});

describe("isAppInstalled", () => {
  test("returns true when the app is found on PATH", () => {
    expect(isAppInstalled("chafa")).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith("which", ["chafa"], {
      stdio: "ignore",
    });
  });

  test("returns false when the lookup fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(isAppInstalled("chafa")).toBe(false);
  });

  test("uses where on Windows", () => {
    vi.mocked(platform).mockReturnValue("win32");

    isAppInstalled("chafa");

    expect(execFileSync).toHaveBeenCalledWith("where", ["chafa"], {
      stdio: "ignore",
    });
  });

  test("passes the app name as an argument, not through a shell", () => {
    isAppInstalled("chafa; rm -rf ~");

    expect(execFileSync).toHaveBeenCalledWith(
      "which",
      ["chafa; rm -rf ~"],
      { stdio: "ignore" },
    );
  });
});

describe("isVersionAtLeast", () => {
  test.each([
    ["1.18.3", "1.18.3", true],
    ["1.18.4", "1.18.3", true],
    ["1.19.0", "1.18.3", true],
    ["2.0.0", "1.18.3", true],
    ["1.18.2", "1.18.3", false],
    ["1.9.9", "1.18.3", false],
    ["0.20.0", "1.18.3", false],
    ["1.18", "1.18.3", false],
    ["1.18.3.1", "1.18.3", true],
  ])("%s is at least %s: %s", (version, minimum, expected) => {
    expect(isVersionAtLeast(version, minimum)).toBe(expected);
  });
});
