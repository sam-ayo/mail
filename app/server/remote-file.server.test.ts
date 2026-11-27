import { afterEach, describe, expect, it, vi } from "vitest";

// The first calls get fake answers. A call with no fake answer goes to the
// real safe-net code, which blocks private addresses.
const answers: Response[] = [];
vi.mock("./safe-net.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("./safe-net.server")>();
  return {
    ...real,
    safeFetchResponse: vi.fn(async (url: URL, init: Parameters<typeof real.safeFetchResponse>[1]) => {
      const answer = answers.shift();
      return answer ?? real.safeFetchResponse(url, init);
    }),
  };
});

const { downloadFile, filenameOf } = await import("./remote-file.server");
const net = vi.mocked(await import("./safe-net.server"));

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

afterEach(() => {
  answers.length = 0;
  vi.clearAllMocks();
});

describe("downloadFile", () => {
  it("follows a redirect and reads the file", async () => {
    answers.push(
      redirect("/files/report.pdf"),
      new Response("%PDF-1.4", { headers: { "content-type": "application/pdf; qs=0.1" } }),
    );
    const file = await downloadFile("https://example.com/r/1", 1000);
    expect(file).toEqual({ filename: "report.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4") });
    expect(net.safeFetchResponse.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.com/r/1",
      "https://example.com/files/report.pdf",
    ]);
  });

  it("blocks a redirect to a private address", async () => {
    answers.push(redirect("https://127.0.0.1/secret"));
    await expect(downloadFile("https://example.com/r/2", 1000)).rejects.toThrow("not public");
  });

  it("blocks a redirect to http", async () => {
    answers.push(redirect("http://example.com/file.pdf"));
    await expect(downloadFile("https://example.com/r/3", 1000)).rejects.toThrow("must use https");
  });

  it("stops after five redirects", async () => {
    for (let i = 0; i < 6; i++) answers.push(redirect(`/hop${i}`));
    await expect(downloadFile("https://example.com/start", 1000)).rejects.toThrow("too many redirects");
  });

  it("stops at the limit, also without a Content-Length", async () => {
    answers.push(new Response(new Blob([new Uint8Array(2000)]).stream()));
    await expect(downloadFile("https://example.com/big.bin", 1000)).rejects.toThrow("25 MB");
  });

  it("stops at once when the Content-Length is over the limit", async () => {
    answers.push(new Response("x", { headers: { "content-length": "5000" } }));
    await expect(downloadFile("https://example.com/big.bin", 1000)).rejects.toThrow("25 MB");
  });

  it("gives the HTTP status of an error", async () => {
    answers.push(new Response("no", { status: 404 }));
    await expect(downloadFile("https://example.com/missing.pdf", 1000)).rejects.toThrow("HTTP 404");
  });

  it("refuses a URL that is not valid", async () => {
    await expect(downloadFile("not a url", 1000)).rejects.toThrow("not a valid URL");
  });
});

describe("filenameOf", () => {
  const url = new URL("https://example.com/a/b/Quarterly%20Report.pdf?x=1");
  it("uses the RFC 5987 name first", () => {
    expect(filenameOf(`attachment; filename="plain.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`, url)).toBe("Résumé.pdf");
  });
  it("uses the plain name", () => {
    expect(filenameOf('attachment; filename="notes.txt"', url)).toBe("notes.txt");
  });
  it("removes a path from the name", () => {
    expect(filenameOf('attachment; filename="../../etc/passwd"', url)).toBe("passwd");
  });
  it("uses the decoded last part of the path", () => {
    expect(filenameOf(null, url)).toBe("Quarterly Report.pdf");
  });
  it("has a default name", () => {
    expect(filenameOf(null, new URL("https://example.com/"))).toBe("download");
  });
});
