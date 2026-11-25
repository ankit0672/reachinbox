import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, Unplug } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { logout } from "../../api/auth";
import { disconnectSlack, SLACK_CONNECT_PATH } from "../../api/slack";
import { useMe } from "../../auth/useMe";
import { SlackIcon } from "../../components/SlackIcon";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/toastContext";
import { slackStatusKey, useSlackStatus } from "../../slack/slack";

const itemClasses =
  "flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm " +
  "enabled:hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-ink-subtle";

/** Figma sidebar user card (avatar, name, email, chevron) with an account menu. */
export function UserMenu() {
  const { data: me } = useMe(); // always loaded: rendered behind <RequireAuth>
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/login", { replace: true });
    },
    onError: () => toast.error("Couldn't log out. Please try again."),
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!me) return null;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-3 rounded-card bg-surface-muted p-3">
        <Avatar name={me.name} src={me.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{me.name}</p>
          <p className="truncate text-[11px] text-ink-muted">{me.email}</p>
        </div>
        <button
          type="button"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((o) => !o)}
          className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <ChevronDown aria-hidden size={16} className={open ? "rotate-180" : ""} />
        </button>
      </div>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute top-full left-0 z-10 mt-1 w-72 rounded-card border border-border bg-surface p-1 shadow-popover"
        >
          <SlackMenuItems />
          <div role="separator" className="my-1 h-px bg-divider" />
          <button
            type="button"
            role="menuitem"
            className={itemClasses}
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? (
              <Spinner size={16} label="Logging out" />
            ) : (
              <LogOut aria-hidden size={16} />
            )}
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Slack section of the account menu:
 * - not configured on the server: disabled, with a hint
 * - not connected: "Connect Slack" (full-page navigation to the OAuth start)
 * - connected: "Slack connected ✓ (workspace)" and "Disconnect"
 */
function SlackMenuItems() {
  const status = useSlackStatus();
  const queryClient = useQueryClient();
  const toast = useToast();

  const disconnect = useMutation({
    mutationFn: disconnectSlack,
    onSuccess: () => {
      toast.success("Slack disconnected. Rate-limit alerts are off.");
      return queryClient.invalidateQueries({ queryKey: slackStatusKey });
    },
    onError: () => toast.error("Couldn't disconnect Slack. Please try again."),
  });

  if (status.isPending) {
    return (
      <div className={`${itemClasses} text-ink-muted`}>
        <Spinner size={16} label="Checking Slack" />
        Slack
      </div>
    );
  }
  if (status.isError) {
    return (
      <button
        type="button"
        role="menuitem"
        className={itemClasses}
        onClick={() => void status.refetch()}
      >
        <SlackIcon />
        Slack status unavailable · Retry
      </button>
    );
  }
  if (!status.data.available) {
    return (
      <button
        type="button"
        role="menuitem"
        disabled
        className={itemClasses}
        title="Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URL and ENCRYPTION_KEY on the server"
      >
        <SlackIcon />
        Slack isn't set up on this server
      </button>
    );
  }
  if (!status.data.connected) {
    return (
      // A real navigation, not fetch: the API redirects to Slack's consent screen.
      <a role="menuitem" href={SLACK_CONNECT_PATH} className={itemClasses}>
        <SlackIcon />
        Connect Slack
      </a>
    );
  }
  return (
    <>
      <div className={`${itemClasses} cursor-default`}>
        <SlackIcon />
        <span className="min-w-0 flex-1 break-words">
          Slack connected <span className="text-primary">✓</span>
          {status.data.teamName && (
            <span className="whitespace-nowrap text-ink-muted"> ({status.data.teamName})</span>
          )}
        </span>
      </div>
      <button
        type="button"
        role="menuitem"
        className={itemClasses}
        disabled={disconnect.isPending}
        onClick={() => disconnect.mutate()}
      >
        <Unplug aria-hidden size={16} />
        Disconnect Slack
      </button>
    </>
  );
}
