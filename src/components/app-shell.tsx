import { Link, useRouterState } from "@tanstack/react-router";
import { Box, FileOutput, Gauge, Layers3, Plus, ShieldCheck, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: Gauge, match: (p: string) => p === "/" },
  { to: "/new", label: "New job", icon: Plus, match: (p: string) => p.startsWith("/new") },
  { to: "/docs", label: "Pipeline", icon: Workflow, match: (p: string) => p.startsWith("/docs") },
] as const;

export function AppShell({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground md:flex-row">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border md:flex">
        <Link to="/" className="flex items-baseline gap-2 px-5 pt-6 pb-5">
          <span className="font-medium tracking-[0.18em] text-xs text-sage">TERRASPLAT</span>
        </Link>
        <p className="px-5 pb-6 text-[11px] leading-relaxed text-muted">
          Observability-aware single-pass reconstruction
        </p>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex h-11 items-center gap-2 rounded-md px-3 text-sm transition-colors",
                item.match(pathname) ? "bg-accent text-foreground" : "text-muted hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
          {projectId ? (
            <div className="mt-6 space-y-0.5">
              <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Job</p>
              <JobLink to="/projects/$id/validate" icon={ShieldCheck} label="Validate" path={pathname} id={projectId} />
              <JobLink to="/projects/$id/process" icon={Layers3} label="Process" path={pathname} id={projectId} />
              <JobLink to="/projects/$id/viewer" icon={Box} label="Viewer" path={pathname} id={projectId} />
              <JobLink to="/projects/$id/accuracy" icon={Gauge} label="Accuracy" path={pathname} id={projectId} />
              <JobLink to="/projects/$id/export" icon={FileOutput} label="Export" path={pathname} id={projectId} />
            </div>
          ) : null}
        </nav>
        <p className="px-5 py-4 font-mono text-[10px] text-muted">SIH 2026 · PS 26158</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-border px-4 md:hidden">
          <Link to="/" className="text-xs tracking-[0.18em] text-sage">
            TERRASPLAT
          </Link>
          <Link to="/new" className="text-xs text-muted">
            New job
          </Link>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
        {projectId ? (
          <nav className="grid grid-cols-5 border-t border-border md:hidden">
            <Link
              to="/projects/$id/validate"
              params={{ id: projectId }}
              className={cn(
                "flex h-12 items-center justify-center text-[11px] tracking-wide",
                pathname.endsWith("/validate") ? "text-foreground" : "text-muted",
              )}
            >
              Check
            </Link>
            <Link
              to="/projects/$id/process"
              params={{ id: projectId }}
              className={cn(
                "flex h-12 items-center justify-center text-[11px] tracking-wide",
                pathname.endsWith("/process") ? "text-foreground" : "text-muted",
              )}
            >
              Run
            </Link>
            <Link
              to="/projects/$id/viewer"
              params={{ id: projectId }}
              className={cn(
                "flex h-12 items-center justify-center text-[11px] tracking-wide",
                pathname.endsWith("/viewer") ? "text-foreground" : "text-muted",
              )}
            >
              3D
            </Link>
            <Link
              to="/projects/$id/accuracy"
              params={{ id: projectId }}
              className={cn(
                "flex h-12 items-center justify-center text-[11px] tracking-wide",
                pathname.endsWith("/accuracy") ? "text-foreground" : "text-muted",
              )}
            >
              RMSE
            </Link>
            <Link
              to="/projects/$id/export"
              params={{ id: projectId }}
              className={cn(
                "flex h-12 items-center justify-center text-[11px] tracking-wide",
                pathname.endsWith("/export") ? "text-foreground" : "text-muted",
              )}
            >
              Out
            </Link>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function JobLink({
  to,
  icon: Icon,
  label,
  path,
  id,
}: {
  to: "/projects/$id/validate" | "/projects/$id/process" | "/projects/$id/viewer" | "/projects/$id/accuracy" | "/projects/$id/export";
  icon: typeof Box;
  label: string;
  path: string;
  id: string;
}) {
  const suffix = to.split("/").pop() ?? "";
  const active = path.endsWith(`/${suffix}`);
  return (
    <Link
      to={to}
      params={{ id }}
      className={cn(
        "flex h-10 items-center gap-2 rounded-md px-3 text-sm",
        active ? "bg-accent text-foreground" : "text-muted hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
