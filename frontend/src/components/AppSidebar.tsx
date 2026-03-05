import {
  LayoutDashboard, Monitor, BarChart3, Zap, Gauge, TrendingUp,
  DollarSign, Brain, FileText, ChevronLeft, Leaf, Shield, Users
} from "lucide-react";
import appIcon from "/clean.png";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { roleAccess } from "@/lib/authConfig";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "CNC Monitoring", url: "/monitoring", icon: Monitor },
  { title: "Production Analytics", url: "/production", icon: BarChart3 },
  { title: "Energy vs Output", url: "/energy-output", icon: Zap },
  { title: "Power Quality", url: "/power-quality", icon: Gauge },
  { title: "Peak Demand", url: "/peak-demand", icon: TrendingUp },
  { title: "Cost Analysis", url: "/cost-analysis", icon: DollarSign },
  { title: "Carbon & Sustainability", url: "/carbon", icon: Leaf },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "AI Insights", url: "/ai-insights", icon: Brain },
  { title: "Configuration", url: "/config", icon: Shield },
  { title: "Admin", url: "/admin", icon: Users },
  
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role } = useAuth();

  const allowedRoutes = role ? roleAccess[role] : [];
  const visibleItems = navItems.filter((item) => allowedRoutes.includes(item.url));

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className={collapsed ? "p-1" : "p-4"}>
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <img src={appIcon} alt="CNC Energy" className="h-8 w-8 shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">CNC Energy</span>
              <span className="text-[10px] text-muted-foreground">Intelligence Platform</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center overflow-visible">
            <img src={appIcon} alt="CNC Energy" className="h-8 w-8 shrink-0" />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {!collapsed && "Navigation"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      activeClassName="bg-primary/10 text-primary font-medium border-l-2 border-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full justify-center text-muted-foreground"
        >
          <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
