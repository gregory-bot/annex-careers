import { useRef, useState } from "react";
import { Loader2, PlusCircle, Briefcase, FileText, Paperclip, X, ImageIcon, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { fileUrl, type JobInput, type ListingKind, type UploadResult } from "@/lib/jobStore";

const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,.pdf,.docx,.txt";
const MAX_FILE_MB = 8;

export const jobInputClass =
  "w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary";

const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Attachment", "Freelance"];
const CONTRACT_TYPES = ["Consultancy", "Short-term contract", "Tender / RFP", "Freelance", "Contract"];

const EMPTY_FORM = {
  title: "",
  company: "",
  location: "",
  description: "",
  requirements: "",
  job_type: JOB_TYPES[0],
  experience_level: "",
  remote: false,
  apply_url: "",
  tags: "",
  application_deadline: "",
  tor_url: "",
  duration: "",
  budget: "",
};

type FormState = typeof EMPTY_FORM;

function emptyForm(kind: ListingKind): FormState {
  return { ...EMPTY_FORM, job_type: kind === "contract" ? CONTRACT_TYPES[0] : JOB_TYPES[0] };
}

function toInput(form: FormState, kind: ListingKind, lockedCompany?: string): JobInput {
  const isContract = kind === "contract";
  return {
    kind,
    title: form.title.trim(),
    company: lockedCompany ?? (form.company.trim() || undefined),
    location: form.location.trim() || undefined,
    description: form.description.trim() || undefined,
    requirements: form.requirements.trim() || undefined,
    job_type: form.job_type,
    experience_level: form.experience_level.trim() || undefined,
    remote: form.remote,
    apply_url: form.apply_url.trim() || undefined,
    tags: form.tags.trim() || undefined,
    application_deadline: form.application_deadline || undefined,
    tor_url: isContract ? form.tor_url.trim() || undefined : undefined,
    duration: isContract ? form.duration.trim() || undefined : undefined,
    budget: isContract ? form.budget.trim() || undefined : undefined,
  };
}

/**
 * The listing form shared by the admin "Add Job" tab and the employer portal.
 * Handles both kinds of listing: a job opening, or a contract / consultancy
 * with its terms of reference, duration and budget. Two columns on large
 * screens so it fills the width instead of the height. Resolving `onSubmit`
 * clears the form.
 */
export default function JobForm({
  lockedCompany, initialKind = "job", allowKindSwitch = false,
  submitLabel, submittingLabel, onSubmit, uploader,
}: {
  lockedCompany?: string;
  initialKind?: ListingKind;
  allowKindSwitch?: boolean;
  submitLabel?: string;
  submittingLabel?: string;
  onSubmit: (input: JobInput) => Promise<void>;
  /** Uploads a poster / document and returns what could be read from it. Omit to hide attachments. */
  uploader?: (file: File) => Promise<UploadResult>;
}) {
  const [kind, setKind] = useState<ListingKind>(initialKind);
  const [form, setForm] = useState<FormState>(() => emptyForm(initialKind));
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isContract = kind === "contract";

  /** Fill fields the person has not typed into yet from what was read out of the file. */
  const applySuggestions = (result: UploadResult) => {
    const s = result.suggested || {};
    let filled = 0;
    if (allowKindSwitch && s.kind && s.kind !== kind && !form.title.trim() && !form.description.trim()) {
      switchKind(s.kind);
    }
    setForm((prev) => {
      const next = { ...prev };
      const fill = (field: keyof FormState, value?: string) => {
        if (value && typeof next[field] === "string" && !(next[field] as string).trim()) {
          (next as Record<string, string | boolean>)[field] = value;
          filled += 1;
        }
      };
      fill("title", s.title);
      if (!lockedCompany) fill("company", s.company);
      fill("location", s.location);
      fill("apply_url", s.apply_url);
      fill("application_deadline", s.application_deadline);
      fill("description", s.description);
      if (s.job_type && (s.kind === "contract" ? CONTRACT_TYPES : JOB_TYPES).includes(s.job_type)) fill("job_type", s.job_type);
      return next;
    });
    return filled;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !uploader) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          toast.error(`${file.name} is larger than ${MAX_FILE_MB} MB`);
          continue;
        }
        try {
          const result = await uploader(file);
          setAttachments((prev) => [...prev, result]);
          if (result.read) {
            const filled = applySuggestions(result);
            toast.success(filled > 0
              ? `Read ${file.name} and filled ${filled} field${filled === 1 ? "" : "s"}. Please check them before publishing.`
              : `Attached ${file.name}. Its text is in the description if you need it.`);
          } else if (result.kind === "image" && !result.ocr_available) {
            toast.success(`Attached ${file.name}. Text reading is not enabled on the server, so fill the form manually.`);
          } else {
            toast.success(`Attached ${file.name}. No readable text was found, so fill the form manually.`);
          }
        } catch (err) {
          toast.error(err instanceof Error && err.message ? err.message : `Could not upload ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeAttachment = (id: number) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const update = (field: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const switchKind = (next: ListingKind) => {
    if (next === kind) return;
    setKind(next);
    // Keep what was typed; only the type dropdown has kind-specific options.
    setForm((prev) => ({ ...prev, job_type: next === "contract" ? CONTRACT_TYPES[0] : JOB_TYPES[0] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error(isContract ? "Contract title is required" : "Job title is required");
    if (isContract && form.tor_url.trim() && !/^https?:\/\//i.test(form.tor_url.trim())) {
      return toast.error("The Terms of Reference link must start with http:// or https://");
    }
    setSubmitting(true);
    try {
      await onSubmit({ ...toInput(form, kind, lockedCompany), attachment_ids: attachments.map((a) => a.id) });
      setForm(emptyForm(kind));
      setAttachments([]);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const typeOptions = isContract ? CONTRACT_TYPES : JOB_TYPES;
  const label = submitLabel ?? (isContract ? "Publish contract" : "Add Job");
  const busyLabel = submittingLabel ?? (isContract ? "Publishing..." : "Adding...");

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-4 sm:p-6">
      {allowKindSwitch && (
        <div className="mb-5">
          <div className="inline-flex rounded-lg border border-border bg-muted p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => switchKind("job")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${!isContract ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Briefcase size={15} /> Job opening
            </button>
            <button
              type="button"
              onClick={() => switchKind("contract")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${isContract ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileText size={15} /> Contract / Consultancy
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {isContract
              ? "A short-term assignment, consultancy or tender. Share the terms of reference, duration and budget; it is listed under Contracts."
              : "A permanent, part-time, internship or similar opening; it is listed under Jobs."}
          </p>
        </div>
      )}

      {uploader && (
        <div className="mb-6 rounded-xl border border-dashed border-border bg-muted/40 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><Sparkles size={15} className="text-primary" /> Have a poster, TOR or contract document?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attach it and we read the text to pre-fill the form. Images, PDF, Word or text, up to {MAX_FILE_MB} MB. Images are shown on the listing; documents can be downloaded from it.
              </p>
            </div>
            <div>
              <input ref={fileInput} type="file" accept={ACCEPTED_FILES} multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input bg-card text-sm font-medium hover:bg-muted disabled:opacity-50 whitespace-nowrap">
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                {uploading ? "Reading file..." : "Attach file"}
              </button>
            </div>
          </div>
          {attachments.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-3">
              {attachments.map((a) => (
                <li key={a.id} className="relative flex items-center gap-3 bg-card border border-border rounded-lg p-2 pr-8 max-w-full">
                  {a.kind === "image" ? (
                    <img src={fileUrl(a.url)} alt={a.filename} className="w-14 h-14 rounded-md object-cover border border-border" />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-orange-50 text-orange-700 flex items-center justify-center border border-orange-200"><FileText size={22} /></div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate max-w-[200px]" title={a.filename}>{a.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.kind === "image" ? <span className="inline-flex items-center gap-1"><ImageIcon size={11} /> Poster</span> : "Document"} {"\u00b7"} {(a.size / 1024).toFixed(0)} KB
                      {a.read ? " \u00b7 text read" : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => removeAttachment(a.id)} className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-muted" aria-label={`Remove ${a.filename}`}><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-5 gap-6">
        <div className="space-y-4 xl:col-span-2">
          <div>
            <label className="block text-sm font-medium mb-1">{isContract ? "Contract title *" : "Job Title *"}</label>
            <input type="text" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder={isContract ? "e.g. Consultant - Website Development" : "e.g. Junior Data Analyst"} className={jobInputClass} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{isContract ? "Organization" : "Company"}</label>
              {lockedCompany ? (
                <input type="text" value={lockedCompany} readOnly disabled className={`${jobInputClass} bg-muted text-muted-foreground cursor-not-allowed`} />
              ) : (
                <input type="text" value={form.company} onChange={(e) => update("company", e.target.value)} placeholder={isContract ? "e.g. UN Women Kenya" : "e.g. Safaricom"} className={jobInputClass} />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <input type="text" value={form.location} onChange={(e) => update("location", e.target.value)} placeholder="e.g. Nairobi, Kenya" className={jobInputClass} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{isContract ? "Contract type" : "Job Type"}</label>
              <select value={form.job_type} onChange={(e) => update("job_type", e.target.value)} className={jobInputClass}>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Experience Level</label>
              <select value={form.experience_level} onChange={(e) => update("experience_level", e.target.value)} className={jobInputClass}>
                <option value="">Select...</option>
                <option value="Entry">Entry Level</option>
                <option value="Junior">Junior</option>
                <option value="Mid">Mid Level</option>
                <option value="Senior">Senior</option>
                <option value="Lead">Lead</option>
              </select>
            </div>
          </div>

          {isContract && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Terms of Reference (TOR) link</label>
                <input type="url" value={form.tor_url} onChange={(e) => update("tor_url", e.target.value)} placeholder="https://... (PDF or page with the full TOR)" className={jobInputClass} />
                <p className="text-xs text-muted-foreground mt-1">Optional if you paste the TOR into the scope of work on the right.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Duration</label>
                  <input type="text" value={form.duration} onChange={(e) => update("duration", e.target.value)} placeholder="e.g. 3 months, 20 working days" className={jobInputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Budget / fee</label>
                  <input type="text" value={form.budget} onChange={(e) => update("budget", e.target.value)} placeholder="e.g. KES 800,000 fixed fee" className={jobInputClass} />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{isContract ? "Application / submission link" : "Application Link"}</label>
            <input type="url" value={form.apply_url} onChange={(e) => update("apply_url", e.target.value)} placeholder={isContract ? "https://... or where proposals are submitted" : "https://company.com/apply"} className={jobInputClass} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Tags</label>
              <input type="text" value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder={isContract ? "e.g. web development, monitoring & evaluation" : "e.g. python, data, analytics"} className={jobInputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{isContract ? "Submission deadline" : "Application Deadline"}</label>
              <input type="date" value={form.application_deadline} onChange={(e) => update("application_deadline", e.target.value)} className={jobInputClass} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input type="checkbox" id="job-remote" checked={form.remote} onChange={(e) => update("remote", e.target.checked)} className="rounded" />
            <label htmlFor="job-remote" className="text-sm font-medium">{isContract ? "Can be delivered remotely" : "Remote position"}</label>
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-3">
          <div className="flex flex-col flex-1">
            <label className="block text-sm font-medium mb-1">{isContract ? "Scope of work / Terms of Reference" : "Job Description"}</label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder={isContract ? "Background, objectives, scope of work, deliverables, timeline, reporting..." : "Paste the job description here..."}
              rows={9}
              className={`${jobInputClass} resize-y flex-1 min-h-[180px]`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{isContract ? "Requirements & qualifications" : "Requirements"}</label>
            <textarea
              value={form.requirements}
              onChange={(e) => update("requirements", e.target.value)}
              placeholder={isContract
                ? "One requirement per line, e.g.\nRegistered firm or individual consultant\n5+ years delivering similar assignments\nTechnical and financial proposal"
                : "One requirement per line, e.g.\nBachelor's degree in a related field\n3+ years of experience\nProficiency in SQL"}
              rows={5}
              className={`${jobInputClass} resize-y`}
            />
            <p className="text-xs text-muted-foreground mt-1">One requirement per line. Shown as a bullet list on the listing page.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border">
        <button type="submit" disabled={submitting} className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
          {submitting ? busyLabel : label}
        </button>
      </div>
    </form>
  );
}
