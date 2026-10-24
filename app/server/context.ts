import { createContext } from "react-router";
import type { Account } from "./accounts.server";

export interface CurrentUser {
  id: string;
  /** A workspace of the public demo or of the reviewer sign-in. */
  demo: boolean;
  /** The accounts when the request started. An action that changes them does not update this list. */
  accounts: Account[];
}

export const userContext = createContext<CurrentUser | null>(null);
