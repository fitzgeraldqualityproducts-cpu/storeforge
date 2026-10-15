"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  ImageIcon,
  LinkIcon,
  Loader2Icon,
  PackageCheckIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, describeError } from "@/lib/client/api";
import type { PublicCapabilities } from "@/lib/config";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand-constants";
import { LogoMark } from "./logo-mark";
import { ThemeToggle } from "./theme-toggle";

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  brandName: string | null;
  title: string | null;
  steps: Record<string, { status: string }>;
}

export function HomeScreen({ capabilities }: { capabilities: PublicCapabilities }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: ProjectRow[] }>("/api/projects"),
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        json: { name: name.trim() || "Untitled store" },
      }),
    onSuccess: (d) => router.push(`/projects/${d.project.id}`),
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Project deleted");
      void projects.refetch();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <div className="bg-grain min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <LogoMark />
        <nav className="flex items-center gap-1" aria-label="Utilities">
          {capabilities.isDev && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/runs">Debug runs</Link>
            </Button>
          )}
          <ThemeToggle />
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <section className="grid gap-10 py-10 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div className="animate-fade-up">
            <Badge variant="ember" className="mb-5">
              <SparklesIcon /> Product in, store out
            </Badge>
            <h1 className="font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl">
              Found a product?
              <br />
              <span className="text-muted-foreground">Ship the store.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              {APP_TAGLINE} Paste a supplier link or drop in photos. {APP_NAME} drafts the brand,
              listing, images, pages and theme settings, and you review every word before it goes
              anywhere.
            </p>
            <ul className="mt-6 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="flex items-center gap-2">
                <LinkIcon className="size-4 text-ember" /> Link or photos
              </li>
              <li className="flex items-center gap-2">
                <ImageIcon className="size-4 text-ember" /> Cleaned images
              </li>
              <li className="flex items-center gap-2">
                <PackageCheckIcon className="size-4 text-ember" /> Import-ready ZIP
              </li>
            </ul>
          </div>
          <Card className="animate-fade-up self-start p-6 [animation-delay:80ms]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
              className="grid gap-4"
            >
              <div>
                <h2 className="text-lg font-semibold">Start a new store</h2>
                <p className="text-sm text-muted-foreground">
                  Name it anything; you&apos;ll pick a real brand name later.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  value={name}
                  maxLength={120}
                  placeholder="e.g. Ceramic pour-over set"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button type="submit" variant="ember" size="lg" disabled={create.isPending}>
                {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                Create project
              </Button>
            </form>
            {!capabilities.aiConfigured && (
              <Alert variant="warning" className="mt-5">
                <SparklesIcon />
                <AlertTitle>AI is not configured yet</AlertTitle>
                <AlertDescription>
                  <p>
                    Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> to generate
                    content, or set <code>AI_MODE=fixture</code> to try the offline demo data.
                    Scraping, uploads and image processing work without it.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </Card>
        </section>

        <section aria-labelledby="projects-heading" className="mt-4">
          <h2
            id="projects-heading"
            className="mb-4 text-sm font-medium tracking-wide text-muted-foreground uppercase"
          >
            Your projects
          </h2>
          {projects.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : projects.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load projects</AlertTitle>
              <AlertDescription>{describeError(projects.error)}</AlertDescription>
            </Alert>
          ) : projects.data?.projects.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.data.projects.map((p) => {
                const done = Object.values(p.steps).filter((s) => s.status === "ready").length;
                return (
                  <li key={p.id}>
                    <Card className="group relative gap-3 p-5 transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/projects/${p.id}`}
                          className="font-medium after:absolute after:inset-0 focus-visible:outline-none"
                        >
                          {p.brandName ?? p.name}
                        </Link>
                        <Badge variant={p.status === "exported" ? "success" : "secondary"}>
                          {p.status}
                        </Badge>
                      </div>
                      <p className="line-clamp-1 text-sm text-muted-foreground">
                        {p.title ?? "No listing yet"}
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {done}/7 steps ready · {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                        <span className="relative z-10 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${p.name}`}
                            onClick={() => {
                              if (confirm(`Delete "${p.name}" and all its files?`))
                                remove.mutate(p.id);
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Card className="items-center p-10 text-center text-sm text-muted-foreground">
              No projects yet. Create one above to get started.
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
