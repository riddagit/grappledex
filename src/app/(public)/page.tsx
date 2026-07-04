import Link from "next/link";

export const metadata = {
  title: "Grappledex — the definitive no-gi grappling records database",
  description:
    "Verified, structured records for elite professional no-gi grappling: athletes, matches, events and finishes.",
};

export default function LandingPage() {
  return (
    <main className="wrap">
      <div className="eyebrow"><span>Grappledex</span></div>
      <h1 className="athlete-name">The record<br />of record.</h1>
      <div className="record">
        <p style={{ maxWidth: "34rem", margin: 0 }}>
          A verified, connected database of professional no-gi grappling — every athlete,
          match, event and finish, entered by hand and sourced. Deep and correct beats
          broad and shallow.
        </p>
      </div>
      <section>
        <div className="section-head">Start here</div>
        <div className="stack">
          <Link href="/athlete/gordon-ryan">→ Gordon Ryan</Link>
        </div>
      </section>
    </main>
  );
}
