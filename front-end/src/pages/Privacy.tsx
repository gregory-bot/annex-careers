import { Link } from "react-router-dom";
import LegalPage, { CONTACT_EMAIL, type LegalSection } from "@/components/LegalPage";
import { useDocumentMeta } from "@/lib/seo";

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const sections: LegalSection[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        Annex Careers (careers.annex-technologies.com) is a job aggregation platform run by Annex Technologies in Kenya.
        We are the data controller for the personal data described in this policy, and we process it in line with the
        Kenya Data Protection Act, 2019 and its regulations.
      </p>
    ),
  },
  {
    heading: "Information we collect",
    body: (
      <>
        <p>We collect only what we need to run the service:</p>
        <ul>
          <li><strong>Email alerts.</strong> When you subscribe, we store your email address so we can send you job alerts.</li>
          <li>
            <strong>CV checks.</strong> When you upload a CV to check it against a job or generate an ATS-friendly version, we
            read the text of the document. If the CV contains an email address, we save your name, email, the skills we
            detect and the extracted CV text so we can send you matching jobs. We do not keep the original file.
          </li>
          <li><strong>Employer accounts.</strong> Employers we invite provide a work email and the job listings they publish.</li>
          <li>
            <strong>Usage data.</strong> We record anonymous page views and clicks on "Apply" links, together with a random
            session identifier, the referring page and your browser's user agent. This tells us which listings are useful.
          </li>
          <li>
            <strong>Data kept on your device.</strong> Your CV Check chat history is saved in your browser's local storage and is
            not sent to our servers except when you upload a CV.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "How we use your information",
    body: (
      <ul>
        <li>To send the job alerts and job matches you asked for.</li>
        <li>To analyse your CV against a job and produce your match score and improved CV.</li>
        <li>To publish and manage listings for employers.</li>
        <li>To understand how the site is used, fix problems and improve it.</li>
        <li>To show advertising that keeps the platform free (see section 5).</li>
      </ul>
    ),
  },
  {
    heading: "Legal basis",
    body: (
      <p>
        We process your data on the basis of your consent (for example when you subscribe or upload a CV), to provide the
        service you requested, and for our legitimate interest in running and improving a secure platform. You can withdraw
        consent at any time.
      </p>
    ),
  },
  {
    heading: "Cookies and advertising",
    body: (
      <>
        <p>
          We use your browser's storage to keep your analytics session and chat history. We may show ads from third parties,
          including Google. Google and its partners use cookies to serve ads based on your visits to this and other websites.
        </p>
        <p>
          You can opt out of personalised advertising in{" "}
          <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">Google Ads Settings</a>, or learn more
          at <a href="https://www.aboutads.info/choices" target="_blank" rel="noopener noreferrer">aboutads.info</a>. See{" "}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
            how Google uses information from sites that use its services
          </a>.
        </p>
      </>
    ),
  },
  {
    heading: "Who we share it with",
    body: (
      <>
        <p>We do not sell your personal data. We share it only with the service providers that help us run the platform:</p>
        <ul>
          <li>Hosting and database providers that store our data.</li>
          <li>Email delivery providers that send our emails.</li>
          <li>Advertising partners such as Google, as described above.</li>
        </ul>
        <p>
          Some of these providers store data outside Kenya. Where that happens, we rely on providers that offer appropriate
          safeguards for your data. We may also disclose information when the law requires it.
        </p>
      </>
    ),
  },
  {
    heading: "Job listings and third-party sites",
    body: (
      <p>
        Many listings are collected from other job boards and company career pages. When you click "Apply" you leave Annex
        Careers, and the other site's own privacy policy applies to anything you submit there.
      </p>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <p>
        We keep subscriber and CV data while you use our alerts, and delete it when you ask us to. Anonymous usage records are
        kept for as long as they are useful for statistics.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <>
        <p>Under the Data Protection Act, 2019 you have the right to:</p>
        <ul>
          <li>be told how your data is used;</li>
          <li>get a copy of the personal data we hold about you;</li>
          <li>have inaccurate data corrected, or false and misleading data deleted;</li>
          <li>object to processing, including for direct marketing, and stop receiving emails;</li>
          <li>ask us to delete your data.</li>
        </ul>
        <p>
          To use any of these rights, including unsubscribing from alerts, email {mail}. If you are not satisfied with our
          response, you can complain to the{" "}
          <a href="https://www.odpc.go.ke" target="_blank" rel="noopener noreferrer">Office of the Data Protection Commissioner</a>.
        </p>
      </>
    ),
  },
  {
    heading: "Security",
    body: (
      <p>
        We use encrypted connections (HTTPS), access controls on admin and employer areas, and trusted hosting providers. No
        system is perfectly secure, so we cannot guarantee absolute security.
      </p>
    ),
  },
  {
    heading: "Children",
    body: <p>Annex Careers is for job seekers aged 18 and over. We do not knowingly collect data from children.</p>,
  },
  {
    heading: "Changes and contact",
    body: (
      <p>
        We may update this policy and will change the date at the top when we do. Questions? Email {mail} or visit our{" "}
        <Link to="/contact">contact page</Link>.
      </p>
    ),
  },
];

const Privacy = () => {
  useDocumentMeta({ title: "Privacy Policy", description: "How Annex Careers collects, uses and protects your personal data under the Kenya Data Protection Act, 2019." });
  return (
    <LegalPage
      title="Privacy Policy"
      updated="24 September 2026"
      intro={<p>This policy explains what personal data Annex Careers collects, why we collect it, and the choices you have.</p>}
      sections={sections}
    />
  );
};

export default Privacy;
