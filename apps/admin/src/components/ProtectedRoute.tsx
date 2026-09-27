import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Skeleton } from "./Skeleton";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // ...role/loading checks below; the forced-password-change redirect is added
  // after we know the user is present and permitted.

  if (loading) {
    return (
      // Mirrors the Layout shell (w-52 sidebar, h-14 top bar) so the panel
      // doesn't jump when the session check finishes.
      <div role="status" aria-label="Loading" className="min-h-screen flex bg-white dark:bg-brand-950">
        <div className="w-52 shrink-0 border-r border-brand-200 dark:border-brand-700 bg-brand-100 dark:bg-brand-900 p-4 flex flex-col gap-3">
          <Skeleton className="h-7 w-28 mb-4" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="flex-1 flex flex-col">
          <div className="h-14 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-6 flex items-center justify-end gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <div className="p-6 flex flex-col gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "user") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-brand-950">
        <div className="max-w-md w-full mx-4 border border-red-200 dark:border-red-800 rounded-lg p-8 bg-red-50 dark:bg-red-950/30">
          <h1 className="text-xl font-semibold text-red-800 dark:text-red-300 mb-2">
            Access Denied
          </h1>
          <p className="text-sm text-red-700 dark:text-red-400">
            Only admins can use the admin panel.
          </p>
          <p className="mt-4 text-xs text-red-600 dark:text-red-500">
            Logged in as: {user.email} (role: {user.role})
          </p>
        </div>
      </div>
    );
  }

  // Admin with a pending forced password change: keep them out of the panel
  // until they set their own password.
  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
