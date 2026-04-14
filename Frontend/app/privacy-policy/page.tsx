import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Lucid",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 px-6 py-12">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-10">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: April 4, 2026</p>

        <div className="mt-8 space-y-6 text-sm md:text-base leading-7 text-slate-700">
          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">1. Introduction</h2>
            <p className="mt-2">
              Lucid values your privacy. This Privacy Policy explains what information we collect,
              how we use it, and the choices you have regarding your data when using our platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">2. Information We Collect</h2>
            <p className="mt-2">
              We may collect account details, usage data, and content you provide while using Lucid,
              such as profile information, learning activity, and communication preferences.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">3. How We Use Information</h2>
            <p className="mt-2">
              We use collected information to operate and improve the platform, personalize user
              experiences, provide support, maintain security, and comply with legal obligations.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">4. Data Sharing</h2>
            <p className="mt-2">
              We do not sell personal data. We may share information with trusted service providers,
              when required by law, or to protect users and the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">5. Data Security</h2>
            <p className="mt-2">
              We apply reasonable administrative, technical, and organizational safeguards to protect
              your data. No method of storage or transmission is fully secure, but we continuously
              work to improve protections.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">6. Your Choices</h2>
            <p className="mt-2">
              Depending on your jurisdiction, you may have rights to access, update, or delete your
              personal data. You can also update certain account settings directly in the application.
            </p>
          </section>

          <section>
            <h2 className="text-lg md:text-xl font-semibold text-slate-900">7. Contact</h2>
            <p className="mt-2">
              If you have any questions about this Privacy Policy, please contact your Lucid account
              administrator or support team.
            </p>
          </section>
        </div>

        <div className="mt-10">
          <Link href="/" className="inline-flex items-center rounded-full bg-[#2563EB] px-5 py-2.5 text-white text-sm font-semibold hover:bg-blue-700 transition-colors">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
