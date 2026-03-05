export type UserRole = "admin" | "manager" | "operator";

export interface AuthUser {
  email: string;
  password: string;
  role: UserRole;
  name: string;
}

export const users: AuthUser[] = [
  { email: "admin@gmail.com", password: "Energy@321", role: "admin", name: "Admin User" },
  { email: "manager@gmail.com", password: "Energy@321", role: "manager", name: "Plant Manager" },
  { email: "operator@gmail.com", password: "Energy@321", role: "operator", name: "CNC Operator" },
];

export const roleAccess: Record<UserRole, string[]> = {
  admin: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/cost-analysis", "/ai-insights", "/reports", "/carbon", "/admin", "/config"],
  manager: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/cost-analysis", "/ai-insights", "/reports", "/carbon"],
  operator: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/ai-insights", "/carbon"],
};

export function authenticate(email: string, password: string): AuthUser | null {
  return users.find((u) => u.email === email && u.password === password) || null;
}
