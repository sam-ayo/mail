import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useMemo, useRef, useState } from "react";
import { insertRecipient, lastRecipient, parseAddressList, suggestContacts, type Contact } from "~/lib/mail";
import { Avatar } from "./ui";

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
 * A field for a list of addresses. As the person types, people from their mail
 * show below the field. A pick puts the person in place of the text that the
 * person typed after the last comma.
 */
export function RecipientInput({ value, onChange, exclude = [], ref, onFocus, onKeyDown, ...props }: RecipientInputProps) {
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const { start, text } = lastRecipient(value);
  const contacts = useContacts(text, active);
  const items = useMemo(() => {
    const present = [...exclude, ...parseAddressList(value.slice(0, start)).map((a) => a.email)];
    return suggestContacts(contacts, text, present);
  }, [contacts, text, value, start, exclude]);
  const highlighted = useRef<Contact | undefined>(undefined);

  function pick(contact: Contact) {
    onChange(insertRecipient(value, contact));
  }

  return (
    <Autocomplete.Root
      items={items}
      mode="none"
      autoHighlight
      value={value}
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
        onChange(next);
      }}
    >
      <Autocomplete.Input
        {...props}
        ref={ref}
        onFocus={(event) => {
          setActive(true);
          onFocus?.(event);
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
          onKeyDown?.(event);
        }}
      />
      {items.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} align="start" className="z-[60] outline-none">
            <Autocomplete.Popup className="max-h-72 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl bg-white p-1 text-sm shadow-xl ring-1 ring-black/5 outline-none dark:bg-zinc-900 dark:ring-white/10">
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
