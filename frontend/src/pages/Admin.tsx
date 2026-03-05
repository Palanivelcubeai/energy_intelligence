import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import { defaultUsers, type UserRecord } from "@/data/carbonData";
import { useToast } from "@/hooks/use-toast";

export default function Admin() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRecord[]>(defaultUsers.map(u => ({ ...u })));
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "Operator" as UserRecord["role"] });
  const [editUser, setEditUser] = useState<UserRecord | null>(null);

  const addUser = () => {
    if (!newUser.name || !newUser.email) return;
    setUsers(prev => [...prev, { ...newUser, id: Date.now().toString() }]);
    setNewUser({ name: "", email: "", role: "Operator" });
    toast({ title: "User Added", description: `${newUser.name} added as ${newUser.role}` });
  };

  const saveEditUser = () => {
    if (!editUser) return;
    setUsers(prev => prev.map(u => u.id === editUser.id ? editUser : u));
    setEditUser(null);
    toast({ title: "User Updated", description: `${editUser.name} has been updated.` });
  };

  const deleteUser = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    toast({ title: "User Removed" });
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
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button size="sm" onClick={addUser}>Add User</Button>
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
                  <span className="text-sm text-foreground">{u.name}</span>
                  <p className="text-[10px] text-muted-foreground">{u.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${roleColor(u.role)}`}>
                  {u.role}
                </span>

                {/* Edit User Dialog */}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditUser({ ...u })}>
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
                      </div>
                    )}
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" size="sm">Cancel</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button size="sm" onClick={saveEditUser}>Save</Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteUser(u.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
