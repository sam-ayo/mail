import { createHash, randomUUID } from "node:crypto";
import type { Address, Folder, Message, ProviderKind, Thread, ThreadAction, ThreadSummary, Unsubscribe } from "~/lib/mail";
import type { Account, DemoCredentials } from "../accounts.server";
import { snippetFromText } from "../util.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderError } from "./types";

// The demo provider keeps sample mail in memory. It shows the app with no
// OAuth setup, and it resets when the server restarts.

type Location = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

interface DemoThread {
  id: string;
  location: Location;
  messages: Message[];
  attachments: Map<string, { filename: string; mimeType: string; data: Buffer }>;
}

interface Seed {
  from: Address;
  subject: string;
  hoursAgo: number;
  body: string;
  html?: string;
  location?: Location;
  unread?: boolean;
  starred?: boolean;
  replies?: { from: Address | "me"; hoursAgo: number; body: string }[];
  attachment?: { filename: string; mimeType: string; content: string };
  /** A List-Unsubscribe header, for mail from a mailing list. */
  unsubscribe?: Unsubscribe;
  /** A fixed Message-ID. Seeds with the same ID in two demo accounts show as one conversation in the unified inbox. */
  shared?: string;
}

const people = {
  maya: { name: "Maya Chen", email: "maya@northwind.io" },
  leo: { name: "Leo Okafor", email: "leo@northwind.io" },
  priya: { name: "Priya Raman", email: "priya.raman@acme.dev" },
  sam: { name: "Sam Rivera", email: "sam@rivera.design" },
  stripe: { name: "Stripe", email: "receipts@stripe.com" },
  github: { name: "GitHub", email: "noreply@github.com" },
  linear: { name: "Linear", email: "notifications@linear.app" },
  figma: { name: "Figma", email: "no-reply@figma.com" },
  airline: { name: "Aurora Airlines", email: "trips@aurora-air.example" },
  newsletter: { name: "The Pragmatic Engineer", email: "hello@pragmaticengineer.example" },
  nora: { name: "Nora Lindqvist", email: "nora@lindqvist.se" },
  hr: { name: "People Team", email: "people@northwind.io" },
  spam: { name: "Crypto Wins", email: "win@totally-legit.example" },
  jordan: { name: "Jordan Morgan", email: "jordan.morgan@fastmail.example" },
  landlord: { name: "Elm Street Lettings", email: "tenants@elmstreet.example" },
  bank: { name: "Harbor Bank", email: "alerts@harborbank.example" },
  club: { name: "Riverside Running Club", email: "hello@riversiderun.example" },
  clinic: { name: "Brightside Dental", email: "appointments@brightside.example" },
  client: { name: "Tomás Herrera", email: "tomas@herrera-coffee.example" },
  gumroad: { name: "Gumroad", email: "sales@gumroad.example" },
  vercel: { name: "Vercel", email: "notifications@vercel.example" },
  coach: { name: "Dana Whitfield", email: "dana@whitfield-coaching.example" },
  school: { name: "Oakridge Evening Classes", email: "enrol@oakridge.example" },
  energy: { name: "Lumen Energy", email: "billing@lumen-energy.example" },
} satisfies Record<string, Address>;

function newsletterHtml(title: string, paragraphs: string[]) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;font-family:Georgia,serif;color:#18181b">
<tr><td style="padding:32px 40px 8px"><p style="margin:0;font:600 12px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7c3aed">Weekly issue</p>
<h1 style="margin:12px 0 0;font-size:28px;line-height:1.2">${title}</h1></td></tr>
${paragraphs.map((p) => `<tr><td style="padding:12px 40px;font-size:17px;line-height:1.6">${p}</td></tr>`).join("")}
<tr><td style="padding:24px 40px 40px"><a href="https://example.com/read" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font:600 14px -apple-system,sans-serif">Read the full issue</a></td></tr>
</table></td></tr></table><img src="https://example.com/open.gif" width="1" height="1" alt=""></body></html>`;
}

function receiptHtml(amount: string, item: string) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1f36">
<h2 style="margin:0 0 4px">Receipt from Northwind Inc.</h2><p style="color:#697386;margin:0 0 24px">Receipt #2041-7781</p>
<table width="100%" style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:8px 0;border-bottom:1px solid #e3e8ee">${item}</td><td align="right" style="border-bottom:1px solid #e3e8ee">${amount}</td></tr>
<tr><td style="padding:8px 0;font-weight:600">Amount paid</td><td align="right" style="font-weight:600">${amount}</td></tr></table>
<p style="color:#697386;font-size:12px;margin-top:24px">Questions? Visit <a href="https://support.stripe.com">support.stripe.com</a>.</p></div>`;
}

// More than one demo account receives these, so the unified
// inbox shows how it merges duplicates.
const LISBON_TRIP: Seed = {
  from: people.airline,
  subject: "Your trip to Lisbon is confirmed ✈️",
  hoursAgo: 50,
  shared: "lisbon-trip",
  body: "Booking reference: QX7P2M\n\nSFO → LIS · Fri 14 Nov · 18:40\nLIS → SFO · Sun 23 Nov · 11:15\n\nCheck in opens 24 hours before departure.",
};

const NORA_COFFEE: Seed = {
  from: people.nora,
  subject: "Coffee next week?",
  hoursAgo: 70,
  shared: "nora-coffee",
  body: "Hej! I'm in town next Tuesday and Wednesday. Would love to catch up over coffee if you're free.\n\n/Nora",
  replies: [
    { from: "me", hoursAgo: 68, body: "Yes! Wednesday morning works. 9:30 at Sightglass?" },
    { from: people.nora, hoursAgo: 66, body: "Perfect, see you there ☕️" },
  ],
};

const SEEDS: Seed[] = [
  {
    from: people.maya,
    subject: "Q4 roadmap review: can you take the inbox section?",
    shared: "q4-roadmap",
    hoursAgo: 0.4,
    unread: true,
    starred: true,
    body: "Hi!\n\nWe're finalising the Q4 roadmap deck for Thursday. Could you own the section on the unified inbox and keyboard-first triage? Ten minutes is plenty.\n\nI've dropped the draft outline in the attachment. Let me know if the timing works.\n\nThanks,\nMaya",
    attachment: {
      filename: "q4-roadmap-outline.md",
      mimeType: "text/markdown",
      content: "# Q4 Roadmap\n\n1. Unified inbox\n2. Keyboard-first triage\n3. Undo send\n4. Snooze and reminders\n",
    },
  },
  {
    from: people.leo,
    subject: "Design crit moved to 3pm",
    hoursAgo: 1.5,
    unread: true,
    body: "Heads up: the design crit moved to 3pm today because of the all-hands. Same room, same link.\n\nLeo",
  },
  {
    from: people.priya,
    subject: "Re: API rate limits for the sync engine",
    hoursAgo: 3,
    unread: true,
    body: "Hey, quick question on the sync engine. Are we batching Gmail history requests, or one per account per minute?",
    replies: [
      {
        from: "me",
        hoursAgo: 2.5,
        body: "We poll history every 60s per account and batch metadata calls 10 at a time. Push notifications are next.",
      },
      {
        from: people.priya,
        hoursAgo: 2,
        body: "Perfect, that's well inside quota. Let's pair on Pub/Sub push next week? I'll send an invite.",
      },
    ],
  },
  {
    from: people.github,
    subject: "[good-email-client] PR #42: Add command palette",
    hoursAgo: 5,
    unsubscribe: { mailto: "mailto:unsub+pr42@reply.github.com?subject=unsubscribe", oneClick: false },
    body: "@sam-rivera approved these changes.\n\nLooks great! The fuzzy matching feels instant. Ship it.\n\n—\nReply to this email directly or view it on GitHub.",
  },
  {
    from: people.linear,
    subject: "ENG-311 assigned to you: Undo send should survive navigation",
    hoursAgo: 7,
    unread: true,
    body: "Maya Chen assigned ENG-311 to you.\n\nUndo send should survive navigation between folders. Currently the timer resets when the route changes.\n\nPriority: High",
  },
  {
    from: people.stripe,
    subject: "Your receipt from Northwind Inc. #2041-7781",
    hoursAgo: 20,
    body: "Receipt from Northwind Inc. Amount paid: $48.00 for Team plan (monthly).",
    html: receiptHtml("$48.00", "Team plan — monthly"),
  },
  {
    from: people.newsletter,
    subject: "How the best teams run incident reviews",
    hoursAgo: 26,
    unsubscribe: { url: "https://pragmaticengineer.example/unsubscribe/8f3k2", oneClick: true },
    body: "This week: blameless reviews, timelines that actually help, and the one question every review should end with.",
    html: newsletterHtml("How the best teams run incident reviews", [
      "Most incident reviews fail for the same reason: they focus on <em>who</em> rather than <em>what</em>. This week we look at teams that turned reviews into their best learning tool.",
      "<strong>1. Write the timeline first.</strong> Before anyone gives an opinion, agree on what happened and when.",
      "<strong>2. End with one question:</strong> what would have made this impossible, not just unlikely?",
    ]),
  },
  {
    from: people.sam,
    subject: "New icon set for the sidebar",
    hoursAgo: 30,
    starred: true,
    body: "Hey! Attached are the refreshed sidebar icons. I went with a 1.5px stroke to match Inter at 14px. Tell me what you think.\n\nSam",
    attachment: {
      filename: "sidebar-icons.svg",
      mimeType: "image/svg+xml",
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60"><rect width="240" height="60" rx="12" fill="#eef2ff"/><circle cx="40" cy="30" r="12" fill="#6366f1"/><rect x="70" y="18" width="24" height="24" rx="6" fill="#ec4899"/><path d="M130 42l12-24 12 24z" fill="#f59e0b"/><rect x="180" y="20" width="36" height="20" rx="10" fill="#10b981"/></svg>',
    },
  },
  LISBON_TRIP,
  NORA_COFFEE,
  {
    from: people.figma,
    subject: "Sam Rivera commented on Email Client — Inbox v3",
    hoursAgo: 80,
    body: "Sam Rivera: \"Can we try the unread dot on the left edge instead of bolding? Feels calmer.\"",
  },
  {
    from: people.hr,
    subject: "Open enrolment closes Friday",
    hoursAgo: 120,
    location: "archive",
    body: "Reminder: benefits open enrolment closes this Friday at 5pm. Changes after that wait until next year.",
  },
  {
    from: people.leo,
    subject: "Offsite photos 📸",
    hoursAgo: 200,
    location: "archive",
    body: "Uploaded all the offsite photos to the shared drive. The sunset ones came out great.",
  },
  {
    from: people.spam,
    subject: "You've been selected!!! Claim 10 BTC now",
    hoursAgo: 15,
    location: "spam",
    body: "Congratulations winner! Click here to claim your prize before it expires.",
  },
  {
    from: people.github,
    subject: "[good-email-client] CI failed on main",
    hoursAgo: 150,
    location: "trash",
    body: "The build failed on main. typecheck: 2 errors.",
  },
];

// Realistic worst-case data from the break-ui catalog. It is a regression
// fixture for the layout: long names, unbreakable emails, one-letter names,
// emoji, right-to-left text, missing fields, and long file names.
const WORST_SEEDS: Seed[] = [
  {
    from: { name: "Aleksandra Wiśniewska-Kowalczyk", email: "aleksandra.wisniewska-kowalczyk@example.com" },
    subject:
      "Re: Q3 Board Deck — FINAL (revised) v12 [approved by legal] — please review the Benachrichtigungseinstellungen section before Thursday's all-hands",
    hoursAgo: 0.1,
    unread: true,
    starred: true,
    body: "Line one\nLine two\n\n" + "This paragraph is long on purpose. ".repeat(60),
    attachment: {
      filename: "Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf",
      mimeType: "text/plain",
      content: "Board deck placeholder",
    },
  },
  {
    from: { email: "bartholomew.fitzgerald@northwind-industries-holdings.example.com" },
    subject: "",
    hoursAgo: 0.5,
    unread: true,
    body: "",
  },
  {
    from: { name: "Jo", email: "a@b.co" },
    subject: "ok",
    hoursAgo: 1,
    body: "k",
  },
  {
    from: { name: "🦊 Fox", email: "fox@example.org" },
    subject: "👩🏽‍💻 Priya joined the workspace",
    hoursAgo: 2,
    body: "Say hi 👋",
  },
  {
    from: { name: "نور الهدى عبد الرحمن", email: "noor@example.com" },
    subject: "مرحبا، هل يمكننا تحديد موعد للاجتماع؟",
    hoursAgo: 3,
    unread: true,
    body: "مرحبا، هل يمكننا تحديد موعد للاجتماع الأسبوع القادم؟",
  },
  {
    from: { name: "王秀英", email: "wang.xiuying@example.com" },
    subject: "季度报告",
    hoursAgo: 4,
    body: "请查看附件中的季度报告。",
    attachment: {
      filename: "IMG_20250914_183022_HDR_portrait_edited_edited.HEIC",
      mimeType: "application/octet-stream",
      content: "binary",
    },
  },
  {
    from: { name: "Christopher Alexander Montgomery III", email: "first.last+billing-notifications@example.com" },
    subject: "<script>alert(1)</script> &amp; **bold**",
    hoursAgo: 5,
    body: "Escaping test: <b>not bold</b> &amp; **not bold**",
    replies: Array.from({ length: 11 }, (_, i) => ({
      from: i % 2 ? ("me" as const) : { name: `Đặng Thị Ngọc Hân ${i}`, email: `user${i}@sub.department.region.example.co.uk` },
      hoursAgo: 4.9 - i * 0.1,
      body: `Reply ${i + 1}`,
    })),
  },
  {
    from: { name: "  Sam   Lee ", email: "sam.lee@example.com" },
    subject: "Senior Product Design Engineer, Platform Infrastructure — Paramètres de confidentialité et de sécurité",
    hoursAgo: 30,
    body: "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved",
  },
];

const PERSONAL_SEEDS: Seed[] = [
  {
    from: people.jordan,
    subject: "Mum's birthday dinner on Saturday",
    hoursAgo: 0.8,
    unread: true,
    body: "Hey,\n\nI booked a table at Lucia's for 7pm on Saturday. Can you pick up the cake on the way? I'll get the flowers.\n\nJ",
    replies: [
      { from: "me", hoursAgo: 0.6, body: "Yes, I'll get the cake. Chocolate or lemon?" },
      { from: people.jordan, hoursAgo: 0.5, body: "Lemon. She said chocolate last year and regretted it 😄" },
    ],
  },
  {
    from: people.landlord,
    subject: "Boiler service visit: Thursday 10am–12pm",
    hoursAgo: 4,
    unread: true,
    body: "Hello,\n\nOur engineer will service the boiler on Thursday between 10am and 12pm. Please make sure someone is home, or reply to arrange a key.\n\nElm Street Lettings",
  },
  {
    from: people.bank,
    subject: "Your October statement is ready",
    hoursAgo: 22,
    body: "Your statement for October is ready to view in online banking. Closing balance: $2,481.17.",
  },
  {
    from: people.club,
    subject: "Sunday long run: new route along the river",
    hoursAgo: 34,
    starred: true,
    unsubscribe: { url: "https://riversiderun.example/preferences", oneClick: false },
    body: "Morning runners!\n\nThis Sunday we try the new 16 km route along the river path. We meet at the boathouse at 8am. Pace groups as usual.\n\nThe route map is attached.",
    attachment: {
      filename: "river-route.gpx",
      mimeType: "application/gpx+xml",
      content: '<?xml version="1.0"?><gpx version="1.1" creator="demo"><trk><name>River route</name></trk></gpx>',
    },
  },
  LISBON_TRIP,
  NORA_COFFEE,
  {
    from: people.clinic,
    subject: "Reminder: check-up on 4 November",
    hoursAgo: 96,
    location: "archive",
    body: "This is a reminder of your dental check-up on 4 November at 2:30pm. Reply C to cancel.",
  },
];

const STUDIO_SEEDS: Seed[] = [
  {
    from: people.client,
    subject: "Logo round 2: feedback",
    hoursAgo: 0.3,
    unread: true,
    starred: true,
    body: "Hi Alex,\n\nWe love option B. Could you try it in the darker green from the menu boards, and a version without the bean?\n\nNo rush, end of next week is fine.\n\nTomás",
  },
  {
    from: people.gumroad,
    subject: "You made a sale! Inbox Zero Notion template",
    hoursAgo: 6,
    unread: true,
    body: "Someone bought Inbox Zero Notion template for $12. You have made 38 sales this month.",
  },
  {
    from: people.vercel,
    subject: "Deployment ready: studio-site (production)",
    hoursAgo: 12,
    body: "Your deployment of studio-site to production is ready.\n\nCommit: Update case studies page",
  },
  {
    from: people.client,
    subject: "Invoice #0007",
    hoursAgo: 140,
    location: "archive",
    body: "Paid, thanks! See you for round 2.",
  },
];

const OUTLOOK_SEEDS: Seed[] = [
  {
    from: people.coach,
    subject: "Your plan for next week",
    hoursAgo: 1.5,
    unread: true,
    body: "Hi Alex,\n\nGreat session today. Next week: three runs, one strength day, and a proper rest day on Friday.\n\nThe full plan is attached.\n\nDana",
    attachment: { filename: "week-12-plan.txt", mimeType: "text/plain", content: "Mon: easy 5 km\nWed: strength\nThu: intervals\nFri: rest\nSun: long run 14 km" },
    replies: [{ from: "me", hoursAgo: 1, body: "Thanks Dana! Can we move strength to Tuesday?" }],
  },
  {
    from: people.school,
    subject: "Your place on Beginner Spanish is confirmed",
    hoursAgo: 9,
    unread: true,
    unsubscribe: { url: "https://oakridge.example/preferences", oneClick: false },
    body: "Thanks for enrolling. Classes start on Tuesday 5 November at 7pm in Room 4. Bring a notebook. We supply the rest.",
  },
  {
    from: people.energy,
    subject: "Your bill for October: $64.20",
    hoursAgo: 28,
    body: "Your October bill is $64.20. We will take the payment by direct debit on 1 November.",
  },
  NORA_COFFEE,
  {
    from: people.airline,
    subject: "Check in now for your flight to Oslo",
    hoursAgo: 50,
    starred: true,
    body: "Online check-in is open for flight AU 214 to Oslo. Boarding starts at 8:40am from gate B12.",
  },
];

/**
 * Each new demo account gets the next persona, so several demo accounts look like different mailboxes.
 * A persona with an `email` and a `look` looks like a real account, for screenshots and screen recordings.
 */
export const DEMO_PERSONAS: {
  label: string;
  title: string;
  name: string;
  domain: string;
  email?: string;
  look?: ProviderKind;
  seeds: Seed[];
}[] = [
  { label: "work", title: "Custom domain", name: "Alex Morgan", domain: "northwind.io", email: "alex@northwind.io", look: "imap", seeds: SEEDS },
  { label: "personal", title: "Gmail", name: "Alex Morgan", domain: "gmail.com", email: "alex.morgan@gmail.com", look: "google", seeds: PERSONAL_SEEDS },
  { label: "studio", title: "Studio", name: "Alex Morgan Studio", domain: "studio.demo", seeds: STUDIO_SEEDS },
  { label: "outlook", title: "Outlook", name: "Alex Morgan", domain: "outlook.com", email: "alex.morgan@outlook.com", look: "microsoft", seeds: OUTLOOK_SEEDS },
];

function personaOf(account: Account) {
  const index = (account.credentials as DemoCredentials).persona ?? 0;
  return DEMO_PERSONAS[index % DEMO_PERSONAS.length];
}

const SENT_SEEDS = [
  {
    to: people.maya,
    subject: "Notes from the user interviews",
    hoursAgo: 40,
    body: "Hi Maya,\n\nSummary: everyone wants faster triage and a reliable undo. Two people asked for split inboxes by sender type.\n\nFull notes are in the doc.",
  },
  {
    to: people.sam,
    subject: "Re: Brand colours",
    hoursAgo: 90,
    body: "Love the indigo. Let's keep pink for account accents only.",
  },
];

// Keep the sample mail across Vite reloads in development.
const globalDemo = globalThis as unknown as { __demoStores?: Map<string, Map<string, DemoThread>> };
const stores = (globalDemo.__demoStores ??= new Map<string, Map<string, DemoThread>>());

export type DemoDataset = "demo" | "worst";

const globalDatasets = globalThis as unknown as { __demoDatasets?: Map<string, DemoDataset> };
const datasets = (globalDatasets.__demoDatasets ??= new Map<string, DemoDataset>());

/** Development only: swap the sample mail for an account, and reseed it. */
export function setDemoDataset(accountId: string, dataset: DemoDataset) {
  datasets.set(accountId, dataset);
  stores.delete(accountId);
}

export function getDemoDataset(accountId: string): DemoDataset {
  return datasets.get(accountId) ?? "demo";
}

// Each server instance seeds its own copy of the sample mail. The IDs come
// from the account ID, so a list from one instance opens on another.
function seededIds(accountId: string) {
  let count = 0;
  return () => {
    const hex = createHash("sha256").update(`${accountId}:${count++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}

function seed(account: Account) {
  const nextId = seededIds(account.id);
  const me: Address = { name: account.name || "You", email: account.email };
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
  const threads = new Map<string, DemoThread>();

  const makeMessage = (
    threadId: string,
    from: Address,
    to: Address[],
    subject: string,
    hoursAgo: number,
    body: string,
    html?: string,
    messageIdHeader = `<${nextId()}@demo.local>`,
  ): Message => ({
    id: nextId(),
    threadId,
    from,
    to,
    cc: [],
    bcc: [],
    replyTo: [],
    subject,
    date: at(hoursAgo),
    snippet: snippetFromText(body),
    text: body,
    html,
    unread: false,
    starred: false,
    attachments: [],
    messageIdHeader,
  });

  const worst = getDemoDataset(account.id) === "worst";
  const persona = personaOf(account);
  (worst ? WORST_SEEDS : persona.seeds).forEach((s) => {
    const id = nextId();
    const shared = s.shared ? `<seed-${s.shared}@demo.local>` : undefined;
    const first = makeMessage(id, s.from, [me], s.subject, s.hoursAgo, s.body, s.html, shared);
    first.unsubscribe = s.unsubscribe;
    const thread: DemoThread = {
      id,
      location: s.location ?? "inbox",
      messages: [first],
      attachments: new Map(),
    };
    if (s.attachment) {
      const attachmentId = nextId();
      const data = Buffer.from(s.attachment.content);
      thread.attachments.set(attachmentId, { ...s.attachment, data });
      first.attachments.push({
        id: attachmentId,
        filename: s.attachment.filename,
        mimeType: s.attachment.mimeType,
        size: data.length,
        inline: false,
      });
    }
    for (const reply of s.replies ?? []) {
      const from = reply.from === "me" ? me : reply.from;
      const to = reply.from === "me" ? [s.from] : [me];
      thread.messages.push(makeMessage(id, from, to, `Re: ${s.subject.replace(/^Re: /, "")}`, reply.hoursAgo, reply.body));
    }
    const last = thread.messages[thread.messages.length - 1];
    last.unread = !!s.unread;
    last.starred = !!s.starred;
    threads.set(id, thread);
  });

  for (const s of worst || persona.seeds !== SEEDS ? [] : SENT_SEEDS) {
    const id = nextId();
    threads.set(id, {
      id,
      location: "sent",
      messages: [makeMessage(id, me, [s.to], s.subject, s.hoursAgo, s.body)],
      attachments: new Map(),
    });
  }
  return threads;
}

function store(account: Account) {
  let threads = stores.get(account.id);
  if (!threads) {
    threads = seed(account);
    stores.set(account.id, threads);
  }
  return threads;
}

function matches(thread: DemoThread, folder: Folder, myEmail: string) {
  switch (folder) {
    case "starred":
      return thread.messages.some((m) => m.starred) && thread.location !== "trash";
    case "sent":
      return thread.location !== "trash" && thread.messages.some((m) => m.from.email === myEmail);
    default:
      return thread.location === folder;
  }
}

export function createDemoProvider(account: Account): MailProvider {
  const threads = store(account);
  const me: Address = { name: account.name || "You", email: account.email };

  function find(threadId: string) {
    const thread = threads.get(threadId);
    if (!thread) throw new ProviderError("Conversation not found", 404);
    return thread;
  }

  function summarize(thread: DemoThread, folder: Folder): ThreadSummary {
    const last = thread.messages[thread.messages.length - 1];
    const people =
      folder === "sent"
        ? thread.messages.flatMap((m) => m.to)
        : thread.messages.map((m) => m.from);
    const seen = new Set<string>();
    return {
      accountId: account.id,
      id: thread.id,
      subject: thread.messages[0].subject || "(no subject)",
      snippet: last.snippet,
      participants: people.filter((p) => !seen.has(p.email) && seen.add(p.email)),
      date: last.date,
      unread: thread.messages.some((m) => m.unread),
      starred: thread.messages.some((m) => m.starred),
      messageCount: thread.messages.length,
      hasAttachments: thread.messages.some((m) => m.attachments.length > 0),
      messageIds: thread.messages.flatMap((m) => (m.messageIdHeader ? [m.messageIdHeader] : [])),
    };
  }

  return {
    async listThreads({ folder, query, cursor, limit }: ListOptions): Promise<ThreadPage> {
      const needle = query?.toLowerCase();
      const all = [...threads.values()]
        .filter((thread) => matches(thread, folder, account.email))
        .filter(
          (thread) =>
            !needle ||
            thread.messages.some((m) =>
              [m.subject, m.text ?? "", m.from.email, m.from.name ?? ""].some((field) =>
                field.toLowerCase().includes(needle),
              ),
            ),
        )
        .map((thread) => summarize(thread, folder))
        .sort((a, b) => b.date.localeCompare(a.date));
      const offset = Number(cursor) || 0;
      const next = offset + limit;
      return {
        threads: all.slice(offset, next),
        nextCursor: next < all.length ? String(next) : undefined,
      };
    },

    async getThread(threadId: string): Promise<Thread> {
      const thread = find(threadId);
      const messages = structuredClone(thread.messages);
      return {
        accountId: account.id,
        id: thread.id,
        subject: messages[0].subject || "(no subject)",
        messages,
        starred: messages.some((m) => m.starred),
        unread: messages.some((m) => m.unread),
      };
    },

    async modifyThread(threadId: string, action: ThreadAction) {
      const thread = find(threadId);
      const last = thread.messages[thread.messages.length - 1];
      switch (action) {
        case "archive":
        case "trash":
        case "spam":
          thread.location = action;
          break;
        case "inbox":
          thread.location = "inbox";
          break;
        case "star":
          last.starred = true;
          break;
        case "unstar":
          thread.messages.forEach((m) => (m.starred = false));
          break;
        case "read":
          thread.messages.forEach((m) => (m.unread = false));
          break;
        case "unread":
          last.unread = true;
          break;
      }
    },

    async send(message: OutgoingMessage) {
      const existing =
        message.reply?.kind === "reply" ? threads.get(message.reply.threadId) : undefined;
      const id = existing?.id ?? randomUUID();
      const thread: DemoThread = existing ?? {
        id,
        location: "sent",
        messages: [],
        attachments: new Map(),
      };
      const sent: Message = {
        id: randomUUID(),
        threadId: id,
        from: me,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: [],
        subject: message.subject,
        date: new Date().toISOString(),
        snippet: snippetFromText(message.text),
        text: message.text,
        html: message.html,
        unread: false,
        starred: false,
        attachments: [],
        messageIdHeader: `<${randomUUID()}@demo.local>`,
      };
      for (const attachment of message.attachments) {
        const attachmentId = randomUUID();
        thread.attachments.set(attachmentId, {
          filename: attachment.filename,
          mimeType: attachment.contentType,
          data: attachment.content,
        });
        sent.attachments.push({
          id: attachmentId,
          filename: attachment.filename,
          mimeType: attachment.contentType,
          size: attachment.content.length,
          inline: false,
        });
      }
      thread.messages.push(sent);
      threads.set(id, thread);

      // A message to yourself arrives in the inbox, so you can try the full loop.
      const toSelf = [...message.to, ...message.cc].some(
        (a) => a.email.toLowerCase() === account.email.toLowerCase(),
      );
      if (toSelf && !existing) {
        const copyId = randomUUID();
        threads.set(copyId, {
          id: copyId,
          location: "inbox",
          messages: [{ ...structuredClone(sent), id: randomUUID(), threadId: copyId, unread: true }],
          attachments: new Map(thread.attachments),
        });
      }
    },

    async getAttachment(messageId: string, attachmentId: string) {
      for (const thread of threads.values()) {
        if (!thread.messages.some((m) => m.id === messageId)) continue;
        const attachment = thread.attachments.get(attachmentId);
        if (attachment) return attachment;
      }
      throw new ProviderError("Attachment not found", 404);
    },

    async inboxUnreadCount() {
      return [...threads.values()].filter(
        (thread) => thread.location === "inbox" && thread.messages.some((m) => m.unread),
      ).length;
    },
  };
}

export function resetDemoAccount(accountId: string) {
  stores.delete(accountId);
}
