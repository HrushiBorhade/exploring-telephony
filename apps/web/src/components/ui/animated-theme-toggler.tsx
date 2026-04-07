"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { flushSync } from "react-dom"
import { Sun, Moon } from "lucide-react"

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  ...props
}: AnimatedThemeTogglerProps) => {
  const { resolvedTheme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === "dark"

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current
    if (!button || !resolvedTheme) return

    const { top, left, width, height } = button.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y)
    )

    const applyTheme = () => {
      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    if (typeof document.startViewTransition !== "function") {
      applyTheme()
      return
    }

    const transition = document.startViewTransition(() => {
      flushSync(applyTheme)
    })

    const ready = transition?.ready
    if (ready && typeof ready.then === "function") {
      ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${maxRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration,
              easing: "ease-in-out",
              pseudoElement: "::view-transition-new(root)",
            }
          )
        })
        .catch(() => {})
    }
  }, [resolvedTheme, setTheme, duration])

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={toggleTheme}
      className={className}
      aria-label="Toggle theme"
      {...props}
    >
      {mounted ? (
        isDark ? <Moon className="size-4" /> : <Sun className="size-4" />
      ) : (
        <span className="size-4" />
      )}
    </button>
  )
}
