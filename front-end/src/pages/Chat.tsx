import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Plus, FileText, Sparkles, X, Trash2, Download, TrendingUp, TrendingDown, Lightbulb, CheckCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { useDocumentMeta } from "@/lib/seo";
import { useJob, type Job, type CvAnalysisResult, analyzeCv, generateAtsCv } from "@/lib/jobStore";

interface Message {
  role: "user" | "assistant";
  content?: string;
  analysis?: CvAnalysisResult;
  download?: { url: string; filename: string };
}

interface ChatSession {
  id: string;
  jobId?: string;
  jobTitle?: string;
  messages: Message[];
  updatedAt: number;
}

const STORAGE_KEY = "annex_agent_sessions";

// ── Session persistence ──────────────────────────────
function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function generateSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getWelcomeMessage(targetJob: Job | null | undefined): Message {
  if (targetJob) {
    return {
      role: "assistant",
      content: `I've loaded the details for "${targetJob.title}". Attach your CV below, then choose "Check Fit" for a match report or "Generate ATS CV" for a tailored, ATS-optimized rewrite.`,
    };
  }
  return {
    role: "assistant",
    content: `Welcome! Attach your CV using the + button, then:\n\n- Check Fit: get a match score and gap analysis (open this from a specific job page for the most useful results)\n- Generate ATS CV: get a clean, ATS-optimized rewrite of your CV as a PDF\n\nThis runs entirely on our servers. No data leaves Annex Careers.`,
  };
}

function getScoreColor(score: number) {
  if (score >= 75) return { light: "bg-green-50 dark:bg-green-950/30", label: "Strong Match" };
  if (score >= 50) return { light: "bg-yellow-50 dark:bg-yellow-950/30", label: "Moderate Match" };
  return { light: "bg-red-50 dark:bg-red-950/30", label: "Needs Work" };
}

// ── Styled analysis renderer ─────────────────────────
function AnalysisCard({
  data, jobTitle, onGenerate, generating,
}: { data: CvAnalysisResult; jobTitle?: string; onGenerate?: () => void; generating?: boolean }) {
  const sc = getScoreColor(data.score);
  return (
    <div className="w-full space-y-3">
      <div className="bg-primary rounded-xl p-4 text-primary-foreground">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mb-1">CV Analysis Report</p>
        <p className="font-heading font-bold text-base sm:text-lg leading-snug">{jobTitle ? `CV Alignment for ${jobTitle}` : "General CV Review"}</p>
        <div className="flex items-center gap-3 mt-3">
          <div className="w-16 h-16 rounded-xl bg-white/20 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold">{data.score}%</span>
          </div>
          <div className="flex-1">
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-1000" style={{ width: `${data.score}%` }} />
            </div>
            <p className="text-xs mt-1 opacity-80">{sc.label}</p>
          </div>
        </div>
      </div>

      <div className={`rounded-xl p-4 ${sc.light}`}>
        <p className="text-sm leading-relaxed">{data.summary}</p>
        {data.low_confidence && (
          <p className="text-xs text-muted-foreground mt-2">
            Note: this CV's layout was hard to parse automatically (confidence: {data.parse_confidence}%). Using clear
            section headers (Experience, Education, Skills) will improve accuracy.
          </p>
        )}
      </div>

      {(data.matched_skills.length > 0 || data.missing_skills.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.matched_skills.length > 0 && (
            <div className="border border-green-200 dark:border-green-800 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-green-700 dark:text-green-400 mb-2">Matched skills</p>
              <div className="flex flex-wrap gap-1.5">
                {data.matched_skills.map((s) => (
                  <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">{s}</span>
                ))}
              </div>
            </div>
          )}
          {data.missing_skills.length > 0 && (
            <div className="border border-red-200 dark:border-red-800 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-400 mb-2">Missing skills</p>
              <div className="flex flex-wrap gap-1.5">
                {data.missing_skills.map((s) => (
                  <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="border border-green-200 dark:border-green-800 rounded-xl overflow-hidden">
        <div className="bg-green-50 dark:bg-green-950/30 px-4 py-2.5 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-600" />
          <span className="font-heading font-semibold text-sm text-green-700 dark:text-green-400">Strengths</span>
        </div>
        <div className="divide-y divide-green-100 dark:divide-green-900/30">
          {data.strengths.map((s, i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-2">
              <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {data.gaps.length > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-xl overflow-hidden">
          <div className="bg-red-50 dark:bg-red-950/30 px-4 py-2.5 flex items-center gap-2">
            <TrendingDown size={16} className="text-red-600" />
            <span className="font-heading font-semibold text-sm text-red-700 dark:text-red-400">Gaps to Address</span>
          </div>
          <div className="divide-y divide-red-100 dark:divide-red-900/30">
            {data.gaps.map((g, i) => (
              <div key={i} className="px-4 py-3">
                <p className="text-sm leading-relaxed">{g}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-blue-200 dark:border-blue-800 rounded-xl overflow-hidden">
        <div className="bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5 flex items-center gap-2">
          <Lightbulb size={16} className="text-blue-600" />
          <span className="font-heading font-semibold text-sm text-blue-700 dark:text-blue-400">Recommendations</span>
        </div>
        <div className="divide-y divide-blue-100 dark:divide-blue-900/30">
          {data.recommendations.map((r, i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0 text-[10px] font-bold">{i + 1}</span>
              <p className="text-sm leading-relaxed">{r}</p>
            </div>
          ))}
        </div>
      </div>

      {onGenerate && (
        <button
          onClick={onGenerate}
          disabled={!!generating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {generating ? "Generating..." : "Generate ATS CV from this"}
        </button>
      )}
    </div>
  );
}

function DownloadCard({ download }: { download: { url: string; filename: string } }) {
  return (
    <div className="w-full bg-muted rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <FileText size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{download.filename}</p>
        <p className="text-xs text-muted-foreground">Your ATS-optimized CV is ready</p>
      </div>
      <a
        href={download.url}
        download={download.filename}
        className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:opacity-90 transition-opacity shrink-0"
      >
        <Download size={14} /> Download
      </a>
    </div>
  );
}

const ACCEPTED_TYPES = ".pdf,.docx,.txt";

// ── Component ────────────────────────────────────────
const Chat = () => {
  useDocumentMeta({ title: "CV Check", description: "Upload your CV to see how well it matches a job and get an ATS-friendly version." });
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");
  const { job: targetJob } = useJob(jobId ?? undefined);

  // Session management
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<"analyze" | "generate" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingGenerate, setPendingGenerate] = useState<{ file: File; missingSkills: string[] } | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  // Kept in memory only (not persisted) so a "Generate ATS CV from this"
  // button can reuse the CV already uploaded for a Check Fit, without
  // asking the user to attach the same file again.
  const [lastFile, setLastFile] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or restore session
  useEffect(() => {
    const existing = loadSessions();
    setSessions(existing);

    if (jobId) {
      const jobSession = existing.find((s) => s.jobId === jobId);
      if (jobSession) {
        setActiveSessionId(jobSession.id);
        setMessages(jobSession.messages);
        return;
      }
    }

    const id = generateSessionId();
    const welcome = getWelcomeMessage(jobId ? (targetJob || null) : null);
    setActiveSessionId(id);
    setMessages([welcome]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-init when targetJob loads (job fetch is async)
  const [jobInitialized, setJobInitialized] = useState(false);
  useEffect(() => {
    if (jobId && targetJob && !jobInitialized) {
      const existing = sessions.find((s) => s.jobId === jobId);
      if (existing) {
        setActiveSessionId(existing.id);
        setMessages(existing.messages);
      } else {
        setMessages([getWelcomeMessage(targetJob)]);
      }
      setJobInitialized(true);
    }
  }, [targetJob, jobId, jobInitialized, sessions]);

  // Persist messages to localStorage (download blob URLs die on reload —
  // that's an accepted rough edge, not a functional requirement)
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const updated = loadSessions();
    const idx = updated.findIndex((s) => s.id === activeSessionId);
    const session: ChatSession = {
      id: activeSessionId,
      jobId: jobId || undefined,
      jobTitle: targetJob?.title,
      messages,
      updatedAt: Date.now(),
    };
    if (idx >= 0) updated[idx] = session;
    else updated.unshift(session);
    const trimmed = updated.slice(0, 20);
    saveSessions(trimmed);
    setSessions(trimmed);
  }, [messages, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessages((prev) => [...prev, { role: "assistant", content: "File too large (max 10MB)." }]);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext || "")) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Unsupported file type. Please upload a .pdf, .docx, or .txt file." }]);
      return;
    }
    setAttachedFile(file);
  };

  const finalizeAction = async (action: "analyze" | "generate", file: File, confirmedSkills: string[] = []) => {
    const actionLabel = action === "analyze" ? "Check Fit" : "Generate ATS CV";
    const skillsNote = confirmedSkills.length > 0 ? ` (confirmed: ${confirmedSkills.join(", ")})` : "";
    const userMsg: Message = { role: "user", content: `Uploaded "${file.name}": ${actionLabel}${targetJob ? ` for "${targetJob.title}"` : ""}${skillsNote}` };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(action);

    try {
      if (action === "analyze") {
        const result = await analyzeCv(file, jobId ?? undefined);
        setMessages([...newMessages, { role: "assistant", analysis: result }]);
      } else {
        const { blob, filename } = await generateAtsCv(file, jobId ?? undefined, confirmedSkills);
        const url = URL.createObjectURL(blob);
        setMessages([...newMessages, {
          role: "assistant",
          content: "Your ATS-optimized CV is ready.",
          download: { url, filename },
        }]);
      }
    } catch (err: any) {
      setMessages([...newMessages, { role: "assistant", content: err.message || "Something went wrong. Please try again." }]);
    } finally {
      setLoading(null);
    }
  };

  const startGenerate = async (file: File) => {
    // Generating for a specific job: check which of that job's required
    // skills are missing from the CV first, so the user can explicitly
    // confirm any they actually have before we add them — the tool never
    // adds a skill on its own.
    if (jobId) {
      setLoading("generate");
      try {
        const preview = await analyzeCv(file, jobId);
        setLoading(null);
        if (preview.missing_skills.length > 0) {
          setPendingGenerate({ file, missingSkills: preview.missing_skills });
          setSelectedSkills(new Set());
          return;
        }
      } catch (err: any) {
        setLoading(null);
        setMessages((prev) => [...prev, { role: "assistant", content: err.message || "Something went wrong. Please try again." }]);
        return;
      }
    }

    await finalizeAction("generate", file);
  };

  const runAction = async (action: "analyze" | "generate") => {
    if (!attachedFile || loading) return;
    const file = attachedFile;
    setAttachedFile(null);
    setLastFile(file);

    if (action === "analyze") {
      await finalizeAction("analyze", file);
    } else {
      await startGenerate(file);
    }
  };

  const regenerateFromLastFile = () => {
    if (!lastFile || loading) return;
    startGenerate(lastFile);
  };

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const confirmGenerate = async () => {
    if (!pendingGenerate) return;
    const { file } = pendingGenerate;
    const confirmedSkills = Array.from(selectedSkills);
    setPendingGenerate(null);
    await finalizeAction("generate", file, confirmedSkills);
  };

  const cancelPendingGenerate = () => setPendingGenerate(null);

  const startNewSession = () => {
    const id = generateSessionId();
    setActiveSessionId(id);
    setMessages([getWelcomeMessage(null)]);
    setAttachedFile(null);
  };

  const loadSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setShowHistory(false);
  };

  const deleteSession = (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    saveSessions(updated);
    setSessions(updated);
    if (sessionId === activeSessionId) startNewSession();
  };

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20 h-screen flex flex-col overflow-hidden">
        <div className="container flex-1 flex gap-0 lg:gap-5 px-4 py-3 max-w-7xl mx-auto w-full min-h-0">

          {/* ── Left Panel: Job Info + History (desktop only) ── */}
          <div className="hidden lg:flex flex-col w-80 shrink-0 min-h-0">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h1 className="font-heading font-bold text-base">Annex Agent</h1>
                <p className="text-[11px] text-muted-foreground">CV Fit Checker &amp; ATS Rewriter</p>
              </div>
            </div>

            {targetJob && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-4">
                <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">Analyzing job</p>
                <p className="font-heading font-semibold text-sm leading-snug mb-1">{targetJob.title}</p>
                {targetJob.company && <p className="text-xs text-muted-foreground">{targetJob.company}</p>}
                {targetJob.location && <p className="text-xs text-muted-foreground">{targetJob.location}</p>}
                {targetJob.type && (
                  <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {targetJob.type}
                  </span>
                )}
                <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                  <p className="text-[10px] text-muted-foreground mb-1">What I'll check:</p>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    <li>Skill keyword overlap</li>
                    <li>Missing skills for this role</li>
                    <li>CV structure &amp; completeness</li>
                    <li>Match score</li>
                  </ul>
                </div>
              </div>
            )}

            {!targetJob && (
              <div className="bg-muted rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold mb-3">I can help you with:</p>
                <ul className="text-[11px] text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">1</span>
                    <span>Check if your CV matches a specific job (open this from a job page)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">2</span>
                    <span>Generate a clean, ATS-optimized rewrite of your CV</span>
                  </li>
                </ul>
              </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">Chat History</p>
                <button onClick={startNewSession} className="text-[10px] text-primary font-medium hover:underline">+ New Chat</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                      s.id === activeSessionId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <button onClick={() => loadSession(s)} className="flex-1 text-left truncate min-w-0">
                      {s.jobTitle || "General chat"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 shrink-0"
                      title="Delete chat"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/60 px-3 py-4">No previous chats</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Right Panel: Chat Area ── */}
          <div className="flex-1 flex flex-col min-h-0 bg-card border border-border rounded-2xl overflow-hidden">

            {/* Mobile header */}
            <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground flex items-center justify-center shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-sm">Annex Agent</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {targetJob ? targetJob.title : "CV Fit Checker & ATS Rewriter"}
                </p>
              </div>
              <button onClick={() => setShowHistory(!showHistory)} className="text-xs text-primary font-medium px-2 py-1 rounded-lg hover:bg-muted">
                History
              </button>
            </div>

            {showHistory && (
              <div className="lg:hidden border-b border-border bg-muted/50 px-4 py-3 max-h-48 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold">Chat History</p>
                  <button onClick={startNewSession} className="text-[10px] text-primary font-medium">+ New</button>
                </div>
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadSession(s)}
                    className={`block w-full text-left px-3 py-1.5 rounded text-xs truncate ${s.id === activeSessionId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    {s.jobTitle || "General chat"}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg, i) => {
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-sm whitespace-pre-wrap leading-relaxed break-words">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                if (msg.analysis) {
                  const isLatest = i === messages.length - 1;
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[95%] sm:max-w-[85%]">
                        <AnalysisCard
                          data={msg.analysis}
                          jobTitle={targetJob?.title}
                          onGenerate={isLatest && lastFile ? regenerateFromLastFile : undefined}
                          generating={isLatest && loading === "generate"}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[95%] sm:max-w-[85%] space-y-2">
                      {msg.content && (
                        <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-muted text-foreground text-sm whitespace-pre-wrap leading-relaxed break-words inline-block">
                          {msg.content}
                        </div>
                      )}
                      {msg.download && <DownloadCard download={msg.download} />}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">{loading === "analyze" ? "Analyzing your CV..." : "Generating your ATS CV..."}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Attached file + actions */}
            <div className="px-4 pb-3 border-t border-border bg-card shrink-0 pt-3">
              <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} onChange={handleFileUpload} className="hidden" title="Upload CV or resume" />

              {pendingGenerate ? (
                <div className="space-y-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <p className="text-xs leading-relaxed text-foreground">
                    {targetJob?.title ? <strong>{targetJob.title}</strong> : "This role"} also asks for these skills, which
                    weren't found in your CV. Only select the ones you genuinely have. We'll never add a skill you
                    haven't confirmed.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingGenerate.missingSkills.map((skill) => (
                      <label
                        key={skill}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs cursor-pointer border transition-colors ${
                          selectedSkills.has(skill)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/50"
                        }`}
                      >
                        <input type="checkbox" className="hidden" checked={selectedSkills.has(skill)} onChange={() => toggleSkill(skill)} />
                        {skill}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={cancelPendingGenerate}
                      disabled={!!loading}
                      className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmGenerate}
                      disabled={!!loading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Sparkles size={16} /> Generate{selectedSkills.size > 0 ? ` (+${selectedSkills.size})` : ""}
                    </button>
                  </div>
                </div>
              ) : attachedFile ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
                    <FileText size={14} className="text-blue-600 shrink-0" />
                    <span className="text-xs font-medium truncate flex-1">{attachedFile.name}</span>
                    <button onClick={() => setAttachedFile(null)} className="text-muted-foreground hover:text-foreground" title="Remove file">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runAction("analyze")}
                      disabled={!!loading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle size={16} /> Check Fit
                    </button>
                    <button
                      onClick={() => runAction("generate")}
                      disabled={!!loading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Sparkles size={16} /> Generate ATS CV
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-primary transition-colors text-sm font-medium"
                >
                  <Plus size={18} /> Attach your CV (.pdf, .docx, .txt)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;
