import { PromotionForm } from "./promotion-form";

export default function NewPromotionPage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New promotion</h1>
      <PromotionForm />
    </main>
  );
}
