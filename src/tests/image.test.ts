import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ImageError,
  MIN_CHAFA_VERSION,
  checkChafa,
  displayImageFromUrl,
} from "../image.js";
import { isAppInstalled } from "../utils.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn<typeof import("node:child_process").execFileSync>(),
  spawn: vi.fn<typeof import("node:child_process").spawn>(),
}));
vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  isAppInstalled: vi.fn<typeof isAppInstalled>(() => true),
}));

const imageUrl = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/1.jpg";

class FakeChild extends EventEmitter {
  stdin = { end: vi.fn<(chunk: Buffer) => void>() };
}

// Returns a fake chafa process that exits with `exitCode` once its input ends.
function stubChafaProcess(exitCode = 0) {
  const child = new FakeChild();
  child.stdin.end.mockImplementation(() => {
    setImmediate(() => child.emit("close", exitCode));
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

function stubFetch(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

beforeEach(() => {
  vi.mocked(isAppInstalled).mockReturnValue(true);
  vi.mocked(execFileSync).mockReset();
  vi.mocked(execFileSync).mockReturnValue(
    `Chafa version ${MIN_CHAFA_VERSION}\n`,
  );
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkChafa", () => {
  test("passes when a supported version is installed", () => {
    expect(() => checkChafa()).not.toThrow();
    expect(execFileSync).toHaveBeenCalledWith("chafa", ["--version"], {
      encoding: "utf8",
    });
  });

  test("throws when chafa isn't installed", () => {
    vi.mocked(isAppInstalled).mockReturnValue(false);

    expect(() => checkChafa()).toThrow(ImageError);
    expect(() => checkChafa()).toThrow(
      "chafa is not installed. Check README.md for installation instructions.",
    );
  });

  test("throws when the installed version is too old", () => {
    vi.mocked(execFileSync).mockReturnValue("Chafa version 1.14.0\n");

    expect(() => checkChafa()).toThrow(
      `chafa 1.14.0 is installed, but ${MIN_CHAFA_VERSION} or later is required.`,
    );
  });

  test("throws when the version can't be read", () => {
    vi.mocked(execFileSync).mockReturnValue("something unexpected\n");

    expect(() => checkChafa()).toThrow(
      `Couldn't read the chafa version. ${MIN_CHAFA_VERSION} or later is required.`,
    );
  });
});

describe("displayImageFromUrl", () => {
  test("downloads the image and pipes it to chafa without a shell", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchStub = stubFetch(new Response(bytes));
    const child = stubChafaProcess();

    await displayImageFromUrl(imageUrl);

    expect(fetchStub).toHaveBeenCalledWith(imageUrl);
    expect(spawn).toHaveBeenCalledWith("chafa", ["-"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    expect(child.stdin.end).toHaveBeenCalledWith(Buffer.from(bytes));
  });

  test("checks chafa before downloading", async () => {
    vi.mocked(isAppInstalled).mockReturnValue(false);
    const fetchStub = stubFetch(new Response("image"));

    await expect(displayImageFromUrl(imageUrl)).rejects.toThrow(ImageError);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("throws when the download fails", async () => {
    stubFetch(new Response("missing", { status: 404 }));

    await expect(displayImageFromUrl(imageUrl)).rejects.toThrow(
      `Couldn't download ${imageUrl} (HTTP 404).`,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  test("throws when chafa exits with an error", async () => {
    stubFetch(new Response("image"));
    stubChafaProcess(2);

    await expect(displayImageFromUrl(imageUrl)).rejects.toThrow(
      "chafa exited with code 2.",
    );
  });

  test("throws when chafa can't be started", async () => {
    stubFetch(new Response("image"));
    const child = new FakeChild();
    child.stdin.end.mockImplementation(() => {
      setImmediate(() => child.emit("error", new Error("spawn chafa EACCES")));
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    await expect(displayImageFromUrl(imageUrl)).rejects.toThrow(
      "spawn chafa EACCES",
    );
  });
});
