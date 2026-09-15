export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  type: string;
  posted: string;
  source: string;
  description: string;
  requirements: string[];
  category: string;
  url: string;
  apply_url: string;
  application_deadline: string;
  is_active: boolean;
  remote: boolean;
}

export interface Stats {
  total_jobs: number;
  active_jobs: number;
  sources: Record<string, number>;
  recent_scrapes: Array<{
    source: string;
    status: string;
    jobs_found: number;
    started_at: string | null;
  }>;
}

import { useEffect, useState } from "react";

const API_BASE = "https://api.careers.annex-technologies.com";

export function useJobs(): { jobs: Job[]; loading: boolean } {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/jobs?per_page=500`)
      .then((res) => res.json())
      .then((data) => {
        const rawJobs = data.jobs ?? data;
        const mapped = Array.isArray(rawJobs)
          ? rawJobs.map((j: any) => ({
              id: String(j.id),
              title: j.title ?? "",
              company: j.company ?? "",
              location: j.location ?? "",
              salary:
                j.salary_min && j.salary_max
                  ? `${j.salary_currency ?? "KES"} ${j.salary_min.toLocaleString()} - ${j.salary_max.toLocaleString()}`
                  : j.salary ?? "",
              type: j.job_type ?? j.type ?? "",
              posted: j.posted_date ?? j.posted ?? "",
              source: j.source ?? "",
              description: j.description ?? "",
              requirements: typeof j.requirements === "string" && j.requirements
                ? j.requirements.split("\n").map((r: string) => r.trim()).filter(Boolean)
                : Array.isArray(j.requirements) ? j.requirements : [],
              category: j.category ?? j.tags ?? "",
              url: j.url ?? "",
              apply_url: j.apply_url ?? "",
              application_deadline: j.application_deadline ?? "",
              is_active: j.is_active ?? true,
              remote: j.remote ?? false,
            }))
          : [];
        setJobs(mapped);
      })
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  return { jobs, loading };
}

export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/stats`)
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => setStats(null));
  }, []);

  return stats;
}

export function useSources(): Record<string, number> {
  const [sources, setSources] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch(`${API_BASE}/api/sources`)
      .then((res) => res.json())
      .then((data) => setSources(data.sources ?? {}))
      .catch(() => setSources({}));
  }, []);

  return sources;
}

// --- Admin API helpers ---

export interface ScrapeLogEntry {
  id: number;
  source: string;
  status: string;
  jobs_found: number;
  jobs_new: number;
  jobs_updated: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface UserEntry {
  id: number;
  email: string;
  name: string | null;
  source: string;
  job_interests: string | null;
  subscribed_at: string | null;
  last_emailed_at: string | null;
}

export function useScrapeLogsAdmin() {
  const [logs, setLogs] = useState<ScrapeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/scrape-logs?limit=100`)
      .then((r) => r.json())
      .then((d) => setLogs(d.logs ?? []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  return { logs, loading, refresh };
}

export function useUsersAdmin() {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/users`)
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  return { users, loading, refresh };
}

export async function sendBulkAlerts(userIds: number[]): Promise<{ sent: number }> {
  const res = await fetch(`${API_BASE}/api/users/send-alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
  return res.json();
}

export async function triggerScrapeAll(): Promise<{ total_found: number }> {
  const res = await fetch(`${API_BASE}/api/scrape-all`, { method: "POST" });
  if (!res.ok) throw new Error("Scrape failed");
  return res.json();
}

export async function createJob(data: {
  title: string;
  company?: string;
  location?: string;
  description?: string;
  job_type?: string;
  experience_level?: string;
  remote?: boolean;
  apply_url?: string;
  tags?: string;
  application_deadline?: string;
}): Promise<{ message: string; job_id: number }> {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to create job");
  return res.json();
}

export async function registerUser(data: { email: string; name?: string; job_interests?: string }) {
  const res = await fetch(`${API_BASE}/api/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
  return res.json();
}
