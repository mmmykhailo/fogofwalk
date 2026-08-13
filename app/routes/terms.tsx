import type { Route } from "./+types/terms"
import { PageShell } from "~/components/PageShell"
import { PageSection } from "~/components/PageSection"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Terms of Service — Fog of Walk" },
    {
      name: "description",
      content:
        "Terms of Service for Fog of Walk: acceptable use, disclaimers, liability limitations, and account rules.",
    },
  ]
}

export default function TermsPage() {
  return (
    <PageShell title="Terms of Service">
      <p className="mb-10 text-sm text-muted-foreground">
        Last updated: August 13, 2026
      </p>

      <PageSection title="Acceptance of terms">
        <p className="leading-relaxed">
          By accessing or using Fog of Walk (the "Service"), you agree to be
          bound by these Terms of Service (the "Terms"). If you do not agree, do
          not use the Service.
        </p>
      </PageSection>

      <PageSection title="What the Service provides">
        <p className="leading-relaxed">
          Fog of Walk is a social activity-tracking and mapping service. It
          allows you to create an account, import GPX, FIT, or similar activity
          files, upload photographs, visualize routes on maps, follow other
          users, interact with community content, and share activities or other
          content with other people. Features may change or be removed at any
          time without notice.
        </p>
      </PageSection>

      <PageSection title="Your account">
        <p className="mb-4 leading-relaxed">
          You sign in through a third-party authentication provider. You are
          responsible for maintaining the security of that account and for all
          activity that occurs under your account. You must provide accurate and
          complete information where requested, and you must not impersonate any
          person or entity.
        </p>
        <p className="leading-relaxed">
          We may suspend, restrict, or terminate your access at any time, for
          any reason or no reason, with or without notice.
        </p>
      </PageSection>

      <PageSection title="Your content and licenses">
        <p className="mb-4 leading-relaxed">
          You retain ownership of any content you upload, including activity
          files, photographs, comments, profile information, and other materials
          ("Your Content"). By uploading Your Content, you grant us a
          non-exclusive, worldwide, royalty-free, sublicensable license to
          store, display, transmit, and otherwise use Your Content solely to
          operate and provide the Service.
        </p>
        <p className="mb-4 leading-relaxed">
          You represent and warrant that you have all rights necessary to upload
          Your Content and that doing so does not violate any law or the rights
          of any third party.
        </p>
        <p className="leading-relaxed">
          Content that you make available to other users may be copied, viewed,
          or otherwise used by those users. Changing the visibility of content
          later does not necessarily undo copies that another person may have
          independently made.
        </p>
      </PageSection>

      <PageSection title="Acceptable use">
        <p className="mb-4 leading-relaxed">You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            use the Service for any illegal purpose or in violation of any
            applicable law;
          </li>
          <li>
            upload content that is unlawful, infringing, defamatory, harassing,
            hateful, fraudulent, obscene, or otherwise objectionable;
          </li>
          <li>
            abuse, disrupt, overload, scrape, reverse-engineer, or interfere
            with the Service;
          </li>
          <li>
            attempt to gain unauthorized access to any part of the Service or
            other users' accounts;
          </li>
          <li>distribute malware, spam, or other harmful code or materials;</li>
          <li>
            use automated means to access the Service without our prior written
            consent; or
          </li>
          <li>
            use the Service in any way that could harm the operator, other
            users, or third parties.
          </li>
        </ul>
      </PageSection>

      <PageSection title="No warranty">
        <p className="leading-relaxed">
          The Service is provided "as is" and "as available", without any
          warranty of any kind, express or implied, including but not limited to
          warranties of merchantability, fitness for a particular purpose,
          accuracy, reliability, security, availability, or non-infringement. We
          do not guarantee that the Service will be uninterrupted, timely,
          secure, or error-free, or that any defects will be corrected.
        </p>
      </PageSection>

      <PageSection title="No liability">
        <p className="leading-relaxed">
          To the fullest extent permitted by applicable law, the operator is not
          liable for any direct, indirect, incidental, special, consequential,
          punitive, or exemplary damages arising out of or relating to your
          access to or use of, or inability to access or use, the Service, Your
          Content, or any third-party content or services, even if advised of
          the possibility of such damages. This includes damages for lost data,
          lost profits, lost revenue, personal injury, property damage, privacy
          breaches, reputational harm, or any other losses.
        </p>
      </PageSection>

      <PageSection title="Your responsibility for data and backups">
        <p className="leading-relaxed">
          You are solely responsible for keeping backups of any files,
          photographs, or data you upload. We are not responsible for data loss,
          corruption, deletion, unauthorized access, or any other harm to Your
          Content. Use the Service at your own risk.
        </p>
      </PageSection>

      <PageSection title="Third-party services">
        <p className="leading-relaxed">
          The Service relies on third-party services for map tiles,
          authentication, hosting, and other infrastructure. We are not
          responsible for the availability, accuracy, privacy practices,
          security, or terms of those third-party services. Your use of those
          services is subject to their respective terms and policies.
        </p>
      </PageSection>

      <PageSection title="Source availability">
        <p className="leading-relaxed">
          The Service's source code is made available for transparency and
          educational purposes. Viewing or using the source code does not create
          any contractual relationship, warranty, support obligation, or license
          to operate the Service.
        </p>
      </PageSection>

      <PageSection title="Indemnification">
        <p className="leading-relaxed">
          You agree to indemnify and hold harmless the operator from any claims,
          damages, liabilities, costs, or expenses (including reasonable legal
          fees) arising out of or relating to your use of the Service, Your
          Content, your violation of these Terms, or your violation of any
          rights of a third party.
        </p>
      </PageSection>

      <PageSection title="Termination">
        <p className="leading-relaxed">
          We may suspend or terminate your access to the Service at any time,
          for any reason or no reason, with or without notice. Upon termination,
          your right to use the Service ceases immediately. Provisions that by
          their nature should survive termination will survive.
        </p>
      </PageSection>

      <PageSection title="Changes to the Service and terms">
        <p className="leading-relaxed">
          We may modify these Terms or the Service at any time. Continued use of
          the Service after changes means you accept the updated Terms. It is
          your responsibility to review the Terms periodically.
        </p>
      </PageSection>

      <PageSection title="Governing law and disputes">
        <p className="leading-relaxed">
          These Terms are governed by the laws of the Federal Republic of
          Germany, without regard to conflict-of-law principles. Any disputes
          shall be resolved in the courts of Germany.
        </p>
      </PageSection>

      <PageSection title="Contact">
        <p className="leading-relaxed">
          Questions about these Terms can be sent to{" "}
          <a
            href="mailto:mmmykhailo@proton.me"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            mmmykhailo@proton.me
          </a>
          .
        </p>
      </PageSection>
    </PageShell>
  )
}
