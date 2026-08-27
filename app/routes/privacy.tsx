import type { Route } from "./+types/privacy"
import { PageShell } from "~/components/PageShell"
import { PageSection } from "~/components/PageSection"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Privacy Policy — Fog of Walk" },
    {
      name: "description",
      content:
        "Privacy Policy for Fog of Walk: what data is collected, how it is used, and your rights under EU data protection law.",
    },
  ]
}

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy Policy">
      <p className="mb-10 text-sm text-muted-foreground">
        Last updated: August 13, 2026
      </p>

      <PageSection title="Introduction">
        <p className="leading-relaxed">
          This Privacy Policy explains how Fog of Walk ("Fog of Walk", "we",
          "us", or "our") collects, uses, stores, and shares personal data when
          you use our website, application, and related services (collectively,
          the "Service").
        </p>
      </PageSection>

      <PageSection title="Who is responsible for your data?">
        <p className="mb-4 leading-relaxed">
          Fog of Walk is operated by an individual developer (the "operator"),
          who is responsible for the processing of personal data described in
          this Privacy Policy.
        </p>
        <p className="mb-4 leading-relaxed">
          For privacy questions or requests concerning your personal data,
          contact:
        </p>
        <p className="leading-relaxed">
          <strong>Email:</strong>{" "}
          <a
            href="mailto:mmmykhailo@proton.me"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            mmmykhailo@proton.me
          </a>
        </p>
        <p className="mt-4 leading-relaxed">
          For the purposes of the EU General Data Protection Regulation
          ("GDPR"), the operator acts as the data controller for the personal
          data processed through the Service.
        </p>
      </PageSection>

      <PageSection title="What is Fog of Walk?">
        <p className="mb-4 leading-relaxed">
          Fog of Walk is a social activity-tracking and mapping service.
          Depending on the features you use, the Service allows you to:
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>create and manage an account;</li>
          <li>import GPX, FIT, or similar activity files;</li>
          <li>upload photographs;</li>
          <li>visualize activities and routes on maps;</li>
          <li>choose who can view activities and profile information;</li>
          <li>follow other users and interact with community content; and</li>
          <li>share activities or other content with other people.</li>
        </ul>
        <p className="mt-4 leading-relaxed">
          Some of these features require us to store information on our servers
          so that it can be accessed across devices and displayed to other users
          according to your settings.
        </p>
      </PageSection>

      <PageSection title="Information we collect">
        <h3 className="mt-4 mb-2 text-base font-semibold">
          Account information
        </h3>
        <p className="mb-4 leading-relaxed">
          When you create an account or sign in through a third-party
          authentication provider, we may receive your provider-specific user
          identifier, display name, profile photograph or avatar, and email
          address where provided by the authentication provider. We do not
          receive your third-party authentication password.
        </p>

        <h3 className="mt-4 mb-2 text-base font-semibold">
          Activity information
        </h3>
        <p className="mb-4 leading-relaxed">
          When you upload an activity, we process GPS coordinates, route
          information, date and time, distance, duration, speed or pace,
          elevation, laps or segments, other metrics contained in the uploaded
          file, and any name, description, or other metadata you add. GPS
          information can reveal where you live, work, exercise, or regularly
          travel, so consider carefully which activities you make visible to
          others.
        </p>

        <h3 className="mt-4 mb-2 text-base font-semibold">Photos</h3>
        <p className="mb-4 leading-relaxed">
          If you upload photographs, we process the photographs and associated
          metadata, including timestamps or geographic coordinates where
          present. Metadata may be retained or removed depending on how the
          Service processes the photograph. Avoid uploading photographs
          containing personal information that you do not want to share.
        </p>

        <h3 className="mt-4 mb-2 text-base font-semibold">
          Social and user-generated content
        </h3>
        <p className="mb-4 leading-relaxed">
          We process follows, comments, reactions, activity descriptions,
          profile information, photographs, activities and routes you choose to
          share, and other content you submit. Content made available to other
          users may be copied, viewed, or used by those users, regardless of
          later changes to visibility.
        </p>

        <h3 className="mt-4 mb-2 text-base font-semibold">
          Technical and security information
        </h3>
        <p className="leading-relaxed">
          When you use the Service, we may process your IP address, request date
          and time, browser or device information where made available,
          diagnostic and error information, and authentication and security
          events. Some preferences may also be stored locally in your browser or
          device. We do not intentionally collect more technical information
          than is reasonably necessary for operating, securing, and
          troubleshooting the Service.
        </p>
      </PageSection>

      <PageSection title="How we use personal data">
        <p className="mb-4 leading-relaxed">We use personal data to:</p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>create and maintain your account and authenticate you;</li>
          <li>store and display your activities, photographs, and routes;</li>
          <li>process uploaded files and display maps;</li>
          <li>
            provide social features and synchronize information between devices;
          </li>
          <li>
            protect accounts, detect unauthorized access, investigate abuse, and
            maintain security;
          </li>
          <li>
            send service-related communications such as account, security, or
            operational notices;
          </li>
          <li>
            diagnose problems and improve existing functionality, using
            aggregated or minimized information where practical;
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          We do not sell your personal data or use it for advertising.
        </p>
      </PageSection>

      <PageSection title="Legal bases for processing">
        <p className="mb-4 leading-relaxed">
          Where the GDPR applies, we rely on one or more of the following legal
          bases:
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            <strong>Performance of a contract</strong> — processing necessary to
            provide the Service you request.
          </li>
          <li>
            <strong>Legitimate interests</strong> — securing the Service,
            preventing abuse, maintaining infrastructure, troubleshooting, and
            protecting our legal rights, provided those interests are not
            overridden by your rights.
          </li>
          <li>
            <strong>Consent</strong> — where processing is genuinely optional
            and requires your specific permission. You may withdraw consent at
            any time.
          </li>
          <li>
            <strong>Legal obligations</strong> — where necessary to comply with
            applicable law.
          </li>
        </ul>
      </PageSection>

      <PageSection title="Activity and profile privacy">
        <p className="mb-4 leading-relaxed">
          The Service provides controls that determine who can see your profile,
          activities, routes, photographs, or other content. Depending on your
          settings, content may be visible only to you, to selected users or
          followers, or publicly visible.
        </p>
        <p className="leading-relaxed">
          You are responsible for choosing appropriate privacy settings before
          sharing location information. Because activity data can reveal
          sensitive patterns about your movements, we encourage you to review
          your privacy settings carefully before publishing an activity.
        </p>
      </PageSection>

      <PageSection title="Who we share information with">
        <p className="mb-4 leading-relaxed">
          We do not sell your personal data.
        </p>
        <p className="mb-4 leading-relaxed">
          Information you intentionally make visible through the Service may be
          viewed by other users or the public, depending on your privacy
          settings.
        </p>
        <p className="mb-4 leading-relaxed">
          We use the following categories of service providers:
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            <strong>Hosting:</strong> netcup.de (Germany) — server hosting and
            infrastructure.
          </li>
          <li>
            <strong>Authentication:</strong> your chosen OAuth provider (e.g.,
            GitHub, Google, etc.).
          </li>
          <li>
            <strong>Maps:</strong> OpenFreeMap and Esri — map tiles and related
            mapping resources.
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          Map providers may receive your IP address and the geographic area for
          which map information is requested. Their processing is governed by
          their own privacy policies.
        </p>
        <p className="mt-4 leading-relaxed">
          We may also disclose information where reasonably necessary to comply
          with a legal obligation, protect rights or safety, investigate abuse,
          or establish, exercise, or defend legal claims.
        </p>
      </PageSection>

      <PageSection title="International transfers">
        <p className="leading-relaxed">
          The Service is hosted in Germany by netcup.de. Some service providers
          (such as map providers or authentication providers) may process
          personal data outside the European Economic Area. Where such transfers
          occur, we rely on the transfer mechanisms required by applicable data
          protection law, such as an adequacy decision or Standard Contractual
          Clauses.
        </p>
      </PageSection>

      <PageSection title="Data retention">
        <p className="mb-4 leading-relaxed">
          We retain personal data only for as long as reasonably necessary for
          the purposes described in this Privacy Policy. For example:
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            account information is retained while your account remains active;
          </li>
          <li>
            activities, photographs, and other user content are retained while
            necessary to provide the features you use, unless you delete them;
          </li>
          <li>
            security and server logs are retained for approximately 30 days for
            security and operational purposes; and
          </li>
          <li>
            information required to comply with legal obligations may be
            retained for the period required by law.
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          When personal data is no longer necessary, we delete it, anonymize it,
          or dispose of it in accordance with our retention practices, subject
          to applicable legal exceptions.
        </p>
      </PageSection>

      <PageSection title="Account deletion">
        <p className="mb-4 leading-relaxed">
          You may request deletion of your account using the account deletion
          functionality in the Service or by contacting us at{" "}
          <a
            href="mailto:mmmykhailo@proton.me"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            mmmykhailo@proton.me
          </a>
          .
        </p>
        <p className="leading-relaxed">
          When an account is deleted, we will delete or anonymize associated
          personal data unless we have a lawful reason to retain particular
          information. Deletion may not immediately remove information that must
          temporarily remain in backups, information that we are legally
          required to retain, or content that has been independently copied or
          redistributed by other users.
        </p>
      </PageSection>

      <PageSection title="Your data protection rights">
        <p className="mb-4 leading-relaxed">
          Where applicable under the GDPR and other data protection laws, you
          may have the right to:
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>access your personal data;</li>
          <li>correct inaccurate or incomplete personal data;</li>
          <li>request deletion of personal data;</li>
          <li>request restriction of processing;</li>
          <li>object to certain processing;</li>
          <li>
            receive certain personal data in a structured, commonly used,
            machine-readable format;
          </li>
          <li>withdraw consent where processing is based on consent; and</li>
          <li>
            lodge a complaint with a competent data protection supervisory
            authority.
          </li>
        </ul>
        <p className="mt-4 leading-relaxed">
          To exercise a right, contact{" "}
          <a
            href="mailto:mmmykhailo@proton.me"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            mmmykhailo@proton.me
          </a>
          . We may need to verify your identity before fulfilling certain
          requests.
        </p>
      </PageSection>

      <PageSection title="Cookies and local storage">
        <p className="leading-relaxed">
          The Service uses local browser storage (such as IndexedDB and
          localStorage) to keep preferences, cached data, and authentication
          tokens. We do not use tracking cookies, analytics identifiers, or
          third-party telemetry. If we introduce non-essential cookies or
          similar technologies that require consent under applicable law, we
          will provide the appropriate information and controls before using
          them.
        </p>
      </PageSection>

      <PageSection title="Children's privacy">
        <p className="leading-relaxed">
          The Service is not intended for children who are not legally permitted
          to use it under applicable law. If you believe a child has provided
          personal data to us in circumstances where they were not permitted to
          do so, please contact us so we can investigate and take appropriate
          action.
        </p>
      </PageSection>

      <PageSection title="Security">
        <p className="leading-relaxed">
          We use reasonable technical and organizational measures to protect
          personal data against unauthorized access, alteration, disclosure,
          loss, or destruction. No internet-based service can guarantee absolute
          security. If we become aware of a personal data breach that requires
          notification under applicable law, we will take the steps required by
          that law.
        </p>
      </PageSection>

      <PageSection title="Third-party services">
        <p className="leading-relaxed">
          The Service may contain links to or integrations with third-party
          services. Those services operate independently and have their own
          privacy policies and terms. We encourage you to review those policies
          before providing information directly to third parties.
        </p>
      </PageSection>

      <PageSection title="Source availability">
        <p className="leading-relaxed">
          The app's source code is available for inspection. This supports
          transparency about how the service works. It does not grant any right
          to operate the service or imply any warranty or support obligation.
        </p>
      </PageSection>

      <PageSection title="Changes to this Privacy Policy">
        <p className="leading-relaxed">
          We may update this Privacy Policy from time to time. Continued use of
          the Service after changes means you accept the updated policy.
        </p>
      </PageSection>

      <PageSection title="Contact">
        <p className="leading-relaxed">
          For questions about this Privacy Policy or requests concerning your
          personal data, contact{" "}
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
