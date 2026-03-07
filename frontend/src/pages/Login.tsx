import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import appIcon from "/clean.png";

export default function Login() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await login(email, password, rememberMe);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-fade-in"
        style={{ backgroundImage: `url(/login-bg-BA3dPpky.jpg)` }}
      />
      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Login Card */}
      <Card className="w-full max-w-md relative z-10 border-0 shadow-2xl rounded-2xl bg-white/85 backdrop-blur-xl animate-fade-in">
        <CardHeader className="items-center space-y-4 pb-2">
          <img src={appIcon} alt="App Icon" className="h-16 w-16" />
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Energy Intelligence Platform
            </h1>
            <p className="text-sm text-gray-500">Sign in to continue</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="bg-white/70 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-[hsl(187,80%,42%)]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-700">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10 bg-white/70 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-[hsl(187,80%,42%)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
                className="border-gray-400 data-[state=checked]:bg-[hsl(187,80%,42%)] data-[state=checked]:border-[hsl(187,80%,42%)]"
              />
              <Label htmlFor="remember" className="text-sm text-gray-600 cursor-pointer select-none">
                Remember Me
              </Label>
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-[hsl(187,80%,42%)] to-[hsl(152,60%,42%)] hover:from-[hsl(187,80%,38%)] hover:to-[hsl(152,60%,38%)] text-white font-semibold shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </Button>

            <p className="text-center text-xs text-gray-400 pt-2">
              CNC Energy © {new Date().getFullYear()}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
