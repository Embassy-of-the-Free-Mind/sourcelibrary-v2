import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Copyright & DMCA Policy — Source Library',
  description: 'Copyright policy, DMCA takedown procedure, and designated agent information for Source Library.',
  alternates: { canonical: '/dmca' },
};

export default function DmcaPage() {
  return (
    <ContentPageLayout>
      <ContentHeader
        title="Copyright & DMCA Policy"
        subtitle="How we handle copyright and takedown requests"
      />

      <div className="prose prose-slate max-w-none">

        <h2>Our Content</h2>
        <p>
          Source Library hosts digitized primary source texts — principally works published before
          1800, together with early 20th-century bilingual scholarly editions (such as the Loeb
          Classical Library) whose original publication dates place them in the public domain in
          the United States. All content is sourced from established institutional repositories
          including the Internet Archive, Bibliothèque nationale de France (Gallica), the Bayerische
          Staatsbibliothek (MDZ), the Wellcome Collection, and other public-domain digital libraries.
        </p>
        <p>
          We make a good-faith effort to verify the public-domain status of every item before
          import. If you believe we have made an error, please contact us using the procedure below.
        </p>

        <h2>DMCA Designated Agent</h2>
        <p>
          Source Library is operated by Stichting Het Wereldhart — Embassy of the Free Mind
          (Amsterdam, Netherlands). In compliance with the Digital Millennium Copyright Act
          (17 U.S.C. § 512), we have registered a Designated Agent with the United States
          Copyright Office.
        </p>

        <table className="text-sm">
          <tbody>
            <tr>
              <td className="font-medium pr-6 py-1">Service Provider</td>
              <td>Stichting Het Wereldhart — Embassy of the Free Mind</td>
            </tr>
            <tr>
              <td className="font-medium pr-6 py-1">Registration</td>
              <td>DMCA-1072831 (U.S. Copyright Office Designated Agent Directory)</td>
            </tr>
            <tr>
              <td className="font-medium pr-6 py-1">Designated Agent</td>
              <td>Derek Lomas</td>
            </tr>
            <tr>
              <td className="font-medium pr-6 py-1">Address</td>
              <td>Keizersgracht 123-4, 1015 CJ Amsterdam, Netherlands</td>
            </tr>
            <tr>
              <td className="font-medium pr-6 py-1">Email</td>
              <td>
                <a href="mailto:contact@sourcelibrary.org">contact@sourcelibrary.org</a>
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Filing a Takedown Notice</h2>
        <p>
          To submit a notice of claimed copyright infringement under 17 U.S.C. § 512(c)(3),
          send a written communication to the Designated Agent that includes:
        </p>
        <ol>
          <li>
            A physical or electronic signature of the copyright owner or an authorized agent.
          </li>
          <li>
            Identification of the copyrighted work claimed to be infringed (or, if multiple
            works are covered by a single notice, a representative list).
          </li>
          <li>
            Identification of the material you claim is infringing, with enough detail for us
            to locate it (a URL is sufficient).
          </li>
          <li>
            Your contact information: name, address, telephone number, and email address.
          </li>
          <li>
            A statement that you have a good-faith belief that use of the material is not
            authorized by the copyright owner, its agent, or the law.
          </li>
          <li>
            A statement, under penalty of perjury, that the information in the notice is
            accurate and that you are the copyright owner or authorized to act on behalf
            of the copyright owner.
          </li>
        </ol>
        <p>
          Send notices to{' '}
          <a href="mailto:contact@sourcelibrary.org">contact@sourcelibrary.org</a> with the subject
          line <strong>DMCA Takedown Notice</strong>.
        </p>
        <p>
          Upon receipt of a valid notice, we will remove the identified material promptly and
          notify the party responsible for the content.
        </p>

        <h2>Counter-Notice</h2>
        <p>
          If you believe your material was removed in error, you may submit a counter-notice
          under 17 U.S.C. § 512(g)(3) to the same address. A valid counter-notice must include:
        </p>
        <ol>
          <li>Your physical or electronic signature.</li>
          <li>Identification of the removed material and its location before removal.</li>
          <li>
            A statement under penalty of perjury that you have a good-faith belief the material
            was removed as a result of mistake or misidentification.
          </li>
          <li>
            Your name, address, and telephone number, and a statement consenting to the
            jurisdiction of the federal district court for the district in which your address
            is located (or, if outside the U.S., any judicial district in which we may be found).
          </li>
        </ol>
        <p>
          If we receive a valid counter-notice, we may restore the material after 10–14 business
          days unless the original claimant notifies us that they have filed a court action.
        </p>

        <h2>Repeat Infringers</h2>
        <p>
          We will terminate access for users or accounts that are the subject of repeated,
          substantiated copyright infringement claims.
        </p>

      </div>
    </ContentPageLayout>
  );
}
