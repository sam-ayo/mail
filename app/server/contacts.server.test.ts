import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, ThreadSummary } from "~/lib/mail";

vi.mock("./accounts.server", () => ({ listAccounts: vi.fn(async () => [{ id: "acc-1", email: "me@acme.com" }]) }));
vi.mock("./mail.server", () => ({ listThreads: vi.fn() }));

const mail = vi.mocked(await import("./mail.server"));
const { findContacts, listContacts } = await import("./contacts.server");

const thread = (...people: { name?: string; email: string }[]) => ({ participants: people }) as ThreadSummary;
// The recent mail of each folder, and what a search finds.
const recent: Partial<Record<Folder, ThreadSummary[]>> = {
  sent: [thread({ email: "me@acme.com" }, { name: "Carol Diaz", email: "carol@acme.com" })],
  inbox: [
    thread({ name: "Ada Lovelace", email: "ada@acme.com" }),
    thread({ name: "Robot", email: "no-reply@shop.com" }),
    thread({ name: "Ada L.", email: "ada@acme.com" }, { name: "Bob", email: "bob@acme.com" }),
  ],
  archive: [],
};
const searched: Partial<Record<Folder, ThreadSummary[]>> = {
  inbox: [thread({ name: "Ada Byron", email: "ada.byron@old.com" }, { name: "Bob", email: "bob@acme.com" })],
};

beforeEach(() => {
  mail.listThreads.mockImplementation(async (_user, options) => ({
    threads: (options.query ? searched : recent)[options.folder] ?? [],
    errors: [],
  }));
});

describe("listContacts", () => {
  it("counts each person, weighs Sent, and leaves out the user and no-reply addresses", async () => {
    expect(await listContacts("user-1")).toEqual([
      { email: "carol@acme.com", name: "Carol Diaz", count: 3 },
      { email: "ada@acme.com", name: "Ada Lovelace", count: 2 },
      { email: "bob@acme.com", name: "Bob", count: 1 },
    ]);
  });
});

describe("findContacts", () => {
  it("matches the recent people and the people that the search finds", async () => {
    expect(await findContacts("user-1", "ada")).toEqual([
      { email: "ada@acme.com", name: "Ada Lovelace", count: 2 },
      { email: "ada.byron@old.com", name: "Ada Byron", count: 1 },
    ]);
  });

  it("needs each word to match", async () => {
    expect((await findContacts("user-1", "ada byron")).map((c) => c.email)).toEqual(["ada.byron@old.com"]);
  });

  it("matches a part of an address", async () => {
    expect((await findContacts("user-1", "acme.com")).map((c) => c.email)).toEqual([
      "carol@acme.com",
      "ada@acme.com",
      "bob@acme.com",
    ]);
  });

  it("finds a person only in recent mail when the search finds nothing", async () => {
    expect((await findContacts("user-1", "carol")).map((c) => c.email)).toEqual(["carol@acme.com"]);
  });
});
