"use client"

import { cn } from "@/lib/utils"

interface RippleProps extends React.ComponentPropsWithoutRef<"div"> {
  mainCircleSize?: number
  mainCircleOpacity?: number
  numCircles?: number
}

export function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.24,
  numCircles = 8,
  className,
  ...props
}: RippleProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 select-none [mask-image:linear-gradient(to_bottom,white,transparent)]",
        className
      )}
      {...props}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 100
        const opacity = mainCircleOpacity - i * 0.02
        const animationDelay = `${i * 0.08}s`

        return (
          <div
            key={i}
            className="absolute animate-ripple rounded-full border border-primary/20"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity: Math.max(opacity, 0.02),
              animationDelay,
              top: "50%",
              left: "50%",
              translate: "-50% -50%",
            }}
          />
        )
      })}
    </div>
  )
}
