import { Link } from "react-router-dom";
import LegalPage, { CONTACT_EMAIL, type LegalSection } from "@/components/LegalPage";
import { useDocumentMeta } from "@/lib/seo";

const sections: LegalSection[] = [
  {
    heading: "About the service",
    body: (
      <p>
        Annex Careers collects job and contract listings from job boards, company career pages and employers, and shows them
        in one place. By using the site you agree to these terms.
      </p>
    ),
  },
  {
    heading: "Listings",
    body: (
      <>
        <p>
          We work to keep listings accurate and current, but we do not employ the people hiring and cannot guarantee that a
          listing is accurate, still open or genuine. Always check a role on the employer's own site before you apply.
        </p>
        <p>
          <strong>Never pay anyone to get a job.</strong> Genuine employers do not charge application or placement fees. If a
          listing asks for money, report it to us.
        </p>
      </>
    ),
  },
  {
    heading: "CV Check",
    body: (
      <p>
        Match scores, feedback and generated CVs are automated suggestions and do not guarantee an interview or a job. You are
        responsible for checking that your CV is accurate before you send it anywhere.
      </p>
    ),
  },
  {
    heading: "Employers",
    body: (
      <p>
        Employers who post on Annex Careers must post real, lawful vacancies and must not charge candidates fees. We may edit or
        remove any listing, or close an employer account, at our discretion.
      </p>
    ),
  },
  {
    heading: "Acceptable use",
    body: (
      <p>
        Do not misuse the site: no attempts to break or overload it, no bulk scraping of our pages, no uploading of malicious
        files, and no use of the service to break the law.
      </p>
    ),
  },
  {
    heading: "Third-party sites and ads",
    body: (
      <p>
        The site links to other websites and shows advertising. We are not responsible for the content or practices of those
        sites or advertisers.
      </p>
    ),
  },
  {
    heading: "Liability",
    body: (
      <p>
        The service is provided "as is". To the extent the law allows, Annex Technologies is not liable for any loss arising
        from your use of the site or of any listing on it.
      </p>
    ),
  },
  {
    heading: "Privacy",
    body: (
      <p>
        How we handle your personal data is explained in our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    heading: "Changes, governing law and contact",
    body: (
      <p>
        We may update these terms and will change the date at the top when we do. These terms are governed by the laws of
        Kenya. Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
];

const Terms = () => {
  useDocumentMeta({ title: "Terms of Use", description: "The terms for using Annex Careers as a job seeker or employer." });
  return (
    <LegalPage
      title="Terms of Use"
      updated="24 September 2026"
      intro={<p>Please read these terms before using Annex Careers.</p>}
      sections={sections}
    />
  );
};

export default Terms;
