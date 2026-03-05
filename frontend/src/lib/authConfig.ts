export type UserRole = "admin" | "manager" | "operator";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

export const roleAccess: Record<UserRole, string[]> = {
  admin: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/cost-analysis", "/ai-insights", "/reports", "/carbon", "/admin", "/config"],
  manager: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/cost-analysis", "/ai-insights", "/reports", "/carbon"],
  operator: ["/", "/monitoring", "/production", "/energy-output", "/power-quality", "/peak-demand", "/ai-insights", "/carbon"],
};
