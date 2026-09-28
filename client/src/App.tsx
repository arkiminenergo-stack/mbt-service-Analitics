import { Switch, Route, useLocation, Redirect } from "wouter";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import LoginPage from "@/pages/LoginPage";
import MbtPage from "@/pages/MbtPage";
import MbtProjectPage from "@/pages/MbtProjectPage";
import GiProjectsPage from "@/pages/GiProjectsPage";
import GiProjectPage from "@/pages/GiProjectPage";
import { Loader2 } from "lucide-react";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ['/api/auth/me'],
    retry: false,
  });
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user && location !== '/login') {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/mbt/:projectId">
        {(params) => (
          <AuthGuard>
            <MbtProjectPage />
          </AuthGuard>
        )}
      </Route>
      <Route path="/mbt">
        <AuthGuard>
          <MbtPage />
        </AuthGuard>
      </Route>
      <Route path="/gi/:projectId">
        {() => (
          <AuthGuard>
            <GiProjectPage />
          </AuthGuard>
        )}
      </Route>
      <Route path="/gi">
        <AuthGuard>
          <GiProjectsPage />
        </AuthGuard>
      </Route>
      <Route path="/">
        <Redirect to="/mbt" />
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
