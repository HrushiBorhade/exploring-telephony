import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function StatCardSkeleton({ delay }: { delay: string }) {
  return (
    <Card className="shadow-xs">
      <CardHeader>
        <Skeleton
          className="h-4 w-24"
          style={{ animationDelay: delay }}
        />
        <Skeleton
          className="h-9 w-16"
          style={{ animationDelay: delay }}
        />
      </CardHeader>
      <CardContent>
        <Skeleton
          className="h-4 w-28"
          style={{ animationDelay: delay }}
        />
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
          <StatCardSkeleton delay="0ms" />
          <StatCardSkeleton delay="100ms" />
        </div>

        {/* Table section */}
        <div className="px-4 lg:px-6">
          <div className="flex items-center justify-between mb-4">
            <Skeleton
              className="h-6 w-28"
              style={{ animationDelay: "200ms" }}
            />
            <Skeleton
              className="h-9 w-28 rounded-md"
              style={{ animationDelay: "200ms" }}
            />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Phones</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <Skeleton
                        className="h-4"
                        style={{ width: `${[96, 112, 80, 104, 88][i]}px` }}
                      />
                    </TableCell>
                    <TableCell>
                      <Skeleton
                        className="h-4"
                        style={{ width: `${[160, 176, 152, 168, 144][i]}px` }}
                      />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton
                        className="h-4"
                        style={{ width: `${[56, 48, 64, 52, 44][i]}px` }}
                      />
                    </TableCell>
                    <TableCell className="pr-6">
                      <Skeleton className="h-4 w-4 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
