import { createContext } from "react-router";

export interface CurrentUser {
  id: string;
}

export const userContext = createContext<CurrentUser | null>(null);
