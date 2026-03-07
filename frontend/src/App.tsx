import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PlantConfigProvider } from "@/context/PlantConfigContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import MachineMonitoring from "./pages/MachineMonitoring";
import ProductionAnalytics from "./pages/ProductionAnalytics";
import EnergyVsOutput from "./pages/EnergyVsOutput";
import PowerQuality from "./pages/PowerQuality";
import PeakDemand from "./pages/PeakDemand";
import CostAnalysis from "./pages/CostAnalysis";
import AIInsights from "./pages/AIInsights";
import Reports from "./pages/Reports";
import CarbonSustainability from "./pages/CarbonSustainability";
import AdminConfig from "./pages/AdminConfig";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <DashboardLayout>{children}</DashboardLayout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PlantConfigProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedPage><Overview /></ProtectedPage>} />
          <Route path="/monitoring" element={<ProtectedPage><MachineMonitoring /></ProtectedPage>} />
          <Route path="/production" element={<ProtectedPage><ProductionAnalytics /></ProtectedPage>} />
          <Route path="/energy-output" element={<ProtectedPage><EnergyVsOutput /></ProtectedPage>} />
          <Route path="/power-quality" element={<ProtectedPage><PowerQuality /></ProtectedPage>} />
          <Route path="/peak-demand" element={<ProtectedPage><PeakDemand /></ProtectedPage>} />
          <Route path="/cost-analysis" element={<ProtectedPage><CostAnalysis /></ProtectedPage>} />
          <Route path="/ai-insights" element={<ProtectedPage><AIInsights /></ProtectedPage>} />
          <Route path="/reports" element={<ProtectedPage><Reports /></ProtectedPage>} />
          <Route path="/carbon" element={<ProtectedPage><CarbonSustainability /></ProtectedPage>} />
          <Route path="/admin" element={<ProtectedPage><Admin /></ProtectedPage>} />
          <Route path="/config" element={<ProtectedPage><AdminConfig /></ProtectedPage>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </PlantConfigProvider>
  </QueryClientProvider>
);

export default App;
