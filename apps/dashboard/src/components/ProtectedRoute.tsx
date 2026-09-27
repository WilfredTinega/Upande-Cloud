import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Skeleton, SkeletonCards } from "./Skeleton";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // App-shell skeleton (top bar, sidebar, content) matching Layout.
    return (
      <div role="status" aria-label="Loading" className="h-screen flex flex-col bg-white dark:bg-brand-950">
        <div className="h-14 flex items-center gap-3 px-6 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shrink-0">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="ml-auto h-8 w-8 rounded-full" />
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-52 shrink-0 border-r border-brand-200 dark:border-brand-700 bg-brand-100 dark:bg-brand-900 flex flex-col gap-3 px-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <div className="flex-1 min-w-0 p-6 flex flex-col gap-6">
            <Skeleton className="h-8 w-48" />
            <SkeletonCards count={6} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    // Preserve where the user was headed (e.g. the app deep-linked from the
    // "site not available" page) so login can return them there.
    const dest = location.pathname + location.search;
    const to = dest && dest !== "/" ? `/login?redirect=${encodeURIComponent(dest)}` : "/login";
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}
