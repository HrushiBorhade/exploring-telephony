"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Shield, ShieldOff, UserX, UserCheck, Eye, MoreHorizontal, Search, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useSession, authClient } from "@/lib/auth-client";
import type { AdminUser } from "@/lib/types";

function UsersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Dialogs
  const [banDialog, setBanDialog] = useState<{ userId: string; name: string } | null>(null);
  const [banReason, setBanReason] = useState("");
  const [roleDialog, setRoleDialog] = useState<{ userId: string; name: string; currentRole: string } | null>(null);
  const [newRole, setNewRole] = useState("user");

  // Guard
  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/capture");
    }
  }, [session, router]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await authClient.admin.listUsers({
        query: {
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
          ...(search ? { searchValue: search, searchField: "name", searchOperator: "contains" as const } : {}),
        },
      });
      if (error) throw new Error(error.message);
      setUsers((data?.users as AdminUser[]) ?? []);
    } catch (err: any) {
      toast.error(`Failed to load users: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Actions
  async function handleBan() {
    if (!banDialog) return;
    setActionLoading(banDialog.userId);
    try {
      const { error } = await authClient.admin.banUser({ userId: banDialog.userId, banReason });
      if (error) throw new Error(error.message);
      toast.success(`${banDialog.name} banned`);
      setBanDialog(null);
      setBanReason("");
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnban(userId: string, name: string) {
    setActionLoading(userId);
    try {
      const { error } = await authClient.admin.unbanUser({ userId });
      if (error) throw new Error(error.message);
      toast.success(`${name} unbanned`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSetRole() {
    if (!roleDialog) return;
    setActionLoading(roleDialog.userId);
    try {
      const { error } = await authClient.admin.setRole({ userId: roleDialog.userId, role: newRole });
      if (error) throw new Error(error.message);
      toast.success(`${roleDialog.name} is now ${newRole}`);
      setRoleDialog(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleImpersonate(userId: string) {
    setActionLoading(userId);
    try {
      const { error } = await authClient.admin.impersonateUser({ userId });
      if (error) throw new Error(error.message);
      toast.success("Impersonating user");
      router.replace("/capture");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-4"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
      <motion.div variants={pageFadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold font-heading tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">{users.length} users total</p>
        </div>
      </motion.div>

      <motion.div variants={pageFadeUp} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 max-w-sm"
        />
      </motion.div>

      <motion.div variants={pageFadeUp} className="border rounded-lg overflow-hidden">
        {loading ? (
          <UsersSkeleton />
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No users found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user, i) => (
                <TableRow
                  key={user.id}
                  className="group"
                  style={{ animation: `fade-in-up 0.3s ease-out backwards`, animationDelay: `${i * 30}ms` }}
                >
                  <TableCell className="font-medium">{user.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {(user as any).phoneNumber || user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "outline"} className="text-[10px]">
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Badge variant="destructive" className="text-[10px]">Banned</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={
                        <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      }>
                        {actionLoading === user.id ? <LoaderCircle className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setRoleDialog({ userId: user.id, name: user.name, currentRole: user.role }); setNewRole(user.role); }}>
                          <Shield className="size-3.5 mr-2" />
                          Set Role
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleImpersonate(user.id)}>
                          <Eye className="size-3.5 mr-2" />
                          Impersonate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {user.banned ? (
                          <DropdownMenuItem onClick={() => handleUnban(user.id, user.name)}>
                            <UserCheck className="size-3.5 mr-2" />
                            Unban
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => { setBanDialog({ userId: user.id, name: user.name }); setBanReason(""); }} className="text-red-600">
                            <UserX className="size-3.5 mr-2" />
                            Ban User
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </motion.div>

      {/* Ban Dialog */}
      <Dialog open={!!banDialog} onOpenChange={(open) => !open && setBanDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banDialog?.name}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for ban (optional)"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBan} disabled={!!actionLoading}>
              {actionLoading ? <LoaderCircle className="size-4 animate-spin" /> : "Ban User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Role Dialog */}
      <Dialog open={!!roleDialog} onOpenChange={(open) => !open && setRoleDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Role for {roleDialog?.name}</DialogTitle>
          </DialogHeader>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)}>Cancel</Button>
            <Button onClick={handleSetRole} disabled={!!actionLoading}>
              {actionLoading ? <LoaderCircle className="size-4 animate-spin" /> : "Save Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
