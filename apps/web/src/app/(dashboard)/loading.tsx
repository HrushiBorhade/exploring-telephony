import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-28 rounded-xl skeleton-shimmer"
            style={{
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>
      <Skeleton className="h-8 w-48 skeleton-shimmer" style={{ animationDelay: "400ms" }} />
      <Skeleton className="h-64 rounded-xl skeleton-shimmer" style={{ animationDelay: "500ms" }} />
    </div>
  );
}
