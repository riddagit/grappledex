import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db/client";
import { getPromotionPage, type PromotionPage } from "@/lib/public/promotion-page";

export const dynamic = "force-dynamic";

function year(date: string): string { return date.slice(0, 4); }

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPromotionPage(db, slug);
  if (!page) return { title: "Not found — Grappledex" };
  const title = `${page.promotion.name} — events & results — Grappledex`;
  const description = `${page.promotion.name} grappling events, cards and results.`;
  return { title, description, openGraph: { title, description } };
}

export default async function PromotionPublicPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getPromotionPage(db, slug);
  if (!page) notFound();
  return (
    <main className="wrap">
      <header>
        <div className="eyebrow"><span>Promotion</span></div>
        <h1 className="athlete-name">{page.promotion.name}</h1>
      </header>
      <Events page={page} />
    </main>
  );
}

function Events({ page }: { page: PromotionPage }) {
  return (
    <section>
      <div className="section-head">Events</div>
      {page.events.length === 0 ? (
        <p className="empty">No events recorded yet.</p>
      ) : (
        <div className="stack">
          {page.events.map((e) => (
            <div key={e.slug}>
              <Link href={`/event/${e.slug}`}>{e.name}</Link>
              {" · "}<span className="now">{year(e.startDate)}</span>
              {e.location ? ` · ${e.location}` : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
