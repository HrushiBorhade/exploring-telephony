// Shared animation config — single source of truth
// Pattern: step wrapper fades, children stagger with opacity + y

export const spring = { type: "spring" as const, duration: 0.3, bounce: 0 }

// Step wrapper — opacity fade only, blur dissolve on exit
export const stepVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: {
    opacity: 0,
    filter: "blur(4px)",
    transition: { duration: 0.15 },
  },
}

// Stagger — 40ms per field, no stagger on exit
export const staggerContainer = {
  enter: {},
  center: { transition: { staggerChildren: 0.04 } },
  exit: {},
}

// Children — opacity + y only (NO blur — 5+ simultaneous blurs kill frame budget)
export const staggerChild = {
  enter: { opacity: 0, y: 6 },
  center: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, duration: 0.3, bounce: 0 },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.1 },
  },
}

// Page-level stagger (dashboard cards, sections)
export const pageStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
}

// Page-level fade up (cards, content blocks)
export const pageFadeUp = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, duration: 0.4, bounce: 0 },
  },
}
