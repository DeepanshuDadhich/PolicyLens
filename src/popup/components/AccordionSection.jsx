import { useState } from "react";

/**
 * Generic collapsible section: a clickable header with a title, an optional
 * count badge, and a rotating chevron; content height-animates in/out via a
 * CSS grid-template-rows transition (no JS measurement or refs needed).
 *
 * Deliberately knows nothing about what it renders inside — ListSection uses
 * it for its item list, and any future section (e.g. RedFlags) can reuse
 * just this expand/collapse mechanism without inheriting ListSection's
 * item layout.
 */
export default function AccordionSection({ title, count, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {title}
          {typeof count === "number" && (
            <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal text-gray-300">
              {count}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-90" : "rotate-0"}`}
        >
          ▸
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </section>
  );
}
