import { Mail, Briefcase, ShieldAlert } from "lucide-react";
import Layout from "@/components/Layout";
import { CONTACT_EMAIL } from "@/components/LegalPage";
import { useDocumentMeta } from "@/lib/seo";

const reasons = [
  { icon: Mail, title: "General questions", text: "Feedback, partnerships, or help using the site." },
  { icon: Briefcase, title: "Employers", text: "Post vacancies on Annex Careers or advertise with us." },
  { icon: ShieldAlert, title: "Report a listing", text: "Tell us about a suspicious listing, or one that asks for money. Include the link." },
];

const Contact = () => {
  useDocumentMeta({ title: "Contact Us", description: `Get in touch with Annex Careers at ${CONTACT_EMAIL}.` });
  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="bg-primary text-primary-foreground">
          <div className="container py-16 sm:py-20 px-4 text-center">
            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold mb-4">Contact Us</h1>
            <p className="text-primary-foreground/80 max-w-xl mx-auto text-base sm:text-lg mb-8">
              Questions, feedback or partnership ideas? Send us an email.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 px-8 py-3 bg-background text-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity break-all"
            >
              <Mail className="w-4 h-4 shrink-0" /> {CONTACT_EMAIL}
            </a>
          </div>
        </div>

        <div className="container py-16 sm:py-20 px-4">
          <div className="grid md:grid-cols-3 gap-5">
            {reasons.map(({ icon: Icon, title, text }) => (
              <a
                key={title}
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(title)}`}
                className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors"
              >
                <Icon className="w-6 h-6 text-primary mb-3" />
                <h2 className="font-heading font-semibold text-base mb-2">{title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Contact;
