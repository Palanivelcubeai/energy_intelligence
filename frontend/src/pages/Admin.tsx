import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Users, Plus, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { type UserRecord } from "@/data/carbonData";

interface UserWithAdmin extends UserRecord {
  is_main_admin?: boolean;
}
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/services/apiClient";

export default function Admin() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithAdmin[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "Operator" as UserRecord["role"], password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [editCurrentPassword, setEditCurrentPassword] = useState("");
  const [editNewPassword, setEditNewPassword] = useState("");
  const [editConfirmNewPassword, setEditConfirmNewPassword] = useState("");
  const [editPasswordError, setEditPasswordError] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [showPasswords, setShowPasswords] = useState({ add: false, addConfirm: false, editCurrent: false, editNew: false, editConfirm: false });

  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiClient.get("/users");
      const mapped = res.data.map((u: { id: string; name: string; email: string; role: string; is_main_admin?: boolean }) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: (u.role.charAt(0).toUpperCase() + u.role.slice(1)) as UserRecord["role"],
        is_main_admin: u.is_main_admin || false,
      }));
      mapped.sort((a: UserWithAdmin, b: UserWithAdmin) => (b.is_main_admin ? 1 : 0) - (a.is_main_admin ? 1 : 0));
      setUsers(mapped);
    } catch {
      toast({ title: "Error", description: "Failed to load users", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const addUser = async () => {
    if (!newUser.name || !newUser.email) return;
    try {
      await apiClient.post("/users", {
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        password: newUser.password,
      });
      setNewUser({ name: "", email: "", role: "Operator", password: "" });
      setConfirmPassword("");
      toast({ title: "User Added", description: `${newUser.name} added as ${newUser.role}` });
      fetchUsers();
    } catch {
      toast({ title: "Error", description: "Failed to add user", variant: "destructive" });
    }
  };

  const saveEditUser = async () => {
    if (!editUser || !editCurrentPassword) return;
    if (editNewPassword && editNewPassword !== editConfirmNewPassword) {
      setEditPasswordError("New passwords do not match");
      return;
    }
    try {
      await apiClient.put(`/users/${editUser.id}`, {
        name: editUser.name,
        email: editUser.email,
        role: editUser.role,
        currentPassword: editCurrentPassword,
        ...(editNewPassword ? { password: editNewPassword } : {}),
      });
      setEditDialogOpen(false);
      setEditUser(null);
      setEditCurrentPassword("");
      setEditNewPassword("");
      setEditConfirmNewPassword("");
      setEditPasswordError("");
      toast({ title: "User Updated", description: `${editUser.name} has been updated.` });
      fetchUsers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Failed to update user";
      if (msg === "Current password is incorrect") {
        setEditPasswordError(msg);
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await apiClient.delete(`/users/${id}`);
      toast({ title: "User Removed" });
      fetchUsers();
    } catch {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    }
  };

  const roleColor = (role: UserRecord["role"]) => {
    if (role === "Admin") return "bg-destructive/10 text-destructive";
    if (role === "Manager") return "bg-primary/10 text-primary";
    return "bg-success/10 text-success";
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Users className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage platform users and their access roles</p>
        </div>
      </div>

      {/* User Management */}
      <div className="kpi-card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">User Management</h3>
          </div>

          {/* Add User Dialog */}
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5 text-xs">
                <Plus className="h-3 w-3" /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Role</Label>
                  <Select value={newUser.role} onValueChange={v => setNewUser(p => ({ ...p, role: v as UserRecord["role"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Admin">Admin</SelectItem>
                      <SelectItem value="Manager">Manager</SelectItem>
                      <SelectItem value="Operator">Operator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password</Label>
                  <div className="relative">
                    <Input type={showPasswords.add ? "text" : "password"} value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="Enter password" className="pr-8" />
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPasswords(p => ({ ...p, add: !p.add }))}>
                      {showPasswords.add ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Confirm Password</Label>
                  <div className="relative">
                    <Input type={showPasswords.addConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" className="pr-8" />
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPasswords(p => ({ ...p, addConfirm: !p.addConfirm }))}>
                      {showPasswords.addConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {confirmPassword && newUser.password !== confirmPassword && (
                    <p className="text-[10px] text-destructive">Passwords do not match</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button size="sm" onClick={addUser} disabled={!newUser.name || !newUser.email || !newUser.password || newUser.password !== confirmPassword}>Add User</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-md bg-secondary/30">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {u.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-foreground">{u.name}</span>
                    {u.is_main_admin && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-semibold">Main Admin</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{u.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${roleColor(u.role)}`}>
                  {u.role}
                </span>

                {/* Edit User Dialog */}
                <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) { setEditCurrentPassword(""); setEditNewPassword(""); setEditConfirmNewPassword(""); setEditPasswordError(""); } }}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditUser({ ...u }); setEditDialogOpen(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit User</DialogTitle>
                    </DialogHeader>
                    {editUser && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Current Password <span className="text-destructive">*</span></Label>
                          <div className="relative">
                            <Input type={showPasswords.editCurrent ? "text" : "password"} value={editCurrentPassword} onChange={e => { setEditCurrentPassword(e.target.value); setEditPasswordError(""); }} placeholder="Enter current password to verify" className="pr-8" />
                            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPasswords(p => ({ ...p, editCurrent: !p.editCurrent }))}>
                              {showPasswords.editCurrent ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                          {editPasswordError && (
                            <p className="text-[10px] text-destructive">{editPasswordError}</p>
                          )}
                        </div>
                        <hr className="border-border" />
                        <div className="space-y-1.5">
                          <Label className="text-xs">Name</Label>
                          <Input value={editUser.name} onChange={e => setEditUser(p => p ? { ...p, name: e.target.value } : p)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Email</Label>
                          <Input type="email" value={editUser.email} onChange={e => setEditUser(p => p ? { ...p, email: e.target.value } : p)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Role</Label>
                          <Select value={editUser.role} onValueChange={v => setEditUser(p => p ? { ...p, role: v as UserRecord["role"] } : p)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Admin">Admin</SelectItem>
                              <SelectItem value="Manager">Manager</SelectItem>
                              <SelectItem value="Operator">Operator</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <hr className="border-border" />
                        <p className="text-[10px] text-muted-foreground">Leave blank to keep the current password</p>
                        <div className="space-y-1.5">
                          <Label className="text-xs">New Password</Label>
                          <div className="relative">
                            <Input type={showPasswords.editNew ? "text" : "password"} value={editNewPassword} onChange={e => setEditNewPassword(e.target.value)} placeholder="Enter new password" className="pr-8" />
                            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPasswords(p => ({ ...p, editNew: !p.editNew }))}>
                              {showPasswords.editNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        {editNewPassword && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Confirm New Password</Label>
                            <div className="relative">
                              <Input type={showPasswords.editConfirm ? "text" : "password"} value={editConfirmNewPassword} onChange={e => setEditConfirmNewPassword(e.target.value)} placeholder="Re-enter new password" className="pr-8" />
                              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPasswords(p => ({ ...p, editConfirm: !p.editConfirm }))}>
                                {showPasswords.editConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                            {editConfirmNewPassword && editNewPassword !== editConfirmNewPassword && (
                              <p className="text-[10px] text-destructive">Passwords do not match</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" size="sm">Cancel</Button>
                      </DialogClose>
                      <Button size="sm" onClick={saveEditUser} disabled={!editCurrentPassword || (!!editNewPassword && editNewPassword !== editConfirmNewPassword)}>Save</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {!u.is_main_admin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete User</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete <span className="font-semibold text-foreground">{u.name}</span>? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteUser(u.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
