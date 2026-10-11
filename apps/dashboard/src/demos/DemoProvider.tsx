import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { demoReducer, loadDemo, type Action, type DemoState } from "./model";
const KEY = "hunch:exhibition:v1";
const Context = createContext<{
  state: DemoState;
  dispatch: Dispatch<Action>;
} | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(demoReducer, null, () => {
    try {
      return loadDemo(localStorage.getItem(KEY));
    } catch {
      return loadDemo(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* Session still works when storage is unavailable. */
    }
  }, [state]);
  return (
    <Context.Provider value={{ state, dispatch }}>{children}</Context.Provider>
  );
}
export function useDemo() {
  const context = useContext(Context);
  if (!context) throw new Error("Exhibition pages require DemoProvider.");
  return context;
}

export function ExhibitionAccountBadge() {
  const { state } = useDemo();
  return <Link to="/funding" className="exhibition-account-badge">{state.connected ? `${state.tokens.toLocaleString()} demo HUNCH` : "Fund exhibition account"}</Link>;
}
