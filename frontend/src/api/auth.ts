import { apiFetch } from "./client";
import type { Me } from "./types";

/** Full-page navigation target: the backend starts the Google OAuth flow. */
export const GOOGLE_LOGIN_PATH = "/api/auth/google";

export const getMe = () => apiFetch<Me>("/api/auth/me");

export const logout = () => apiFetch<void>("/api/auth/logout", { method: "POST" });
