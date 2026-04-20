import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Lucid",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-slate-100 text-slate-800 px-6 py-12 md:py-16">
      <div className="max-w-4xl mx-auto">
        <div className="rounded-3xl border border-sky-100 bg-gradient-to-r from-blue-700 via-cyan-600 to-teal-500 text-white p-6 md:p-8 shadow-lg">
          <p className="text-xs md:text-sm uppercase tracking-[0.18em] text-blue-100">Lucid Legal</p>
          <h1 className="mt-2 text-3xl md:text-5xl font-bold">Privacy Policy</h1>
          <p className="mt-3 text-sm md:text-base text-blue-50">
            This page explains how we collect, use, and protect your personal data when you use Lucid.
          </p>
          <p className="mt-4 text-sm text-blue-100">Last updated: April 17, 2026</p>
        </div>

        <div className="mt-6 rounded-3xl bg-white border border-slate-200/80 shadow-[0_10px_30px_rgba(2,6,23,0.08)] p-6 md:p-10">
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Please read this Privacy Policy together with our Terms and any notices shown when specific data is collected.
          </div>

          <div className="space-y-6 text-sm md:text-base leading-7 text-slate-700">
          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">1. Introduction</h2>
            <p className="mt-2">
              Lucid values your privacy. This Privacy Policy explains how Lucid collects, uses,
              stores, shares, and protects personal data when you access or use our platform,
              website, and related services. By accessing, registering, purchasing, or using
              Lucid, you confirm that you have read and understood this Privacy Policy.
            </p>
            <p className="mt-2">
              If you do not agree with this Privacy Policy, please discontinue use of the
              services. Your continued use of Lucid means you agree to the terms in effect at the
              time of use.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">2. Applicability and Third-Party Services</h2>
            <p className="mt-2">
              This Privacy Policy applies only to information collected through Lucid-controlled
              services. It does not apply to third-party websites, apps, or services linked from
              our platform. When you leave Lucid or use third-party integrations, their privacy
              policies apply.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">3. Information We Collect</h2>
            <p className="mt-2">
              We may collect the following categories of data:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>
                Identity Data: first name, last name, username, and date of birth.
              </li>
              <li>
                Contact Data: email address, phone number, and mailing address.
              </li>
              <li>
                Account and Profile Data: login credentials, preferences, interests, feedback,
                and survey responses.
              </li>
              <li>
                Transaction Data: subscription and purchase records, billing details, and payment
                status.
              </li>
              <li>
                Technical Data: IP address, device identifiers, browser type and version,
                operating system, time zone, and cookie identifiers.
              </li>
              <li>
                Usage Data: interactions with features, pages visited, and engagement patterns.
              </li>
              <li>
                Communications Data: support requests, complaints, and correspondence.
              </li>
            </ul>
            <p className="mt-2">
              We may also use aggregated or anonymized data for analytics and product improvement.
              Such data does not directly identify you.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">4. How We Collect Data</h2>
            <p className="mt-2">
              We collect personal data directly from you when you create an account, purchase
              services, complete forms, or contact support. We also collect data automatically
              through cookies and similar technologies, and from select service providers such as
              payment processors and analytics partners.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">5. How We Use Data</h2>
            <p className="mt-2">
              We use personal data to provide and improve Lucid services, manage accounts,
              personalize user experience, process payments, provide support, maintain security,
              prevent misuse, and comply with legal obligations.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">6. Cookies and Tracking</h2>
            <p className="mt-2">
              Cookies are small files stored on your browser or device. We use cookies and similar
              technologies to keep you signed in, remember preferences, analyze usage, and improve
              functionality. You can control cookie settings through your browser; disabling cookies
              may affect certain features of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">7. Information Sharing</h2>
            <p className="mt-2">
              We do not sell personal data. We may share data with trusted service providers,
              business partners supporting operations, and authorities when required by law or to
              protect rights, safety, and platform integrity.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">8. Data Security</h2>
            <p className="mt-2">
              We implement reasonable administrative, technical, and organizational safeguards to
              protect personal data against unauthorized access, alteration, disclosure, and
              destruction. While we strive to secure data, no internet-based transmission or storage
              system can be guaranteed fully secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">9. Data Retention</h2>
            <p className="mt-2">
              We retain personal data only as long as necessary for service delivery, legitimate
              business purposes, legal compliance, dispute resolution, and enforcement of our
              agreements. Data may be deleted or anonymized when retention is no longer required.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">10. Your Rights and Choices</h2>
            <p className="mt-2">
              Depending on applicable law, you may have rights to access, update, correct, delete,
              or restrict processing of your personal data, and to request portability of your data.
              You may also object to certain processing or withdraw consent where consent is the
              basis of processing.
            </p>
            <p className="mt-2">
              You can exercise these rights by contacting us using the details below.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">11. Children&apos;s Privacy</h2>
            <p className="mt-2">
              Lucid services are not intended for children below the age permitted by applicable
              law without parental or guardian consent. If we learn that data was collected without
              valid consent where required, we will take appropriate steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">12. Changes to This Policy</h2>
            <p className="mt-2">
              We may update this Privacy Policy from time to time to reflect legal, technical, or
              business changes. Updated versions will be posted on this page with a revised date.
              Continued use of Lucid after updates means you accept the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">13. Contact Us</h2>
            <p className="mt-2">
              For questions, complaints, or requests related to this Privacy Policy, contact us at
              <span className="font-medium"> support@lucid.com</span>. You may also contact your
              Lucid account administrator for organization-specific requests.
            </p>
          </section>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/" className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-white text-sm font-semibold hover:bg-slate-800 transition-colors">
              Back to Home
            </Link>
            <a href="mailto:support@lucid.com" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors">
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
