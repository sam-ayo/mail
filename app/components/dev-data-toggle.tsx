import { useFetcher } from "react-router";
import { cx } from "./ui";

/**
 * Development only. A plain segmented control that swaps the demo mailbox
 * between sample data and the worst-case fixture. It is not part of the design.
 */
export function DevDataToggle({ dataset }: { dataset: "demo" | "worst" }) {
  const fetcher = useFetcher();
  const current = (fetcher.formData?.get("dataset") as string | undefined) ?? dataset;
  return (
    <fetcher.Form
      method="post"
      action="/api/dev/demo-data"
      className="fixed bottom-2 left-2 z-[70] flex gap-0.5 rounded-full bg-zinc-200 p-0.5 font-[system-ui] text-[11px] text-zinc-600 shadow-sm"
    >
      {(["demo", "worst"] as const).map((value) => (
        <button
          key={value}
          name="dataset"
          value={value}
          className={cx("rounded-full px-2.5 py-0.5", current === value && "bg-white text-zinc-900 shadow-xs")}
        >
          {value === "demo" ? "Demo data" : "Worst case"}
        </button>
      ))}
    </fetcher.Form>
  );
}
