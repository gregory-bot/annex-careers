import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, KeyRound, Briefcase, ExternalLink, CircleCheck, Repeat, Trash2, Eye, MousePointerClick, Star } from "lucide-react";
import Layout from "@/components/Layout";
import JobForm from "@/components/JobForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  employerLogin, getEmployerToken, clearEmployerToken, useEmployerMe, uploadListingFile,
  createEmployerJob, closeEmployerJob, repostEmployerJob, deleteEmployerJob, EmployerSessionError,
  type JobInput, type EmployerJob,
} from "@/lib/jobStore";

const inputClass =
  "w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary";

function formatCode(value: string) {
  // XXXX-XXXX-XXXX as the user types; letters upper-cased, look-alikes left to the server to reject.
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return raw.replace(/(.{4})(?=.)/g, "$1-");
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Public page companies reach from their invitation email. Email + access
 * code unlock only this page: a job form locked to their company, and the
 * list of jobs they have posted.
 */
const EmployerPortal = () => {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getEmployerToken()));
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmployerJob | null>(null);

  const { me, loading, error, refresh } = useEmployerMe(authed);

  // A token that the server no longer accepts drops us back to the sign-in card.
  useEffect(() => {
    if (error instanceof EmployerSessionError || (error && !getEmployerToken())) {
      setAuthed(false);
      toast.error(errorMessage(error, "Your session has ended. Please sign in again."));
    }
  }, [error]);

  const signOut = () => {
    clearEmployerToken();
    queryClient.removeQueries({ queryKey: ["employer"] });
    setAuthed(false);
    setCode("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !code.trim()) return toast.error("Enter your email and access code");
    setSigningIn(true);
    try {
      const session = await employerLogin(email, code);
      toast.success(`Welcome, ${session.contact_name || session.company_name}`);
      setAuthed(true);
    } catch (err) {
      toast.error(errorMessage(err, "Invalid email or access code"));
    } finally {
      setSigningIn(false);
    }
  };

  const handlePost = async (input: JobInput) => {
    const result = await createEmployerJob(input);
    toast.success(`"${result.job.title}" is now live under ${result.job.kind === "contract" ? "Contracts" : "Jobs"} on Annex Careers`);
    queryClient.invalidateQueries({ queryKey: ["employer", "me"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };

  // One handler shape for close / repost / delete: run, toast, refresh the list.
  const runJobAction = async (id: string, action: () => Promise<{ message: string }>, fallback: string) => {
    setActingId(id);
    try {
      const result = await action();
      toast.success(result.message);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      if (err instanceof EmployerSessionError) signOut();
      toast.error(errorMessage(err, fallback));
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const job = pendingDelete;
    setPendingDelete(null);
    await runJobAction(job.id, () => deleteEmployerJob(job.id), "Failed to delete job");
  };

  const totals = me
    ? me.jobs.reduce(
        (acc, job) => ({
          live: acc.live + (job.is_active ? 1 : 0),
          views: acc.views + job.views,
          clicks: acc.clicks + job.apply_clicks,
        }),
        { live: 0, views: 0, clicks: 0 },
      )
    : { live: 0, views: 0, clicks: 0 };

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-24 pb-16 bg-muted min-h-screen">
        <div className="container px-4 max-w-6xl">
          {!authed ? (
            <div className="max-w-md mx-auto bg-card border border-border rounded-2xl p-8 shadow-lg">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
                <KeyRound size={22} />
              </div>
              <h1 className="font-heading text-2xl font-bold text-center mb-2">Employer sign in</h1>
              <p className="text-sm text-muted-foreground text-center mb-8">
                Use the email address we contacted you on and the access code from your invitation.
              </p>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Work email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" required />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Access code</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(formatCode(e.target.value))}
                    placeholder="XXXX-XXXX-XXXX"
                    className={`${inputClass} font-mono tracking-widest uppercase`}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <button type="submit" disabled={signingIn} className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
                  {signingIn ? <><Loader2 size={16} className="animate-spin" /> Signing in...</> : "Continue"}
                </button>
              </form>
              <p className="text-xs text-muted-foreground text-center mt-6">
                Don&apos;t have a code? Reply to your invitation email or contact Annex Careers to request access.
              </p>
            </div>
          ) : loading || !me ? (
            <div className="text-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Posting as</p>
                  <h1 className="font-heading text-2xl font-bold">{me.company_name}</h1>
                  <p className="text-sm text-muted-foreground">
                    Jobs and contracts you publish here appear on Annex Careers immediately.
                    {me.expires_at ? ` Your access is valid until ${new Date(me.expires_at).toLocaleDateString()}.` : ""}
                  </p>
                </div>
                <button onClick={signOut} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-sm hover:bg-card">
                  <LogOut size={16} /> Sign out
                </button>
              </div>

              <h2 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2"><Briefcase size={18} className="text-primary" /> Post a job or a contract</h2>
              <JobForm lockedCompany={me.company_name} allowKindSwitch submittingLabel="Publishing..." onSubmit={handlePost} uploader={(file) => uploadListingFile(file, "employer")} />

              <div className="mt-10 mb-3 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <h2 className="font-heading font-semibold text-lg">Your postings ({me.jobs.length})</h2>
                  <p className="text-xs text-muted-foreground">
                    Views counts people who opened a job page. Apply clicks counts those who pressed Apply Now on it.
                    Want a listing pinned to the top of the site? Ask us about featured placement.
                  </p>
                </div>
              </div>
              {me.jobs.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-2xl font-bold font-heading">{totals.live}</p>
                    <p className="text-xs text-muted-foreground">Live jobs</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-2xl font-bold font-heading flex items-center gap-2"><Eye size={18} className="text-muted-foreground" />{totals.views.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Job page views</p>
                  </div>
                  <div className="bg-card border border-primary/40 rounded-xl p-4">
                    <p className="text-2xl font-bold font-heading flex items-center gap-2 text-primary"><MousePointerClick size={18} />{totals.clicks.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Apply Now clicks</p>
                  </div>
                </div>
              )}
              {me.jobs.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-xl text-center py-10 text-sm text-muted-foreground">
                  Nothing posted yet. Your first job or contract will show here once you publish it.
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Kind</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Location</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Posted</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground text-right hidden sm:table-cell">Views</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground text-right">Apply clicks</th>
                          <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {me.jobs.map((job) => {
                          const busy = actingId === job.id;
                          return (
                          <tr key={job.id} className={`border-b border-border last:border-0 ${busy ? "opacity-60" : ""}`}>
                            <td className="px-4 py-3 font-medium">
                              <div className="flex items-center gap-2">
                                {job.title}
                                {job.is_featured && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground" title={`Featured until ${new Date(job.featured_until).toLocaleDateString()}`}>
                                    <Star size={9} fill="currentColor" /> Featured
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${job.kind === "contract" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                                {job.kind === "contract" ? "Contract" : "Job"}
                              </span>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{job.location || "\u2014"}</td>
                            <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                              {job.posted ? new Date(job.posted).toLocaleDateString() : "\u2014"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${job.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                                {job.is_active && <CircleCheck size={11} />}{job.is_active ? "Live" : "Closed"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">{job.views.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold">{job.apply_clicks.toLocaleString()}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1 flex-wrap">
                                <Link to={`/jobs/${job.id}`} target="_blank" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10">
                                  <ExternalLink size={13} /><span className="hidden sm:inline">View</span>
                                </Link>
                                <button
                                  onClick={() => runJobAction(job.id, () => repostEmployerJob(job.id), "Failed to repost job")}
                                  disabled={actingId !== null}
                                  title="Repost: move back to the top of the listing (and reopen if closed)"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                                >
                                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Repeat size={13} />}<span className="hidden sm:inline">Repost</span>
                                </button>
                                {job.is_active && (
                                  <button
                                    onClick={() => runJobAction(job.id, () => closeEmployerJob(job.id), "Failed to close job")}
                                    disabled={actingId !== null}
                                    title="Close: hide from the site but keep it here"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50"
                                  >
                                    Close
                                  </button>
                                )}
                                <button
                                  onClick={() => setPendingDelete(job)}
                                  disabled={actingId !== null}
                                  title="Delete permanently"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <Trash2 size={13} /><span className="hidden sm:inline">Delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this job?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        description={pendingDelete ? `"${pendingDelete.title}" will be removed from Annex Careers permanently, along with its view and click counts. If you only want to stop applications, use Close instead.` : null}
      />
    </Layout>
  );
};

export default EmployerPortal;
