import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatRecipients,
  insertRecipient,
  isEmail,
  lastRecipient,
  parseAddressList,
  suggestContacts,
  type Address,
  type Contact,
} from "~/lib/mail";
import { Warning, X } from "./icons";
import { Avatar, cx } from "./ui";

/** The list of people loads again after this time, so new mail gives new suggestions. */
const CONTACTS_MAX_AGE = 10 * 60 * 1000;
let contactsCache: { promise: Promise<Contact[]>; time: number } | null = null;

/** The people in the recent mail of the person. All composers share one request. */
function loadContacts() {
  if (!contactsCache || Date.now() - contactsCache.time > CONTACTS_MAX_AGE) {
    const promise = fetch("/api/contacts")
      .then((response) => (response.ok ? response.json() : { contacts: [] }))
      .then((data: { contacts?: Contact[] }) => data.contacts ?? [])
      .catch(() => {
        // A failed request loads again at the next focus.
        contactsCache = null;
        return [];
      });
    contactsCache = { promise, time: Date.now() };
  }
  return contactsCache.promise;
}

/**
 * The people for the suggestions. The recent people load at the first focus.
 * A mail search for the text finds people in older mail. The search starts
 * after a short pause in the typing.
 */
function useContacts(text: string, active: boolean) {
  const [recent, setRecent] = useState<Contact[]>([]);
  const [searched, setSearched] = useState<Contact[]>([]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadContacts().then((contacts) => current && setRecent(contacts));
    return () => {
      current = false;
    };
  }, [active]);
  useEffect(() => {
    if (!active || text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { contacts: [] }))
        .then((data: { contacts?: Contact[] }) => setSearched(data.contacts ?? []))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, active]);
  return useMemo(() => {
    // Both lists can have a person. The larger count is the better one.
    const people = new Map<string, Contact>();
    for (const contact of [...recent, ...searched]) {
      const known = people.get(contact.email);
      people.set(contact.email, {
        ...contact,
        name: known?.name ?? contact.name,
        count: Math.max(known?.count ?? 0, contact.count),
      });
    }
    return [...people.values()];
  }, [recent, searched]);
}

interface RecipientInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "ref" | "defaultValue"> {
  value: string;
  onChange(value: string): void;
  /** The addresses in the other recipient fields. They do not show as suggestions. */
  exclude?: string[];
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * A field for a list of addresses. Each complete address shows as a chip with
 * the avatar of the person, and a chip is red if the address is not valid. As
 * the person types, people from their mail show below the field. A pick puts
 * the person in place of the text that the person typed after the last comma.
 */
export function RecipientInput({
  value,
  onChange,
  exclude = [],
  ref,
  className,
  placeholder,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: RecipientInputProps) {
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { start, text } = lastRecipient(value);
  // The text after the last comma stays text while the person types it. It becomes a chip when the focus leaves.
  const head = focused ? value.slice(0, start) : value;
  const typed = focused ? value.slice(start).trimStart() : "";
  const chips = useMemo(() => parseAddressList(head), [head]);
  const contacts = useContacts(text, active);
  const items = useMemo(() => {
    const present = [...exclude, ...parseAddressList(value.slice(0, start)).map((a) => a.email)];
    return suggestContacts(contacts, text, present);
  }, [contacts, text, value, start, exclude]);
  const highlighted = useRef<Contact | undefined>(undefined);

  function pick(contact: Contact) {
    onChange(insertRecipient(value, contact));
  }

  /** Makes a chip of the text that the person typed. */
  function commit() {
    if (text) onChange(formatRecipients(parseAddressList(value)));
  }

  /** The text of the field after the person typed or pasted `next` after the chips. */
  function withTyped(next: string) {
    const before = value.slice(0, start);
    const addresses = parseAddressList(next);
    const valid = addresses.length > 0 && addresses.every((address) => isEmail(address.email));
    // Pasted addresses become chips at once. A space after a complete address makes the chip, as a comma does.
    const pasted = next.length - typed.length > 1;
    const spaced = /\s$/.test(next) && !/\s/.test(next.trim());
    if (valid && (pasted || spaced)) return before + formatRecipients(addresses);
    const cut = lastRecipient(next).start;
    if (cut === 0) return before + next;
    return before + formatRecipients(parseAddressList(next.slice(0, cut))) + next.slice(cut).trimStart();
  }

  function remove(index: number) {
    onChange(formatRecipients(chips.filter((_, i) => i !== index)) + typed);
    inputRef.current?.focus();
  }

  return (
    <Autocomplete.Root
      items={items}
      mode="none"
      autoHighlight
      value={typed}
      itemToStringValue={(contact: Contact) => contact.email}
      onOpenChange={setOpen}
      onItemHighlighted={(contact) => {
        highlighted.current = contact;
      }}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") {
          const contact = items.find((c) => c.email === next);
          if (contact) return pick(contact);
        }
        onChange(withTyped(next));
      }}
    >
      <div
        className="flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-1 py-1"
        onMouseDown={(event) => {
          // A press on the space between the chips puts the cursor in the field.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {chips.map((address, index) => (
          <RecipientChip key={`${index}:${address.email}`} address={address} onRemove={() => remove(index)} />
        ))}
        <Autocomplete.Input
          {...props}
          ref={(element) => {
            inputRef.current = element;
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
          className={cx("min-w-24 flex-1", className)}
          placeholder={chips.length === 0 ? placeholder : undefined}
          onFocus={(event) => {
            setActive(true);
            setFocused(true);
            // An address that the app put in the field stays a chip.
            if (!focused) commit();
            onFocus?.(event);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            // The field keeps its state while the person is in a different window.
            if (!document.hasFocus()) return;
            setFocused(false);
            commit();
          }}
          onKeyDown={(event) => {
            const shown = open && items.length > 0;
            // Tab takes the highlighted person, as Return does.
            if (event.key === "Tab" && !event.shiftKey && shown && highlighted.current) {
              event.preventDefault();
              pick(highlighted.current);
              return;
            }
            // While the list shows, Return and Escape are for the list, not for the form.
            const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
            if (shown && plain && (event.key === "Enter" || event.key === "Escape")) {
              event.stopPropagation();
              return;
            }
            // Backspace at the start removes the last chip. An address that is not valid becomes text again.
            if (event.key === "Backspace" && !typed && chips.length > 0) {
              event.preventDefault();
              const last = chips[chips.length - 1];
              onChange(formatRecipients(chips.slice(0, -1)) + (isEmail(last.email) ? "" : last.email));
              return;
            }
            onKeyDown?.(event);
          }}
        />
      </div>
      {items.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} align="start" className="z-[60] outline-none">
            <Autocomplete.Popup className="max-h-72 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl bg-white p-1 text-sm shadow-xl ring-1 ring-black/5 outline-none origin-(--transform-origin) transition-[scale,opacity] duration-[125ms] ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 dark:bg-zinc-900 dark:ring-white/10">
              <Autocomplete.List>
                {(contact: Contact) => (
                  <Autocomplete.Item
                    key={contact.email}
                    value={contact}
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-zinc-700 outline-none select-none data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                  >
                    <Avatar name={contact.name} email={contact.email} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      {contact.name && <span className="truncate font-medium">{contact.name}</span>}
                      <span className={contact.name ? "truncate text-xs text-zinc-500" : "truncate"}>
                        {contact.email}
                      </span>
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      )}
    </Autocomplete.Root>
  );
}

function RecipientChip({ address, onRemove }: { address: Address; onRemove(): void }) {
  const valid = isEmail(address.email);
  return (
    <span
      title={valid ? address.email : `${address.email} is not a valid email address`}
      className={cx(
        "flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 text-[13px] leading-5",
        valid
          ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
          : "bg-red-50 text-red-700 ring-1 ring-red-300 ring-inset dark:bg-red-950/50 dark:text-red-300 dark:ring-red-800",
      )}
    >
      {valid ? (
        <Avatar name={address.name} email={address.email} size="xs" />
      ) : (
        <span className="grid size-5 shrink-0 place-items-center">
          <Warning className="size-3.5" />
        </span>
      )}
      <span className="truncate">{address.name || address.email}</span>
      <button
        type="button"
        aria-label={`Remove ${address.email}`}
        // The focus stays in the field, so the text that the person typed does not become a chip.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        className="grid size-4 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
