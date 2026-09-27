import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "../types";
import { authApi, clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from "./api";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function useAuthProvider(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    const storedToken = getToken();
    if (!storedToken) {
      setLoading(false);
      return;
    }
    // Only a 401/403 ends the session; network errors / 5xx are retried with
    // backoff and the token kept.
    let cancelled = false;
    const load = async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const { user: u } = await authApi.me();
          if (cancelled) return;
          setUser(u);
          setTokenState(storedToken);
          return;
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 401 || status === 403) {
            clearToken();
            setTokenState(null);
            setUser(null);
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    };
    void load().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any authenticated request that gets 401 (session revoked / expired).
  useEffect(() => {
    const onUnauthorized = () => {
      setTokenState(null);
      setUser(null);
      navigate("/login", { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const { token: t, user: u } = await authApi.login(email, password);
    setToken(t);
    setTokenState(t);
    setUser(u);
    return u;
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const { token: t, user: u } = await authApi.changePassword(
        currentPassword,
        newPassword,
      );
      setToken(t);
      setTokenState(t);
      setUser(u);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return { user, token, loading, login, changePassword, logout };
}
