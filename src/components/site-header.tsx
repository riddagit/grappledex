import Link from "next/link";
import { SearchBox } from "@/components/search-box";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="wordmark">RollVault</Link>
        <SearchBox />
      </div>
    </header>
  );
}
