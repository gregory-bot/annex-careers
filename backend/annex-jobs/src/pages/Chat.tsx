import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Plus, FileText, Sparkles, X, Trash2, Download, TrendingUp, TrendingDown, Lightbulb, CheckCircle, ExternalLink } from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";
import jsPDF from "jspdf";
import Layout from "@/components/Layout";
import { useJobs, type Job, registerUser } from "@/lib/jobStore";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  id: string;
  jobId?: string;
  jobTitle?: string;
  messages: Message[];
  updatedAt: number;
}

const GEMINI_API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY || "",
  import.meta.env.VITE_GEMINI_API_KEY_2 || "",
  import.meta.env.VITE_GEMINI_API_KEY_3 || "",
].filter(Boolean);
const GEMINI_MODEL = "gemini-2.5-flash";

async function callGemini(body: object): Promise<any> {
  let lastError: Error | null = null;
  for (const key of GEMINI_API_KEYS) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (resp.status === 429 || resp.status === 403) {
        lastError = new Error(`Quota exceeded (key ending ...${key.slice(-4)})`);
        continue;
      }
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg = errData?.error?.message || `API error: ${resp.status}`;
        if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate")) {
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      return await resp.json();
    } catch (err: any) {
      if (err.message?.toLowerCase().includes("quota") || err.message?.toLowerCase().includes("rate")) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("No Gemini API keys configured.");
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

// ── Prompts ──────────────────────────────────────────
function buildSystemPrompt(jobContext: string | null, jobsOverview: string): string {
  const base = `You are Annex Agent, an AI career assistant on the Annex Careers job platform. Be professional, encouraging, and concise.

CRITICAL OUTPUT FORMAT FOR CV ANALYSIS:
When analyzing a CV against a job, you MUST respond with ONLY a valid JSON object (no text before/after), using this exact structure:
{
  "type": "analysis",
  "title": "CV Alignment for [Job Title]",
  "score": 55,
  "candidate_name": "The full name found in the CV",
  "candidate_email": "the-email@found-in-cv.com",
  "summary": "Brief 2-3 sentence overview of the match.",
  "strengths": [
    {"title": "Strength area name", "detail": "Explanation of why this is a strength."},
    ...more strengths
  ],
  "gaps": [
    {"title": "Gap area name", "detail": "Explanation of the gap and why it matters."},
    ...more gaps
  ],
  "recommendations": [
    {"title": "Recommendation name", "detail": "Specific actionable advice on what to add/change."},
    ...more recommendations
  ]
}

CRITICAL: You MUST always extract "candidate_name" and "candidate_email" from the CV content and include them in the JSON. Look for a name at the top of the CV and an email address anywhere in the CV. If you cannot find a name, use "Unknown". If you cannot find an email, set candidate_email to null.

The score must be a number 0-100. Keep titles short (3-5 words). Details should be 1-3 sentences max. Provide 3-6 items per section.

When the user asks you to WRITE or REVAMP a CV, respond with ONLY a valid JSON object:
{
  "type": "cv",
  "title": "Revamped CV for [Job Title]",
  "cv_text": "The complete CV text with clear sections like PROFESSIONAL SUMMARY, WORK EXPERIENCE, SKILLS, EDUCATION, etc. Use line breaks for formatting."
}

For ALL OTHER conversations (general questions, greetings, follow-ups, job searches, career advice), respond with plain text. Do NOT use JSON. Do NOT use markdown (no **, ##, ###, *). Use plain text with dashes for lists.`;

  if (jobContext) {
    return `${base}

The user is checking alignment for this specific job:
${jobContext}

When they upload a CV or paste text, analyze it and respond with the JSON analysis format. Be honest but encouraging about match scores. If they ask for a revamped CV, respond with the JSON cv format.`;
  }

  return `${base}

You help users with:
- Finding jobs from the platform (here are some available): ${jobsOverview}
- Reviewing CVs/resumes and suggesting improvements
- Matching CVs against specific job descriptions
- Answering career and interview questions

When a user uploads a CV without a specific job context, STILL respond with the JSON analysis format. Use "General CV Review" as the title. Evaluate the CV's overall quality, formatting, and content. Assign a score based on general best practices. ALWAYS extract candidate_name and candidate_email from the CV.`;
}

function buildJobsOverview(jobs: { title: string; company: string; location: string; type: string; salary: string; id: string }[]) {
  return jobs.slice(0, 40).map((j) => `- ${j.title} at ${j.company || "N/A"} (${j.location}, ${j.type || "N/A"}) [ID: ${j.id}]`).join("\n");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getWelcomeMessage(targetJob: Job | null | undefined): Message {
  if (targetJob) {
    return {
      role: "assistant",
      content: `I've loaded the details for "${targetJob.title}". Upload your CV using the + button or paste it as text and I'll give you a detailed alignment report with a match score.`,
    };
  }
  return {
    role: "assistant",
    content: `welcome I'm your career assistant. I can:\n\n- Check your CV alignment against any job listing\n- Review and improve your CV\n- Find jobs matching your skills\n- Answer career and interview questions\n\nUse the + button to upload your CV, or type a question.`,
  };
}

// ── Structured response types ────────────────────────
interface AnalysisData {
  type: "analysis";
  title: string;
  score: number;
  summary: string;
  strengths: { title: string; detail: string }[];
  gaps: { title: string; detail: string }[];
  recommendations: { title: string; detail: string }[];
  candidate_name?: string;
  candidate_email?: string | null;
}

interface CVData {
  type: "cv";
  title: string;
  cv_text: string;
}

type StructuredResponse = AnalysisData | CVData;

function tryParseStructured(content: string): StructuredResponse | null {
  try {
    // Try to extract JSON from the response
    const trimmed = content.trim();
    let jsonStr = trimmed;

    // Handle case where JSON is wrapped in markdown code blocks
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    // Must start with {
    if (!jsonStr.startsWith("{")) return null;

    const parsed = JSON.parse(jsonStr);
    if (parsed.type === "analysis" && typeof parsed.score === "number" && Array.isArray(parsed.strengths)) {
      return parsed as AnalysisData;
    }
    if (parsed.type === "cv" && typeof parsed.cv_text === "string") {
      return parsed as CVData;
    }
    return null;
  } catch {
    return null;
  }
}

function getScoreColor(score: number) {
  if (score >= 75) return { bg: "bg-green-500", text: "text-green-700", light: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", label: "Strong Match" };
  if (score >= 50) return { bg: "bg-yellow-500", text: "text-yellow-700", light: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", label: "Moderate Match" };
  return { bg: "bg-red-500", text: "text-red-700", light: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", label: "Needs Work" };
}

// ── PDF Generator ────────────────────────────────────
function generateCVPdf(cvText: string, jobTitle: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const usable = pageWidth - margin * 2;
  let y = 20;

  // Header bar
  doc.setFillColor(220, 38, 38); // red-600
  doc.rect(0, 0, pageWidth, 12, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("ANNEX CAREERS", margin, 8);
  doc.text("CV Document", pageWidth - margin, 8, { align: "right" });
  y = 22;

  const lines = cvText.split("\n");
  doc.setTextColor(30, 30, 30);

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers (ALL CAPS lines)
    const isHeader = /^[A-Z][A-Z\s&/,()-]{2,}$/.test(trimmed) && trimmed.length > 2;

    if (isHeader) {
      y += 4;
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFillColor(220, 38, 38);
      doc.rect(margin, y - 1, usable, 0.5, "F");
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(220, 38, 38);
      doc.text(trimmed, margin, y);
      y += 6;
      doc.setTextColor(30, 30, 30);
    } else if (trimmed === "") {
      y += 3;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const wrapped = doc.splitTextToSize(trimmed, usable);
      for (const wl of wrapped) {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(wl, margin, y);
        y += 4.5;
      }
    }
  }

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated by Annex Careers | Page ${i} of ${pages}`, pageWidth / 2, 290, { align: "center" });
  }

  const safeName = jobTitle.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
  doc.save(`CV_${safeName}.pdf`);
}

function generateAnalysisPdf(data: AnalysisData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const m = 20;
  const usable = pw - m * 2;
  let y = 0;

  // Red header
  doc.setFillColor(220, 38, 38);
  doc.rect(0, 0, pw, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(data.title, m, 14);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Powered by Annex Careers Agent", m, 22);
  // Score badge
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(pw - m - 30, 6, 30, 16, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(220, 38, 38);
  doc.text(`${data.score}%`, pw - m - 15, 17, { align: "center" });

  y = 36;

  // Summary
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  const summaryLines = doc.splitTextToSize(data.summary, usable);
  for (const sl of summaryLines) {
    doc.text(sl, m, y);
    y += 5;
  }
  y += 4;

  const drawSection = (title: string, items: { title: string; detail: string }[], color: [number, number, number]) => {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFillColor(...color);
    doc.rect(m, y, usable, 0.8, "F");
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...color);
    doc.text(title, m, y);
    y += 7;

    for (const item of items) {
      if (y > 265) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(30, 30, 30);
      doc.text(`• ${item.title}`, m + 2, y);
      y += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      const dLines = doc.splitTextToSize(item.detail, usable - 6);
      for (const dl of dLines) {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(dl, m + 4, y);
        y += 4.2;
      }
      y += 2;
    }
    y += 4;
  };

  drawSection("STRENGTHS", data.strengths, [22, 163, 74]);
  drawSection("GAPS & AREAS FOR IMPROVEMENT", data.gaps, [220, 38, 38]);
  drawSection("ACTIONABLE RECOMMENDATIONS", data.recommendations, [37, 99, 235]);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Annex Careers - CV Analysis Report | Page ${i} of ${pages}`, pw / 2, 290, { align: "center" });
  }

  const safeName = data.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
  doc.save(`${safeName}_Report.pdf`);
}

// ── Styled analysis renderer ─────────────────────────
function AnalysisCard({ data }: { data: AnalysisData }) {
  const sc = getScoreColor(data.score);
  return (
    <div className="w-full space-y-3">
      {/* Header with score */}
      <div className="bg-primary rounded-xl p-4 text-primary-foreground">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mb-1">CV Analysis Report</p>
        <p className="font-heading font-bold text-base sm:text-lg leading-snug">{data.title}</p>
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

      {/* Summary */}
      <div className="bg-muted rounded-xl p-4">
        <p className="text-sm leading-relaxed">{data.summary}</p>
      </div>

      {/* Strengths */}
      <div className="border border-green-200 dark:border-green-800 rounded-xl overflow-hidden">
        <div className="bg-green-50 dark:bg-green-950/30 px-4 py-2.5 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-600" />
          <span className="font-heading font-semibold text-sm text-green-700 dark:text-green-400">Strengths</span>
          <span className="ml-auto text-[10px] font-medium text-green-600 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full">{data.strengths.length} found</span>
        </div>
        <div className="divide-y divide-green-100 dark:divide-green-900/30">
          {data.strengths.map((s, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gaps */}
      <div className="border border-red-200 dark:border-red-800 rounded-xl overflow-hidden">
        <div className="bg-red-50 dark:bg-red-950/30 px-4 py-2.5 flex items-center gap-2">
          <TrendingDown size={16} className="text-red-600" />
          <span className="font-heading font-semibold text-sm text-red-700 dark:text-red-400">Gaps to Address</span>
          <span className="ml-auto text-[10px] font-medium text-red-600 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-full">{data.gaps.length} found</span>
        </div>
        <div className="divide-y divide-red-100 dark:divide-red-900/30">
          {data.gaps.map((g, i) => (
            <div key={i} className="px-4 py-3">
              <p className="text-sm font-medium">{g.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{g.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="border border-blue-200 dark:border-blue-800 rounded-xl overflow-hidden">
        <div className="bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5 flex items-center gap-2">
          <Lightbulb size={16} className="text-blue-600" />
          <span className="font-heading font-semibold text-sm text-blue-700 dark:text-blue-400">Recommendations</span>
        </div>
        <div className="divide-y divide-blue-100 dark:divide-blue-900/30">
          {data.recommendations.map((r, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0 text-[10px] font-bold">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Download report button */}
      <button
        onClick={() => generateAnalysisPdf(data)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:opacity-90 transition-opacity"
      >
        <Download size={16} />
        Download Full Report (PDF)
      </button>
    </div>
  );
}

function CVCard({ data, jobTitle }: { data: CVData; jobTitle: string }) {
  return (
    <div className="w-full space-y-3">
      <div className="bg-primary rounded-xl p-4 text-primary-foreground">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mb-1">Revamped CV</p>
        <p className="font-heading font-bold text-base sm:text-lg leading-snug">{data.title}</p>
      </div>
      <div className="bg-muted rounded-xl p-4 max-h-60 overflow-y-auto">
        <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{data.cv_text}</pre>
      </div>
      <button
        onClick={() => generateCVPdf(data.cv_text, jobTitle || data.title)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:opacity-90 transition-opacity"
      >
        <Download size={16} />
        Download CV (PDF)
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────
const Chat = () => {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");
  const { jobs: allJobs } = useJobs();
  const targetJob = jobId ? allJobs.find((j) => j.id === jobId) : null;

  // Session management
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
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
    const welcome = getWelcomeMessage(jobId ? (allJobs.find((j) => j.id === jobId) || null) : null);
    setActiveSessionId(id);
    setMessages([welcome]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-init when targetJob loads (jobs fetch is async)
  const [jobInitialized, setJobInitialized] = useState(false);
  useEffect(() => {
    if (jobId && targetJob && !jobInitialized) {
      const existing = sessions.find((s) => s.jobId === jobId);
      if (existing) {
        setActiveSessionId(existing.id);
        setMessages(existing.messages);
      } else {
        const welcome = getWelcomeMessage(targetJob);
        setMessages([welcome]);
      }
      setJobInitialized(true);
    }
  }, [targetJob, jobId, jobInitialized, sessions]);

  // Persist messages to localStorage
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ File too large (max 10MB)." }]);
      return;
    }
    if (file.type === "text/plain" || file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (text) setInput((prev) => prev + (prev ? "\n\n" : "") + `[CV from: ${file.name}]\n${text}`);
      };
      reader.readAsText(file);
    } else {
      try {
        const base64 = await fileToBase64(file);
        setUploadedFile({ name: file.name, base64, mimeType: file.type || "application/pdf" });
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Failed to read file." }]);
      }
    }
    e.target.value = "";
  };

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && !uploadedFile) || loading) return;

    const userContent = uploadedFile
      ? (input.trim() ? `${input.trim()}\n\n[Uploaded: ${uploadedFile.name}]` : `[Uploaded CV: ${uploadedFile.name}] Please analyze my CV.`)
      : input.trim();

    const userMsg: Message = { role: "user", content: userContent };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    const currentFile = uploadedFile;
    setUploadedFile(null);

    try {
      if (GEMINI_API_KEYS.length === 0) {
        setMessages([...newMessages, { role: "assistant", content: "⚠️ Gemini API key not configured. Set VITE_GEMINI_API_KEY in .env." }]);
        setLoading(false);
        return;
      }

      const jobContext = targetJob
        ? `Title: ${targetJob.title}\nCompany: ${targetJob.company || "Not listed"}\nLocation: ${targetJob.location || "Not listed"}\nType: ${targetJob.type || "Not listed"}\nSalary: ${targetJob.salary || "Not listed"}\n\nDescription:\n${targetJob.description}\n\nRequirements:\n${targetJob.requirements?.join("\n") || "Not specified"}`
        : null;

      const systemPrompt = buildSystemPrompt(jobContext, buildJobsOverview(allJobs));
      const convo = newMessages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
      const parts: any[] = [{ text: `${systemPrompt}\n\nConversation:\n${convo}\n\nAssistant:` }];

      if (currentFile) {
        parts.unshift({ inline_data: { mime_type: currentFile.mimeType, data: currentFile.base64 } });
      }

      const data = await callGemini({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } });

      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process that.";

      // Parse structured JSON BEFORE stripping markdown (to preserve JSON integrity)
      let extractedAnalysis: any = null;
      try {
        const parsed = tryParseStructured(text);
        if (parsed?.type === "analysis") {
          extractedAnalysis = parsed;
        }
      } catch { /* ignore parse errors */ }

      // Strip any markdown formatting for plain text responses
      text = text.replace(/#{1,6}\s?/g, "").replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1").replace(/_{1,2}([^_]+)_{1,2}/g, "$1").replace(/```json\s*/g, "").replace(/```\s*/g, "");
      setMessages([...newMessages, { role: "assistant", content: text }]);

      // Silently extract and register user from CV analysis
      if (extractedAnalysis) {
        try {
          const email = extractedAnalysis.candidate_email;
          const name = extractedAnalysis.candidate_name && extractedAnalysis.candidate_name !== "Unknown" ? extractedAnalysis.candidate_name : undefined;
          if (email && typeof email === "string" && email.includes("@")) {
            const jobTitle = targetJob?.title || extractedAnalysis.title?.replace(/^CV Alignment for\s*/i, "") || undefined;
            registerUser({
              email,
              name,
              job_interests: jobTitle,
            }).catch(() => {});
          }
        } catch { /* silent — don't disrupt chat */ }
      }
    } catch (err: any) {
      setMessages([...newMessages, { role: "assistant", content: ` ${err.message || "Something went wrong."}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, uploadedFile, loading, messages, targetJob, allJobs]);

  const startNewSession = () => {
    const id = generateSessionId();
    setActiveSessionId(id);
    setMessages([getWelcomeMessage(null)]);
    setUploadedFile(null);
    setInput("");
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
            {/* Agent branding */}
            <div className="flex items-center gap-3 mb-4">
              
              <div>
                <h1 className="font-heading font-bold text-base">Annex Agent</h1>
                <p className="text-[11px] text-muted-foreground">Career Assistant</p>
              </div>
            </div>

            {/* Target job card */}
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
                    <li>Experience alignment</li>
                    <li>Skills gap analysis</li>
                    <li>CV improvement tips</li>
                    <li>Match score</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Capabilities when no job */}
            {!targetJob && (
              <div className="bg-muted rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold mb-3">I can help you with:</p>
                <ul className="text-[11px] text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">1</span>
                    <span>Check if your CV matches a specific job</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">2</span>
                    <span>Review and improve your CV</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">3</span>
                    <span>Find jobs matching your skills</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">4</span>
                    <span>Answer career & interview questions</span>
                  </li>
                </ul>
              </div>
            )}

            {/* Chat history */}
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
                  {targetJob ? targetJob.title : "AI Career Assistant"}
                </p>
              </div>
              <button onClick={() => setShowHistory(!showHistory)} className="text-xs text-primary font-medium px-2 py-1 rounded-lg hover:bg-muted">
                History
              </button>
            </div>

            {/* Mobile history dropdown */}
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

            {/* Messages — scrolls within this container */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg, i) => {
                // Try to parse structured JSON response
                const structured = msg.role === "assistant" ? tryParseStructured(msg.content) : null;

                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-sm whitespace-pre-wrap leading-relaxed break-words">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                // Structured analysis card
                if (structured?.type === "analysis") {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[95%] sm:max-w-[85%]">
                        <AnalysisCard data={structured} />
                      </div>
                    </div>
                  );
                }

                // Structured CV card
                if (structured?.type === "cv") {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[95%] sm:max-w-[85%]">
                        <CVCard data={structured} jobTitle={targetJob?.title || ""} />
                      </div>
                    </div>
                  );
                }

                // Plain text fallback — parse job references into clickable links
                const cleanContent = msg.content
                  .replace(/--- START OF CV ---\n?/g, "")
                  .replace(/\n?--- END OF CV ---/g, "");

                // Split text around job reference patterns like: - Job Title – Location [ID: 6213]
                const jobRefRegex = /- (.+?)\s*\[ID:\s*(\d+)\]/g;
                const parts: (string | { label: string; id: string })[] = [];
                let lastIdx = 0;
                let match: RegExpExecArray | null;
                while ((match = jobRefRegex.exec(cleanContent)) !== null) {
                  if (match.index > lastIdx) parts.push(cleanContent.slice(lastIdx, match.index));
                  parts.push({ label: match[1].trim(), id: match[2] });
                  lastIdx = match.index + match[0].length;
                }
                if (lastIdx < cleanContent.length) parts.push(cleanContent.slice(lastIdx));

                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl rounded-bl-sm bg-muted text-foreground text-sm whitespace-pre-wrap leading-relaxed break-words">
                      {parts.map((part, pi) =>
                        typeof part === "string" ? (
                          <span key={pi}>{part}</span>
                        ) : (
                          <Link
                            key={pi}
                            to={`/jobs/${part.id}`}
                            className="flex items-center gap-2 my-2 px-3 py-2.5 bg-white dark:bg-card border border-border rounded-xl hover:border-primary/50 hover:shadow-sm transition-all group no-underline"
                          >
                            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <FileText size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{part.label}</p>
                              <p className="text-[10px] text-muted-foreground">Tap to view & apply</p>
                            </div>
                            <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary shrink-0" />
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">Analyzing...</span>
                  </div>
                </div>
              )}
            </div>

            {/* File preview */}
            {uploadedFile && (
              <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
                <FileText size={14} className="text-blue-600 shrink-0" />
                <span className="text-xs font-medium truncate flex-1">{uploadedFile.name}</span>
                <button onClick={() => setUploadedFile(null)} className="text-muted-foreground hover:text-foreground" title="Remove file">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Input bar — pinned at bottom */}
            <div className="px-4 py-3 border-t border-border bg-card shrink-0">
              <input ref={fileInputRef} type="file" accept=".txt,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={handleFileUpload} className="hidden" title="Upload CV or resume" />
              <div className="flex gap-2 items-end">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-full bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors shrink-0"
                  title="Upload CV/Resume"
                >
                  <Plus size={20} />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder={targetJob ? "Upload your CV or paste it here..." : "Ask anything about jobs or your career..."}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[40px] max-h-28 resize-none min-w-0"
                  rows={1}
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || (!input.trim() && !uploadedFile)}
                  className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
                  title="Send message"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;
